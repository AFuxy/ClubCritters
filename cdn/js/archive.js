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

// Cache Keys (Must match main.js for Roster, unique for Archive)
const CACHE_KEY_ROSTER = 'cc_roster_v2';
const CACHE_KEY_ARCHIVE = 'cc_archive_v2';
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
    const lastUpdate = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (cachedRoster && cachedArchive) {
        const timeStr = lastUpdate ? new Date(parseInt(lastUpdate)).toLocaleTimeString() : "Unknown";
        console.log(`%c[CACHE] Loaded snapshot from ${timeStr}`, logStyle.info);

        processData(JSON.parse(cachedRoster), JSON.parse(cachedArchive));
        revealContent();
    } else {
        console.log("%c[CACHE] Miss. Waiting for network...", logStyle.info);
    }

    // --- PHASE 2: FRESH FETCH (NETWORK) ---
    try {
        const startFetch = performance.now();
        const [rosterRes, archiveRes] = await Promise.all([
            fetch(ROSTER_URL),
            fetch(ARCHIVE_URL)
        ]);

        if (rosterRes.ok && archiveRes.ok) {
            const rosterJson = await rosterRes.json();
            const archiveJson = await archiveRes.json();

            const rosterRows = rosterJson.values || [];
            const archiveRows = archiveJson.values || [];

            // Smart Check (Compare Strings)
            const newRosterStr = JSON.stringify(rosterRows);
            const newArchiveStr = JSON.stringify(archiveRows);
            
            const hasChanges = (newRosterStr !== cachedRoster) || (newArchiveStr !== cachedArchive);
            const fetchTime = (performance.now() - startFetch).toFixed(0);

            if (hasChanges) {
                const now = new Date();
                console.log(`%c[API] 🟢 New Data Found (${fetchTime}ms)`, logStyle.success);
                
                localStorage.setItem(CACHE_KEY_ROSTER, newRosterStr);
                localStorage.setItem(CACHE_KEY_ARCHIVE, newArchiveStr);
                localStorage.setItem(CACHE_KEY_TIMESTAMP, now.getTime());

                processData(rosterRows, archiveRows);
                revealContent();
            } else {
                console.log(`%c[API] ⚪ Data unchanged (${fetchTime}ms)`, "color: #666; font-size: 0.9em;");
            }
        }
    } catch (error) {
        console.warn("Network update failed.", error);
    }

    // Setup Listeners
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderSets(e.target.value));
    }
}

// ==========================================
//          DATA PROCESSING
// ==========================================

function processData(rosterRows, archiveRows) {
    // 1. Parse Roster (Array of Arrays)
    rosterMap = {};
    if (rosterRows && rosterRows.length > 1) {
        for (let i = 1; i < rosterRows.length; i++) {
            const cols = rosterRows[i];
            if (!cols || !cols[0]) continue;
            
            rosterMap[cols[0].toLowerCase()] = {
                image: cols[3] || "cdn/logos/club/HeadOnly.png",
                color: (cols[4] && cols[4].startsWith('#')) ? cols[4] : "#29C5F6"
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
            // Columns start at Index 1
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
    
    // Sort by Date (Newest First)
    allSets.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 3. Build UI
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

    // Group by DJ
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

    // Render Cards
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
            <div class="dj-archive-card" style="border-left: 4px solid ${group.color};">
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