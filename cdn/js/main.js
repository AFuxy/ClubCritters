/**
 * CLUB CRITTERS - MAIN APPLICATION LOGIC
 * Handles schedule data fetching, time zone conversion (UTC -> Local),
 * color contrast adjustment, and real-time UI rendering.
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

// ==========================================
//          GLOBAL STATE
// ==========================================

let eventStartTime = null;
let eventEndTime = null;
let forceOffline = false;
let djSchedule = [];
let currentState = null; 
let userTimezoneCode = ""; // e.g., "GMT", "EST", "JST"

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c SYSTEM BOOT SEQUENCE INITIATED ", logStyle.banner, logStyle.tag);

    // 1. Detect User Timezone Code (falls back to empty string on failure)
    try {
        userTimezoneCode = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(part => part.type == 'timeZoneName').value;
    } catch (e) {
        userTimezoneCode = "";
    }

    // 2. Set Initial UI State
    loadingView.classList.remove('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.add('hidden');
    archiveLink.classList.add('hidden');

    // 3. Fetch Data & Start System
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

    // 4. Start Heartbeat (Updates UI every 5 seconds)
    console.log("%c[SYSTEM]%c Heartbeat monitor active (Tick: 5000ms)", "color: #29C5F6;", "color: #ccc;");
    setInterval(checkStatus, 5000);
}

// ==========================================
//          DATA FETCHING & PARSING
// ==========================================

async function fetchAndParseSheet() {
    const response = await fetch(googleSheetUrl);
    if (!response.ok) throw new Error("Google Sheet returned " + response.status);

    const text = await response.text();
    const rows = text.split(/\r?\n/);
    if (rows.length < 2) throw new Error("Sheet is empty or missing header");

    const headers = rows[0].split(',').map(h => h.trim());
    const settingsRow = rows[1].split(',').map(c => c.trim());
    
    // Config: Event Times (Expected in ISO UTC) & Force Offline Toggle
    eventStartTime = settingsRow[0];
    eventEndTime = settingsRow[1];
    const offlineCell = settingsRow[2] ? settingsRow[2].toUpperCase() : "";
    forceOffline = (offlineCell === "TRUE" || offlineCell === "YES" || offlineCell === "1");

    // Schedule Parsing
    djSchedule = [];
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        
        // Ensure row has minimum data (DJ Name in Col 4)
        if (cols.length < 4 || !cols[3]) continue; 

        // Process color: ensure contrast against dark background
        let rawColor = cols[7];
        let finalColor = null;

        if (rawColor && rawColor.startsWith('#')) {
            finalColor = ensureReadableColor(rawColor);
        }

        const dj = {
            name: cols[3],
            timeRaw: cols[4], // Raw UTC string (e.g. "16:30 - 17:30")
            genre: cols[5],
            image: cols[6] || "cdn/logos/club/HeadOnly.png",
            color: finalColor,
            links: {}
        };

        // Parse Dynamic Social Links (Cols 8+)
        for (let x = 8; x < cols.length; x++) {
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
//          HELPER FUNCTIONS
// ==========================================

/**
 * Parses a UTC time range string (e.g. "16:30 - 17:30") 
 * and converts it to the User's Local Time string with timezone code appended.
 */
function processDjTime(timeStr) {
    if (!timeStr || !eventStartTime) return null;

    const times = timeStr.match(/(\d{1,2}):(\d{2})/g);
    if (!times || times.length < 2) return null;

    const eventDate = new Date(eventStartTime);
    
    const [startH, startM] = times[0].split(':').map(Number);
    const [endH, endM] = times[1].split(':').map(Number);

    // Create Date objects relative to the Event Start Date (UTC)
    const start = new Date(eventDate);
    start.setUTCHours(startH, startM, 0, 0);

    const end = new Date(eventDate);
    end.setUTCHours(endH, endM, 0, 0);

    // Handle Day Rollovers (e.g., set goes past midnight)
    if (startH < eventDate.getUTCHours() - 6) { 
        start.setDate(start.getDate() + 1);
        end.setDate(end.getDate() + 1);
    } else if (end < start) {
        end.setDate(end.getDate() + 1);
    }

    // Format for Display: "HH:MM - HH:MM TZ"
    const timeOptions = { hour: '2-digit', minute: '2-digit' };
    const localDisplay = `${start.toLocaleTimeString([], timeOptions)} - ${end.toLocaleTimeString([], timeOptions)} ${userTimezoneCode}`;

    return {
        startObj: start,
        endObj: end,
        displayString: localDisplay
    };
}

