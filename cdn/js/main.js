/**
 * CLUB CRITTERS - MAIN APP LOGIC (V1.3 - DEEP LINK, CHAMELEON, FULL CACHE, FEATURED GENRE)
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
const CACHE_KEY_ARCHIVE = 'cc_archive_v1';

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
let vrcInstanceUrl = ""; 
let djSchedule = [];
let rosterMap = {}; 
let rawArchiveData = ""; 
let currentState = null; 
let userTimezoneCode = ""; 
let countdownInterval = null; 

// ==========================================
//          INITIALIZATION (CACHE + NETWORK)
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c SYSTEM STARTUP ", logStyle.banner, logStyle.tag);

    try {
        userTimezoneCode = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(part => part.type == 'timeZoneName').value;
    } catch (e) { userTimezoneCode = "LOC"; }

    // --- PHASE 1: INSTANT LOAD (CACHE) ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedSchedule = localStorage.getItem(CACHE_KEY_SCHEDULE);
    const cachedArchive = localStorage.getItem(CACHE_KEY_ARCHIVE);

    if (cachedRoster && cachedSchedule) {
        console.log("%c[CACHE] Loading from local storage...", logStyle.info);
        processRosterData(cachedRoster);
        processScheduleData(cachedSchedule);
        if (cachedArchive) rawArchiveData = cachedArchive; 
        checkStatus(); 
    } else {
        console.log("%c[CACHE] Miss. Waiting for network...", logStyle.info);
    }

    // --- PHASE 2: FRESH FETCH (NETWORK) ---
    try {
        const [rosterResp, scheduleResp, archiveResp] = await Promise.all([
            fetch(rosterSheetUrl),
            fetch(scheduleSheetUrl),
            fetch(archiveSheetUrl)
        ]);

        if (rosterResp.ok && scheduleResp.ok && archiveResp.ok) {
            const rosterText = await rosterResp.text();
            const scheduleText = await scheduleResp.text();
            const archiveText = await archiveResp.text();

            const isRosterNew = rosterText !== cachedRoster;
            const isScheduleNew = scheduleText !== cachedSchedule;
            const isArchiveNew = archiveText !== cachedArchive;

            if (isRosterNew || isScheduleNew || isArchiveNew) {
                console.log("%c[NETWORK] New data detected. Updating...", logStyle.success);
                
                localStorage.setItem(CACHE_KEY_ROSTER, rosterText);
                localStorage.setItem(CACHE_KEY_SCHEDULE, scheduleText);
                localStorage.setItem(CACHE_KEY_ARCHIVE, archiveText);

                processRosterData(rosterText);
                processScheduleData(scheduleText);
                rawArchiveData = archiveText; 

                checkStatus();
            } else {
                console.log("%c[NETWORK] Data is up to date.", logStyle.success);
            }
        }
    } catch (error) {
        console.warn("Network update failed. Using cache if available.", error);
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

        // 🛑 UPDATED: Start from Column 7 (H) instead of 6 (G)
        // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7
        for (let x = 7; x < cols.length; x++) {
            if (cols[x] && headers[x]) {
                entry.links[headers[x]] = cols[x];
            }
        }
        rosterMap[name.toLowerCase()] = entry;
    }
}

function processScheduleData(csvText) {
    const rows = csvText.split(/\r?\n/);
    
    // Row 2 (Index 1) is Settings
    const settingsRow = rows[1].split(',').map(c => c.trim());
    
    eventStartTime = settingsRow[0];
    eventEndTime = settingsRow[1];
    const offlineCell = settingsRow[2] ? settingsRow[2].toUpperCase() : "";
    forceOffline = (offlineCell === "TRUE" || offlineCell === "YES" || offlineCell === "1");
    
    // Capture VRC Link from Cell D2 (Index 3)
    vrcInstanceUrl = settingsRow[3] || "";

    djSchedule = [];

    // Start at i = 2 (Row 3) to skip the Header and Settings rows
    for (let i = 2; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        
        // FIX: Check for Name in Column E (Index 4), not D. Need at least 5 cols.
        if (cols.length < 5 || !cols[4]) continue; 

        const name = cols[4];    // Column E
        const timeRaw = cols[5]; // Column F
        const genre = cols[6];   // Column G

        const rosterData = rosterMap[name.toLowerCase()];

        const dj = {
            name: name,
            timeRaw: timeRaw,
            genre: genre,
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

// THEME MANAGER (V1.3 - Chameleon Mode)
function updateSiteTheme(color) {
    const root = document.documentElement;
    if (color) {
        root.style.setProperty('--primary-blue', color);
        root.style.setProperty('--primary-purple', color);
    } else {
        root.style.setProperty('--primary-blue', '#29C5F6');
        root.style.setProperty('--primary-purple', '#B36AF4');
    }
}

// VRC DEEP LINK PARSER (V1.3)
function generateDeepLink(webUrl) {
    try {
        const url = new URL(webUrl);
        const worldId = url.searchParams.get("worldId");
        const instanceId = url.searchParams.get("instanceId");
        if (worldId && instanceId) {
            return `vrchat://launch?id=${worldId}:${instanceId}`;
        }
    } catch (e) { }
    return null;
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

function fetchAndShowFeaturedSet() {
    const container = document.getElementById('featured-container');
    if (!container || container.innerHTML !== "" || !rawArchiveData) return;

    try {
        const rows = rawArchiveData.split(/\r?\n/);
        let potentialSets = [];
        let latestDateObj = new Date(0);

        for (let i = 1; i < rows.length; i++) {
            if (!rows[i]) continue;
            const cols = rows[i].split(',').map(c => c.trim());
            const name = cols[0];
            if (!name) continue;

            const rosterData = rosterMap[name.toLowerCase()];
            const image = rosterData ? rosterData.image : "cdn/logos/club/HeadOnly.png";

            // LOOP GROUPS OF 4 (Title | Date | Genre | Link)
            for (let x = 1; x < cols.length; x += 4) {
                const title = cols[x];
                const dateStr = cols[x+1];
                const genre = cols[x+2] || ""; // NEW: Capture Genre
                const link = cols[x+3];
                
                if (title && link && dateStr) {
                    const d = new Date(dateStr);
                    if (!isNaN(d)) {
                        potentialSets.push({ dj: name, image, title, genre, dateStr, dateObj: d, link });
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
                        <h3>${set.title} <span style="font-size:0.7rem; opacity:0.6; border:1px solid #444; padding:2px 5px; border-radius:4px; margin-left:5px; vertical-align:middle;">${set.genre}</span></h3>
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
    
    // Reset theme on offline
    updateSiteTheme(null);
    fetchAndShowFeaturedSet();
}

function renderEventView(isLive) {
    document.body.classList.remove('body-centered');
    archiveLink.classList.add('hidden');
    loadingView.classList.add('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.remove('hidden');

    // Reset Theme initially
    updateSiteTheme(null); 

    if (isLive) {
        document.title = "Club Critters - LIVE NOW";
        badgeContainer.innerHTML = '<div class="status-badge status-live">🔴 EVENT LIVE NOW</div>';
        subtext.innerText = "Tonight's Lineup";

        const deepLink = generateDeepLink(vrcInstanceUrl);
        let joinContainer = document.getElementById('join-container');
        if (!joinContainer) {
            joinContainer = document.createElement('div');
            joinContainer.id = 'join-container';
            joinContainer.style.marginBottom = "20px";
            djContainer.before(joinContainer);
        }

        if (deepLink) {
            joinContainer.innerHTML = `
                <a href="${deepLink}" class="btn btn-live-join">LAUNCH VRCHAT</a>
                <a href="${vrcInstanceUrl}" target="_blank" style="display:block; margin-top:8px; font-size:0.8rem; color:#666; text-decoration:none;">Open via Website &rarr;</a>
            `;
        } else {
            joinContainer.innerHTML = ''; 
        }

    } else {
        document.title = "Club Critters - UPCOMING";
        const d = new Date(eventStartTime);
        badgeContainer.innerHTML = `<div class="status-badge status-upcoming">📅 STARTING: ${d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'})}</div>`;
        subtext.innerText = "Upcoming Schedule";

        const existingContainer = document.getElementById('join-container');
        if (existingContainer) existingContainer.innerHTML = '';
    }

    djContainer.innerHTML = ''; 
    const now = new Date();

    djSchedule.forEach(dj => {
        const timeData = processDjTime(dj.timeRaw);
        const isActive = (isLive && timeData && now >= timeData.startObj && now < timeData.endObj);
        
        // --- CHAMELEON TRIGGER ---
        // FIX: Always trigger the theme update if active.
        if (isActive) {
            updateSiteTheme(dj.color);
        }
        
        let shareButton = '';
        if (isActive) {
            const safeShareText = shareMessageTemplate.replace("{dj}", dj.name).replace("{genre}", dj.genre).replace(/'/g, "\\'");
            shareButton = `<button class="share-btn" onclick="copyToClipboard('${safeShareText}', this)">🔗 Share</button>`;
        }
        
        const liveTag = isActive ? `<span class="live-tag">ON AIR <div class="visualizer"><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div></div></span>` : '';
        let linksHtml = Object.keys(dj.links).length > 0 ? '<div class="social-tags">' + Object.keys(dj.links).map(k => `<a href="${dj.links[k]}" target="_blank" class="social-tag">${k}</a>`).join('') + '</div>' : '';

        const card = document.createElement('div');
        card.className = `dj-card ${isActive ? 'dj-active' : ''}`; 
        
        // Set accent for the card itself (always active)
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