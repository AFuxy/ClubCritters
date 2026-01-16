/**
 * CLUB CRITTERS - ARCHIVE LOGIC
 * Fetches the specific Archive tab from Google Sheets, groups sets by DJ,
 * and sorts them chronologically.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const baseUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=532548123&single=true&output=csv";

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #B36AF4; color: #fff; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #B36AF4; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    success: "color: #00e676; font-weight: bold;",
    warning: "color: #ff9100; font-weight: bold;",
    error: "background: #ff4444; color: #fff; padding: 2px 5px; border-radius: 2px;",
    data: "color: #29C5F6; font-weight: bold;"
};

// ==========================================
//          MAIN LOGIC
// ==========================================

const listContainer = document.getElementById('archive-list');
const loader = document.getElementById('loading-view');
const emptyMsg = document.getElementById('empty-msg');

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c ARCHIVE SUBSYSTEM ONLINE ", logStyle.banner, logStyle.tag);

    try {
        console.log("%c[NETWORK]%c Requesting archive data...", "color: #999;", "color: #fff;");
        const response = await fetch(baseUrl);
        
        if(!response.ok) throw new Error("Sheet returned " + response.status);
        
        const text = await response.text();
        const rows = text.split(/\r?\n/).slice(1); // Skip Header Row

        console.log(`%c[PARSING]%c Processing ${rows.length} DJ rows...`, logStyle.data, "color: #ccc;");

        const djMap = new Map();

        // 1. PARSE & GROUP DATA
        rows.forEach((row) => {
            const cols = row.split(',').map(c => c.trim());
            if (cols.length < 2) return; 

            const djName = cols[0];
            // Use fallback image if cell is empty
            const djImage = (cols[1] && cols[1].length > 0) ? cols[1] : "../cdn/logos/club/HeadOnly.png";

            // Initialize DJ object if not present
            if (!djMap.has(djName)) {
                djMap.set(djName, {
                    name: djName,
                    image: djImage,
                    sets: [],
                    latestDate: new Date(0) // Used for sorting DJs by recency
                });
            }

            const currentDJ = djMap.get(djName);

            // Iterate through sets (Groups of 3 columns: Title, Date, Link)
            // Starting at Column C (Index 2)
            for (let i = 2; i < cols.length; i += 3) {
                const title = cols[i];
                const dateRaw = cols[i+1];
                const link = cols[i+2];

                if (title && link) {
                    const setDate = new Date(dateRaw);
                    
                    currentDJ.sets.push({
                        title: title,
                        dateRaw: dateRaw,
                        dateObj: setDate,
                        link: link
                    });

                    // Update DJ's latest activity timestamp
                    if (setDate > currentDJ.latestDate) {
                        currentDJ.latestDate = setDate;
                    }
                }
            }
        });

        // 2. SORTING
        // Sort DJs: Most active/recent at the top
        const sortedDJs = Array.from(djMap.values()).sort((a, b) => b.latestDate - a.latestDate);

        // Sort Sets within DJs: Newest sets first
        sortedDJs.forEach(dj => {
            dj.sets.sort((a, b) => b.dateObj - a.dateObj);
        });

        console.log("%c[SUCCESS]%c Archive compilation complete.", logStyle.success, "color: #ccc;");
        
        // 3. UI UPDATE
        loader.classList.add('hidden');

        if (sortedDJs.length === 0) {
            console.warn("%c[EMPTY]%c No sets found in spreadsheet.", logStyle.warning, "color: #ccc;");
            emptyMsg.classList.remove('hidden');
        } else {
            listContainer.classList.remove('hidden');
            renderGroupedSets(sortedDJs);
        }

    } catch (e) {
        console.log("%c[CRITICAL FAILURE]%c Unable to load archive.", logStyle.error, "color: #ff4444;");
        console.error(e);
        loader.classList.add('hidden');
        listContainer.innerHTML = "<p>Unable to load archive.</p>";
    }
}

// Helper: Format ISO date to readable string
function formatDate(dateObj) {
    if (isNaN(dateObj)) return "Unknown Date";
    return dateObj.toLocaleDateString(undefined, {
        month: 'short', 
        day: 'numeric', 
        year: 'numeric'
    });
}

function renderGroupedSets(djs) {
    listContainer.innerHTML = '';
    
    console.log(`%c[UI]%c Rendering ${djs.length} DJ cards...`, logStyle.data, "color: #ccc");

    djs.forEach(dj => {
        // Skip DJs with no sets
        if (dj.sets.length === 0) return;

        // Build HTML for the list of sets
        let setsHtml = '<div class="set-list">';
        dj.sets.forEach(set => {
            setsHtml += `
                <div class="set-item">
                    <div class="set-info">
                        <div class="set-title">${set.title}</div>
                        <div class="set-date">${formatDate(set.dateObj)}</div>
                    </div>
                    <a href="${set.link}" target="_blank" class="play-btn-small">▶ Play</a>
                </div>
            `;
        });
        setsHtml += '</div>';

        // Build Main Card
        const card = document.createElement('div');
        card.className = 'dj-card'; 
        // Force column layout for grouped view
        card.style.flexDirection = "column";
        card.style.alignItems = "stretch";
        
        card.innerHTML = `
            <div style="display:flex; align-items:center; margin-bottom: 15px;">
                <img src="${dj.image}" class="dj-img" alt="${dj.name}">
                <div>
                    <h3 style="margin:0; color:var(--primary-blue);">${dj.name}</h3>
                    <span style="color:#666; font-size:0.85rem;">${dj.sets.length} Archived Sets</span>
                </div>
            </div>
            ${setsHtml}
        `;
        listContainer.appendChild(card);
    });
}

// Start Archive Logic
init();