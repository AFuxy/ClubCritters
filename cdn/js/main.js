/**
 * CLUB CRITTERS - MAIN APP LOGIC
 * Handles the schedule fetching, state management (Live/Upcoming/Offline),
 * and UI rendering for the main hub.
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

    // Set initial UI state
    loadingView.classList.remove('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.add('hidden');
    archiveLink.classList.add('hidden');

    try {
        console.log("%c[NETWORK]%c Fetching schedule configuration...", "color: #999;", "color: #fff;");
        await fetchAndParseSheet();
        
        console.log("%c[SUCCESS]%c Schedule loaded successfully.", logStyle.success, "color: #ccc;");
        if(djSchedule.length > 0) {
            console.groupCollapsed("📂 Loaded Schedule Data");
            console.table(djSchedule);
            console.groupEnd();
        }

        // Run initial status check immediately
        checkStatus();
        
    } catch (error) {
        console.log("%c[CRITICAL FAILURE]%c Unable to load schedule.", logStyle.error, "color: #ff4444;");
        console.error(error);
        showOffline("Community Hub"); 
    }

    // Start heartbeat to check time every 5 seconds
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

    // Parse Settings (Row 2)
    const headers = rows[0].split(',').map(h => h.trim());
    const settingsRow = rows[1].split(',').map(c => c.trim());
    
    eventStartTime = settingsRow[0];
    eventEndTime = settingsRow[1];
    
    // Check for Force Offline override (Column C)
    const offlineCell = settingsRow[2] ? settingsRow[2].toUpperCase() : "";
    forceOffline = (offlineCell === "TRUE" || offlineCell === "YES" || offlineCell === "1");

    // Parse Schedule (Rows 3+)
    djSchedule = [];
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        
        // Ensure row has minimum data (DJ Name in Col 4)
        if (cols.length < 4 || !cols[3]) continue; 

        const dj = {
            name: cols[3],
            time: cols[4],
            genre: cols[5],
            image: cols[6] || "cdn/logos/club/HeadOnly.png",
            links: {}
        };

        // Parse dynamic social links starting from Col 8
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
//          STATE MANAGEMENT
// ==========================================

function checkStatus() {
    // 1. Check for Manual Override
    if (forceOffline) {
        if (currentState !== 'disabled') {
            console.log("%c[MODE]%c Manual Override: FORCE OFFLINE active.", logStyle.warning, "color: #ccc");
            showOffline("Community Hub");
            currentState = 'disabled';
        }
        return;
    }

    // 2. Check for Missing Configuration
    if (!eventStartTime || !eventEndTime) {
        if (currentState !== 'disabled') {
            console.log("%c[MODE]%c Configuration Missing: Defaulting to Offline.", logStyle.warning, "color: #ccc");
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

    // 4. Update UI if State Changed
    if (newState !== currentState) {
        const icon = newState === 'live' ? '🔴' : (newState === 'upcoming' ? '📅' : '🏁');
        console.log(`%c CLUB CRITTERS %c STATE CHANGE: ${icon} ${newState.toUpperCase()} `, logStyle.banner, logStyle.tag);
        currentState = newState;

        if (newState === 'finished') {
            showOffline("Thanks for partying with us! <br><span style='font-size:0.8rem; color:#888; display:block; margin-top:5px;'>(Archives take a short time to process/upload)</span>"); 
        } 
        else if (newState === 'live') {
            renderEventView(true);
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
    document.title = "Club Critters - " + message.replace(/<[^>]*>?/gm, ''); // Strip HTML for title tag
    
    // Center the layout for simple text view
    document.body.classList.add('body-centered');

    // Show the Archive link when offline
    archiveLink.classList.remove('hidden');

    loadingView.classList.add('hidden');
    offlineView.classList.remove('hidden');
    eventView.classList.add('hidden');
    
    badgeContainer.innerHTML = '';
    subtext.innerHTML = message;
}

function renderEventView(isLive) {
    // Reset layout to top-aligned for list view
    document.body.classList.remove('body-centered');
    
    // Hide Archive link during events
    archiveLink.classList.add('hidden');

    loadingView.classList.add('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.remove('hidden');

    // Set Badges and Titles
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
    console.log(`%c[UI]%c Rendering ${djSchedule.length} DJ Cards...`, "color: #29C5F6", "color: #ccc");

    djSchedule.forEach(dj => {
        // Generate Social Links HTML
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

        // Create Card Element
        const card = document.createElement('div');
        card.className = 'dj-card';
        card.innerHTML = `
            <img src="${dj.image}" alt="${dj.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${dj.name}</h3>
                    <span class="time">${dj.time}</span>
                </div>
                <span class="genre">${dj.genre}</span>
                ${linksHtml}
            </div>
        `;
        djContainer.appendChild(card);
    });
}

// Start App
init();