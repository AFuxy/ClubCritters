/**
 * CLUB CRITTERS - TEAM LOGIC (V2.0 - GOOGLE API)
 * Instant loads via Google Sheets API + Smart Caching
 */

// ==========================================
//          CONFIGURATION
// ==========================================

// 🔴 PASTE YOUR DETAILS HERE
const SPREADSHEET_ID = "1MXvHh09Bw1yLQk6_YidOJmYrbJydZvdfQCR0kgK_NE4";
const API_KEY = "AIzaSyBE-7WGEdDOlq9SFBKhEfxg_AbP1KZOMUE";

const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;
const ROSTER_URL = `${BASE_URL}/Roster!A:Z?key=${API_KEY}`;
const SCHEDULE_URL = `${BASE_URL}/Schedule!A:Z?key=${API_KEY}`;

// Shared Cache Keys
const CACHE_KEY_ROSTER = 'cc_roster_v2';
const CACHE_KEY_SCHEDULE = 'cc_schedule_v2';
const CACHE_KEY_TIMESTAMP = 'cc_roster_ts';

// Console Theme
const logStyle = { 
    banner: "background: #00e676; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;", 
    tag: "background: #151e29; color: #00e676; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;", 
    info: "color: #888; font-weight: bold;", 
    success: "color: #00e676; font-style: italic;" 
};

const loadingView = document.getElementById('loading-view');
const staffSection = document.getElementById('staff-section');
const staffList = document.getElementById('staff-list');
const residentSection = document.getElementById('resident-section');
const residentList = document.getElementById('resident-list');
const emptyMsg = document.getElementById('empty-msg');

let currentActiveDj = null;
let isEventLive = false;

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c TEAM V2 STARTUP ", logStyle.banner, logStyle.tag);
    createBioModal();

    // --- PHASE 1: CACHE LOAD ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedSchedule = localStorage.getItem(CACHE_KEY_SCHEDULE);
    const lastUpdate = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (cachedRoster) {
        if (cachedSchedule) processScheduleStatus(JSON.parse(cachedSchedule));
        processRosterData(JSON.parse(cachedRoster));
    }

    // --- PHASE 2: NETWORK UPDATE ---
    try {
        const [rosterRes, scheduleRes] = await Promise.all([
            fetch(ROSTER_URL),
            fetch(SCHEDULE_URL)
        ]);
        
        if (rosterRes.ok && scheduleRes.ok) {
            const rosterJson = await rosterRes.json();
            const scheduleJson = await scheduleRes.json();
            
            const rows = rosterJson.values || [];
            const scheduleRows = scheduleJson.values || [];
            
            processScheduleStatus(scheduleRows);
            
            // Smart Check
            const newRosterStr = JSON.stringify(rows);
            const hasChanges = (newRosterStr !== cachedRoster);
            
            if (hasChanges) {
                localStorage.setItem(CACHE_KEY_ROSTER, newRosterStr);
                localStorage.setItem(CACHE_KEY_SCHEDULE, JSON.stringify(scheduleRows));
                localStorage.setItem(CACHE_KEY_TIMESTAMP, new Date().getTime());
                processRosterData(rows);
            }
        }
    } catch (error) {
        console.warn("Network error", error);
        if (!cachedRoster) {
             loadingView.classList.add('hidden');
             emptyMsg.classList.remove('hidden');
        }
    }
}

function processScheduleStatus(rows) {
    if (!rows || rows.length < 2) return;
    const settings = rows[1];
    const start = new Date(settings[0]);
    const end = new Date(settings[1]);
    const now = new Date();
    
    isEventLive = (now >= start && now < end && settings[2] !== "TRUE");
    
    if (isEventLive) {
        // Add Live Pulse to Back Link
        const backLink = document.querySelector('.nav-pill');
        if (backLink && !backLink.querySelector('.live-dot')) {
            backLink.insertAdjacentHTML('afterbegin', '<span class="live-dot"></span>');
        }

        updateSiteTheme(null); // Set to default brand gradient first

        // Find current DJ
        for (let i = 2; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || !cols[5]) continue;
            
            const times = cols[5].match(/(\d{1,2}):(\d{2})/g);
            if (!times || times.length < 2) continue;
            
            const djStart = new Date(start);
            const [sh, sm] = times[0].split(':').map(Number);
            djStart.setUTCHours(sh, sm, 0, 0);
            
            const djEnd = new Date(start);
            const [eh, em] = times[1].split(':').map(Number);
            djEnd.setUTCHours(eh, em, 0, 0);
            
            if (sh < start.getUTCHours() - 6) { djStart.setDate(djStart.getDate() + 1); djEnd.setDate(djEnd.getDate() + 1); }
            else if (djEnd < djStart) { djEnd.setDate(djEnd.getDate() + 1); }

            if (now >= djStart && now < djEnd) {
                currentActiveDj = cols[4].toLowerCase();
                // If the active DJ has a custom color/gradient, apply it to the whole page
                const colorValue = cols[4] ? processColorValue(cols[4]) : null;
                if (colorValue) updateSiteTheme(colorValue);
                break;
            }
        }
    } else {
        updateSiteTheme(null);
    }
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
        root.style.setProperty('--primary-blue', '#29C5F6');
        root.style.setProperty('--primary-purple', '#B36AF4');
        root.style.setProperty('--primary-gradient', 'linear-gradient(45deg, var(--static-blue), var(--static-purple))');
    }
}

// ==========================================
//          DATA PROCESSING
// ==========================================

