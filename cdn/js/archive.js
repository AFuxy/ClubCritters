/**
 * CLUB CRITTERS - ARCHIVE LOGIC
 * Fetches past sets, groups them by DJ, formats dates,
 * and allows instant searching.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

// URL for the "Archive" Tab (Tab 2)
const archiveSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=532548123&single=true&output=csv";

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
//          MAIN LOGIC
// ==========================================

const loadingView = document.getElementById('loading-view');
const archiveList = document.getElementById('archive-list');
const emptyMsg = document.getElementById('empty-msg');
const searchInput = document.getElementById('search-input');

let fullArchiveData = []; 

async function init() {
    console.clear();
    console.log("%c ARCHIVE %c SYSTEM STARTUP ", logStyle.banner, logStyle.tag);

    try {
        await fetchAndParseArchive();
        
        // Enable Search Listener
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                filterSets(e.target.value);
            });
        }

    } catch (error) {
        console.log("%c[ERROR]%c Archive failed to load.", logStyle.error, "color: #ff4444;");
        console.error(error);
        loadingView.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
    }
}

async function fetchAndParseArchive() {
    console.groupCollapsed("📦 Fetching Archive Data");
    console.log(`%c[NETWORK] Requesting CSV...`, logStyle.info);

    const response = await fetch(archiveSheetUrl);
    if (!response.ok) throw new Error("Archive Sheet returned " + response.status);

    const text = await response.text();
    const rows = text.split(/\r?\n/);
    if (rows.length < 2) throw new Error("Archive Sheet is empty");

    console.log(`%c[NETWORK] Received ${rows.length} rows. Parsing...`, logStyle.success);

    fullArchiveData = []; 

    // Parse Rows (Start from Row 2, assuming Row 1 is headers)
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        
        // Basic Validation: Needs DJ Name (Col A) and at least one set (Col C)
        if (cols.length < 3 || !cols[0]) continue; 

        const djEntry = {
            name: cols[0],
            image: cols[1] || "../cdn/logos/club/HeadOnly.png",
            sets: []
        };

        // Parse Sets (Groups of 3 columns: Title, Date, Link)
        // Starts at Column C (index 2)
        for (let x = 2; x < cols.length; x += 3) {
            const title = cols[x];
            const dateStr = cols[x+1];
            const link = cols[x+2];

            if (title && link) {
                djEntry.sets.push({ title, date: dateStr, link });
            }
        }

        if (djEntry.sets.length > 0) {
            fullArchiveData.push(djEntry);
        }
    }

    // --- FANCY DEBUG TABLE ---
    const debugSummary = fullArchiveData.map(d => ({
        DJ: d.name,
        Sets: d.sets.length,
        Latest: d.sets[0]?.date || "N/A"
    }));
    
    console.log(`%c[DATA] Parsed ${fullArchiveData.length} DJs with sets.`, logStyle.success);
    console.table(debugSummary);
    console.groupEnd();

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
            // DATE PRETTY PRINTING
            let displayDate = set.date;
            try {
                const dateObj = new Date(set.date);
                if (!isNaN(dateObj)) {
                    displayDate = dateObj.toLocaleDateString(undefined, { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric' 
                    });
                }
            } catch (e) { /* Keep original string if date parse fails */ }

            setsHtml += `
                <div class="set-item">
                    <div class="set-info">
                        <div class="set-title">${set.title}</div>
                        <div class="set-date">${displayDate || ""}</div>
                    </div>
                    <a href="${set.link}" target="_blank" class="play-btn-small">▶ Listen</a>
                </div>
            `;
        });
        setsHtml += '</div>';

        card.innerHTML = `
            <div style="display:flex; align-items:center; margin-bottom:15px;">
                <img src="${dj.image}" alt="${dj.name}" class="dj-img" style="width:50px; height:50px;">
                <h3 style="margin:0; color:var(--primary-purple);">${dj.name}</h3>
            </div>
            ${setsHtml}
        `;
        
        archiveList.appendChild(card);
    });
}

// ==========================================
//          SEARCH LOGIC
// ==========================================

function filterSets(query) {
    const term = query.toLowerCase().trim();

    if (!term) {
        renderArchive(fullArchiveData);
        return;
    }

    console.log(`%c[SEARCH] Filtering for: "${term}"`, logStyle.info);

    const filtered = fullArchiveData.filter(dj => {
        const nameMatch = dj.name.toLowerCase().includes(term);
        const setsMatch = dj.sets.some(set => 
            set.title.toLowerCase().includes(term) || 
            (set.date && set.date.toLowerCase().includes(term))
        );
        return nameMatch || setsMatch;
    });

    renderArchive(filtered);
}

init();