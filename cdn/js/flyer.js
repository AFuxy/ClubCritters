const SPREADSHEET_ID = "1MXvHh09Bw1yLQk6_YidOJmYrbJydZvdfQCR0kgK_NE4";
const API_KEY = "AIzaSyBE-7WGEdDOlq9SFBKhEfxg_AbP1KZOMUE";

const SCHEDULE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Schedule!A:Z?key=${API_KEY}`;
const ROSTER_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Roster!A:Z?key=${API_KEY}`;

const flyerLines = document.getElementById('flyer-lines');
const flyerDate = document.getElementById('flyer-date');
const tzSelect = document.getElementById('timezone-select');

async function initFlyer() {
    try {
        const [scheduleResp, rosterResp] = await Promise.all([
            fetch(SCHEDULE_URL),
            fetch(ROSTER_URL)
        ]);

        const scheduleJson = await scheduleResp.json();
        const rosterJson = await rosterResp.json();

        const scheduleRows = scheduleJson.values;
        const rosterRows = rosterJson.values;

        if (!scheduleRows || scheduleRows.length < 2) return;

        let nameIdx = 0; 
        let imgIdx = 1;  
        
        if (rosterRows && rosterRows.length > 0) {
            const headers = rosterRows[0];
            const n = headers.findIndex(h => h.toLowerCase() === "name");
            const i = headers.findIndex(h => h.toLowerCase() === "image");
            if (n !== -1) nameIdx = n;
            if (i !== -1) imgIdx = i;
        }

        const logoMap = {};
        if (rosterRows) {
            rosterRows.forEach(row => {
                const rName = row[nameIdx]; 
                const rLogo = row[imgIdx]; 
                if (rName && rLogo) {
                    logoMap[rName.toLowerCase().trim()] = rLogo;
                }
            });
        }

        const offset = parseInt(tzSelect.value); 
        const tzLabel = tzSelect.options[tzSelect.selectedIndex].text.split(' ')[0];

        const dateRaw = scheduleRows[1][0];
        if (dateRaw) {
            const d = new Date(dateRaw);
            
            const shiftedDate = new Date(d.getTime() + (offset * 60 * 60 * 1000));

            const dateStr = shiftedDate.toLocaleDateString('en-GB', { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'short',
                timeZone: 'UTC'
            });
            
            flyerDate.innerText = dateStr.toUpperCase();
        }

        flyerLines.innerHTML = '';
        
        for (let i = 2; i < scheduleRows.length; i++) {
            const cols = scheduleRows[i];
            if (!cols || !cols[4]) continue;

            const name = cols[4];    
            const timeRaw = cols[5] || "";
            let baseTime = timeRaw.split('-')[0].trim(); 
            
            const displayTime = applyTimezone(baseTime, offset);
            
            const genre = cols[6] || ""; 
            
            let imgUrl = "cdn/logos/club/HeadOnly.png";
            if (logoMap[name.toLowerCase().trim()]) {
                imgUrl = logoMap[name.toLowerCase().trim()];
            } else if (cols[7]) {
                imgUrl = cols[7]; 
            }

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
        }

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
    const filename = `ClubCritters_Flyer_${dateStr}_${timeStr}.png`;

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