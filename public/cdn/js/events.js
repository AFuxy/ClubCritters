/**
 * CLUB CRITTERS - EVENT HISTORY LOGIC (V3.0)
 */

const API_EVENTS = "/api/public/events";
const API_SETTINGS = "/api/public/settings";

const loadingView = document.getElementById('loading-view');
const eventsView = document.getElementById('events-view');
const eventList = document.getElementById('event-list');
const emptyMsg = document.getElementById('empty-msg');

async function initEvents() {
    try {
        const [eventRes, setRes] = await Promise.all([
            fetch(API_EVENTS),
            fetch(API_SETTINGS)
        ]);

        if (eventRes.ok && setRes.ok) {
            const events = await eventRes.json();
            const settings = await setRes.json();

            if (events.length === 0) {
                loadingView.classList.add('hidden');
                emptyMsg.classList.remove('hidden');
                return;
            }

            renderGlobalStats(events);
            renderEvents(events);
            
            loadingView.classList.add('hidden');
            eventsView.classList.remove('hidden');
        }
    } catch (error) {
        console.error("Failed to load events", error);
    }
}

function renderGlobalStats(events) {
    const totalEvents = events.length;
    const allTimePeak = Math.max(...events.map(e => e.peakCapacity || 0));
    const totalMinutes = events.reduce((acc, curr) => acc + (curr.totalDuration || 0), 0);
    const totalHours = Math.round(totalMinutes / 60);

    document.getElementById('stat-total-events').innerText = totalEvents;
    document.getElementById('stat-all-time-peak').innerText = allTimePeak;
    document.getElementById('stat-total-hours').innerText = totalHours;
}

function renderEvents(events) {
    eventList.innerHTML = "";
    
    events.forEach(event => {
        const date = new Date(event.startTime).toLocaleDateString(undefined, { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        
        const duration = event.totalDuration 
            ? `${Math.floor(event.totalDuration / 60)}h ${event.totalDuration % 60}m` 
            : 'Unrecorded';

        const uniqueBadge = event.uniqueUsers > 0 
            ? `<span class="peak-badge" style="background:rgba(179, 106, 244, 0.1); color:#B36AF4; margin-left:10px;">Unique: ${event.uniqueUsers}</span>`
            : "";

        const card = document.createElement('div');
        card.className = "event-card";
        card.innerHTML = `
            <div class="event-info">
                <h3>${event.worldName}</h3>
                <div class="event-date">${date}</div>
            </div>
            <div class="event-stats">
                <span class="peak-badge">Peak: ${event.peakCapacity}</span>
                ${uniqueBadge}
                <span class="duration-text">${duration} duration</span>
            </div>
        `;
        eventList.appendChild(card);
    });
}

initEvents();