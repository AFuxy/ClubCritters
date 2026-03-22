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

            window.applyGlobalSettings(settings);

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
            ? `<span class="peak-badge" style="background:rgba(179, 106, 244, 0.1); color:#B36AF4;">Unique: ${event.uniqueUsers}</span>`
            : "";

        const overflowBadge = event.isGrouped 
            ? `<span class="peak-badge" style="background:rgba(0, 230, 118, 0.1); color:#00e676;">Overflow Protected</span>`
            : "";

        const card = document.createElement('div');
        card.className = "event-card";
        card.style.flexDirection = "column"; // Allow vertical expansion
        
        // Sort instances by start time to accurately label them
        const sortedInstances = event.instances.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        const instanceListHtml = sortedInstances.map((inst, index) => {
            const label = index === 0 ? "MAIN HUB" : `OVERFLOW #${index}`;
            const labelColor = index === 0 ? "var(--primary-purple)" : "#888";
            
            return `
                <div class="instance-row">
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <span class="instance-name">${inst.worldName}</span>
                        <span style="font-size:0.6rem; font-weight:900; color:${labelColor}; letter-spacing:1px;">${label}</span>
                    </div>
                    <span class="instance-data">
                        PEAK: <b>${inst.peakCapacity}</b> | UNIQ: <b>${inst.uniqueUsers}</b>
                    </span>
                </div>
            `;
        }).join('');

        const breakdownLink = event.isGrouped 
            ? `<div class="breakdown-toggle" onclick="toggleBreakdown(this)">🔍 VIEW DETAILS</div>`
            : "";

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div class="event-info">
                    <h3>${event.worldName}</h3>
                    <div class="event-date">${date}</div>
                    ${breakdownLink}
                </div>
                <div class="event-stats">
                    <div class="badge-group">
                        <span class="peak-badge">Peak: ${event.peakCapacity}</span>
                        ${uniqueBadge}
                        ${overflowBadge}
                    </div>
                    <span class="duration-text">${duration} duration</span>
                </div>
            </div>
            <div class="instance-breakdown">
                ${instanceListHtml}
            </div>
        `;
        eventList.appendChild(card);
    });
}

function toggleBreakdown(el) {
    const card = el.closest('.event-card');
    const breakdown = card.querySelector('.instance-breakdown');
    const isVisible = breakdown.style.display === 'block';
    
    breakdown.style.display = isVisible ? 'none' : 'block';
    el.innerText = isVisible 
        ? `🔍 View ${breakdown.querySelectorAll('.instance-row').length} Instances` 
        : `➖ Hide Instances`;
    }

    initEvents();