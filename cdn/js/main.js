/**
 * CLUB CRITTERS - MAIN APP LOGIC
 * Handles schedule fetching, time zone conversion, color contrast,
 * visualizers, live countdown timer, social sharing, and featured sets.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

// URL for the "Schedule" Tab (Tab 1)
const googleSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?output=csv";

// URL for the "Archive" Tab (Tab 2) - REQUIRED for Offline Featured Set
const archiveSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=532548123&single=true&output=csv"; 

// Template for the 'Share' button clipboard text. 
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
    state: "background: #B36AF4; color: #fff; font-weight: bold; padding: 2px 8px; border-radius: 4px;",
    info: "color: #888; font-style: italic;"
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
    console.log("%c CLUB CRITTERS %c SYSTEM STARTUP ", logStyle.banner, logStyle.tag);

    try {
        userTimezoneCode = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(part => part.type == 'timeZoneName').value;
        console.log(`%c[SYSTEM] User Timezone Detected: ${userTimezoneCode}`, logStyle.info);
    } catch (e) {
        userTimezoneCode = "LOC";
    }

    // CLS FIX: We do NOT hide/show views here anymore.
    // We trust the HTML default (Centered/Offline) to prevent jumping.

    try {
        await fetchAndParseSheet();
        checkStatus();
    } catch (error) {
        console.log("%c[CRITICAL FAILURE]%c Unable to load schedule.", logStyle.error, "color: #ff4444;");
        console.error(error);
        // If fetch fails, we stay in the default Offline/Centered state
        showOffline("Community Hub"); 
    }

    // Heartbeat logic (Silenced in console to prevent spam)
    setInterval(checkStatus, 5000);
}

// ==========================================
//          DATA FETCHING (SCHEDULE)
// ==========================================

async function fetchAndParseSheet() {
    console.groupCollapsed("📦 Fetching Schedule Data");
    console.log(`%c[NETWORK] Requesting CSV...`, logStyle.info);

    const response = await fetch(googleSheetUrl);
    if (!response.ok) throw new Error("Google Sheet returned " + response.status);

    const text = await response.text();
    const rows = text.split(/\r?\n/);
    if (rows.length < 2) throw new Error("Sheet is empty or missing header");

    console.log(`%c[NETWORK] Received ${rows.length} rows. Parsing...`, logStyle.success);

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

    // --- FANCY DEBUG TABLE ---
    console.log(`%c[DATA] Schedule Parsed Successfully:`, logStyle.success);
    console.table(djSchedule, ['name', 'timeRaw', 'genre', 'color']);
    console.groupEnd();
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
            console.log("%c[STATE CHANGE]%c FORCE OFFLINE ENABLED", logStyle.state, "color: #ccc;");
            showOffline("Community Hub");
            currentState = 'disabled';
        }
        return;
    }

    if (!eventStartTime || !eventEndTime) {
        if (currentState !== 'disabled') {
            console.log("%c[STATE CHANGE]%c MISSING CONFIG -> DISABLED", logStyle.state, "color: #ccc;");
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
        if (currentState !== 'live') {
             console.log("%c[STATE CHANGE]%c EVENT IS LIVE! 🔴", logStyle.state, "color: #ff4444; font-weight:bold;");
        }
        currentState = newState;
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        renderEventView(true);
    } 
    else if (newState !== currentState) {
        console.log(`%c[STATE CHANGE]%c Switching to: ${newState.toUpperCase()}`, logStyle.state, "color: #ccc;");
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

    // Handle initial offline load (if state wasn't 'finished' but page just loaded)
    if (currentState === 'disabled' || currentState === 'finished') {
         fetchAndShowFeaturedSet();
    }
    if (!eventStartTime && !forceOffline) {
         fetchAndShowFeaturedSet();
    }
}

// ==========================================
//          COUNTDOWN LOGIC
// ==========================================

function startCountdown(startTime) {
    if (countdownInterval) clearInterval(countdownInterval);

    console.log("%c[TIMER]%c Countdown logic armed.", "color: #29C5F6", logStyle.info);

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
//          FEATURED SET LOGIC (Offline)
// ==========================================

async function fetchAndShowFeaturedSet() {
    const container = document.getElementById('featured-container');
    if (!container) return;
    if (container.innerHTML !== "") return;

    console.groupCollapsed("💾 Fetching Featured Set (Offline Mode)");

    try {
        const response = await fetch(archiveSheetUrl);
        if (!response.ok) throw new Error("Archive fetch failed");

        const text = await response.text();
        const rows = text.split(/\r?\n/);
        
        console.log(`%c[NETWORK] Analyzing ${rows.length} archive entries...`, logStyle.info);

        let potentialSets = [];
        let latestDateObj = new Date(0); // Start at Epoch

        // STEP 1: Scan all rows
        for (let i = 1; i < rows.length; i++) {
            if (!rows[i]) continue;
            const cols = rows[i].split(',').map(c => c.trim());
            if (cols.length < 3) continue;

            const djName = cols[0];
            const djImage = cols[1] || "cdn/logos/club/HeadOnly.png";

            // Archive format: Name, Image, [Title, Date, Link]...
            for (let x = 2; x < cols.length; x += 3) {
                const title = cols[x];
                const dateStr = cols[x+1];
                const link = cols[x+2];

                if (title && link && dateStr) {
                    const d = new Date(dateStr);
                    if (!isNaN(d)) {
                        potentialSets.push({
                            dj: djName,
                            image: djImage,
                            title: title,
                            dateStr: dateStr,
                            dateObj: d,
                            link: link
                        });

                        // Track newest date found
                        if (d > latestDateObj) {
                            latestDateObj = d;
                        }
                    }
                }
            }
        }

        // STEP 2: Filter for sets that match the newest date (Release Day Carousel)
        const featuredSets = potentialSets.filter(set => 
            set.dateObj.getTime() === latestDateObj.getTime()
        );

        if (featuredSets.length > 0) {
            console.log(`%c[SUCCESS] Found ${featuredSets.length} sets from ${latestDateObj.toDateString()}`, logStyle.success);
            renderFeaturedSets(featuredSets);
        } else {
            console.log(`%c[INFO] No valid sets found to feature.`, logStyle.info);
        }

    } catch (e) {
        console.warn("Could not fetch featured set", e);
    }
    console.groupEnd();
}

function renderFeaturedSets(sets) {
    const container = document.getElementById('featured-container');
    if (!container) return;

    let html = '';

    sets.forEach(set => {
        // Format YYYY-MM-DD into "Jan 16, 2026"
        let displayDate = set.dateStr;
        try {
            if (!isNaN(set.dateObj)) {
                displayDate = set.dateObj.toLocaleDateString(undefined, { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric' 
                });
            }
        } catch (e) {}

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
            </a>
        `;
    });

    container.innerHTML = html;
}

// ==========================================
//          UI RENDERING
// ==========================================

function showOffline(message) {
    document.title = "Club Critters - " + message.replace(/<[^>]*>?/gm, '');
    
    // CLS FIX: Ensure centering and archive visibility when offline
    document.body.classList.add('body-centered');
    archiveLink.classList.remove('hidden');

    loadingView.classList.add('hidden');
    offlineView.classList.remove('hidden');
    eventView.classList.add('hidden');
    
    badgeContainer.innerHTML = '';
    subtext.innerHTML = message;
    
    // Trigger Featured Set Fetch
    fetchAndShowFeaturedSet();
}

function renderEventView(isLive) {
    // CLS FIX: Remove centering and hide archive when Event Mode is active
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
        let shareButton = '';
        if (isActive) {
            const shareText = shareMessageTemplate
                .replace("{dj}", dj.name)
                .replace("{genre}", dj.genre);
            const safeShareText = shareText.replace(/'/g, "\\'");
            shareButton = `<button class="share-btn" onclick="copyToClipboard('${safeShareText}', this)">🔗 Share</button>`;
        }

        // --- VISUALIZER LOGIC ---
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
        btnElement.classList.add('copied');
        setTimeout(() => btnElement.classList.remove('copied'), 2000);
    }).catch(err => console.error('Failed to copy', err));
};

init();