/**
 * CLUB CRITTERS - ARCHIVE LOGIC (V1.3 - ROBUST CACHE & GENRE PILLS)
 * Features: LocalStorage Cache, Debug Logging, 4-Column Parsing, Genre Filters
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const rosterSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=1671173789&single=true&output=csv";
const archiveSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=532548123&single=true&output=csv"; 

// Cache Keys (Must match main.js for Roster, unique for Archive)
const CACHE_KEY_ROSTER = 'cc_roster_v1';
const CACHE_KEY_ARCHIVE = 'cc_archive_v1';

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #B36AF4; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #B36AF4; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    success: "color: #00e676; font-weight: bold;",
    info: "color: #888; font-style: italic;",
    error: "background: #ff4444; color: #fff; padding: 2px 5px; border-radius: 2px;"
};

// ==========================================
//          GLOBAL STATE
// ==========================================

let allSets = [];
let rosterMap = {};
let activeGenre = 'ALL';

// UI Elements
const loadingView = document.getElementById('loading-view');
const archiveView = document.getElementById('archive-view'); // Make sure your HTML has this ID wrapping the lists
const searchInput = document.getElementById('search-input');
const genreContainer = document.getElementById('genre-filters');
const listContainer = document.getElementById('archive-list');

// ==========================================
//          INITIALIZATION
// ==========================================

async function initArchive() {
    console.clear();
    console.log("%c CLUB CRITTERS %c ARCHIVE SYSTEM STARTUP ", logStyle.banner, logStyle.tag);

    // --- PHASE 1: INSTANT LOAD (CACHE) ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedArchive = localStorage.getItem(CACHE_KEY_ARCHIVE);

    if (cachedRoster && cachedArchive) {
        console.log("%c[CACHE] Loading from local storage...", logStyle.info);
        processData(cachedRoster, cachedArchive);
        revealContent();
    } else {
        console.log("%c[CACHE] Miss. Waiting for network...", logStyle.info);
    }

    // --- PHASE 2: FRESH FETCH (NETWORK) ---
    try {
        const [rosterRes, archiveRes] = await Promise.all([
            fetch(rosterSheetUrl),
            fetch(archiveSheetUrl)
        ]);

        if (rosterRes.ok && archiveRes.ok) {
            const rosterText = await rosterRes.text();
            const archiveText = await archiveRes.text();

            const isNew = (rosterText !== cachedRoster) || (archiveText !== cachedArchive);

            if (isNew) {
                console.log("%c[NETWORK] New data detected. Updating...", logStyle.success);
                
                localStorage.setItem(CACHE_KEY_ROSTER, rosterText);
                localStorage.setItem(CACHE_KEY_ARCHIVE, archiveText);

                processData(rosterText, archiveText);
                revealContent();
            } else {
                console.log("%c[NETWORK] Data is up to date.", logStyle.success);
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

function processData(rosterCsv, archiveCsv) {
    // 1. Parse Roster (Now capturing COLOR)
    const rRows = rosterCsv.split(/\r?\n/);
    rosterMap = {};
    for (let i = 1; i < rRows.length; i++) {
        const cols = rRows[i].split(',').map(c => c.trim());
        if (cols[0]) {
            // Store object with image AND color
            rosterMap[cols[0].toLowerCase()] = {
                image: cols[3] || "cdn/logos/club/HeadOnly.png",
                color: cols[4] || "#29C5F6" // Default blue if missing
            };
        }
    }

    // 2. Parse Archive
    const aRows = archiveCsv.split(/\r?\n/);
    allSets = [];

    for (let i = 1; i < aRows.length; i++) {
        const cols = aRows[i].split(',').map(c => c.trim());
        const djName = cols[0];
        if (!djName) continue;

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
    // We assume the rest of the page is visible, but if you have a wrapper:
    if (archiveView) archiveView.classList.remove('hidden');
}

function buildGenreFilters() {
    if (!genreContainer) return;

    // Extract unique genres
    const genres = new Set();
    allSets.forEach(set => {
        if(set.genre) genres.add(set.genre);
    });

    // Create "ALL" button
    let html = `<button class="genre-pill ${activeGenre === 'ALL' ? 'active' : ''}" onclick="filterGenre('ALL', this)">ALL</button>`;

    // Create button for each genre
    Array.from(genres).sort().forEach(g => {
        const isActive = activeGenre === g ? 'active' : '';
        html += `<button class="genre-pill ${isActive}" onclick="filterGenre('${g}', this)">${g}</button>`;
    });

    genreContainer.innerHTML = html;
}

window.filterGenre = function(genre, btnElement) {
    activeGenre = genre;
    
    // Update UI (Active State)
    document.querySelectorAll('.genre-pill').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    // Re-render list
    const searchTerm = searchInput ? searchInput.value : "";
    renderSets(searchTerm);
}

function renderSets(searchTerm = "") {
    if (!listContainer) return;
    listContainer.innerHTML = "";
    
    const term = searchTerm.toLowerCase();

    // 1. Filter the list
    const filtered = allSets.filter(set => {
        const matchesSearch = set.dj.toLowerCase().includes(term) || set.title.toLowerCase().includes(term);
        const matchesGenre = activeGenre === 'ALL' || set.genre === activeGenre;
        return matchesSearch && matchesGenre;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#666;">No sets found matching criteria.</div>`;
        return;
    }

    // 2. GROUP BY DJ (To restore the Card Layout)
    // We create a Map where the key is "DJName", and value is their sets
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

    // 3. Render the Cards
    Object.keys(grouped).forEach(djName => {
        const group = grouped[djName];
        
        // Build the HTML for the sets inside the card
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

// Start
initArchive();