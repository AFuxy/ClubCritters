const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let authCookie = null;
let pendingCookie = null; // Used for 2FA verification
let cachedGroupId = null;
let lastStatus = "Disconnected";
let dbCookieLoaded = false;
let cooldownUntil = 0; // Timestamp when we can try login again

// --- CACHE CONFIGURATION ---
const cache = {
    groupStats: { data: null, timestamp: 0 },
    groupInstance: { data: null, timestamp: 0 },
    specificInstance: new Map() 
};
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Save cookie to database
 */
async function saveCookieToDB(cookie) {
    try {
        const { Settings } = require('../db');
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});
        await settings.update({ vrcCookie: cookie });
    } catch (e) {
        console.error("[VRC API] Failed to save cookie to DB:", e);
    }
}

/**
 * Load cookie from database
 */
async function loadCookieFromDB() {
    if (dbCookieLoaded) return authCookie;
    try {
        const { Settings } = require('../db');
        const settings = await Settings.findOne();
        if (settings && settings.vrcCookie) {
            authCookie = settings.vrcCookie;
            lastStatus = "Connected";
            console.log("\x1b[36m[VRC API] 🍪 Loaded session cookie from database.\x1b[0m");
        }
        dbCookieLoaded = true;
    } catch (e) {
        console.error("[VRC API] Failed to load cookie from DB:", e);
    }
    return authCookie;
}

/**
 * Log in to VRChat and store the authentication cookie
 */
async function loginVRC() {
    // 1. Cooldown Check
    const nowTs = Date.now();
    if (nowTs < cooldownUntil) {
        const remaining = Math.ceil((cooldownUntil - nowTs) / 1000);
        lastStatus = `Rate Limited (${remaining}s)`;
        return null;
    }

    // 2. Load from DB first
    if (!authCookie && !dbCookieLoaded) {
        await loadCookieFromDB();
        if (authCookie) return authCookie;
    }

    const username = process.env.VRC_USERNAME;
    const password = process.env.VRC_PASSWORD;

    if (!username || !password) {
        lastStatus = "Missing Credentials";
        return null;
    }

    console.log(`[VRC API] 🔐 Attempting to login as: ${username}...`);
    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

    try {
        const res = await fetch('https://api.vrchat.cloud/api/1/auth/user', {
            headers: {
                'Authorization': authHeader,
                'User-Agent': 'ClubCrittersManager/1.0.0 (contact: site-admin)'
            }
        });

        // 3. Handle Rate Limiting
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter || res.status === 429) {
            const seconds = parseInt(retryAfter) || 300;
            cooldownUntil = Date.now() + (seconds * 1000);
            lastStatus = `Rate Limited (${seconds}s)`;
            console.error(`\x1b[31m[VRC API] ⛔ RATE LIMITED: Waiting ${seconds}s before next attempt.\x1b[0m`);
            return null;
        }

        const data = await res.json().catch(() => ({}));
        const cookies = res.headers.raw()['set-cookie'];
        const currentCookie = cookies?.find(c => c.startsWith('auth='))?.split(';')[0];

        if (res.status === 200) {
            if (currentCookie && !data.requiresTwoFactorAuth) {
                authCookie = currentCookie;
                lastStatus = "Connected";
                await saveCookieToDB(authCookie);
                console.log(`\x1b[32m[VRC API] ✅ Logged in successfully.\x1b[0m`);
                return authCookie;
            }
            
            if (data.requiresTwoFactorAuth) {
                pendingCookie = currentCookie;
                lastStatus = "2FA Required";
                console.log("\x1b[33m[VRC API] 🔐 2FA Required. Check your email.\x1b[0m");
            }
        } else if (res.status === 401) {
            lastStatus = "Invalid Credentials";
            console.error("\x1b[31m[VRC API] ❌ 401 Unauthorized. Check your Username/Password.\x1b[0m");
            cooldownUntil = Date.now() + (60 * 1000); 
        } else {
            lastStatus = `Error ${res.status}`;
        }
    } catch (err) {
        console.error("[VRC API] Login Error:", err);
        lastStatus = "Connection Error";
    }
    return null;
}

/**
 * Submit an Email OTP code to VRChat
 */
async function verifyVRC(code) {
    if (!code) return { success: false, message: "Code required" };
    
    if (!pendingCookie) {
        await loginVRC();
        if (!pendingCookie) return { success: false, message: lastStatus.includes("Rate Limited") ? "Account is rate limited. Please wait." : "No active login attempt found." };
    }

    try {
        const res = await fetch('https://api.vrchat.cloud/api/1/auth/twofactorauth/emailotp/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': pendingCookie,
                'User-Agent': 'ClubCrittersManager/1.0.0'
            },
            body: JSON.stringify({ code })
        });

        if (res.status === 200) {
            const cookies = res.headers.raw()['set-cookie'];
            authCookie = cookies?.find(c => c.startsWith('auth='))?.split(';')[0] || pendingCookie;
            pendingCookie = null;
            lastStatus = "Connected";
            await saveCookieToDB(authCookie);
            console.log("\x1b[32m[VRC API] ✅ 2FA Verified! Connected.\x1b[0m");
            return { success: true };
        }
        
        const data = await res.json().catch(() => ({}));
        return { success: false, message: data.error?.message || "Verification failed" };
    } catch (e) {
        return { success: false, message: "Network error" };
    }
}

function getVrcStatus() {
    return lastStatus;
}

function parseVrcUrl(url) {
    try {
        const urlObj = new URL(url);
        const worldId = urlObj.searchParams.get('worldId');
        const instanceId = urlObj.searchParams.get('instanceId');
        return { worldId, instanceId };
    } catch (e) { return null; }
}

