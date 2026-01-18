/**
 * CLUB CRITTERS - MAIN APP LOGIC (SMART CACHE VERSION)
 * Uses LocalStorage to render instantly, then updates from network in background.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const scheduleSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=0&single=true&output=csv";
const rosterSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=1671173789&single=true&output=csv";
const archiveSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=532548123&single=true&output=csv"; 

const shareMessageTemplate = "🔊 LIVE NOW: {dj} is playing {genre}! Join us: https://critters.club";

// Cache Keys
const CACHE_KEY_ROSTER = 'cc_roster_v1';
const CACHE_KEY_SCHEDULE = 'cc_schedule_v1';

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #29C5F6; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #29C5F6; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    success: "color: #00e676; font-weight: bold;",
    state: "background: #B36AF4; color: #fff; font-weight: bold; padding: 2px 8px; border-radius: 4px;",
    info: "color: #888; font-style: italic;",
    error: "background: #ff4444; color: #fff; padding: 2px 5px; border-radius: 2px;"
};

// ==========================================
//          GLOBAL STATE
// ==========================================

const offlineView = document.getElementById('offline-view');
const eventView = document.getElementById('event-view');
const loadingView = document.getElementById('loading-view');
const badgeContainer = document.getElementById('status-badge-container');
const djContainer = document.getElementById('dj-container');
const subtext = document.getElementById('status-subtext');
const archiveLink = document.getElementById('archive-link');

let eventStartTime = null;
let eventEndTime = null;
let forceOffline = false;
let djSchedule = [];
let rosterMap = {}; 
let currentState = null; 
let userTimezoneCode = ""; 
let countdownInterval = null; 

// ==========================================
//          INITIALIZATION (CACHE + NETWORK)
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c ROSTER SYSTEM STARTUP ", logStyle.banner, logStyle.tag);

    try {
        userTimezoneCode = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(part => part.type == 'timeZoneName').value;
    } catch (e) { userTimezoneCode = "LOC"; }

    // --- PHASE 1: INSTANT LOAD (CACHE) ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedSchedule = localStorage.getItem(CACHE_KEY_SCHEDULE);

    if (cachedRoster && cachedSchedule) {
        console.log("%c[CACHE] Loading from local storage...", logStyle.info);
        processRosterData(cachedRoster);
        processScheduleData(cachedSchedule);
        checkStatus(); // Render immediately!
    } else {
        console.log("%c[CACHE] Miss. Waiting for network...", logStyle.info);
    }

    // --- PHASE 2: FRESH FETCH (NETWORK) ---
    try {
        const [rosterResp, scheduleResp] = await Promise.all([
            fetch(rosterSheetUrl),
            fetch(scheduleSheetUrl)
        ]);

        if (rosterResp.ok && scheduleResp.ok) {
            const rosterText = await rosterResp.text();
            const scheduleText = await scheduleResp.text();

            // Only re-process if data has changed (simple string comparison)
            const isRosterNew = rosterText !== cachedRoster;
            const isScheduleNew = scheduleText !== cachedSchedule;

            if (isRosterNew || isScheduleNew) {
                console.log("%c[NETWORK] New data detected. Updating...", logStyle.success);
                
                // Update Cache
                localStorage.setItem(CACHE_KEY_ROSTER, rosterText);
                localStorage.setItem(CACHE_KEY_SCHEDULE, scheduleText);

                // Re-process and Re-render
                processRosterData(rosterText);
                processScheduleData(scheduleText);
                checkStatus();
            } else {
                console.log("%c[NETWORK] Data is up to date.", logStyle.success);
            }
        }
    } catch (error) {
        console.warn("Network update failed. Using cache if available.", error);
        // If we have no cache and network fails, show offline
        if (!cachedRoster) showOffline("Community Hub"); 
    }

    setInterval(checkStatus, 5000);
}

// ==========================================
//          DATA PROCESSING
// ==========================================

function processRosterData(csvText) {
    const rows = csvText.split(/\r?\n/);
    if (rows.length < 2) return;

    const headers = rows[0].split(',').map(h => h.trim());
    rosterMap = {};

    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        const name = cols[0];
        if (!name) continue;

        const entry = {
            name: name,
            image: cols[3] || "cdn/logos/club/HeadOnly.png",
            color: cols[4] && cols[4].startsWith('#') ? ensureReadableColor(cols[4]) : null,
            links: {}
        };

        for (let x = 6; x < cols.length; x++) {
            if (cols[x] && headers[x]) {
                entry.links[headers[x]] = cols[x];
            }
        }
        rosterMap[name.toLowerCase()] = entry;
    }
}

function processScheduleData(csvText) {
    const rows = csvText.split(/\r?\n/);
    const settingsRow = rows[1].split(',').map(c => c.trim());
    
    eventStartTime = settingsRow[0];
    eventEndTime = settingsRow[1];
    const offlineCell = settingsRow[2] ? settingsRow[2].toUpperCase() : "";
    forceOffline = (offlineCell === "TRUE" || offlineCell === "YES" || offlineCell === "1");

    djSchedule = [];

    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        if (cols.length < 4 || !cols[3]) continue; 

        const name = cols[3];
        const rosterData = rosterMap[name.toLowerCase()];

        const dj = {
            name: name,
            timeRaw: cols[4],
            genre: cols[5],
            image: rosterData ? rosterData.image : "cdn/logos/club/HeadOnly.png",
            color: rosterData ? rosterData.color : null,
            links: rosterData ? rosterData.links : {}
        };

        djSchedule.push(dj);
    }
}

// ==========================================
//          HELPER FUNCTIONS
// ==========================================

function processDjTime(timeStr) {
    if (!timeStr || !eventStartTime) return null;
    const times = timeStr.match(/(\d{1,2}):(\d{2})/g);
    if (!times || times.length < 2) return null;

    const eventDate = new Date(eventStartTime);
    const [startH, startM] = times[0].split(':').map(Number);
    const [endH, endM] = times[1].split(':').map(Number);

    const start = new Date(eventDate);
    start.setUTCHours(startH, startM, 0, 0);
    const end = new Date(eventDate);
    end.setUTCHours(endH, endM, 0, 0);

    if (startH < eventDate.getUTCHours() - 6) { 
        start.setDate(start.getDate() + 1);
        end.setDate(end.getDate() + 1);
    } else if (end < start) {
        end.setDate(end.getDate() + 1);
    }

    const timeOptions = { hour: '2-digit', minute: '2-digit' };
    const localDisplay = `${start.toLocaleTimeString([], timeOptions)} - ${end.toLocaleTimeString([], timeOptions)} ${userTimezoneCode}`;

    return { startObj: start, endObj: end, displayString: localDisplay };
}

function ensureReadableColor(hex) {
    hex = hex.replace(/^#/, '');
    let r = parseInt(hex.substring(0, 2), 16) / 255;
    let g = parseInt(hex.substring(2, 4), 16) / 255;
    let b = parseInt(hex.substring(4, 6), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } 
    else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    if (l < 0.6) l = 0.6;
    h = Math.round(h * 360); s = Math.round(s * 100); l = Math.round(l * 100);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

// ==========================================
//          STATE MANAGEMENT
// ==========================================

function checkStatus() {
    if (forceOffline) {
        if (currentState !== 'disabled') {
            showOffline("Community Hub");
            currentState = 'disabled';
        }
        return;
    }
    if (!eventStartTime || !eventEndTime) {
        if (currentState !== 'disabled') {
            showOffline("Community Hub");
            currentState = 'disabled';
        }
        return;
    }

    const now = new Date();
    const start = new Date(eventStartTime);
    const end = new Date(eventEndTime);

    let newState = '';
    if (now >= end) newState = 'finished';
    else if (now >= start) newState = 'live';
    else newState = 'upcoming';

    if (newState === 'live') {
        currentState = newState;
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        renderEventView(true);
    } 
    else if (newState !== currentState) {
        currentState = newState;
        if (newState === 'finished') {
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
            showOffline("Thanks for partying with us! <br><span style='font-size:0.8rem; color:#888; display:block; margin-top:5px;'>(Archives take a short time to process/upload)</span>"); 
        } 
        else if (newState === 'upcoming') {
            renderEventView(false);
            startCountdown(start);
        }
    }

    // Always check for Featured Set if we aren't showing the Live schedule
    if (currentState === 'disabled' || currentState === 'finished' || (!eventStartTime && !forceOffline)) {
         fetchAndShowFeaturedSet();
    }
}

function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        const now = new Date();
        const diff = startTime - now;
        if (diff <= 0) return;
        if (diff < 7200000) {
            const h = Math.floor((diff / (1000 * 60 * 60)));
            const m = Math.floor((diff / (1000 * 60)) % 60);
            const s = Math.floor((diff / 1000) % 60);
            const badge = document.querySelector('.status-badge');
            if (badge) badge.innerHTML = `⏱️ STARTING IN: ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

// ==========================================
//          FEATURED SET (OFFLINE)
// ==========================================

async function fetchAndShowFeaturedSet() {
    const container = document.getElementById('featured-container');
    if (!container || container.innerHTML !== "") return;

    try {
        let archiveText;
        if (Object.keys(rosterMap).length === 0) {
            // Fallback if roster empty: fetch both
            const [rosterRes, archiveRes] = await Promise.all([
                fetch(rosterSheetUrl),
                fetch(archiveSheetUrl)
            ]);
            const rosterText = await rosterRes.text();
            archiveText = await archiveRes.text();
            processRosterData(rosterText);
        } else {
            const response = await fetch(archiveSheetUrl);
            archiveText = await response.text();
        }

        const rows = archiveText.split(/\r?\n/);
        let potentialSets = [];
        let latestDateObj = new Date(0);

        for (let i = 1; i < rows.length; i++) {
            if (!rows[i]) continue;
            const cols = rows[i].split(',').map(c => c.trim());
            const name = cols[0];
            if (!name) continue;

            const rosterData = rosterMap[name.toLowerCase()];
            const image = rosterData ? rosterData.image : "cdn/logos/club/HeadOnly.png";

            for (let x = 1; x < cols.length; x += 3) {
                const title = cols[x];
                const dateStr = cols[x+1];
                const link = cols[x+2];
                if (title && link && dateStr) {
                    const d = new Date(dateStr);
                    if (!isNaN(d)) {
                        potentialSets.push({ dj: name, image, title, dateStr, dateObj: d, link });
                        if (d > latestDateObj) latestDateObj = d;
                    }
                }
            }
        }

        const featuredSets = potentialSets.filter(set => set.dateObj.getTime() === latestDateObj.getTime());
        if (featuredSets.length > 0) renderFeaturedSets(featuredSets);

    } catch (e) { console.warn("Featured set error", e); }
}

function renderFeaturedSets(sets) {
    const container = document.getElementById('featured-container');
    let html = '';
    sets.forEach(set => {
        let displayDate = set.dateStr;
        try { displayDate = set.dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e){}
        html += `
            <a href="${set.link}" target="_blank" style="text-decoration:none;">
                <div class="featured-card">
                    <div class="featured-badge">LATEST SET</div>
                    <img src="${set.image}" alt="${set.dj}" class="featured-img">
                    <div class="featured-info">
                        <h3>${set.title}</h3>
                        <p>By <strong>${set.dj}</strong> • ${displayDate}</p>
                    </div>
                    <div style="margin-left:auto; font-size:1.2rem; color:var(--primary-blue);">▶</div>
                </div>
            </a>`;
    });
    container.innerHTML = html;
}

// ==========================================
//          UI RENDERING
// ==========================================

function showOffline(message) {
    document.title = "Club Critters - " + message.replace(/<[^>]*>?/gm, '');
    document.body.classList.add('body-centered');
    archiveLink.classList.remove('hidden');
    loadingView.classList.add('hidden');
    offlineView.classList.remove('hidden');
    eventView.classList.add('hidden');
    badgeContainer.innerHTML = '';
    subtext.innerHTML = message;
    fetchAndShowFeaturedSet();
}

function renderEventView(isLive) {
    document.body.classList.remove('body-centered');
    archiveLink.classList.add('hidden');
    loadingView.classList.add('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.remove('hidden');

    if (isLive) {
        document.title = "Club Critters - LIVE NOW";
        badgeContainer.innerHTML = '<div class="status-badge status-live">🔴 EVENT LIVE NOW</div>';
        subtext.innerText = "Tonight's Lineup";
    } else {
        document.title = "Club Critters - UPCOMING";
        const d = new Date(eventStartTime);
        badgeContainer.innerHTML = `<div class="status-badge status-upcoming">📅 STARTING: ${d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'})}</div>`;
        subtext.innerText = "Upcoming Schedule";
    }

    djContainer.innerHTML = ''; 
    const now = new Date();

    djSchedule.forEach(dj => {
        const timeData = processDjTime(dj.timeRaw);
        const isActive = (isLive && timeData && now >= timeData.startObj && now < timeData.endObj);
        
        let shareButton = '';
        if (isActive) {
            const safeShareText = shareMessageTemplate.replace("{dj}", dj.name).replace("{genre}", dj.genre).replace(/'/g, "\\'");
            shareButton = `<button class="share-btn" onclick="copyToClipboard('${safeShareText}', this)">🔗 Share</button>`;
        }
        
        const liveTag = isActive ? `<span class="live-tag">ON AIR <div class="visualizer"><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div></div></span>` : '';
        let linksHtml = Object.keys(dj.links).length > 0 ? '<div class="social-tags">' + Object.keys(dj.links).map(k => `<a href="${dj.links[k]}" target="_blank" class="social-tag">${k}</a>`).join('') + '</div>' : '';

        const card = document.createElement('div');
        card.className = `dj-card ${isActive ? 'dj-active' : ''}`; 
        if (dj.color) card.style.setProperty('--accent-color', dj.color);

        card.innerHTML = `
            <img src="${dj.image}" alt="${dj.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${dj.name} ${liveTag}</h3>
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${shareButton}
                        <span class="time">${timeData ? timeData.displayString : dj.timeRaw}</span>
                    </div>
                </div>
                <span class="genre">${dj.genre}</span>
                ${linksHtml}
            </div>
        `;
        djContainer.appendChild(card);
    });
}

window.copyToClipboard = function(text, btnElement) {
    navigator.clipboard.writeText(text).then(() => {
        btnElement.classList.add('copied');
        setTimeout(() => btnElement.classList.remove('copied'), 2000);
    });
};

init();