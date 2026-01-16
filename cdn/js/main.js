/**
 * CLUB CRITTERS - MAIN APP LOGIC
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const googleSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?output=csv";

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #29C5F6; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #29C5F6; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    success: "color: #00e676; font-weight: bold;",
    warning: "color: #ff9100; font-weight: bold;",
    error: "background: #ff4444; color: #fff; padding: 2px 5px; border-radius: 2px;",
    dj: "color: #B36AF4; font-weight: bold;"
};

// ==========================================
//          DOM ELEMENTS
// ==========================================

const offlineView = document.getElementById('offline-view');
const eventView = document.getElementById('event-view');
const loadingView = document.getElementById('loading-view');
const badgeContainer = document.getElementById('status-badge-container');
const djContainer = document.getElementById('dj-container');
const subtext = document.getElementById('status-subtext');
const archiveLink = document.getElementById('archive-link');

// Global State
let eventStartTime = null;
let eventEndTime = null;
let forceOffline = false;
let djSchedule = [];
let currentState = null; 

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c SYSTEM BOOT SEQUENCE INITIATED ", logStyle.banner, logStyle.tag);

    loadingView.classList.remove('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.add('hidden');
    archiveLink.classList.add('hidden');

    try {
        console.log("%c[NETWORK]%c Fetching schedule configuration...", "color: #999;", "color: #fff;");
        await fetchAndParseSheet();
        
        console.log("%c[SUCCESS]%c Schedule loaded successfully.", logStyle.success, "color: #ccc;");
        
        checkStatus();
        
    } catch (error) {
        console.log("%c[CRITICAL FAILURE]%c Unable to load schedule.", logStyle.error, "color: #ff4444;");
        console.error(error);
        showOffline("Community Hub"); 
    }

    console.log("%c[SYSTEM]%c Heartbeat monitor active (Tick: 5000ms)", "color: #29C5F6;", "color: #ccc;");
    setInterval(checkStatus, 5000);
}

// ==========================================
//          DATA FETCHING
// ==========================================

async function fetchAndParseSheet() {
    const response = await fetch(googleSheetUrl);
    if (!response.ok) throw new Error("Google Sheet returned " + response.status);

    const text = await response.text();
    const rows = text.split(/\r?\n/);
    if (rows.length < 2) throw new Error("Sheet is empty or missing header");

    const headers = rows[0].split(',').map(h => h.trim());
    const settingsRow = rows[1].split(',').map(c => c.trim());
    
    // These are expected to be ISO UTC strings (e.g. 2026-01-16T20:00:00Z)
    eventStartTime = settingsRow[0];
    eventEndTime = settingsRow[1];
    
    const offlineCell = settingsRow[2] ? settingsRow[2].toUpperCase() : "";
    forceOffline = (offlineCell === "TRUE" || offlineCell === "YES" || offlineCell === "1");

    djSchedule = [];
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        if (cols.length < 4 || !cols[3]) continue; 

        const dj = {
            name: cols[3],
            timeRaw: cols[4], // Store the raw UTC string (e.g. "16:30 - 17:30")
            genre: cols[5],
            image: cols[6] || "cdn/logos/club/HeadOnly.png",
            links: {}
        };

        for (let x = 7; x < cols.length; x++) {
            const url = cols[x];
            const label = headers[x]; 
            if (url && url.length > 0 && label) {
                dj.links[label] = url;
            }
        }
        djSchedule.push(dj);
    }
}

// ==========================================
//          HELPER: PARSE & CONVERT TIME
// ==========================================

/**
 * Takes a UTC time range string (e.g. "16:30 - 17:30") 
 * and converts it to the User's Local Time string, 
 * plus returns the start/end Date objects for logic.
 */
function processDjTime(timeStr) {
    if (!timeStr || !eventStartTime) return null;

    // 1. Extract times from sheet (Assumed UTC)
    const times = timeStr.match(/(\d{1,2}):(\d{2})/g);
    if (!times || times.length < 2) return null;

    // 2. Base everything on the Event Start Day (UTC)
    const eventDate = new Date(eventStartTime);
    
    const [startH, startM] = times[0].split(':').map(Number);
    const [endH, endM] = times[1].split(':').map(Number);

    // 3. Create Date objects using UTC methods
    const start = new Date(eventDate);
    start.setUTCHours(startH, startM, 0, 0);

    const end = new Date(eventDate);
    end.setUTCHours(endH, endM, 0, 0);

    // 4. Handle Rollovers (If DJ is 01:00 but event started 20:00 prev day)
    // Logic: If DJ hour is significantly smaller than Event Start hour, add a day
    if (startH < eventDate.getUTCHours() - 6) { 
        start.setDate(start.getDate() + 1);
        end.setDate(end.getDate() + 1);
    } 
    // If End is smaller than Start (23:00 - 01:00), End is next day
    else if (end < start) {
        end.setDate(end.getDate() + 1);
    }

    // 5. Create Display String (Local Time)
    const timeOptions = { hour: '2-digit', minute: '2-digit' };
    const localDisplay = `${start.toLocaleTimeString([], timeOptions)} - ${end.toLocaleTimeString([], timeOptions)}`;

    return {
        startObj: start,
        endObj: end,
        displayString: localDisplay
    };
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

    // If LIVE, re-render frequently to update the Glow/Time
    if (newState === 'live') {
        currentState = newState;
        renderEventView(true);
    } 
    else if (newState !== currentState) {
        currentState = newState;
        if (newState === 'finished') {
            showOffline("Thanks for partying with us! <br><span style='font-size:0.8rem; color:#888; display:block; margin-top:5px;'>(Archives take a short time to process/upload)</span>"); 
        } 
        else if (newState === 'upcoming') {
            renderEventView(false);
        }
    }
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
        const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' };
        // This converts the ISO UTC event start to Local Date String
        const localDateString = new Date(eventStartTime).toLocaleDateString(undefined, dateOptions);
        badgeContainer.innerHTML = `<div class="status-badge status-upcoming">📅 STARTING: ${localDateString}</div>`;
        subtext.innerText = "Upcoming Schedule";
    }

    djContainer.innerHTML = ''; 
    const now = new Date();

    djSchedule.forEach(dj => {
        // --- 1. Process Time (UTC -> Local) ---
        const timeData = processDjTime(dj.timeRaw);
        
        // If time format is broken, fallback to raw text
        const displayTime = timeData ? timeData.displayString : dj.timeRaw;
        
        // Check if currently playing
        let isActive = false;
        if (isLive && timeData) {
            isActive = (now >= timeData.startObj && now < timeData.endObj);
        }

        // --- 2. Build UI ---
        const activeClass = isActive ? 'dj-active' : '';
        const liveTag = isActive ? '<span class="live-tag">ON AIR</span>' : '';

        // Social Links
        let linksHtml = '';
        const linkKeys = Object.keys(dj.links);
        if (linkKeys.length > 0) {
            linksHtml = '<div class="social-tags">';
            linkKeys.forEach(platformName => {
                const url = dj.links[platformName];
                linksHtml += `<a href="${url}" target="_blank" class="social-tag">${platformName}</a>`;
            });
            linksHtml += '</div>';
        }

        const card = document.createElement('div');
        card.className = `dj-card ${activeClass}`; 
        card.innerHTML = `
            <img src="${dj.image}" alt="${dj.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${dj.name} ${liveTag}</h3>
                    <span class="time">${displayTime}</span>
                </div>
                <span class="genre">${dj.genre}</span>
                ${linksHtml}
            </div>
        `;
        djContainer.appendChild(card);
    });
}

init();