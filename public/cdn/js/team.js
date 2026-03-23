/**
 * CLUB CRITTERS - TEAM LOGIC (V3.0 - MYSQL API)
 * Fetching from local Node.js backend.
 */

// ==========================================
//          CONFIGURATION
// ==========================================

const API_ROSTER = "/api/public/roster";
const API_SCHEDULE = "/api/public/schedule";
const API_SETTINGS = "/api/public/settings";
const API_TRACK = "/api/stats/track";

// Console Theme
const logStyle = { 
    banner: "background: #00e676; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;", 
    tag: "background: #151e29; color: #00e676; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;", 
    info: "color: #888; font-weight: bold;", 
    success: "color: #00e676; font-style: italic;" 
};

const loadingView = document.getElementById('loading-view');
const staffSection = document.getElementById('staff-section');
const staffList = document.getElementById('staff-list');
const residentSection = document.getElementById('resident-section');
const residentList = document.getElementById('resident-list');
const emptyMsg = document.getElementById('empty-msg');

let currentActiveDjId = null;
let isEventLive = false;

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB CRITTERS %c TEAM V3 STARTUP ", logStyle.banner, logStyle.tag);

    // Track Page View
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'page_view', 
            targetId: 'team', 
            metadata: { page: 'team' } 
        })
    }).catch(() => {});

    try {
        const [rosRes, schRes, setRes] = await Promise.all([
            fetch(API_ROSTER),
            fetch(API_SCHEDULE),
            fetch(API_SETTINGS)
        ]);
        
        if (rosRes.ok && schRes.ok && setRes.ok) {
            const roster = await rosRes.json();
            const schedule = await schRes.json();
            const settings = await setRes.json();
            
            window.applyGlobalSettings(settings);
            processStatus(settings, schedule);
            processRoster(roster);
        }
    } catch (error) {
        console.warn("Network error", error);
        loadingView.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
    }
}

function processStatus(settings, schedule) {
    if (!settings) return;
    const start = new Date(settings.eventStartTime);
    const end = new Date(settings.eventEndTime);
    const now = new Date();
    
    isEventLive = (now >= start && now < end && !settings.forceOffline);
    
    if (isEventLive) {
        const backLink = document.querySelector('.nav-pill-cc');
        if (backLink && !backLink.querySelector('.live-dot')) {
            backLink.insertAdjacentHTML('afterbegin', '<span class="live-dot"></span>');
        }

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
                currentActiveDjId = item.performer.name.toLowerCase();
            }
        });
    }
}

function processRoster(members) {
    const staffMembers = [];
    const residents = [];

    members.forEach(member => {
        const type = (member.type || "").toLowerCase();
        if (type.includes('owner') || type.includes('host') || type.includes('staff')) {
            staffMembers.push(member);
        } else {
            residents.push(member);
        }
    });

    staffMembers.sort((a, b) => {
        const tA = a.type.toLowerCase();
        const tB = b.type.toLowerCase();
        const wA = tA.includes('owner') ? 1 : (tA.includes('host') ? 2 : 3);
        const wB = tB.includes('owner') ? 1 : (tB.includes('host') ? 2 : 3);
        return wA - wB;
    });

    residents.sort((a, b) => {
        const tA = a.type.toLowerCase();
        const tB = b.type.toLowerCase();
        const wA = tA.includes('resident') ? 1 : 2;
        const wB = tB.includes('resident') ? 1 : 2;
        return wA - wB;
    });

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
        const links = member.links || {};
        let linksHtml = Object.keys(links).length > 0 ? '<div class="social-tags">' + Object.keys(links).map(k => `<a href="${links[k]}" target="_blank" class="social-tag" onclick="trackSocialClick(event, '${member.discordId}')">${k}</a>`).join('') + '</div>' : '';
        
        const isActive = (currentActiveDjId && member.name.toLowerCase() === currentActiveDjId);
        const playingBadge = isActive ? `<span class="live-tag">ON AIR <div class="visualizer"><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div></div></span>` : '';
        
        const processedColor = processColorValue(member.colorStyle);
        const card = document.createElement('div');
        card.className = `dj-card ${isActive ? 'dj-active' : ''}`;
        if (processedColor) card.style.setProperty('--accent-color', processedColor);

        card.style.cursor = "pointer";
        card.onclick = () => window.location.href = `/performer/${member.discordId}`;

        card.innerHTML = `
            <img src="${member.imageUrl || '/cdn/logos/club/HeadOnly.png'}" alt="${member.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header"><h3>${member.name} ${playingBadge}</h3></div>
                <span class="genre">${member.title || member.type}</span>
                ${linksHtml}
            </div>`;
        container.appendChild(card);
    });
}

window.trackSocialClick = function(event, discordId) {
    event.stopPropagation();
    const label = event.target.innerText || 'social_link';
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'link_click', 
            targetId: discordId, 
            metadata: { page: 'team', label: label } 
        })
    }).catch(() => {});
};

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
