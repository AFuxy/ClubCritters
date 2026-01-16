/**
 * CLUB CRITTERS - MAIN APP LOGIC
 * Handles schedule fetching, time zone conversion, color contrast,
 * visualizers, live countdown timer, and social sharing.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const googleSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?output=csv";

// Template for the 'Share' button clipboard text. 
// Use {dj} and {genre} as placeholders for dynamic data.
const shareMessageTemplate = "🔊 LIVE NOW: {dj} is playing {genre}! Join us: https://club.afuxy.com";

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
let userTimezoneCode = ""; 
let countdownInterval = null; 

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c SYSTEM BOOT SEQUENCE INITIATED ", logStyle.banner, logStyle.tag);

    try {
        userTimezoneCode = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(part => part.type == 'timeZoneName').value;
    } catch (e) {
        userTimezoneCode = "";
    }

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
    
    eventStartTime = settingsRow[0];
    eventEndTime = settingsRow[1];
    const offlineCell = settingsRow[2] ? settingsRow[2].toUpperCase() : "";
    forceOffline = (offlineCell === "TRUE" || offlineCell === "YES" || offlineCell === "1");

    djSchedule = [];
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        if (cols.length < 4 || !cols[3]) continue; 

        let rawColor = cols[7];
        let finalColor = null;
        if (rawColor && rawColor.startsWith('#')) {
            finalColor = ensureReadableColor(rawColor);
        }

        const dj = {
            name: cols[3],
            timeRaw: cols[4],
            genre: cols[5],
            image: cols[6] || "cdn/logos/club/HeadOnly.png",
            color: finalColor,
            links: {}
        };

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
}

// ==========================================
//          COUNTDOWN LOGIC
// ==========================================

function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const now = new Date();
        const diff = startTime - now;

        if (diff <= 0) return;

        // "2-Hour Rule" for switching to countdown display
        if (diff < 7200000) {
            const h = Math.floor((diff / (1000 * 60 * 60)));
            const m = Math.floor((diff / (1000 * 60)) % 60);
            const s = Math.floor((diff / 1000) % 60);

            const timeString = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            
            const badge = document.querySelector('.status-badge');
            if (badge) {
                badge.innerHTML = `⏱️ STARTING IN: ${timeString}`;
            }
        }
    }, 1000);
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
        const localDateString = new Date(eventStartTime).toLocaleDateString(undefined, dateOptions);
        badgeContainer.innerHTML = `<div class="status-badge status-upcoming">📅 STARTING: ${localDateString}</div>`;
        subtext.innerText = "Upcoming Schedule";
    }

    djContainer.innerHTML = ''; 
    const now = new Date();

    djSchedule.forEach(dj => {
        const timeData = processDjTime(dj.timeRaw);
        const displayTime = timeData ? timeData.displayString : dj.timeRaw;
        
        let isActive = false;
        if (isLive && timeData) {
            isActive = (now >= timeData.startObj && now < timeData.endObj);
        }

        const activeClass = isActive ? 'dj-active' : '';
        
        // --- SHARE BUTTON LOGIC ---
        // Generates the share button only if the DJ is currently active
        let shareButton = '';
        if (isActive) {
            // Replace placeholders in the template with actual DJ data
            const shareText = shareMessageTemplate
                .replace("{dj}", dj.name)
                .replace("{genre}", dj.genre);
            
            // Escape special characters to prevent HTML errors in the onclick attribute
            const safeShareText = shareText.replace(/'/g, "\\'");
            
            shareButton = `<button class="share-btn" onclick="copyToClipboard('${safeShareText}', this)">🔗 Share</button>`;
        }

        const liveTag = isActive ? 
            `<span class="live-tag">
                ON AIR 
                <div class="visualizer">
                    <div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div>
                </div>
            </span>` 
            : '';

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
        if (dj.color) { card.style.setProperty('--accent-color', dj.color); }

        card.innerHTML = `
            <img src="${dj.image}" alt="${dj.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${dj.name} ${liveTag}</h3>
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${shareButton}
                        <span class="time">${displayTime}</span>
                    </div>
                </div>
                <span class="genre">${dj.genre}</span>
                ${linksHtml}
            </div>
        `;
        djContainer.appendChild(card);
    });
}

// ==========================================
//          CLIPBOARD HELPER
// ==========================================

window.copyToClipboard = function(text, btnElement) {
    navigator.clipboard.writeText(text).then(() => {
        // Add class to trigger the 'Copied!' tooltip animation
        btnElement.classList.add('copied');
        setTimeout(() => btnElement.classList.remove('copied'), 2000);
    }).catch(err => console.error('Failed to copy', err));
};

init();