function processColorValue(val) {
    if (!val) return null;
    if (val.startsWith('[') && val.endsWith(']')) {
        const colors = val.slice(1, -1).split(',').map(c => c.trim());
        const processed = colors.map(c => ensureReadableColor(c));
        return `linear-gradient(135deg, ${processed.join(', ')})`;
    }
    return (val.startsWith('#')) ? ensureReadableColor(val) : val;
}

function processRosterData(rows) {
    if (!rows || rows.length < 2) return;

    const headers = rows[0].map(h => h.trim());
    const staffMembers = [];
    const residents = [];

    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if (!cols || !cols[0]) continue; 

        // Safe lowercase check
        const type = (cols[1] || "").toLowerCase();
        
        if (!type.includes('staff') && !type.includes('resident') && !type.includes('owner') && !type.includes('host') && !type.includes('dj')) continue;

        let finalColor = processColorValue(cols[4]);

        const member = {
            name: cols[0],
            title: cols[2],
            image: cols[3] || "../cdn/logos/club/HeadOnly.png",
            color: finalColor,
            bio: cols[5],
            links: {}
        };

        // 🛑 HIDDEN COLUMNS LOGIC (Start at Index 7 / Col H)
        for (let x = 7; x < cols.length; x++) {
            if (cols[x] && headers[x]) {
                member.links[headers[x]] = cols[x];
            }
        }

        if (type.includes('staff') || type.includes('owner') || type.includes('host')) {
            staffMembers.push(member);
        } else {
            residents.push(member);
        }
    }
    renderRoster(staffMembers, residents);
}

// ==========================================
//          UI HELPER FUNCTIONS
// ==========================================

function renderRoster(staff, residents) {
    loadingView.classList.add('hidden');
    if (staff.length > 0) { staffSection.classList.remove('hidden'); renderCards(staff, staffList); }
    if (residents.length > 0) { residentSection.classList.remove('hidden'); renderCards(residents, residentList); }
    if (staff.length === 0 && residents.length === 0) emptyMsg.classList.remove('hidden');
}

function renderCards(members, container) {
    container.innerHTML = '';
    members.forEach(member => {
        let linksHtml = Object.keys(member.links).length > 0 ? '<div class="social-tags">' + Object.keys(member.links).map(k => `<a href="${member.links[k]}" target="_blank" class="social-tag" onclick="event.stopPropagation()">${k}</a>`).join('') + '</div>' : '';
        
        const isActive = (currentActiveDj && member.name.toLowerCase() === currentActiveDj);
        const playingBadge = isActive ? '<span class="playing-now-badge">🔴 Playing Now</span>' : '';
        
        const card = document.createElement('div');
        card.className = `dj-card ${isActive ? 'dj-active' : ''}`;
        if (member.color) card.style.setProperty('--accent-color', member.color);

        let bioIndicator = '';
        if (member.bio && member.bio.length > 0) {
            card.style.cursor = "pointer";
            card.onclick = () => openBioModal(member);
            bioIndicator = `<span style="font-size:0.8rem; margin-left:8px; opacity:0.6;">ℹ️</span>`;
        }

        card.innerHTML = `
            <img src="${member.image}" alt="${member.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header"><h3>${member.name} ${bioIndicator} ${playingBadge}</h3></div>
                <span class="genre">${member.title}</span>
                ${linksHtml}
            </div>`;
        container.appendChild(card);
    });
}

function createBioModal() {
    if (document.getElementById('bio-modal-overlay')) return;
    const modalHtml = `<div id="bio-modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center;"><div id="bio-modal-card" style="background:#151e29; border:1px solid #444; width:90%; max-width:400px; border-radius:15px; padding:20px; position:relative; box-shadow:0 0 20px rgba(0,0,0,0.5);"><button onclick="document.getElementById('bio-modal-overlay').style.display='none'" style="position:absolute; top:10px; right:15px; background:none; border:none; color:#fff; font-size:1.5rem; cursor:pointer;">&times;</button><div style="text-align:center; margin-bottom:15px;"><img id="modal-img" src="" style="width:100px; height:100px; border-radius:50%; object-fit:cover; border:3px solid #333;"><h2 id="modal-name" style="margin:10px 0 5px 0; color:#fff;"></h2><span id="modal-title" style="color:var(--primary-blue); font-size:0.9rem;"></span></div><p id="modal-bio" style="color:#ddd; line-height:1.5; font-size:0.95rem; white-space: pre-wrap;"></p></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.getElementById('bio-modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'bio-modal-overlay') e.target.style.display = 'none'; });
}

function openBioModal(member) {
    const overlay = document.getElementById('bio-modal-overlay');
    document.getElementById('modal-name').innerText = member.name;
    document.getElementById('modal-title').innerText = member.title;
    document.getElementById('modal-bio').innerText = member.bio;
    document.getElementById('modal-img').src = member.image;
    if (member.color) {
        document.getElementById('modal-name').style.color = member.color;
        document.getElementById('modal-img').style.borderColor = member.color;
        document.getElementById('bio-modal-card').style.border = `1px solid ${member.color}`;
    }
    overlay.style.display = 'flex';
}

function ensureReadableColor(hex) {
    hex = hex.replace(/^#/, '');
    let r = parseInt(hex.substring(0, 2), 16) / 255;
    let g = parseInt(hex.substring(2, 4), 16) / 255;
    let b = parseInt(hex.substring(4, 6), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else { let d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; } h /= 6; }
    if (l < 0.6) l = 0.6;
    h = Math.round(h * 360); s = Math.round(s * 100); l = Math.round(l * 100);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

init();