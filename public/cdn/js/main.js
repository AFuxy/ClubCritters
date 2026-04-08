/**
 * CLUB FuRN - MAIN APP LOGIC
 (V3.0 - MYSQL API)
 * Fetching from local Node.js backend instead of Google Sheets.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const API_SETTINGS = "/api/public/settings";
const API_SCHEDULE = "/api/public/schedule";
const API_ARCHIVES = "/api/public/archives";
const API_VRC = "/api/public/vrc-status";
const API_TRACK = "/api/stats/track";

const shareMessageTemplate = "🔊 LIVE NOW: {dj} is playing {genre}! Join us: https://clubfurn.com";

// Cache Keys
const CACHE_KEY_SCHEDULE = 'cc_schedule_v3';
const CACHE_KEY_SETTINGS = 'cc_settings_v3';
const CACHE_KEY_ARCHIVE = 'cc_archive_v3';
const CACHE_KEY_TIMESTAMP = 'cc_last_update_ts';

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #f2008d; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #f2008d; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    info: "color: #888; font-style: italic;",
    success: "color: #00e676; font-weight: bold;",
};

// ==========================================
//          GLOBAL STATE
// ==========================================

const offlineView = document.getElementById('offline-view');
const eventView = document.getElementById('event-view');
const loadingView = document.getElementById('loading-view');
const badgeContainer = document.getElementById('status-badge-container') || document.getElementById('badge-container');
const djContainer = document.getElementById('dj-container');
const subtext = document.getElementById('status-subtext');
const archiveLink = document.getElementById('archive-link');
const galleryLink = document.getElementById('gallery-link');

let eventStartTime = null;
let eventEndTime = null;
let forceOffline = false;
let vrcInstanceUrl = ""; 
let djSchedule = [];
let rawArchiveData = []; 
let currentState = null; 
let userTimezoneCode = ""; 
let countdownInterval = null; 
let latestVrcData = null; // Global storage for VRC stats

// ==========================================
//          INITIALIZATION
// ==========================================

async function fetchVrcStatus() {
    try {
        const res = await fetch(API_VRC);
        if (res.ok) {
            latestVrcData = await res.json();
            updateVrcUI();
        }
    } catch (e) {}
}

function updateVrcUI() {
    if (!latestVrcData) return;
    const data = latestVrcData;
    const countSpan = document.getElementById('vrc-player-count');
    
    // 1. Update Instance Count (Active Event)
    if (data.active && countSpan) {
        countSpan.innerText = ` 🟢 ${data.count}/${data.capacity} PLAYERS`;
        countSpan.classList.remove('hidden');
    } else if (countSpan) {
        countSpan.classList.add('hidden');
    }

    // 2. Update Group Activity (Offline/Upcoming View)
    const stats = data.groupStats;
    if (stats && (currentState === 'disabled' || currentState === 'finished' || currentState === 'upcoming')) {
        let msg = "Community Hub";
        if (currentState === 'finished') msg = "Thanks for partying with us!";
        if (currentState === 'upcoming') msg = subtext.innerText.split('\n')[0]; // Preserve "Upcoming Schedule" or similar

        subtext.innerHTML = `${msg} <br> <span style="font-size:0.8rem; opacity:0.6; margin-top:5px; display:block;">🟢 ${stats.onlineMembers} Members Online Now</span>`;
    }
}

async function init() {
    console.clear();
    console.log("%c Club FuRN %c API V3 STARTUP ", logStyle.banner, logStyle.tag);

    // Track Page View
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'page_view', 
            targetId: 'home', 
            metadata: { page: 'home' } 
        })
    }).catch(() => {});

    try {
        userTimezoneCode = Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(part => part.type == 'timeZoneName').value;
    } catch (e) { userTimezoneCode = "LOC"; }

    // Start VRC Status Loop
    setInterval(fetchVrcStatus, 30000);
    fetchVrcStatus();

    // --- PHASE 1: LOAD CACHE ---
    const cachedSettings = localStorage.getItem(CACHE_KEY_SETTINGS);
    const cachedSchedule = localStorage.getItem(CACHE_KEY_SCHEDULE);
    const cachedArchive = localStorage.getItem(CACHE_KEY_ARCHIVE);
    const lastUpdate = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (cachedSettings && cachedSchedule) {
        console.log(`%c[CACHE] Loaded snapshot`, logStyle.info);
        processSettings(JSON.parse(cachedSettings));
        djSchedule = JSON.parse(cachedSchedule);
        if (cachedArchive) rawArchiveData = JSON.parse(cachedArchive);
        checkStatus(); 
    }

    // --- PHASE 2: FRESH FETCH ---
    try {
        const [setResp, schResp, arcResp] = await Promise.all([
            fetch(API_SETTINGS),
            fetch(API_SCHEDULE),
            fetch(API_ARCHIVES)
        ]);

        if (setResp.ok && schResp.ok && arcResp.ok) {
            const settings = await setResp.json();
            const schedule = await schResp.json();
            const archives = await arcResp.json();

            localStorage.setItem(CACHE_KEY_SETTINGS, JSON.stringify(settings));
            localStorage.setItem(CACHE_KEY_SCHEDULE, JSON.stringify(schedule));
            localStorage.setItem(CACHE_KEY_ARCHIVE, JSON.stringify(archives));
            localStorage.setItem(CACHE_KEY_TIMESTAMP, Date.now());

            processSettings(settings);
            djSchedule = schedule;
            rawArchiveData = archives;
            checkStatus();
        }
    } catch (error) {
        console.warn("Network update failed:", error);
    }
    
    setInterval(checkStatus, 5000);
}

function processSettings(data) {
    if (!data) return;
    eventStartTime = data.eventStartTime;
    eventEndTime = data.eventEndTime;
    forceOffline = data.forceOffline;
    vrcInstanceUrl = data.instanceUrl || "";

    const mainTitle = document.getElementById('main-title');
    if (mainTitle) {
        mainTitle.innerText = data.eventTitle || "Furry Rave Night";
    }

    if (window.applyGlobalSettings) {
        window.applyGlobalSettings(data);
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

    // Roll-over logic for events crossing midnight
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
    if (!hex || !hex.startsWith('#')) return hex;
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
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

function processColorValue(val) {
    if (!val) return null;
    if (val.startsWith('[') && val.endsWith(']')) {
        const colors = val.slice(1, -1).split(',').map(c => c.trim());
        const processed = colors.map(c => ensureReadableColor(c));
        return `linear-gradient(135deg, ${processed.join(', ')})`;
    }
    return (val.startsWith('#')) ? ensureReadableColor(val) : val;
}

function updateSiteTheme(color) {
    const root = document.documentElement;
    if (color) {
        let solidColor = color;
        let gradientColor = color;

        if (color.includes('linear-gradient')) {
            const match = color.match(/hsl\([^)]+\)/);
            if (match) solidColor = match[0];
        } else {
            gradientColor = `linear-gradient(135deg, ${color}, ${color})`;
        }

        root.style.setProperty('--primary-blue', solidColor);
        root.style.setProperty('--primary-purple', solidColor);
        root.style.setProperty('--primary-gradient', gradientColor);
    } else {
        root.style.setProperty('--primary-blue', 'var(--static-orange)');
        root.style.setProperty('--primary-purple', 'var(--static-green)');
        root.style.setProperty('--primary-gradient', 'linear-gradient(45deg, var(--static-orange), var(--static-green))');
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
            if (badge) {
                badge.innerHTML = `⏱️ STARTING IN: ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} <span id="vrc-player-count"></span>`;
                updateVrcUI(); // Refresh player count inside the new badge
            }
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
        const latest = rawArchiveData.slice(0, 3);
        renderFeaturedSets(latest);
    } catch (e) { console.warn("Featured set error", e); }
}

function renderFeaturedSets(sets) {
    const container = document.getElementById('featured-container');
    let html = '';
    sets.forEach(set => {
        let displayDate = set.date;
        try { displayDate = new Date(set.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e){}
        
        html += `
            <a href="${set.link}" target="_blank" onclick="trackClick('archive_click', '${set.id}', 'featured_set')" style="text-decoration:none;">
                <div class="featured-card">
                    <div class="featured-badge">LATEST SET</div>
                    <img src="${set.djImage || '/cdn/logos/club/HeadOnly.png'}" class="featured-img">
                    <div class="featured-info">
                        <h3>${set.title} <span style="font-size:0.7rem; opacity:0.6; border:1px solid #444; padding:2px 5px; border-radius:4px; margin-left:5px; vertical-align:middle;">${set.genre}</span></h3>
                        <p>By <strong>${set.djName}</strong> • ${displayDate}</p>
                    </div>
                    <div style="margin-left:auto; font-size:1.2rem; color:var(--primary-blue);">▶</div>
                </div>
            </a>`;
    });
    container.innerHTML = html;
}

function trackClick(type, id, label) {
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: type, 
            targetId: id, 
            metadata: { page: 'home', label: label } 
        })
    }).catch(() => {});
}

// ==========================================
//          UI RENDERING
// ==========================================

function showOffline(message) {
    document.title = "Furry Rave Night - " + message.replace(/<[^>]*>?/gm, '');
    document.body.classList.add('body-centered');
    if (archiveLink) archiveLink.classList.remove('hidden');
    if (galleryLink) galleryLink.classList.remove('hidden');
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
    if (archiveLink) archiveLink.classList.add('hidden');
    if (galleryLink) galleryLink.classList.add('hidden');
    loadingView.classList.add('hidden');
    offlineView.classList.add('hidden');
    eventView.classList.remove('hidden');

    updateSiteTheme(null); 

    if (isLive) {
        document.title = "Furry Rave Night - LIVE NOW";
        badgeContainer.innerHTML = '<div class="status-badge status-live">🔴 EVENT LIVE NOW <span id="vrc-player-count"></span></div>';
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
                <a href="${deepLink}" class="btn-cc btn-primary btn-live-join">LAUNCH VRCHAT</a>
                <a href="${vrcInstanceUrl}" target="_blank" style="display:block; margin-top:8px; font-size:0.8rem; color:#666; text-decoration:none;">Open via Website &rarr;</a>
            `;
        } else {
            joinContainer.innerHTML = ''; 
        }

        setTimeout(() => {
            djContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 500);

    } else {
        document.title = "Furry Rave Night - UPCOMING";
        const d = new Date(eventStartTime);
        badgeContainer.innerHTML = `<div class="status-badge status-upcoming">📅 STARTING: ${d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'})} <span id="vrc-player-count"></span></div>`;
        subtext.innerText = "Upcoming Schedule";

        const existingContainer = document.getElementById('join-container');
        if (existingContainer) existingContainer.innerHTML = '';
    }

    updateVrcUI(); // Refresh player count immediately after rendering the badge container
    djContainer.innerHTML = ''; 
    const now = new Date();

    djSchedule.forEach(item => {
        const timeData = processDjTime(item.timeSlot);
        const isActive = (isLive && timeData && now >= timeData.startObj && now < timeData.endObj);
        
        const processedColor = processColorValue(item.performer.color);

        if (isActive) {
            updateSiteTheme(processedColor);
        }
        
        let shareButton = '';
        if (isActive) {
            const safeShareText = shareMessageTemplate.replace("{dj}", item.performer.name).replace("{genre}", item.genre).replace(/'/g, "\\'");
            shareButton = `<button class="btn-cc btn-small btn-dark" onclick="copyToClipboard('${safeShareText}', this)">🔗 Share</button>`;
        }
        
        const liveTag = isActive ? `<span class="live-tag">ON AIR <div class="visualizer"><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div></div></span>` : '';
        
        const links = item.performer.links || {};
        let linksHtml = Object.keys(links).length > 0 ? '<div class="social-tags">' + Object.keys(links).map(k => `<a href="${links[k]}" target="_blank" class="social-tag" onclick="trackSocialClick(event, '${item.performer.discordId}')">${k}</a>`).join('') + '</div>' : '';

        const card = document.createElement('div');
        card.className = `dj-card ${isActive ? 'dj-active' : ''}`; 
        
        if (processedColor) card.style.setProperty('--accent-color', processedColor);

        card.innerHTML = `
            <img src="${item.performer.image}" alt="${item.performer.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${item.performer.name} ${liveTag}</h3>
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${shareButton}
                        <span class="time">${timeData ? timeData.displayString : item.timeSlot}</span>
                    </div>
                </div>
                <span class="genre">${item.genre}</span>
                ${linksHtml}
            </div>
        `;
        djContainer.appendChild(card);
    });
}

window.trackSocialClick = function(event, discordId) {
    event.stopPropagation();
    const label = event.target.innerText || 'social_link';
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'link_click', 
            targetId: discordId, 
            metadata: { page: 'home', label: label } 
        })
    }).catch(() => {});
};

window.copyToClipboard = function(text, btnElement) {
    navigator.clipboard.writeText(text).then(() => {
        btnElement.classList.add('copied');
        setTimeout(() => btnElement.classList.remove('copied'), 2000);
    });
};

init();
