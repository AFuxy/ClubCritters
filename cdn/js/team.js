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

// Shared Cache Keys
const CACHE_KEY_ROSTER = 'cc_roster_v2';
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

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c TEAM V2 STARTUP ", logStyle.banner, logStyle.tag);
    createBioModal();

    // --- PHASE 1: CACHE LOAD ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const lastUpdate = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (cachedRoster) {
        const timeStr = lastUpdate ? new Date(parseInt(lastUpdate)).toLocaleTimeString() : "Unknown";
        console.log(`%c[CACHE] Loaded snapshot from ${timeStr}`, logStyle.info);
        processRosterData(JSON.parse(cachedRoster));
    }

    // --- PHASE 2: NETWORK UPDATE ---
    try {
        const startFetch = performance.now();
        const response = await fetch(ROSTER_URL);
        
        if (response.ok) {
            const json = await response.json();
            const rows = json.values || [];
            
            // Smart Check
            const newRosterStr = JSON.stringify(rows);
            const hasChanges = (newRosterStr !== cachedRoster);
            const fetchTime = (performance.now() - startFetch).toFixed(0);

            if (hasChanges) {
                const now = new Date();
                console.log(`%c[API] 🟢 New Data Found (${fetchTime}ms)`, logStyle.success);
                
                localStorage.setItem(CACHE_KEY_ROSTER, newRosterStr);
                localStorage.setItem(CACHE_KEY_TIMESTAMP, now.getTime());
                
                processRosterData(rows);
            } else {
                console.log(`%c[API] ⚪ Data unchanged (${fetchTime}ms)`, "color: #666; font-size: 0.9em;");
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

// ==========================================
//          DATA PROCESSING
// ==========================================

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

        let finalColor = (cols[4] && cols[4].startsWith('#')) ? ensureReadableColor(cols[4]) : null;

        const member = {
            name: cols[0],
            title: cols[2],
            image: cols[3] || "../cdn/logos/club/HeadOnly.png",
            color: finalColor,
            bio: cols[5],
            links: {}
        };

        // 🛑 HIDDEN COLUMNS LOGIC (Start at Index 7 / Col H)
        // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7
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
        const card = document.createElement('div');
        card.className = 'dj-card';
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
                <div class="dj-header"><h3>${member.name} ${bioIndicator}</h3></div>
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