async function getGroupId(shortName) {
    if (cachedGroupId) return cachedGroupId;
    
    if (shortName.startsWith('grp_')) {
        cachedGroupId = shortName;
        return cachedGroupId;
    }

    if (!authCookie) await loadCookieFromDB();
    if (!authCookie) await loginVRC();
    if (!authCookie) return null;

    try {
        console.log(`[VRC API] 🔍 Resolving group: ${shortName}...`);
        
        // 1. Try bot's joined groups list
        const joinedRes = await fetch(`https://api.vrchat.cloud/api/1/users/me/groups`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (joinedRes.ok) {
            const groups = await joinedRes.json();
            const match = groups.find(g => g.shortCode && g.shortCode.toLowerCase() === shortName.toLowerCase());
            if (match) {
                cachedGroupId = match.id;
                console.log(`\x1b[36m[VRC API] 📍 Found in joined groups: ${match.name} (${cachedGroupId})\x1b[0m`);
                return cachedGroupId;
            }
        }

        // 2. Fallback: Try general search
        console.log(`[VRC API] 🔎 Not found in joined list. Trying search...`);
        const searchRes = await fetch(`https://api.vrchat.cloud/api/1/groups?query=${encodeURIComponent(shortName)}`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (searchRes.ok) {
            const searchData = await searchRes.json();
            const match = searchData.find(g => g.shortCode && g.shortCode.toLowerCase() === shortName.toLowerCase());
            if (match) {
                cachedGroupId = match.id;
                console.log(`\x1b[36m[VRC API] 📍 Found via search: ${match.name} (${cachedGroupId})\x1b[0m`);
                return cachedGroupId;
            }
        }

        console.error(`\x1b[31m[VRC API] ❌ Could not find group ID for ${shortName}. Please add the grp_... ID to your .env\x1b[0m`);
    } catch (e) {
        console.error("[VRC API] Error resolving Group ID:", e);
    }
    return null;
}

/**
 * Fetch group instance data
 */
async function getGroupInstanceData(groupShortName) {
    // Check Cache
    const now = Date.now();
    if (cache.groupInstance.data && (now - cache.groupInstance.timestamp < CACHE_TTL)) {
        return cache.groupInstance.data;
    }

    if (!authCookie) await loginVRC();
    if (!authCookie) return { active: false, count: 0, capacity: 0 };
    
    const groupId = await getGroupId(groupShortName);
    if (!groupId) return { active: false, count: 0, capacity: 0 };

    try {
        const res = await fetch(`https://api.vrchat.cloud/api/1/groups/${groupId}/instances`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (res.status === 200) {
            const instances = await res.json();
            let result = { active: false, count: 0, capacity: 0 };
            if (instances && instances.length > 0) {
                const bestInstance = instances.reduce((prev, current) => (prev.n_users > current.n_users) ? prev : current);
                result = { active: true, count: bestInstance.n_users, capacity: bestInstance.capacity };
            }
            // Update Cache
            cache.groupInstance = { data: result, timestamp: now };
            return result;
        } else if (res.status === 401) {
            authCookie = null;
            return getGroupInstanceData(groupShortName);
        }
    } catch (err) {}
    return { active: false, count: 0, capacity: 0 };
}

/**
 * Fetch specific instance
 */
async function getInstanceData(instanceUrl) {
    // Check Cache
    const now = Date.now();
    const cached = cache.specificInstance.get(instanceUrl);
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
        return cached.data;
    }

    if (!instanceUrl) return null;
    if (!instanceUrl.includes("worldId=")) return getGroupInstanceData(instanceUrl);

    if (!authCookie) await loginVRC();
    if (!authCookie) return { active: false, count: 0, capacity: 0 };

    const parsed = parseVrcUrl(instanceUrl);
    if (!parsed || !parsed.worldId) return null;

    try {
        const res = await fetch(`https://api.vrchat.cloud/api/1/instances/${parsed.worldId}:${parsed.instanceId}`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (res.status === 200) {
            const data = await res.json();
            const result = { active: true, count: data.n_users, capacity: data.capacity };
            // Update Cache
            cache.specificInstance.set(instanceUrl, { data: result, timestamp: now });
            return result;
        } else if (res.status === 401) {
            authCookie = null;
            return getInstanceData(instanceUrl);
        }
    } catch (err) {}
    return { active: false, count: 0, capacity: 0 };
}

/**
 * Fetch general statistics for the group
 */
async function getGroupStats(groupShortName) {
    // Check Cache
    const now = Date.now();
    if (cache.groupStats.data && (now - cache.groupStats.timestamp < CACHE_TTL)) {
        return cache.groupStats.data;
    }

    if (!authCookie) await loginVRC();
    if (!authCookie) return null;

    const groupId = await getGroupId(groupShortName);
    if (!groupId) return null;

    try {
        const res = await fetch(`https://api.vrchat.cloud/api/1/groups/${groupId}`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (res.ok) {
            const data = await res.json();
            const result = {
                totalMembers: data.memberCount || 0,
                onlineMembers: data.onlineMemberCount || 0
            };
            console.log(`[VRC API] 📈 Group Stats for ${groupShortName}: ${result.onlineMembers} online / ${result.totalMembers} total`);
            // Update Cache
            cache.groupStats = { data: result, timestamp: now };
            return result;
        } else if (res.status === 401) {
            authCookie = null;
            return getGroupStats(groupShortName);
        }
    } catch (e) {
        console.error("[VRC API] Error fetching group stats:", e);
    }
    return null;
}

module.exports = { getInstanceData, getGroupInstanceData, getGroupStats, verifyVRC, getVrcStatus };
