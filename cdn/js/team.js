/**
 * CLUB CRITTERS - TEAM ROSTER LOGIC
 * Fetches the Team sheet, filters members into Staff vs Residents,
 * and renders them using the standard card layout.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

// PASTE YOUR NEW "TEAM" TAB CSV URL HERE
const teamSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=628779174&single=true&output=csv";

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
    console.log("Fetching Team Roster...");

    try {
        await fetchAndParseSheet();
    } catch (error) {
        console.error(error);
        loadingView.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
        emptyMsg.innerText = "Unable to load team data.";
    }
}

async function fetchAndParseSheet() {
    const response = await fetch(teamSheetUrl);
    if (!response.ok) throw new Error("Sheet returned " + response.status);

    const text = await response.text();
    const rows = text.split(/\r?\n/);
    if (rows.length < 2) throw new Error("Sheet is empty");

    const headers = rows[0].split(',').map(h => h.trim());

    const staffMembers = [];
    const residents = [];

    // Parse Rows (Skip Header)
    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        
        // Minimum Requirement: Name (Col A) and Type (Col B)
        if (cols.length < 2 || !cols[0]) continue; 

        // Color Processing (Reuse logic from main.js)
        let rawColor = cols[4];
        let finalColor = null;
        if (rawColor && rawColor.startsWith('#')) {
            finalColor = ensureReadableColor(rawColor);
        }

        const member = {
            name: cols[0],
            type: cols[1].toLowerCase(), // 'staff' or 'resident'
            title: cols[2],
            image: cols[3] || "../cdn/logos/club/HeadOnly.png", // Note: ../ path for team page
            color: finalColor,
            links: {}
        };

        // Parse Socials (Col F / Index 5 onwards)
        for (let x = 5; x < cols.length; x++) {
            const url = cols[x];
            const label = headers[x]; 
            if (url && url.length > 0 && label) {
                member.links[label] = url;
            }
        }

        // Sort into categories
        if (member.type.includes('staff') || member.type.includes('owner') || member.type.includes('host')) {
            staffMembers.push(member);
        } else if (member.type.includes('resident') || member.type.includes('dj')) {
            residents.push(member);
        }
    }

    renderRoster(staffMembers, residents);
}

function renderRoster(staff, residents) {
    loadingView.classList.add('hidden');

    // Render Staff
    if (staff.length > 0) {
        staffSection.classList.remove('hidden');
        renderCards(staff, staffList);
    }

    // Render Residents
    if (residents.length > 0) {
        residentSection.classList.remove('hidden');
        renderCards(residents, residentList);
    }

    // Handle Total Failure
    if (staff.length === 0 && residents.length === 0) {
        emptyMsg.classList.remove('hidden');
    }
}

// Generic Card Renderer (Reuses styles from main.css)
function renderCards(members, container) {
    container.innerHTML = '';
    
    members.forEach(member => {
        // Generate Social Links
        let linksHtml = '';
        const linkKeys = Object.keys(member.links);
        if (linkKeys.length > 0) {
            linksHtml = '<div class="social-tags">';
            linkKeys.forEach(platformName => {
                const url = member.links[platformName];
                linksHtml += `<a href="${url}" target="_blank" class="social-tag">${platformName}</a>`;
            });
            linksHtml += '</div>';
        }

        const card = document.createElement('div');
        card.className = 'dj-card';
        if (member.color) { card.style.setProperty('--accent-color', member.color); }

        card.innerHTML = `
            <img src="${member.image}" alt="${member.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${member.name}</h3>
                    </div>
                <span class="genre">${member.title}</span>
                ${linksHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

// Helper: Ensure Readable Color (Same as main.js)
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