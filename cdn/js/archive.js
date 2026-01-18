/**
 * CLUB CRITTERS - ARCHIVE LOGIC (SMART CACHE)
 * Instant load using shared LocalStorage + background update.
 */

const rosterSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=1671173789&single=true&output=csv";
const archiveSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=532548123&single=true&output=csv";

// SHARED CACHE KEYS
const CACHE_KEY_ROSTER = 'cc_roster_v1';
const CACHE_KEY_ARCHIVE = 'cc_archive_v1';

// Console Theme
const logStyle = { banner: "background: #B36AF4; color: #fff; font-weight: bold;", tag: "background: #151e29; color: #B36AF4;", success: "color: #00e676;", info: "color: #888;" };

const loadingView = document.getElementById('loading-view');
const archiveList = document.getElementById('archive-list');
const emptyMsg = document.getElementById('empty-msg');
const searchInput = document.getElementById('search-input');

let fullArchiveData = []; 
let rosterMap = {};

async function init() {
    console.clear();
    console.log("%c ARCHIVE %c ROSTER SYSTEM STARTUP ", logStyle.banner, logStyle.tag);
    
    // --- PHASE 1: CACHE LOAD ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    const cachedArchive = localStorage.getItem(CACHE_KEY_ARCHIVE);

    if (cachedRoster && cachedArchive) {
        console.log("%c[CACHE] Loading from local storage...", logStyle.info);
        processRosterData(cachedRoster);
        processArchiveData(cachedArchive);
    }

    if (searchInput) searchInput.addEventListener('input', (e) => filterSets(e.target.value));

    // --- PHASE 2: NETWORK UPDATE ---
    try {
        const [rosterRes, archiveRes] = await Promise.all([
            fetch(rosterSheetUrl),
            fetch(archiveSheetUrl)
        ]);

        if (rosterRes.ok && archiveRes.ok) {
            const rosterText = await rosterRes.text();
            const archiveText = await archiveRes.text();

            const isNewRoster = rosterText !== cachedRoster;
            const isNewArchive = archiveText !== cachedArchive;

            if (isNewRoster || isNewArchive) {
                console.log("%c[NETWORK] New data found. Updating...", logStyle.success);
                localStorage.setItem(CACHE_KEY_ROSTER, rosterText);
                localStorage.setItem(CACHE_KEY_ARCHIVE, archiveText);
                
                processRosterData(rosterText);
                processArchiveData(archiveText);
            }
        }
    } catch (error) {
        console.warn("Network update failed", error);
        if (!cachedArchive) {
             loadingView.classList.add('hidden');
             emptyMsg.classList.remove('hidden');
        }
    }
}

function processRosterData(csvText) {
    const rows = csvText.split(/\r?\n/);
    rosterMap = {};
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        const name = cols[0];
        if (name) {
            rosterMap[name.toLowerCase()] = {
                image: cols[3] || "../cdn/logos/club/HeadOnly.png"
            };
        }
    }
}

function processArchiveData(csvText) {
    const rows = csvText.split(/\r?\n/);
    fullArchiveData = [];

    // Archive Format: Name(0), Set1 Title(1), Set1 Date(2), Set1 Link(3)...
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        const name = cols[0];
        if (!name) continue;

        const rosterData = rosterMap[name.toLowerCase()];
        const image = rosterData ? rosterData.image : "../cdn/logos/club/HeadOnly.png";

        const djEntry = { name, image, sets: [] };

        for (let x = 1; x < cols.length; x += 3) {
            const title = cols[x];
            const dateStr = cols[x+1];
            const link = cols[x+2];

            if (title && link) {
                djEntry.sets.push({ title, date: dateStr, link });
            }
        }
        if (djEntry.sets.length > 0) fullArchiveData.push(djEntry);
    }
    renderArchive(fullArchiveData);
}

function renderArchive(data) {
    loadingView.classList.add('hidden');
    archiveList.innerHTML = '';
    if (data.length === 0) {
        archiveList.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
        return;
    }
    archiveList.classList.remove('hidden');
    emptyMsg.classList.add('hidden');

    data.forEach(dj => {
        const card = document.createElement('div');
        card.className = 'dj-card'; 
        card.style.display = 'block'; 
        card.style.borderLeft = '4px solid var(--primary-purple)'; 

        let setsHtml = '<div class="set-list">';
        dj.sets.forEach(set => {
            let displayDate = set.date;
            try {
                const dateObj = new Date(set.date);
                if (!isNaN(dateObj)) displayDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (e) {}
            setsHtml += `
                <div class="set-item">
                    <div class="set-info"><div class="set-title">${set.title}</div><div class="set-date">${displayDate || ""}</div></div>
                    <a href="${set.link}" target="_blank" class="play-btn-small">▶ Listen</a>
                </div>`;
        });
        setsHtml += '</div>';

        card.innerHTML = `
            <div style="display:flex; align-items:center; margin-bottom:15px;">
                <img src="${dj.image}" alt="${dj.name}" class="dj-img" style="width:50px; height:50px;">
                <h3 style="margin:0; color:var(--primary-purple);">${dj.name}</h3>
            </div>
            ${setsHtml}`;
        archiveList.appendChild(card);
    });
}

function filterSets(query) {
    const term = query.toLowerCase().trim();
    if (!term) { renderArchive(fullArchiveData); return; }
    const filtered = fullArchiveData.filter(dj => {
        return dj.name.toLowerCase().includes(term) || dj.sets.some(set => set.title.toLowerCase().includes(term) || (set.date && set.date.toLowerCase().includes(term)));
    });
    renderArchive(filtered);
}

init();