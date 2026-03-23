/**
 * CLUB CRITTERS - ARCHIVE LOGIC (V3.0 - MYSQL API)
 * Fetching from local Node.js backend.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const API_ARCHIVES = "/api/public/archives";
const API_ROSTER = "/api/public/roster";
const API_SCHEDULE = "/api/public/schedule";
const API_SETTINGS = "/api/public/settings";
const API_TRACK = "/api/stats/track";

// Cache Keys
const CACHE_KEY_ARCHIVE = 'cc_archive_v3';
const CACHE_KEY_ROSTER = 'cc_roster_v3';
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
    console.log("%c CLUB CRITTERS %c ARCHIVE V3 STARTUP ", logStyle.banner, logStyle.tag);

    // Track Page View
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'page_view', 
            targetId: 'archive', 
            metadata: { page: 'archive' } 
        })
    }).catch(() => {});

    // --- PHASE 1: CACHE LOAD ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedArchive = localStorage.getItem(CACHE_KEY_ARCHIVE);

    if (cachedRoster && cachedArchive) {
        processData(JSON.parse(cachedRoster), JSON.parse(cachedArchive));
        revealContent();
    }

    // --- PHASE 2: FRESH FETCH ---
    try {
        const [rosRes, arcRes, schRes, setRes] = await Promise.all([
            fetch(API_ROSTER),
            fetch(API_ARCHIVES),
            fetch(API_SCHEDULE),
            fetch(API_SETTINGS)
        ]);

        if (rosRes.ok && arcRes.ok && schRes.ok && setRes.ok) {
            const roster = await rosRes.json();
            const archives = await arcRes.json();
            const schedule = await schRes.json();
            const settings = await setRes.json();

            localStorage.setItem(CACHE_KEY_ROSTER, JSON.stringify(roster));
            localStorage.setItem(CACHE_KEY_ARCHIVE, JSON.stringify(archives));
            localStorage.setItem(CACHE_KEY_TIMESTAMP, Date.now());

            checkLiveStatus(settings, schedule, roster);
            window.applyGlobalSettings(settings);
            processData(roster, archives);
            revealContent();
        }
    } catch (error) {
        console.warn("Network update failed.", error);
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderSets(e.target.value));
    }
}

function checkLiveStatus(settings, schedule, roster) {
    if (!settings) return;
    const start = new Date(settings.eventStartTime);
    const end = new Date(settings.eventEndTime);
    const now = new Date();
    
    if (now >= start && now < end && !settings.forceOffline) {
        const backLink = document.querySelector('.nav-pill-cc');
        if (backLink && !backLink.querySelector('.live-dot')) {
            backLink.insertAdjacentHTML('afterbegin', '<span class="live-dot"></span>');
        }

        // Theme based on current DJ
        schedule.forEach(item => {
            const times = item.timeSlot.match(/(\d{1,2}):(\d{2})/g);
            if (!times || times.length < 2) return;
            const djStart = new Date(start);
            const [sh, sm] = times[0].split(':').map(Number);
            djStart.setUTCHours(sh, sm, 0, 0);
            const djEnd = new Date(start);
            const [eh, em] = times[1].split(':').map(Number);
            djEnd.setUTCHours(eh, em, 0, 0);
            
            if (sh < start.getUTCHours() - 6) { djStart.setDate(djStart.getDate() + 1); djEnd.setDate(djEnd.getDate() + 1); }
            else if (djEnd < djStart) { djEnd.setDate(djEnd.getDate() + 1); }

            if (now >= djStart && now < djEnd) {
                const dj = roster.find(r => r.name.toLowerCase() === item.performer.name.toLowerCase());
                if (dj && dj.colorStyle) {
                    updateSiteTheme(processColorValue(dj.colorStyle));
                }
            }
        });
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

function processColorValue(val) {
    if (!val) return null;
    if (val.startsWith('[') && val.endsWith(']')) {
        const colors = val.slice(1, -1).split(',').map(c => c.trim());
        const processed = colors.map(c => ensureReadableColor(c));
        return `linear-gradient(135deg, ${processed.join(', ')})`;
    }
    return (val.startsWith('#')) ? ensureReadableColor(val) : val;
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
    if (max === min) { h = s = 0; } else { let d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; } h /= 6; }
    if (l < 0.6) l = 0.6;
    h = Math.round(h * 360); s = Math.round(s * 100); l = Math.round(l * 100);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function processData(roster, archives) {
    rosterMap = {};
    roster.forEach(m => {
        rosterMap[m.name.toLowerCase()] = {
            image: m.imageUrl || "cdn/logos/club/HeadOnly.png",
            color: processColorValue(m.colorStyle) || "#29C5F6"
        };
    });

    allSets = archives.map(arc => {
        const ros = rosterMap[arc.djName.toLowerCase()];
        return {
            id: arc.id,
            dj: arc.djName,
            image: ros ? ros.image : "/cdn/logos/club/HeadOnly.png",
            color: ros ? ros.color : "#29C5F6",
            title: arc.title,
            date: arc.date,
            displayDate: new Date(arc.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
            genre: arc.genre,
            link: arc.link
        };
    });
    
    buildGenreFilters();
    renderSets(searchInput ? searchInput.value : "");
}

function revealContent() {
    if (loadingView) loadingView.classList.add('hidden');
    if (archiveView) archiveView.classList.remove('hidden');
}

function buildGenreFilters() {
    if (!genreContainer) return;
    const genres = new Set();
    allSets.forEach(set => { if(set.genre) genres.add(set.genre); });
    let html = `<button class="btn-cc btn-small nav-pill-cc ${activeGenre === 'ALL' ? 'active' : ''}" onclick="filterGenre('ALL', this)">ALL</button>`;
    Array.from(genres).sort().forEach(g => {
        html += `<button class="btn-cc btn-small nav-pill-cc ${activeGenre === g ? 'active' : ''}" onclick="filterGenre('${g}', this)">${g}</button>`;
    });
    genreContainer.innerHTML = html;
}

window.filterGenre = function(genre, btnElement) {
    activeGenre = genre;
    document.querySelectorAll('.nav-pill-cc').forEach(b => b.classList.remove('active'));
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
            grouped[set.dj] = { image: set.image, color: set.color, sets: [] };
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
                    <a href="${set.link}" target="_blank" onclick="trackClick('archive_click', '${set.id}', 'archive_list')" class="btn-cc btn-small btn-secondary">▶ Listen</a>
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

function trackClick(type, id, label) {
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: type, 
            targetId: id, 
            metadata: { page: 'archive', label: label } 
        })
    }).catch(() => {});
}

initArchive();
