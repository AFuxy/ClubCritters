/**
 * CLUB FuRN - THEME & PARTICLE ENGINE
 * Centralized logic for global themes, snow, and rain effects.
 */

window.applyGlobalSettings = function(data) {
    if (!data) return;
    window.lastData = data; // Store for toggle reference

    // 1. Manage Body Themes
    const themes = ['theme-halloween', 'theme-christmas', 'theme-pride', 'theme-valentines', 'theme-summer', 'theme-rain'];
    themes.forEach(t => document.body.classList.remove(t));
    if (data.eventTheme) {
        document.body.classList.add(data.eventTheme);
    }

    // 2. Motion Preference Check
    const disableMotion = localStorage.getItem('cc_disable_motion') === 'true';
    if (disableMotion) {
        document.body.classList.add('disable-motion');
    } else {
        document.body.classList.remove('disable-motion');
    }

    // 3. Initialize Particles
    initSnow(data.eventTheme === 'theme-christmas' && !disableMotion);
    initRain(data.eventTheme === 'theme-rain' && !disableMotion);

    // 4. Manage Global Logo
    const logoImg = document.querySelector('.logo');
    if (logoImg) {
        if (data.eventLogo && data.eventLogo.trim() !== "") {
            logoImg.src = data.eventLogo;
            logoImg.classList.add('custom-logo');
        } else {
            // Restore default logo - Use absolute path for all EJS views
            logoImg.src = "/cdn/logos/club/HeadOnly.png";
            logoImg.classList.remove('custom-logo');
        }
    }

    updateToggleUI();
};

window.toggleMotion = function() {
    const currentState = localStorage.getItem('cc_disable_motion') === 'true';
    const newState = !currentState;
    localStorage.setItem('cc_disable_motion', newState);
    
    // Immediately apply to current state
    if (window.lastData) {
        window.applyGlobalSettings(window.lastData);
    } else {
        // Fallback if no settings loaded yet
        if (newState) {
            document.body.classList.add('disable-motion');
            initSnow(false);
            initRain(false);
        } else {
            document.body.classList.remove('disable-motion');
        }
        updateToggleUI();
    }
};

function updateToggleUI() {
    const btn = document.getElementById('motion-toggle-btn');
    if (!btn) return;
    
    const highMotionThemes = ['theme-christmas', 'theme-rain', 'theme-pride'];
    const currentTheme = window.lastData ? window.lastData.eventTheme : "";
    
    if (highMotionThemes.includes(currentTheme)) {
        btn.style.display = 'block';
    } else {
        btn.style.display = 'none';
    }

    const disabled = localStorage.getItem('cc_disable_motion') === 'true';
    btn.innerText = disabled ? "✨ Enable Effects" : "🌑 Disable Effects";
}

function initSnow(active) {
    let container = document.getElementById('snow-container');
    if (!active) {
        if (container) container.remove();
        return;
    }
    if (container) return;

    container = document.createElement('div');
    container.id = 'snow-container';
    container.style = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;overflow:hidden;';
    document.body.appendChild(container);

    for (let i = 0; i < 50; i++) {
        const flake = document.createElement('div');
        flake.className = 'snowflake';
        flake.style.left = Math.random() * 100 + '%';
        flake.style.opacity = Math.random() * 0.7 + 0.3;
        flake.style.animationDuration = (Math.random() * 7 + 5) + 's';
        flake.style.animationDelay = (Math.random() * 5) + 's';
        const size = (Math.random() * 4 + 2) + 'px';
        flake.style.width = size;
        flake.style.height = size;
        flake.style.setProperty('--drift', (Math.random() * 200 - 100) + 'px');
        container.appendChild(flake);
    }
}

function initRain(active) {
    let container = document.getElementById('rain-container');
    if (!active) {
        if (container) container.remove();
        return;
    }
    if (container) return;

    container = document.createElement('div');
    container.id = 'rain-container';
    container.style = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;overflow:hidden;';
    document.body.appendChild(container);

    for (let i = 0; i < 80; i++) {
        const drop = document.createElement('div');
        drop.className = 'rain-drop';
        drop.style.left = Math.random() * 100 + '%';
        drop.style.opacity = Math.random() * 0.3 + 0.1;
        drop.style.animationDuration = (Math.random() * 0.4 + 0.4) + 's';
        drop.style.animationDelay = (Math.random() * 2) + 's';
        drop.style.transform = `scaleY(${Math.random() * 0.7 + 0.8})`;
        container.appendChild(drop);
    }
}
