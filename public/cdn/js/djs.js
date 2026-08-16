/**
 * CLUB FuRN - DJS & PERFORMERS LOGIC (V3.0 - MYSQL API)
 * Fetching and rendering club DJs from local backend.
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
    banner: "background: #a855f7; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;", 
    tag: "background: #151e29; color: #a855f7; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;", 
    info: "color: #888; font-weight: bold;", 
    success: "color: #a855f7; font-style: italic;" 
};

const loadingView = document.getElementById('loading-view');
const djSection = document.getElementById('dj-section');
const djList = document.getElementById('dj-list');
const emptyMsg = document.getElementById('empty-msg');
const searchInput = document.getElementById('dj-search-input');

let allDjs = [];
let currentActiveDjId = null;
let isEventLive = false;

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB FuRN %c DJS V3 STARTUP ", logStyle.banner, logStyle.tag);

    // Track Page View
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'page_view', 
            targetId: 'djs', 
            metadata: { page: 'djs' } 
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
            processDjs(roster);
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

            if (now >= djStart && now < djEnd && item.performer) {
                currentActiveDjId = item.performer.name.toLowerCase();
            }
        });
    }
}

function processDjs(members) {
    const djs = [];

    members.forEach(member => {
        const type = (member.type || "").toLowerCase();
        if (type === 'partner') return;
        
        // Exclude accounts that are strictly staff without DJ role
        if (!type.includes('owner') && !type.includes('host') && !type.includes('staff')) {
            djs.push(member);
        } else if (type.includes('resident') || type.includes('dj') || member.genre) {
            djs.push(member);
        }
    });

    djs.sort((a, b) => {
        const tA = (a.type || "").toLowerCase();
        const tB = (b.type || "").toLowerCase();
        const wA = tA.includes('resident') ? 1 : 2;
        const wB = tB.includes('resident') ? 1 : 2;
        if (wA !== wB) return wA - wB;
        return (a.name || "").localeCompare(b.name || "");
    });

    allDjs = djs;
    renderDjs(allDjs);
}

function renderDjs(djsToRender) {
    loadingView.classList.add('hidden');
    if (djsToRender.length > 0) {
        djSection.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        renderCards(djsToRender, djList);
    } else {
        djSection.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
    }
}

function renderCards(members, container) {
    container.innerHTML = '';
    members.forEach(member => {
        const links = member.links || {};
        let linksHtml = Object.keys(links).length > 0 ? '<div class="social-tags">' + Object.keys(links).map(k => `<a href="${links[k]}" target="_blank" class="social-tag" onclick="trackSocialClick(event, '${member.discordId}')">${k}</a>`).join('') + '</div>' : '';
        
        const isActive = (currentActiveDjId && member.name.toLowerCase() === currentActiveDjId);
        const playingBadge = isActive ? `<span class="live-tag">ON AIR <div class="visualizer"><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div></div></span>` : '';
        
        const processedColor = processColorValue(member.colorStyle);
        const nameColor = processedColor || 'inherit';
        const coloredName = `<span class="b2b-name-inline" style="--dj-color: ${nameColor}">${member.name}</span>`;

        const card = document.createElement('div');
        card.className = `dj-card ${isActive ? 'dj-active' : ''}`;
        if (processedColor) card.style.setProperty('--accent-color', processedColor);

        card.style.cursor = "pointer";
        card.onclick = () => window.location.href = `/performer/${member.discordId}`;

        card.innerHTML = `
            <img src="${member.imageUrl || '/cdn/logos/club/Logo.png'}" alt="${member.name}" class="dj-img">
            <div class="dj-content">
                <div class="dj-header"><h3>${coloredName} ${playingBadge}</h3></div>
                <span class="genre">${member.genre || member.title || member.type}</span>
                ${linksHtml}
            </div>`;
        container.appendChild(card);
    });
}

// Search Filter
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (!q) {
            renderDjs(allDjs);
            return;
        }
        const filtered = allDjs.filter(dj => {
            const name = (dj.name || "").toLowerCase();
            return name.includes(q);
        });
        renderDjs(filtered);
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
            metadata: { page: 'djs', label: label } 
        })
    }).catch(() => {});
};

function processColorValue(val) {
    if (!val) return null;
    val = val.trim();
    if (val.startsWith('[') && val.endsWith(']')) {
        const colors = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        if (colors.length === 0) return null;
        if (colors.length === 1) return colors[0];
        return `linear-gradient(135deg, ${colors.join(', ')})`;
    }
    return val;
}

document.addEventListener('DOMContentLoaded', init);
