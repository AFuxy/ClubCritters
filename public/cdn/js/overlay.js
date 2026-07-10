let lastData = null;
let activeDjEndTime = null;

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
            let currentDJ = data.currentDJ;
            const nowPlayingEl = document.getElementById('now-playing');
            
            // If offline, construct a mock DJ object to represent "Club Offline"
            if (!currentDJ) {
                currentDJ = {
                    id: 'offline',
                    genre: data.eventTitle || 'Club Offline',
                    performers: [{
                        name: 'Club Offline',
                        image: '/cdn/logos/club/Logo.png',
                        color: '#ff00ff' // default accent color
                    }]
                };
            }

            // Update countdown target end time every poll
            if (currentDJ.id !== 'offline' && currentDJ.endTime) {
                activeDjEndTime = new Date(currentDJ.endTime);
            } else {
                activeDjEndTime = null;
            }

            const performers = currentDJ.performers || [];
            const isB2B = performers.length > 1;

            // Handle B2B set name stitching
            const djName = currentDJ.b2bName || (isB2B ? performers.map(p => p.name).join(' <span class="now-playing-b2b-sep">B2B</span> ') : (performers[0] ? performers[0].name : "Unknown DJ"));
            const djGenre = currentDJ.genre || "Electronic";
            const djImage = currentDJ.b2bLogo || (performers[0] ? performers[0].image : "/cdn/logos/club/Logo.png");
            
            // Handle Color Style Mix
            let colorVal = null;
            if (isB2B) {
                const allColors = performers.map(p => p.color).filter(Boolean);
                if (allColors.length > 0) {
                    const flatColors = [];
                    allColors.forEach(c => {
                        if (c.startsWith('[') && c.endsWith(']')) {
                            flatColors.push(...c.slice(1, -1).split(',').map(s => s.trim()));
                        } else {
                            flatColors.push(c);
                        }
                    });
                    if (flatColors.length === 1) colorVal = flatColors[0];
                    else colorVal = `[${flatColors.join(', ')}]`;
                }
            } else {
                colorVal = performers[0] ? performers[0].color : null;
            }

            const isFirstLoad = !lastData;
            const isDjChanged = lastData && (!lastData.currentDJ || lastData.currentDJ.id !== currentDJ.id || lastData.isTransition !== data.isTransition);

            const updateDjUI = () => {
                document.getElementById('current-dj-name').innerHTML = djName;
                document.getElementById('current-genre').innerText = djGenre;
                
                const labelContainer = document.getElementById('current-label-container');
                if (labelContainer) {
                    if (data.isTransition) {
                        labelContainer.innerHTML = 'UP NEXT <span id="current-countdown" class="set-countdown"></span>';
                    } else {
                        labelContainer.innerHTML = 'NOW PLAYING <span id="current-countdown" class="set-countdown"></span>';
                    }
                }
                
                const avatarWrapper = document.getElementById('current-dj-avatar-wrapper');
                if (avatarWrapper) {
                    if (currentDJ.b2bLogo) {
                        avatarWrapper.innerHTML = `<img src="${currentDJ.b2bLogo}" alt="${djName}" class="dj-avatar-single">`;
                    } else if (isB2B) {
                        avatarWrapper.innerHTML = `
                            <div class="dj-avatar-b2b-list">
                                ${performers.map(p => `<img src="${p.image || '/cdn/logos/club/Logo.png'}" class="dj-avatar-b2b-item" title="${p.name}">`).join('')}
                            </div>
                        `;
                    } else {
                        avatarWrapper.innerHTML = `<img src="${djImage}" alt="${djName}" class="dj-avatar-single">`;
                    }
                }
                
                if (colorVal) {
                    const parsedColor = parseColor(colorVal);
                    document.documentElement.style.setProperty('--accent', parsedColor);
                    
                    const container = document.getElementById('overlay-container');
                    if (container) {
                        if (colorVal.startsWith('[') && colorVal.endsWith(']')) {
                            container.classList.add('has-gradient');
                        } else {
                            container.classList.remove('has-gradient');
                        }
                    }
                } else {
                    document.documentElement.style.setProperty('--accent', '#ff00ff');
                    const container = document.getElementById('overlay-container');
                    if (container) {
                        container.classList.remove('has-gradient');
                    }
                }
            };

            if (isFirstLoad) {
                updateDjUI();
                nowPlayingEl.classList.remove('slide-out-left');
            } else if (isDjChanged) {
                nowPlayingEl.classList.add('slide-out-left');
                setTimeout(() => {
                    updateDjUI();
                    nowPlayingEl.classList.remove('slide-out-left');
                }, 800);
            }
        }

        // Update Up Next
        if (!hideUpNext) {
            const upNext = data.upNext;
            const upNextEl = document.getElementById('up-next');
            const listEl = document.getElementById('next-performers-list');

            if (upNext && upNext.length > 0) {
                const isFirstLoad = !lastData;
                const isListChanged = lastData && JSON.stringify(lastData.upNext) !== JSON.stringify(upNext);

                const renderList = () => {
                    listEl.innerHTML = upNext.map(item => {
                        const performers = item.performers || [];
                        const isB2B = performers.length > 1;
                        
                        let nameHtml = '';
                        if (item.b2bName) {
                            nameHtml = item.b2bName;
                        } else if (isB2B) {
                            nameHtml = performers.map(p => p.name).join(' <span class="next-b2b-sep">B2B</span> ');
                        } else {
                            nameHtml = performers[0] ? performers[0].name : "TBA";
                        }

                        return `
                            <div class="next-item">
                                <div class="next-name">${nameHtml}</div>
                                <div class="next-time">${item.timeSlot} UTC+0</div>
                            </div>
                        `;
                    }).join('');
                };

                if (isFirstLoad) {
                    renderList();
                    upNextEl.classList.remove('slide-out-right');
                } else if (isListChanged) {
                    upNextEl.classList.add('slide-out-right');
                    setTimeout(() => {
                        renderList();
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
    if (l < 0.6) l = 0.6; // boost lightness to ensure readability on dark overlay bg
    h = Math.round(h * 360); s = Math.round(s * 100); l = Math.round(l * 100);
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function parseColor(val) {
    if (!val) return '#ff00ff';
    if (val.startsWith('[') && val.endsWith(']')) {
        const colors = val.slice(1, -1).split(',').map(c => c.trim());
        const processed = colors.map(c => ensureReadableColor(c));
        return `linear-gradient(135deg, ${processed.join(', ')})`;
    }
    return (val.startsWith('#')) ? ensureReadableColor(val) : val;
}


function updateCountdown() {
    const countdownEl = document.getElementById('current-countdown');
    if (!countdownEl) return;
    
    if (!activeDjEndTime) {
        countdownEl.innerText = '';
        return;
    }
    
    const now = new Date();
    const diffMs = activeDjEndTime - now;
    
    if (diffMs <= 0) {
        countdownEl.innerText = '• SET ENDING';
        activeDjEndTime = null; // Clear to prevent multiple triggers during fetching
        updateOverlay(); // Pull new data immediately
        return;
    }
    
    const diffSecs = Math.floor(diffMs / 1000);
    const hours = Math.floor(diffSecs / 3600);
    const mins = Math.floor((diffSecs % 3600) / 60);
    const secs = diffSecs % 60;
    
    let timeStr = '';
    if (hours > 0) {
        timeStr = `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    countdownEl.innerText = `• ${timeStr} LEFT`;
}

// Tick the countdown clock every second
setInterval(updateCountdown, 1000);
