/**
 * CLUB CRITTERS - MAIN APP LOGIC (V2.0 - GOOGLE API)
 * Direct API fetch for instant updates.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

// 🔴 REPLACE THESE WITH YOUR REAL DETAILS
const SPREADSHEET_ID = "1MXvHh09Bw1yLQk6_YidOJmYrbJydZvdfQCR0kgK_NE4";
const API_KEY = "AIzaSyBE-7WGEdDOlq9SFBKhEfxg_AbP1KZOMUE";

// API Endpoints
const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;
// Note: We fetch the ranges directly. 'Schedule' is the tab name, 'Roster' is the tab name.
const SCHEDULE_URL = `${BASE_URL}/Schedule!A:Z?key=${API_KEY}`;
const ROSTER_URL = `${BASE_URL}/Roster!A:Z?key=${API_KEY}`;
const ARCHIVE_URL = `${BASE_URL}/Archive!A:Z?key=${API_KEY}`;

const shareMessageTemplate = "🔊 LIVE NOW: {dj} is playing {genre}! Join us: https://critters.club";

// Cache Keys
const CACHE_KEY_ROSTER = 'cc_roster_v2';
const CACHE_KEY_SCHEDULE = 'cc_schedule_v2';
const CACHE_KEY_ARCHIVE = 'cc_archive_v2';
const CACHE_KEY_TIMESTAMP = 'cc_last_update_ts';

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #29C5F6; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #29C5F6; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    info: "color: #888; font-style: italic;",
    success: "color: #00e676; font-weight: bold;",
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
let rawArchiveData = []; // Now an Array, not string
let currentState = null; 
let userTimezoneCode = ""; 
let countdownInterval = null; 

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c API V2 STARTUP ", logStyle.banner, logStyle.tag);

    try {
        userTimezoneCode = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(part => part.type == 'timeZoneName').value;
    } catch (e) { userTimezoneCode = "LOC"; }

    // --- PHASE 1: LOAD CACHE ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedSchedule = localStorage.getItem(CACHE_KEY_SCHEDULE);
    const cachedArchive = localStorage.getItem(CACHE_KEY_ARCHIVE);
    const lastUpdate = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (cachedRoster && cachedSchedule) {
        const timeStr = lastUpdate ? new Date(parseInt(lastUpdate)).toLocaleTimeString() : "Unknown";
        console.log(`%c[CACHE] Loaded snapshot from ${timeStr}`, logStyle.info);
        
        processRosterData(JSON.parse(cachedRoster));
        processScheduleData(JSON.parse(cachedSchedule));
        if (cachedArchive) rawArchiveData = JSON.parse(cachedArchive);
        checkStatus(); 
    }

    // --- PHASE 2: FRESH FETCH (Network) ---
    try {
        const startFetch = performance.now();
        const [rosterResp, scheduleResp, archiveResp] = await Promise.all([
            fetch(ROSTER_URL),
            fetch(SCHEDULE_URL),
            fetch(ARCHIVE_URL)
        ]);

        if (rosterResp.ok && scheduleResp.ok && archiveResp.ok) {
            const rosterJson = await rosterResp.json();
            const scheduleJson = await scheduleResp.json();
            const archiveJson = await archiveResp.json();

            const rosterRows = rosterJson.values || [];
            const scheduleRows = scheduleJson.values || [];
            const archiveRows = archiveJson.values || [];

            // 🟢 SMART CHECK: Compare new data vs cached data strings
            // We stringify to do a quick "Are these identical?" check
            const newRosterStr = JSON.stringify(rosterRows);
            const newScheduleStr = JSON.stringify(scheduleRows);
            const newArchiveStr = JSON.stringify(archiveRows);

            const hasChanges = (newRosterStr !== cachedRoster) || 
                               (newScheduleStr !== cachedSchedule) || 
                               (newArchiveStr !== cachedArchive);

            const fetchTime = (performance.now() - startFetch).toFixed(0);

            if (hasChanges) {
                const now = new Date();
                console.log(`%c[API] 🟢 New Data Found (${fetchTime}ms) @ ${now.toLocaleTimeString()}`, logStyle.success);
                
                // Update Storage
                localStorage.setItem(CACHE_KEY_ROSTER, newRosterStr);
                localStorage.setItem(CACHE_KEY_SCHEDULE, newScheduleStr);
                localStorage.setItem(CACHE_KEY_ARCHIVE, newArchiveStr);
                localStorage.setItem(CACHE_KEY_TIMESTAMP, now.getTime());

                // Process New Data
                processRosterData(rosterRows);
                processScheduleData(scheduleRows);
                rawArchiveData = archiveRows;
                checkStatus();
            } else {
                console.log(`%c[API] ⚪ Data unchanged (${fetchTime}ms)`, "color: #666; font-size: 0.9em;");
            }
        } else {
            console.error("API Error: One or more sheets failed to load.");
        }
    } catch (error) {
        console.warn("Network update failed:", error);
    }
    
    setInterval(checkStatus, 5000);
}

// ==========================================
//          DATA PROCESSING (API VERSION)
// ==========================================

function processRosterData(rows) {
    // API returns an Array of Arrays. No splitting needed!
    if (!rows || rows.length < 2) return;

    const headers = rows[0].map(h => h.trim());
    rosterMap = {};

    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if (!cols || !cols[0]) continue;
        
        const name = cols[0];

        // Safe access (cols[x] might be undefined if empty)
        const entry = {
            name: name,
            image: cols[3] || "cdn/logos/club/HeadOnly.png",
            color: (cols[4] && cols[4].startsWith('#')) ? ensureReadableColor(cols[4]) : null,
            links: {}
        };

        // 🛑 HIDDEN COLUMNS LOGIC (Start at Index 7 / Col H)
        for (let x = 7; x < cols.length; x++) {
            if (cols[x] && headers[x]) {
                entry.links[headers[x]] = cols[x];
            }
        }
        rosterMap[name.toLowerCase()] = entry;
    }
}

function processScheduleData(rows) {
    if (!rows || rows.length < 2) return;

    // Row 2 (Index 1) is Settings
    const settingsRow = rows[1];
    if (!settingsRow) return;

    eventStartTime = settingsRow[0];
    eventEndTime = settingsRow[1];
    
    const offlineCell = settingsRow[2] ? settingsRow[2].toUpperCase() : "";
    forceOffline = (offlineCell === "TRUE" || offlineCell === "YES" || offlineCell === "1");
    
    vrcInstanceUrl = settingsRow[3] || "";

    djSchedule = [];

    // Start at i = 2 (Row 3)
    for (let i = 2; i < rows.length; i++) {
        const cols = rows[i];
        // Need at least 5 cols (Index 4 exists)
        if (!cols || cols.length < 5 || !cols[4]) continue; 

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
            showOffline("Thanks for partying with us!"); 
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
    if (!container || container.innerHTML !== "" || !rawArchiveData || rawArchiveData.length === 0) return;

    try {
        const rows = rawArchiveData;
        let potentialSets = [];
        let latestDateObj = new Date(0);

        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || !cols[0]) continue;
            
            const name = cols[0];
            const rosterData = rosterMap[name.toLowerCase()];
            const image = rosterData ? rosterData.image : "cdn/logos/club/HeadOnly.png";

            // LOOP GROUPS OF 4 (Title | Date | Genre | Link)
            // Note: API returns array, we iterate by index
            for (let x = 1; x < cols.length; x += 4) {
                const title = cols[x];
                const dateStr = cols[x+1];
                const genre = cols[x+2] || ""; 
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
    
    updateSiteTheme(null);
    fetchAndShowFeaturedSet();
}

function renderEventView(isLive) {
    document.body.classList.remove('body-centered');
    archiveLink.classList.add('hidden');
    loadingView.classList.add('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.remove('hidden');

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