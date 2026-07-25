const API_SCHEDULE = "/api/public/schedule";
const API_ROSTER = "/api/public/roster";
const API_SETTINGS = "/api/public/settings";
const API_TRACK = "/api/stats/track";

const flyerLines = document.getElementById('flyer-lines');
const flyerDate = document.getElementById('flyer-date');
const tzSelect = document.getElementById('timezone-select');

const tzAbbrMap = {
    'Europe/London': { summer: 'BST', winter: 'GMT' },
    'Europe/Berlin': { summer: 'CEST', winter: 'CET' },
    'Europe/Paris': { summer: 'CEST', winter: 'CET' },
    'America/New_York': { summer: 'EDT', winter: 'EST' },
    'America/Chicago': { summer: 'CDT', winter: 'CST' },
    'America/Denver': { summer: 'MDT', winter: 'MST' },
    'America/Los_Angeles': { summer: 'PDT', winter: 'PST' },
    'Asia/Tokyo': { summer: 'JST', winter: 'JST' },
    'Australia/Sydney': { summer: 'AEDT', winter: 'AEST' },
    'UTC': { summer: 'UTC', winter: 'UTC' }
};

function getTzOffsetMinutes(date, timeZone) {
    try {
        const format = new Intl.DateTimeFormat('en-US', {
            timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
        });
        const parts = format.formatToParts(date);
        const p = {};
        parts.forEach(pt => p[pt.type] = pt.value);
        const dateInTz = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour === '24' ? 0 : p.hour, p.minute, p.second));
        return Math.round((dateInTz.getTime() - date.getTime()) / 60000);
    } catch(e) {
        return 0;
    }
}

function getTimezoneLabel(targetTz, eventDate) {
    const selectedTz = targetTz === 'AUTO' ? Intl.DateTimeFormat().resolvedOptions().timeZone : targetTz;
    if (!selectedTz || selectedTz === 'UTC') return 'UTC';

    const d = eventDate ? new Date(eventDate) : new Date();
    const jan = new Date(d.getFullYear(), 0, 1);
    const jul = new Date(d.getFullYear(), 6, 1);
    const janOffset = getTzOffsetMinutes(jan, selectedTz);
    const julOffset = getTzOffsetMinutes(jul, selectedTz);
    const currentOffset = getTzOffsetMinutes(d, selectedTz);

    const isDst = (janOffset !== julOffset) && (currentOffset === Math.max(janOffset, julOffset));

    if (tzAbbrMap[selectedTz]) {
        return isDst ? tzAbbrMap[selectedTz].summer : tzAbbrMap[selectedTz].winter;
    }

    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: selectedTz, timeZoneName: 'short' }).formatToParts(d);
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        let val = tzPart ? tzPart.value : 'UTC';
        if (val === 'GMT+2') return 'CEST';
        if (val === 'GMT+1') return isDst ? 'BST' : 'CET';
        return val;
    } catch(e) {
        return 'UTC';
    }
}

function applyTimezone(timeStr, targetTz, eventDate) {
    if (!timeStr || !timeStr.includes(':')) return timeStr;
    try {
        const selectedTz = targetTz === 'AUTO' ? Intl.DateTimeFormat().resolvedOptions().timeZone : targetTz;
        if (!selectedTz || selectedTz === 'UTC') return timeStr;

        const [h, m] = timeStr.split(':').map(Number);
        const baseDate = eventDate ? new Date(eventDate) : new Date();
        const y = baseDate.getUTCFullYear();
        const month = baseDate.getUTCMonth();
        const day = baseDate.getUTCDate();

        const utcD = new Date(Date.UTC(y, month, day, h, m, 0));
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: selectedTz,
            hour: '2-digit', minute: '2-digit', hour12: false
        });
        return formatter.format(utcD);
    } catch(e) {
        return timeStr;
    }
}

