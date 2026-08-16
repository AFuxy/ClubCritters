/**
 * CLUB FuRN - VIPS & CREATORS LOGIC (V3.0 - MYSQL API)
 * Fetching and rendering club VIPs & creators from local backend.
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
    banner: "background: #ffd700; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 4px 0 0 4px; font-size: 12px;", 
    tag: "background: #151e29; color: #ffd700; font-weight: bold; padding: 4px 10px; border-radius: 0 4px 4px 0; font-size: 12px;", 
    info: "color: #888; font-weight: bold;", 
    success: "color: #ffd700; font-style: italic;" 
};

const loadingView = document.getElementById('loading-view');
const vipSection = document.getElementById('vip-section');
const vipList = document.getElementById('vip-list');
const emptyMsg = document.getElementById('empty-msg');
const searchInput = document.getElementById('vip-search-input');

let allVips = [];
let currentActiveDjId = null;
let isEventLive = false;

// ==========================================
//          INITIALIZATION
// ==========================================

async function init() {
    console.clear();
    console.log("%c CLUB FuRN %c VIPS V3 STARTUP ", logStyle.banner, logStyle.tag);

    // Track Page View
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'page_view', 
            targetId: 'vips', 
            metadata: { page: 'vips' } 
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
            processVips(roster);
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
    
    if (isEventLive && schedule) {
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

function parseMemberRoles(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(r => String(r).toLowerCase().trim()).filter(Boolean);
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try { return JSON.parse(trimmed).map(r => String(r).toLowerCase().trim()).filter(Boolean); } catch(e) {}
        }
        return trimmed.split(/\s*,\s*|\s*\/\s*/).map(r => r.toLowerCase().trim()).filter(Boolean);
    }
    return [];
}

function processVips(members) {
    const vips = [];

    members.forEach(member => {
        const roles = parseMemberRoles(member.type);
        if (roles.some(r => r.includes('vip'))) {
            vips.push(member);
        }
    });

    vips.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    allVips = vips;
    renderVips(allVips);
}

function renderVips(vipsToRender) {
    loadingView.classList.add('hidden');
    if (vipsToRender.length > 0) {
        vipSection.classList.remove('hidden');
        emptyMsg.classList.add('hidden');
        renderCards(vipsToRender, vipList);
    } else {
        vipSection.classList.add('hidden');
        emptyMsg.classList.remove('hidden');
    }
}

function getVipDisplayTitle(member) {
    if (member.title && member.title.trim()) return member.title.trim();
    return 'VIP Creator & Collaborator';
}

function renderCards(members, container) {
    container.innerHTML = '';
    members.forEach(member => {
        const links = member.links || {};
        let linksHtml = Object.keys(links).length > 0 ? '<div class="social-tags">' + Object.keys(links).map(k => `<a href="${links[k]}" target="_blank" class="social-tag" onclick="trackSocialClick(event, '${member.discordId}')">${k}</a>`).join('') + '</div>' : '';
        
        const isActive = (currentActiveDjId && member.name.toLowerCase() === currentActiveDjId);
        const playingBadge = isActive ? `<span class="live-tag">ON AIR <div class="visualizer"><div class="viz-bar"></div><div class="viz-bar"></div><div class="viz-bar"></div></div></span>` : '';
        
        const processedColor = processColorValue(member.colorStyle) || 'linear-gradient(135deg, #ffd700, #ffb300)';
        const nameColor = processedColor || '#ffd700';
        const coloredName = `<span class="b2b-name-inline" style="--dj-color: ${nameColor}">${member.name}</span>`;

        const card = document.createElement('div');
        card.className = `dj-card ${isActive ? 'dj-active' : ''}`;
        if (processedColor) card.style.setProperty('--accent-color', processedColor);

        card.style.cursor = "pointer";
        card.onclick = () => window.location.href = `/performer/${member.discordId}`;

        card.innerHTML = `
            <img src="${member.imageUrl || '/cdn/logos/club/Logo.png'}" alt="${member.name}" class="dj-img" style="border-color: rgba(255, 215, 0, 0.4);">
            <div class="dj-content">
                <div class="dj-header">
                    <h3>${coloredName} <span style="font-size: 0.8rem; margin-left: 4px;">⭐</span> ${playingBadge}</h3>
                </div>
                <span class="genre" style="color: #ffd700;">${getVipDisplayTitle(member)}</span>
                ${linksHtml}
            </div>`;
        container.appendChild(card);
    });
}

// Search Filter
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            renderVips(allVips);
            return;
        }

        const filtered = allVips.filter(v => {
            const name = (v.name || "").toLowerCase();
            const title = (v.title || "").toLowerCase();
            return name.includes(query) || title.includes(query);
        });

        renderVips(filtered);
    });
}

function processColorValue(val) {
    if (!val) return null;
    if (val.startsWith('[') && val.endsWith(']')) {
        const colors = val.slice(1, -1).split(',').map(c => c.trim());
        return `linear-gradient(135deg, ${colors.join(', ')})`;
    }
    return val;
}

function trackSocialClick(event, discordId) {
    event.stopPropagation();
    const platform = event.currentTarget.innerText.trim();
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            type: 'social_click', 
            targetId: discordId, 
            metadata: { platform: platform, page: 'vips' } 
        })
    }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", init);
