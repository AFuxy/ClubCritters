/**
 * CLUB CRITTERS - ARCHIVE LOGIC (V2.0 - GOOGLE API)
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
const ARCHIVE_URL = `${BASE_URL}/Archive!A:Z?key=${API_KEY}`;
const SCHEDULE_URL = `${BASE_URL}/Schedule!A:Z?key=${API_KEY}`;

// Cache Keys (Must match main.js for Roster, unique for Archive)
const CACHE_KEY_ROSTER = 'cc_roster_v2';
const CACHE_KEY_ARCHIVE = 'cc_archive_v2';
const CACHE_KEY_SCHEDULE = 'cc_schedule_v2';
const CACHE_KEY_TIMESTAMP = 'cc_archive_ts';

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #B36AF4; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #B36AF4; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    success: "color: #00e676; font-weight: bold;",
    info: "color: #888; font-style: italic;",
};

// ==========================================
//          GLOBAL STATE
// ==========================================

let allSets = [];
let rosterMap = {};
let activeGenre = 'ALL';

// UI Elements
const loadingView = document.getElementById('loading-view');
const archiveView = document.getElementById('archive-view'); 
const searchInput = document.getElementById('search-input');
const genreContainer = document.getElementById('genre-filters');
const listContainer = document.getElementById('archive-list');

// ==========================================
//          INITIALIZATION
// ==========================================

async function initArchive() {
    console.clear();
    console.log("%c CLUB CRITTERS %c ARCHIVE V2 STARTUP ", logStyle.banner, logStyle.tag);

    // --- PHASE 1: INSTANT LOAD (CACHE) ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedArchive = localStorage.getItem(CACHE_KEY_ARCHIVE);
    const cachedSchedule = localStorage.getItem(CACHE_KEY_SCHEDULE);
    const lastUpdate = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (cachedRoster && cachedArchive) {
        if (cachedSchedule) checkLiveStatus(JSON.parse(cachedSchedule));
        processData(JSON.parse(cachedRoster), JSON.parse(cachedArchive));
        revealContent();
    }

    // --- PHASE 2: FRESH FETCH (NETWORK) ---
    try {
        const [rosterRes, archiveRes, scheduleRes] = await Promise.all([
            fetch(ROSTER_URL),
            fetch(ARCHIVE_URL),
            fetch(SCHEDULE_URL)
        ]);

        if (rosterRes.ok && archiveRes.ok && scheduleRes.ok) {
            const rosterJson = await rosterRes.json();
            const archiveJson = await archiveRes.json();
            const scheduleJson = await scheduleRes.json();

            const rosterRows = rosterJson.values || [];
            const archiveRows = archiveJson.values || [];
            const scheduleRows = scheduleJson.values || [];

            checkLiveStatus(scheduleRows);

            // Smart Check
            const newRosterStr = JSON.stringify(rosterRows);
            const newArchiveStr = JSON.stringify(archiveRows);
            
            const hasChanges = (newRosterStr !== cachedRoster) || (newArchiveStr !== cachedArchive);

            if (hasChanges) {
                localStorage.setItem(CACHE_KEY_ROSTER, newRosterStr);
                localStorage.setItem(CACHE_KEY_ARCHIVE, newArchiveStr);
                localStorage.setItem(CACHE_KEY_SCHEDULE, JSON.stringify(scheduleRows));
                localStorage.setItem(CACHE_KEY_TIMESTAMP, new Date().getTime());

                processData(rosterRows, archiveRows);
                revealContent();
            }
        }
    } catch (error) {
        console.warn("Network update failed.", error);
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderSets(e.target.value));
    }
}

function checkLiveStatus(rows) {
    if (!rows || rows.length < 2) return;
    const settings = rows[1];
    const start = new Date(settings[0]);
    const end = new Date(settings[1]);
    const now = new Date();
    
    if (now >= start && now < end && settings[2] !== "TRUE") {
        const backLink = document.querySelector('.nav-pill');
        if (backLink && !backLink.querySelector('.live-dot')) {
            backLink.insertAdjacentHTML('afterbegin', '<span class="live-dot"></span>');
        }

        // Apply theme based on current DJ
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
                const djName = cols[4].toLowerCase();
                const rosterData = rosterMap[djName];
                if (rosterData && rosterData.color) {
                    updateSiteTheme(rosterData.color);
                }
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
    if (val && val.startsWith('[') && val.endsWith(']')) {
        const colors = val.slice(1, -1).split(',').map(c => c.trim());
        const processed = colors.map(c => ensureReadableColor(c));
        return `linear-gradient(135deg, ${processed.join(', ')})`;
    }
    return (val && val.startsWith('#')) ? ensureReadableColor(val) : val;
}

function ensureReadableColor(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
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

function processData(rosterRows, archiveRows) {
    // 1. Parse Roster (Array of Arrays)
    rosterMap = {};
    if (rosterRows && rosterRows.length > 1) {
        for (let i = 1; i < rosterRows.length; i++) {
            const cols = rosterRows[i];
            if (!cols || !cols[0]) continue;
            
            rosterMap[cols[0].toLowerCase()] = {
                image: cols[3] || "cdn/logos/club/HeadOnly.png",
                color: processColorValue(cols[4]) || "#29C5F6"
            };
        }
    }

    // 2. Parse Archive
    allSets = [];
    if (archiveRows && archiveRows.length > 1) {
        for (let i = 1; i < archiveRows.length; i++) {
            const cols = archiveRows[i];
            if (!cols || !cols[0]) continue;

            const djName = cols[0];
            const rosterData = rosterMap[djName.toLowerCase()];
            const image = rosterData ? rosterData.image : "cdn/logos/club/HeadOnly.png";
            const color = rosterData ? rosterData.color : "#29C5F6";

            // READ GROUPS OF 4: Title | Date | Genre | Link
            for (let x = 1; x < cols.length; x += 4) {
                const title = cols[x];
                const rawDate = cols[x+1];
                const genre = cols[x+2] || "Other"; 
                const link = cols[x+3];

                if (title && link && rawDate) {
                    let displayDate = rawDate;
                    const d = new Date(rawDate);
                    if (!isNaN(d)) {
                        displayDate = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
                    }
                    allSets.push({ dj: djName, image, color, title, date: rawDate, displayDate, genre, link });
                }
            }
        }
    }
    
    allSets.sort((a, b) => new Date(b.date) - new Date(a.date));
    buildGenreFilters();
    renderSets(searchInput ? searchInput.value : "");
}

// ==========================================
//          UI RENDERING
// ==========================================

function revealContent() {
    if (loadingView) loadingView.classList.add('hidden');
    if (archiveView) archiveView.classList.remove('hidden');
}

function buildGenreFilters() {
    if (!genreContainer) return;

    const genres = new Set();
    allSets.forEach(set => {
        if(set.genre) genres.add(set.genre);
    });

    let html = `<button class="genre-pill ${activeGenre === 'ALL' ? 'active' : ''}" onclick="filterGenre('ALL', this)">ALL</button>`;

    Array.from(genres).sort().forEach(g => {
        const isActive = activeGenre === g ? 'active' : '';
        html += `<button class="genre-pill ${isActive}" onclick="filterGenre('${g}', this)">${g}</button>`;
    });

    genreContainer.innerHTML = html;
}

window.filterGenre = function(genre, btnElement) {
    activeGenre = genre;
    document.querySelectorAll('.genre-pill').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    renderSets(searchInput ? searchInput.value : "");
}

function renderSets(searchTerm = "") {
    if (!listContainer) return;
    listContainer.innerHTML = "";
    
    const term = searchTerm.toLowerCase();

    const filtered = allSets.filter(set => {
        const matchesSearch = set.dj.toLowerCase().includes(term) || set.title.toLowerCase().includes(term);
        const matchesGenre = activeGenre === 'ALL' || set.genre === activeGenre;
        return matchesSearch && matchesGenre;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">No sets found matching criteria.</div>`;
        return;
    }

    const grouped = {};
    filtered.forEach(set => {
        if (!grouped[set.dj]) {
            grouped[set.dj] = {
                image: set.image,
                color: set.color,
                sets: []
            };
        }
        grouped[set.dj].sets.push(set);
    });

    Object.keys(grouped).forEach(djName => {
        const group = grouped[djName];
        let setsHtml = '';
        group.sets.forEach(set => {
            setsHtml += `
                <div class="archive-row">
                    <div class="row-info">
                        <div class="row-title" style="color:#eee;">
                            ${set.title} 
                            <span class="genre-tag">${set.genre}</span>
                        </div>
                        <div class="row-date" style="color:${group.color}; opacity:0.8;">${set.displayDate}</div>
                    </div>
                    <a href="${set.link}" target="_blank" class="play-btn-card">▶ Listen</a>
                </div>
            `;
        });

        const cardHtml = `
            <div class="dj-archive-card" style="--accent-color: ${group.color};">
                <div class="card-header">
                    <img src="${group.image}" alt="${djName}">
                    <h3 style="color: ${group.color};">${djName}</h3>
                </div>
                <div class="card-body">
                    ${setsHtml}
                </div>
            </div>
        `;
        listContainer.innerHTML += cardHtml;
    });
}

initArchive();