async function initFlyer() {
    // Track Page View
    fetch(API_TRACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'page_view', targetId: 'flyer' })
    }).catch(() => {});

    try {
        const [schRes, rosRes, setRes] = await Promise.all([
            fetch(API_SCHEDULE),
            fetch(API_ROSTER),
            fetch(API_SETTINGS)
        ]);

        const schedule = await schRes.json();
        const roster = await rosRes.json();
        const settings = await setRes.json();
        window.applyGlobalSettings(settings);

        if (settings && settings.eventTitle && !document.getElementById('custom-title').value) {
            document.getElementById('flyer-subtitle').innerText = settings.eventTitle.toUpperCase();
        }

        if (!schedule || schedule.length === 0) return;

        const targetTz = tzSelect.value;
        const selectedTz = targetTz === 'AUTO' ? Intl.DateTimeFormat().resolvedOptions().timeZone : targetTz;
        const eventStartDate = (settings && settings.eventStartTime) ? new Date(settings.eventStartTime) : new Date();
        const tzLabel = getTimezoneLabel(targetTz, eventStartDate);

        if (settings && settings.eventStartTime) {
            const dateStr = eventStartDate.toLocaleDateString('en-GB', { 
                weekday: 'long', day: 'numeric', month: 'long', timeZone: selectedTz
            });
            flyerDate.innerText = dateStr.toUpperCase();
        }

        flyerLines.innerHTML = '';
        
        schedule.forEach((item, i) => {
            const hasPerformers = item.performers && item.performers.length > 0;
            const isB2B = item.performers && item.performers.length > 1;
            
            let displayName = item.b2bName;
            if (!displayName) {
                if (isB2B) displayName = item.performers.map(p => p.name).join(' B2B ');
                else displayName = item.performer ? item.performer.name : 'Unknown';
            }
            
            const timeRaw = item.timeSlot || "";
            let baseTime = timeRaw.split('-')[0].trim(); 
            const displayTime = applyTimezone(baseTime, targetTz, eventStartDate);
            const genre = item.genre || ""; 
            
            // Handle Logos (Group logo or side-by-side logos)
            let logoHtml = '';
            if (item.b2bLogo) {
                logoHtml = `<img src="${item.b2bLogo}" class="dj-logo-img">`;
            } else if (isB2B) {
                logoHtml = `<div style="display: flex; gap: 8px; align-items: center; justify-content: center;">`;
                item.performers.forEach((p, idx) => {
                    logoHtml += `<img src="${p.image}" class="dj-logo-img">`;
                });
                logoHtml += `</div>`;
            } else {
                const imgUrl = (item.performer ? item.performer.image : null) || "/cdn/logos/club/Logo.png";
                logoHtml = `<img src="${imgUrl}" class="dj-logo-img">`;
            }

            const alignClass = (i % 2 === 0) ? 'logo-is-right' : 'logo-is-left';

            const html = `
                <div class="flyer-row ${alignClass}">
                    <div class="dj-info-container">
                        <span class="flyer-time">${displayTime} ${tzLabel}</span>
                        <span class="flyer-dj" style="${displayName.length > 20 ? 'font-size: 1.5rem;' : ''}">${displayName}</span>
                        <span class="flyer-genre">${genre}</span>
                    </div>
                    <div class="dj-logo-container">
                        ${logoHtml}
                    </div>
                </div>
            `;
            flyerLines.innerHTML += html;
        });

    } catch (e) {
        console.error("Flyer Error:", e);
        flyerLines.innerHTML = "<p>Error loading data.</p>";
    }
}

function downloadFlyer() {
    const canvasDiv = document.getElementById('flyer-canvas');
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }).replace(' ', '');
    const timeStr = now.getHours() + "" + now.getMinutes();
    
    const targetTz = tzSelect.value;
    const tzLabel = getTimezoneLabel(targetTz, now);
    const filename = `ClubFuRN_Flyer_${dateStr}_${timeStr}_${tzLabel}.png`;

    html2canvas(canvasDiv, {
        scale: 2, 
        useCORS: true, 
        backgroundColor: null
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

initFlyer();