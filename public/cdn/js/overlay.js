let lastData = null;

// URL Parameters for visibility control
const urlParams = new URLSearchParams(window.location.search);
const hideNowPlaying = urlParams.get('hideNowPlaying') === 'true';
const hideUpNext = urlParams.get('hideUpNext') === 'true';
const hidePop = urlParams.get('hidePop') === 'true';

// Initial Visibility Setup
if (hideNowPlaying) document.getElementById('now-playing').style.display = 'none';
if (hideUpNext) document.getElementById('up-next').style.display = 'none';
if (hidePop) document.getElementById('population-pulse').style.display = 'none';

async function updateOverlay() {
    try {
        const response = await fetch('/api/public/overlay-data');
        const data = await response.json();

        // Update Population
        if (!hidePop) {
            document.getElementById('vrc-count').innerText = data.vrcStatus.count;
            document.getElementById('vrc-capacity').innerText = data.vrcStatus.capacity;
            const dot = document.getElementById('vrc-active-dot');
            if (data.vrcStatus.active) dot.classList.add('active');
            else dot.classList.remove('active');
        }

        // Check for DJ change
        if (!hideNowPlaying) {
            const currentDJ = data.currentDJ;
            const nowPlayingEl = document.getElementById('now-playing');
            
            if (currentDJ) {
                const djName = currentDJ.b2bName || (currentDJ.performers[0] ? currentDJ.performers[0].name : "Unknown DJ");
                const djGenre = currentDJ.genre || "Electronic";
                const djImage = currentDJ.b2bLogo || (currentDJ.performers[0] ? currentDJ.performers[0].image : "/cdn/logos/club/Logo.png");
                
                // If the DJ has changed, do a slide animation
                if (!lastData || !lastData.currentDJ || lastData.currentDJ.id !== currentDJ.id) {
                    nowPlayingEl.classList.add('slide-out-left');
                    setTimeout(() => {
                        document.getElementById('current-dj-name').innerText = djName;
                        document.getElementById('current-genre').innerText = djGenre;
                        document.getElementById('current-dj-image').src = djImage;
                        
                        // Update accent color if the DJ has one
                        if (currentDJ.performers[0] && currentDJ.performers[0].color) {
                            document.documentElement.style.setProperty('--accent', currentDJ.performers[0].color);
                        }
                        
                        nowPlayingEl.classList.remove('slide-out-left');
                    }, 800);
                }
            } else {
                // No one playing (e.g. pre-event or off-hours)
                document.getElementById('current-dj-name').innerText = "Club Offline";
                document.getElementById('current-genre').innerText = data.eventTitle;
            }
        }

        // Update Up Next
        if (!hideUpNext) {
            const upNext = data.upNext;
            const upNextEl = document.getElementById('up-next');
            const listEl = document.getElementById('next-performers-list');

            if (upNext && upNext.length > 0) {
                if (!lastData || JSON.stringify(lastData.upNext) !== JSON.stringify(upNext)) {
                    upNextEl.classList.add('slide-out-right');
                    setTimeout(() => {
                        listEl.innerHTML = upNext.map(item => {
                            const name = item.b2bName || (item.performers[0] ? item.performers[0].name : "TBA");
                            return `
                                <div class="next-item">
                                    <div class="next-name">${name}</div>
                                    <div class="next-time">${item.timeSlot}</div>
                                </div>
                            `;
                        }).join('');
                        upNextEl.classList.remove('slide-out-right');
                    }, 800);
                }
            } else {
                upNextEl.classList.add('slide-out-right');
            }
        }

        lastData = data;
    } catch (err) {
        console.error("Failed to fetch overlay data:", err);
    }
}

// Poll every 15 seconds
setInterval(updateOverlay, 15000);
updateOverlay(); // Initial load

// Add a subtle "re-animate" every few minutes to keep it looking dynamic
setInterval(() => {
    const elements = [];
    if (!hideNowPlaying) elements.push('now-playing');
    if (!hideUpNext) elements.push('up-next');
    if (!hidePop) elements.push('population-pulse');

    if (elements.length === 0) return;

    const randomEl = document.getElementById(elements[Math.floor(Math.random() * elements.length)]);
    
    let animClass = 'slide-out-left';
    if (randomEl.id === 'up-next') animClass = 'slide-out-right';
    if (randomEl.id === 'population-pulse') animClass = 'slide-out-top';

    randomEl.classList.add(animClass);
    setTimeout(() => {
        randomEl.classList.remove(animClass);
    }, 1000);
}, 60000); // Every 60 seconds, one element will do a little refresh slide
