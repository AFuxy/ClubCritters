/**
 * CLUB CRITTERS - TEAM ROSTER LOGIC
 * Fetches the Team sheet, filters members, and handles Bio Popups.
 * * SHEET STRUCTURE EXPECTATION:
 * Col A: Name | Col B: Type | Col C: Title | Col D: Image | Col E: Color | Col F: Bio | Col G+: Socials
 */

// ==========================================
//          CONFIGURATION
// ==========================================

// URL for the "Team" Tab (Tab 3)
const teamSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=628779174&single=true&output=csv";

// ==========================================
//          CONSOLE THEME
// ==========================================
const logStyle = {
    banner: "background: #00e676; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;",
    tag: "background: #151e29; color: #00e676; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;",
    success: "color: #00e676; font-weight: bold;",
    info: "color: #888; font-style: italic;",
    error: "background: #ff4444; color: #fff; padding: 2px 5px; border-radius: 2px;"
};

// ==========================================
//          MAIN LOGIC
// ==========================================

const loadingView = document.getElementById('loading-view');
const staffSection = document.getElementById('staff-section');
const staffList = document.getElementById('staff-list');
const residentSection = document.getElementById('resident-section');
const residentList = document.getElementById('resident-list');
const emptyMsg = document.getElementById('empty-msg');

async function init() {
    console.clear();
    console.log("%c TEAM %c ROSTER SYSTEM STARTUP ", logStyle.banner, logStyle.tag);

    // Inject Modal HTML into the page dynamically (so we don't have to edit index.html)
    createBioModal();

    try {
        await fetchAndParseSheet();
    } catch (error) {
        console.log("%c[ERROR]%c Team roster failed to load.", logStyle.error, "color: #ff4444;");
        console.error(error);
        loadingView.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
        emptyMsg.innerText = "Unable to load team data.";
    }
}

async function fetchAndParseSheet() {
    console.groupCollapsed("📦 Fetching Team Data");
    console.log(`%c[NETWORK] Requesting CSV...`, logStyle.info);

    const response = await fetch(teamSheetUrl);
    if (!response.ok) throw new Error("Sheet returned " + response.status);

    const text = await response.text();
    const rows = text.split(/\r?\n/);
    if (rows.length < 2) throw new Error("Sheet is empty");

    console.log(`%c[NETWORK] Received ${rows.length} rows. Parsing...`, logStyle.success);

    const headers = rows[0].split(',').map(h => h.trim());

    const staffMembers = [];
    const residents = [];

    // Parse Rows
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        
        if (cols.length < 2 || !cols[0]) continue; 

        let rawColor = cols[4];
        let finalColor = null;
        if (rawColor && rawColor.startsWith('#')) {
            finalColor = ensureReadableColor(rawColor);
        }

        const member = {
            name: cols[0],
            type: cols[1].toLowerCase(), 
            title: cols[2],
            image: cols[3] || "../cdn/logos/club/HeadOnly.png",
            color: finalColor,
            bio: cols[5], // Column F is now BIO
            links: {}
        };

        // Parse Socials (Start at Column G / Index 6)
        for (let x = 6; x < cols.length; x++) {
            const url = cols[x];
            const label = headers[x]; 
            if (url && url.length > 0 && label) {
                member.links[label] = url;
            }
        }

        if (member.type.includes('staff') || member.type.includes('owner') || member.type.includes('host')) {
            staffMembers.push(member);
        } else if (member.type.includes('resident') || member.type.includes('dj')) {
            residents.push(member);
        }
    }

    // --- FANCY DEBUG TABLE ---
    const debugSummary = [
        { Group: 'Staff', Count: staffMembers.length },
        { Group: 'Residents', Count: residents.length }
    ];
    console.log(`%c[DATA] Roster Parsed Successfully.`, logStyle.success);
    console.table(debugSummary);
    console.groupEnd();

    renderRoster(staffMembers, residents);
}

