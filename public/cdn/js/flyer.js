const API_SCHEDULE = "/api/public/schedule";
const API_ROSTER = "/api/public/roster";
const API_SETTINGS = "/api/public/settings";
const API_TRACK = "/api/stats/track";

const flyerLines = document.getElementById('flyer-lines');
const flyerDate = document.getElementById('flyer-date');
const tzSelect = document.getElementById('timezone-select');

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

        const offset = parseInt(tzSelect.value); 
        const tzLabel = tzSelect.options[tzSelect.selectedIndex].text.split(' ')[0];

        if (settings && settings.eventStartTime) {
            const d = new Date(settings.eventStartTime);
            const shiftedDate = new Date(d.getTime() + (offset * 60 * 60 * 1000));
            const dateStr = shiftedDate.toLocaleDateString('en-GB', { 
                weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
            });
            flyerDate.innerText = dateStr.toUpperCase();
        }

        flyerLines.innerHTML = '';
        
        schedule.forEach((item, i) => {
            const name = item.performer.name;
            const timeRaw = item.timeSlot || "";
            let baseTime = timeRaw.split('-')[0].trim(); 
            const displayTime = applyTimezone(baseTime, offset);
            const genre = item.genre || ""; 
            const imgUrl = item.performer.image || "/cdn/logos/club/Logo.png";

            const alignClass = (i % 2 === 0) ? 'logo-is-right' : 'logo-is-left';

            const html = `
                <div class="flyer-row ${alignClass}">
                    <div class="dj-info-container">
                        <span class="flyer-time">${displayTime} ${tzLabel}</span>
                        <span class="flyer-dj">${name}</span>
                        <span class="flyer-genre">${genre}</span>
                    </div>
                    <div class="dj-logo-container">
                        <img src="${imgUrl}" class="dj-logo-img" crossorigin="anonymous">
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

function applyTimezone(timeStr, offset) {
    if (!timeStr.includes(':')) return timeStr; 

    const [h, m] = timeStr.split(':').map(Number);
    let newH = h + offset;

    if (newH >= 24) newH -= 24;
    if (newH < 0) newH += 24;

    const finalH = newH.toString().padStart(2, '0');
    return `${finalH}:${m.toString().padStart(2, '0')}`;
}

function downloadFlyer() {
    const canvasDiv = document.getElementById('flyer-canvas');
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }).replace(' ', '');
    const timeStr = now.getHours() + "" + now.getMinutes();
    
    const tzLabel = tzSelect.options[tzSelect.selectedIndex].text.split(' ')[0];
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