/**
 * Ensures a HEX color is readable on a dark background.
 * Converts to HSL and boosts Lightness if below 60%.
 */
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

    // Force brightness (L) to be at least 60%
    if (l < 0.6) l = 0.6;

    h = Math.round(h * 360);
    s = Math.round(s * 100);
    l = Math.round(l * 100);

    return `hsl(${h}, ${s}%, ${l}%)`;
}

// ==========================================
//          STATE MANAGEMENT
// ==========================================

function checkStatus() {
    // 1. Check for Manual Override
    if (forceOffline) {
        if (currentState !== 'disabled') {
            showOffline("Community Hub");
            currentState = 'disabled';
        }
        return;
    }

    // 2. Check for Missing Config
    if (!eventStartTime || !eventEndTime) {
        if (currentState !== 'disabled') {
            showOffline("Community Hub");
            currentState = 'disabled';
        }
        return;
    }

    // 3. Determine Time State
    const now = new Date();
    const start = new Date(eventStartTime);
    const end = new Date(eventEndTime);

    let newState = '';
    if (now >= end) newState = 'finished';
    else if (now >= start) newState = 'live';
    else newState = 'upcoming';

    // 4. Update UI
    if (newState === 'live') {
        // Always re-render during LIVE state to update active DJ glow
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
    document.body.classList.add('body-centered'); // Center content vertically
    archiveLink.classList.remove('hidden');
    loadingView.classList.add('hidden');
    offlineView.classList.remove('hidden');
    eventView.classList.add('hidden');
    
    badgeContainer.innerHTML = '';
    subtext.innerHTML = message;
}

function renderEventView(isLive) {
    document.body.classList.remove('body-centered'); // Top align for scrolling list
    archiveLink.classList.add('hidden');
    loadingView.classList.add('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.remove('hidden');

    // Header Updates
    if (isLive) {
        document.title = "Club Critters - LIVE NOW";
        badgeContainer.innerHTML = '<div class="status-badge status-live">🔴 EVENT LIVE NOW</div>';
        subtext.innerText = "Tonight's Lineup";
    } else {
        document.title = "Club Critters - UPCOMING";
        const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' };
        const localDateString = new Date(eventStartTime).toLocaleDateString(undefined, dateOptions);
        badgeContainer.innerHTML = `<div class="status-badge status-upcoming">📅 STARTING: ${localDateString}</div>`;
        subtext.innerText = "Upcoming Schedule";
    }

    // Render DJ Cards
    djContainer.innerHTML = ''; 
    const now = new Date();

    djSchedule.forEach(dj => {
        // Convert UTC time to Local Time
        const timeData = processDjTime(dj.timeRaw);
        const displayTime = timeData ? timeData.displayString : dj.timeRaw;
        
        // Determine if this DJ is currently playing
        let isActive = false;
        if (isLive && timeData) {
            isActive = (now >= timeData.startObj && now < timeData.endObj);
        }

        const activeClass = isActive ? 'dj-active' : '';
        const liveTag = isActive ? '<span class="live-tag">ON AIR</span>' : '';

        // Generate Social Links
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
        
        // Apply Custom Color if available
        if (dj.color) {
            card.style.setProperty('--accent-color', dj.color);
        }

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

// Start Application
init();