function renderRoster(staff, residents) {
    loadingView.classList.add('hidden');

    if (staff.length > 0) {
        staffSection.classList.remove('hidden');
        renderCards(staff, staffList);
    }

    if (residents.length > 0) {
        residentSection.classList.remove('hidden');
        renderCards(residents, residentList);
    }

    if (staff.length === 0 && residents.length === 0) {
        emptyMsg.classList.remove('hidden');
    }
}

function renderCards(members, container) {
    container.innerHTML = '';
    
    members.forEach(member => {
        let linksHtml = '';
        const linkKeys = Object.keys(member.links);
        
        // Prevent clicks on links from triggering the bio card popup
        if (linkKeys.length > 0) {
            linksHtml = '<div class="social-tags">';
            linkKeys.forEach(platformName => {
                const url = member.links[platformName];
                linksHtml += `<a href="${url}" target="_blank" class="social-tag" onclick="event.stopPropagation()">${platformName}</a>`;
            });
            linksHtml += '</div>';
        }

        const card = document.createElement('div');
        card.className = 'dj-card';
        if (member.color) { card.style.setProperty('--accent-color', member.color); }

        // BIO LOGIC: If bio exists, make card clickable
        let bioIndicator = '';
        if (member.bio && member.bio.length > 0) {
            card.style.cursor = "pointer";
            card.onclick = () => openBioModal(member);
            // Add a small info icon to show it's clickable
            bioIndicator = `<span style="font-size:0.8rem; margin-left:8px; opacity:0.6;">ℹ️</span>`;
        }

        card.innerHTML = `
            <img src="${member.image}" alt="${member.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${member.name} ${bioIndicator}</h3>
                </div>
                <span class="genre">${member.title}</span>
                ${linksHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

// ==========================================
//          BIO MODAL SYSTEM
// ==========================================

function createBioModal() {
    // Inject the modal HTML and CSS dynamically
    const modalHtml = `
        <div id="bio-modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center;">
            <div id="bio-modal-card" style="background:#151e29; border:1px solid #444; width:90%; max-width:400px; border-radius:15px; padding:20px; position:relative; box-shadow:0 0 20px rgba(0,0,0,0.5);">
                <button onclick="closeBioModal()" style="position:absolute; top:10px; right:15px; background:none; border:none; color:#fff; font-size:1.5rem; cursor:pointer;">&times;</button>
                <div style="text-align:center; margin-bottom:15px;">
                    <img id="modal-img" src="" style="width:100px; height:100px; border-radius:50%; object-fit:cover; border:3px solid #333;">
                    <h2 id="modal-name" style="margin:10px 0 5px 0; color:#fff;"></h2>
                    <span id="modal-title" style="color:var(--primary-blue); font-size:0.9rem;"></span>
                </div>
                <p id="modal-bio" style="color:#ddd; line-height:1.5; font-size:0.95rem; white-space: pre-wrap;"></p>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Close on background click
    document.getElementById('bio-modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'bio-modal-overlay') closeBioModal();
    });
}

function openBioModal(member) {
    const overlay = document.getElementById('bio-modal-overlay');
    const nameEl = document.getElementById('modal-name');
    const titleEl = document.getElementById('modal-title');
    const bioEl = document.getElementById('modal-bio');
    const imgEl = document.getElementById('modal-img');
    const cardEl = document.getElementById('bio-modal-card');

    nameEl.innerText = member.name;
    titleEl.innerText = member.title;
    bioEl.innerText = member.bio;
    imgEl.src = member.image;

    // Apply their custom color to the modal border/glow
    if (member.color) {
        nameEl.style.color = member.color;
        imgEl.style.borderColor = member.color;
        cardEl.style.border = `1px solid ${member.color}`;
        cardEl.style.boxShadow = `0 0 20px ${member.color}40`; // 40 = hex opacity
    }

    overlay.style.display = 'flex';
}

function closeBioModal() {
    document.getElementById('bio-modal-overlay').style.display = 'none';
}

// ==========================================
//          HELPER FUNCTIONS
// ==========================================

function ensureReadableColor(hex) {
    hex = hex.replace(/^#/, '');
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

init();