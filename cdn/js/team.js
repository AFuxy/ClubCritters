/**
 * CLUB CRITTERS - TEAM LOGIC (SMART CACHE)
 * Instant load via shared Roster cache.
 */

const rosterSheetUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAATcNJTOB-CmGzt84jPhdc1UgSFgN8ddz0UNfieGoqsK8FctDeyugziybSlG6sDrIv7saP7mpStHq/pub?gid=1671173789&single=true&output=csv";

// SHARED CACHE KEY (Matches Main/Archive)
const CACHE_KEY_ROSTER = 'cc_roster_v1';

// Console Theme
const logStyle = { banner: "background: #00e676; color: #000; font-weight: bold;", tag: "background: #151e29; color: #00e676;", info: "color: #888;", success: "color: #00e676;" };

const loadingView = document.getElementById('loading-view');
const staffSection = document.getElementById('staff-section');
const staffList = document.getElementById('staff-list');
const residentSection = document.getElementById('resident-section');
const residentList = document.getElementById('resident-list');
const emptyMsg = document.getElementById('empty-msg');

async function init() {
    console.clear();
    console.log("%c TEAM %c ROSTER SYSTEM STARTUP ", logStyle.banner, logStyle.tag);
    createBioModal();

    // --- PHASE 1: CACHE LOAD ---
    const cachedRoster = localStorage.getItem(CACHE_KEY_ROSTER);
    if (cachedRoster) {
        console.log("%c[CACHE] Loading from local storage...", logStyle.info);
        processRosterData(cachedRoster);
    }

    // --- PHASE 2: NETWORK UPDATE ---
    try {
        const response = await fetch(rosterSheetUrl);
        if (response.ok) {
            const text = await response.text();
            if (text !== cachedRoster) {
                console.log("%c[NETWORK] New roster data found. Updating...", logStyle.success);
                localStorage.setItem(CACHE_KEY_ROSTER, text);
                processRosterData(text);
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

function processRosterData(csvText) {
    const rows = csvText.split(/\r?\n/);
    if (rows.length < 2) return;

    const headers = rows[0].split(',').map(h => h.trim());
    const staffMembers = [];
    const residents = [];

    for (let i = 1; i < rows.length; i++) {
        if (!rows[i]) continue;
        const cols = rows[i].split(',').map(c => c.trim());
        if (cols.length < 2 || !cols[0]) continue; 

        const type = cols[1].toLowerCase();
        
        if (!type.includes('staff') && !type.includes('resident') && !type.includes('owner') && !type.includes('host') && !type.includes('dj')) continue;

        let finalColor = cols[4] && cols[4].startsWith('#') ? ensureReadableColor(cols[4]) : null;

        const member = {
            name: cols[0],
            title: cols[2],
            image: cols[3] || "../cdn/logos/club/HeadOnly.png",
            color: finalColor,
            bio: cols[5],
            links: {}
        };

        for (let x = 6; x < cols.length; x++) {
            if (cols[x] && headers[x]) member.links[headers[x]] = cols[x];
        }

        if (type.includes('staff') || type.includes('owner') || type.includes('host')) {
            staffMembers.push(member);
        } else {
            residents.push(member);
        }
    }
    renderRoster(staffMembers, residents);
}

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
    // Check if exists first to prevent dupes if function runs twice
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