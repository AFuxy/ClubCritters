const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let authCookie = null;
let pendingCookie = null; // Used for 2FA verification
let cachedGroupId = null;
let lastStatus = "Disconnected";
let dbCookieLoaded = false;
let cooldownUntil = 0; // Timestamp when we can try login again

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
    // 1. Cooldown Check: Don't hammer the API if rate limited
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
            const seconds = parseInt(retryAfter) || 300; // Default to 5 mins if not specified
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
                console.log("\x1b[32m[VRC API] ✅ Logged in successfully.\x1b[0m");
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
            // Set a small cooldown for invalid credentials too to prevent rapid spamming
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
    
    // We need a pending cookie to verify
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
    
    if (!authCookie) await loginVRC();
    if (!authCookie) return null;

    try {
        const res = await fetch(`https://api.vrchat.cloud/api/1/groups/by-short-name/${shortName}`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (res.ok) {
            const data = await res.json();
            cachedGroupId = data.id;
            console.log(`\x1b[36m[VRC API] 📍 Resolved Group ID for ${shortName}: ${cachedGroupId}\x1b[0m`);
            return cachedGroupId;
        } else if (res.status === 401) {
            authCookie = null;
            return getGroupId(shortName);
        }
    } catch (e) {
        console.error("[VRC API] Error resolving Group ID:", e);
    }
    return null;
}

async function getGroupInstanceData(groupShortName) {
    if (!authCookie) {
        if (lastStatus.includes("2FA Required") || lastStatus.includes("Rate Limited")) return { active: false, count: 0, capacity: 0 };
        await loginVRC();
    }
    if (!authCookie) return { active: false, count: 0, capacity: 0 };
    
    const groupId = await getGroupId(groupShortName);
    if (!groupId) return { active: false, count: 0, capacity: 0 };

    try {
        const res = await fetch(`https://api.vrchat.cloud/api/1/groups/${groupId}/instances`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (res.status === 200) {
            const instances = await res.json();
            if (!instances || instances.length === 0) {
                return { active: false, count: 0, capacity: 0 };
            }

            const bestInstance = instances.reduce((prev, current) => (prev.n_users > current.n_users) ? prev : current);

            return {
                active: true,
                count: bestInstance.n_users || 0,
                capacity: bestInstance.capacity || 0,
                full: (bestInstance.n_users >= bestInstance.capacity)
            };
        } else if (res.status === 401) {
            authCookie = null;
            return getGroupInstanceData(groupShortName);
        }
    } catch (err) {
        console.error("[VRC API] Error fetching group instances:", err);
    }
    return { active: false, count: 0, capacity: 0 };
}

async function getInstanceData(instanceUrl) {
    if (!instanceUrl) return null;
    if (!instanceUrl.includes("worldId=")) return getGroupInstanceData(instanceUrl);

    if (!authCookie) {
        if (lastStatus.includes("2FA Required") || lastStatus.includes("Rate Limited")) return { active: false, count: 0, capacity: 0 };
        await loginVRC();
    }
    if (!authCookie) return { active: false, count: 0, capacity: 0 };

    const parsed = parseVrcUrl(instanceUrl);
    if (!parsed || !parsed.worldId) return null;

    try {
        const res = await fetch(`https://api.vrchat.cloud/api/1/instances/${parsed.worldId}:${parsed.instanceId}`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (res.status === 200) {
            const data = await res.json();
            return { active: true, count: data.n_users || 0, capacity: data.capacity || 0, full: (data.n_users >= data.capacity) };
        } else if (res.status === 401) {
            authCookie = null;
            return getInstanceData(instanceUrl);
        }
    } catch (err) {
        console.error("[VRC API] Error fetching instance data:", err);
    }
    return { active: false, count: 0, capacity: 0 };
}

async function getGroupStats(groupShortName) {
    if (!authCookie) {
        if (lastStatus.includes("2FA Required") || lastStatus.includes("Rate Limited")) return null;
        await loginVRC();
    }
    if (!authCookie) return null;

    const groupId = await getGroupId(groupShortName);
    if (!groupId) return null;

    try {
        const res = await fetch(`https://api.vrchat.cloud/api/1/groups/${groupId}`, {
            headers: { 'Cookie': authCookie, 'User-Agent': 'ClubCrittersManager/1.0.0' }
        });

        if (res.ok) {
            const data = await res.json();
            console.log(`[VRC API] 📈 Group Stats for ${groupShortName}: ${data.onlineMemberCount || 0} online / ${data.memberCount || 0} total`);
            return {
                totalMembers: data.memberCount || 0,
                onlineMembers: data.onlineMemberCount || 0
            };
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
