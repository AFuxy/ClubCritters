const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const WebSocket = require('ws');

let authCookie = null;
let pendingCookie = null; 
let cachedGroupId = null;
let botUserId = null; 
let lastStatus = "Disconnected";
let dbCookieLoaded = false;
let cooldownUntil = 0; 
let lastPresence = { status: null, description: null }; 

// --- PIPELINE (WEBSOCKET) ---
let pipeline = null;
let pipelineConnected = false;
let pipelineHeartbeat = null;

// PREVENT CONCURRENT LOGINS
let loginPromise = null;

// --- CACHE CONFIGURATION ---
const cache = {
    groupStats: { data: null, timestamp: 0 },
    groupInstance: { data: null, timestamp: 0 },
    specificInstance: new Map() 
};
const CACHE_TTL = 60000; 

/**
 * Save cookie to database
 */
async function saveCookieToDB(cookie) {
    if (!cookie) return;
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
 * Fetch bot's own user ID if missing
 */
async function fetchBotUserId() {
    if (botUserId || !authCookie) return botUserId;
    try {
        const res = await vrcFetch('https://api.vrchat.cloud/api/1/auth/user');
        if (res.ok) {
            const data = await res.json();
            botUserId = data.id;
            console.log(`[VRC API] 👤 Identified bot user ID: ${botUserId}`);
        }
    } catch (e) {}
    return botUserId;
}

/**
 * Load cookie from database
 */
async function loadCookieFromDB() {
    if (dbCookieLoaded && authCookie) return authCookie;
    try {
        const { Settings } = require('../db');
        const settings = await Settings.findOne();
        if (settings && settings.vrcCookie) {
            authCookie = settings.vrcCookie;
            lastStatus = "Connected";
            console.log("\x1b[36m[VRC API] 🍪 Loaded session cookie from database.\x1b[0m");
            await fetchBotUserId(); 
        }
        dbCookieLoaded = true;
    } catch (e) {}
    return authCookie;
}

/**
 * Centralized Fetch with Rate Limit & Auth Handling
 */
async function vrcFetch(url, options = {}) {
    const nowTs = Date.now();
    if (nowTs < cooldownUntil) {
        throw { status: 429, message: "Local Cooldown Active" };
    }

    const defaultHeaders = {
        'Cookie': authCookie || '',
        'User-Agent': 'ClubCrittersHub/1.0.0'
    };
    
    options.headers = { ...defaultHeaders, ...options.headers };

    const res = await fetch(url, options);

    if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after')) || 300;
        cooldownUntil = Date.now() + (retryAfter * 1000);
        lastStatus = `Rate Limited (${retryAfter}s)`;
        console.warn(`[VRC API] ⚠️ Rate Limited on ${url}. Retry after ${retryAfter}s`);
        throw { status: 429, retryAfter };
    }

    if (res.status === 401 && !url.includes('/auth/user')) {
        console.log("[VRC API] 🔑 Session expired, re-logging...");
        authCookie = null;
        await loginVRC();
        // Retry once after re-login
        if (authCookie) {
            options.headers.Cookie = authCookie;
            return vrcFetch(url, options);
        }
    }

    return res;
}

/**
 * Log in to VRChat
 */
async function loginVRC() {
    if (process.env.DISABLE_VRC_BOT === 'true') {
        lastStatus = "Disabled (Dev Mode)";
        return null;
    }
    if (loginPromise) return loginPromise;

    loginPromise = (async () => {
        try {
            const nowTs = Date.now();
            if (nowTs < cooldownUntil) return authCookie;

            // If we are already waiting for 2FA, don't trigger another email
            if (lastStatus === "2FA Required" && pendingCookie) {
                console.log("[VRC API] ⏳ Still waiting for 2FA code, skipping login attempt...");
                return null;
            }

            if (!authCookie) {
                await loadCookieFromDB();
                if (authCookie) return authCookie;
            }

            const username = process.env.VRC_USERNAME;
            const password = process.env.VRC_PASSWORD;
            if (!username || !password) {
                lastStatus = "Missing Credentials";
                return null;
            }

            const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

            const res = await fetch('https://api.vrchat.cloud/api/1/auth/user', {
                headers: {
                    'Authorization': authHeader,
                    'Cookie': authCookie || '', 
                    'User-Agent': 'ClubCrittersHub/1.0.0'
                }
            });

            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('retry-after')) || 300;
                cooldownUntil = Date.now() + (retryAfter * 1000);
                lastStatus = `Rate Limited (${retryAfter}s)`;
                return authCookie;
            }

            const rawCookies = res.headers.raw()['set-cookie'] || [];
            const authVal = rawCookies.find(c => c.startsWith('auth='))?.split(';')[0];
            const tfaVal = rawCookies.find(c => c.startsWith('twoFactorAuth='))?.split(';')[0];
            const newCombined = [authVal, tfaVal].filter(Boolean).join('; ');

            if (res.status === 200) {
                const data = await res.json();
                if (data.requiresTwoFactorAuth) {
                    if (newCombined) pendingCookie = newCombined;
                    lastStatus = "2FA Required";
                    return null;
                }
                if (newCombined) {
                    authCookie = newCombined;
                    await saveCookieToDB(authCookie);
                }
                botUserId = data.id;
                lastStatus = "Connected";
                return authCookie;
            } else if (res.status === 401) {
                lastStatus = "Invalid Credentials";
                authCookie = null; 
                return null;
            }
            return authCookie;
        } finally {
            loginPromise = null; 
        }
    })();

    return loginPromise;
}

/**
 * Submit an Email OTP code
 */
async function verifyVRC(code) {
    if (!code) return { success: false, message: "Code required" };
    if (!pendingCookie) await loginVRC();
    if (!pendingCookie) return { success: false, message: "No active login attempt." };

    try {
        const res = await fetch('https://api.vrchat.cloud/api/1/auth/twofactorauth/emailotp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': pendingCookie, 'User-Agent': 'ClubCrittersHub/1.0.0' },
            body: JSON.stringify({ code })
        });

        if (res.status === 200) {
            const rawCookies = res.headers.raw()['set-cookie'] || [];
            const newAuth = rawCookies.find(c => c.startsWith('auth='))?.split(';')[0];
            authCookie = newAuth || pendingCookie;
            pendingCookie = null;
            lastStatus = "Connected";
            await saveCookieToDB(authCookie);
            await fetchBotUserId();
            console.log("\x1b[32m[VRC API] ✅ 2FA Verified! Connected.\x1b[0m");
            return { success: true };
        }
        const data = await res.json().catch(() => ({}));
        return { success: false, message: data.error?.message || "Verification failed" };
    } catch (e) { return { success: false, message: "Network error" }; }
}

function getVrcStatus() {
    const now = Date.now();
    if (now < cooldownUntil) {
        const remaining = Math.ceil((cooldownUntil - now) / 1000);
        return `Rate Limited (${remaining}s)`;
    }
    return lastStatus;
}

function cleanInstanceId(input) {
    if (!input) return null;
    if (input.includes('worldId=')) {
        try {
            const url = new URL(input);
            const worldId = url.searchParams.get('worldId');
            const instanceId = url.searchParams.get('instanceId');
            return `${worldId}:${instanceId}`;
        } catch (e) { return null; }
    }
    return input;
}

// Global variable to store active club location for the Pipeline listener
let activeInviteLocation = null;

/**
 * Connect to VRChat Notification Pipeline (WebSocket)
 */
async function connectPipeline(location) {
    if (location) activeInviteLocation = location;
    if (pipelineConnected) return; 

    if (!authCookie) await loadCookieFromDB();
    if (!authCookie) await loginVRC();
    if (!authCookie) return;

    let vrcToken = "";
    const tokenMatch = authCookie.match(/auth=(authcookie_[^;]+)/);
    if (tokenMatch) {
        vrcToken = tokenMatch[1];
    } else if (authCookie.startsWith('authcookie_')) {
        vrcToken = authCookie.split(';')[0].trim();
    }

    if (!vrcToken) return;

    console.log("[VRC API] 📡 Connecting to Notification Pipeline...");
    pipeline = new WebSocket(`wss://pipeline.vrchat.cloud/?authToken=${vrcToken}`, {
        headers: { 'User-Agent': 'ClubCrittersHub/1.0.0 (contact: site-admin)', 'Origin': 'https://vrchat.com' }
    });

    pipeline.on('open', () => {
        pipelineConnected = true;
        console.log("\x1b[32m[VRC API] ✅ Connected to Pipeline. Bot is now ONLINE (Web).\x1b[0m");
        
        if (pipelineHeartbeat) clearInterval(pipelineHeartbeat);
        pipelineHeartbeat = setInterval(() => {
            if (pipeline && pipeline.readyState === WebSocket.OPEN) pipeline.ping();
        }, 30000);
    });

    pipeline.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            if (!msg.type || msg.type !== 'notification') return;
            const notif = JSON.parse(msg.content);
            
            // 1. Friend Request
            if (notif.type === 'friendRequest') {
                console.log(`[VRC API] 🤝 Accepting friend request from: ${notif.senderUsername}`);
                await vrcFetch(`https://api.vrchat.cloud/api/1/auth/user/notifications/${notif.id}/accept`, {
                    method: 'PUT'
                }).catch(() => {});
            }

            if ((notif.type === 'requestInvite' || notif.type === 'invite') && activeInviteLocation) {
                const targetLocation = cleanInstanceId(activeInviteLocation);
                if (!targetLocation) return;

                console.log(`[VRC API] ✨ Received ${notif.type} from ${notif.senderUsername}. Exchanging for Club Invite...`);
                
                const inviteRes = await vrcFetch(`https://api.vrchat.cloud/api/1/invite/${notif.senderUserId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ instanceId: targetLocation })
                }).catch(() => null);

                if (inviteRes && inviteRes.ok) {
                    console.log(`\x1b[32m[VRC API] 📧 Invite successfully sent to ${notif.senderUsername}!\x1b[0m`);
                } else if (inviteRes) {
                    const err = await inviteRes.json().catch(() => ({}));
                    if (inviteRes.status === 403) {
                        console.error(`\x1b[31m[VRC API] ❌ Invite Failed (403): Bot lacks permission to invite to this instance. (Ensure bot has 'Can Invite' group role!)\x1b[0m`);
                    } else {
                        console.error(`\x1b[31m[VRC API] ❌ Failed to send invite: ${inviteRes.status} ${err.error?.message || ''}\x1b[0m`);
                    }
                }

                // Hide the notification
                await vrcFetch(`https://api.vrchat.cloud/api/1/auth/user/notifications/${notif.id}/hide`, {
                    method: 'PUT'
                }).catch(() => {});
            }
        } catch (e) {}
    });

    pipeline.on('close', () => { 
        pipelineConnected = false; 
        clearInterval(pipelineHeartbeat);
        setTimeout(() => connectPipeline(activeInviteLocation), 10000);
    });
    
    pipeline.on('error', (err) => { 
        console.error("[VRC API] Pipeline Error:", err.message); 
        pipelineConnected = false;
    });
}

function disconnectPipeline() {}

async function updateBotPresence(status, description) {
    if (lastPresence.status === status && lastPresence.description === description) return;
    if (!authCookie) await loadCookieFromDB();
    if (!authCookie) await loginVRC();
    if (!authCookie || !botUserId) return;

    try {
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/users/${botUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status || 'active', statusDescription: description || '' })
        });
        if (res.ok) {
            console.log(`\x1b[36m[VRC API] 📡 Presence updated: ${status} | ${description}\x1b[0m`);
            lastPresence = { status, description };
        }
    } catch (err) {}
}

async function getGroupId(inputName) {
    if (cachedGroupId) return cachedGroupId;
    const shortName = inputName.replace(/['"]+/g, '').trim();
    if (shortName.startsWith('grp_')) { cachedGroupId = shortName; return cachedGroupId; }
    if (!authCookie) await loginVRC();
    if (!authCookie) return null;
    try {
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/users/me/groups`);
        if (res.ok) {
            const groups = await res.json();
            const match = groups.find(g => g.shortCode && g.shortCode.toLowerCase() === shortName.toLowerCase());
            if (match) { cachedGroupId = match.id; return cachedGroupId; }
        }
    } catch (e) {}
    return null;
}

async function getGroupInstanceData(groupShortName) {
    const now = Date.now();
    if (cache.groupInstance.data && (now - cache.groupInstance.timestamp < CACHE_TTL)) return cache.groupInstance.data;
    if (!authCookie) await loginVRC();
    if (!authCookie) return { active: false, count: 0, capacity: 0 };
    const groupId = await getGroupId(groupShortName);
    if (!groupId) return { active: false, count: 0, capacity: 0 };
    try {
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/groups/${groupId}/instances`);
        if (res.status === 200) {
            const instances = await res.json();
            let result = { active: false, count: 0, capacity: 0, location: null };
            if (instances && instances.length > 0) {
                const bestInstance = instances.reduce((prev, current) => (prev.n_users > current.n_users) ? prev : current);
                
                // Use .location if present, otherwise fallback to rebuilding
                const location = bestInstance.location || `${bestInstance.worldId || bestInstance.world_id}:${bestInstance.instanceId || bestInstance.instance_id}`;

                // Prefer custom instance name (VRC+), then fallback to worldName
                const finalName = bestInstance.name || bestInstance.worldName || bestInstance.world?.name || 'Club Critters Hub';

                result = { 
                    active: true, 
                    count: (bestInstance.n_users !== undefined) ? bestInstance.n_users : bestInstance.nUsers, 
                    capacity: bestInstance.capacity, 
                    location: location,
                    name: finalName
                };
            }
            cache.groupInstance = { data: result, timestamp: now };
            return result;
        }
    } catch (err) {}
    return { active: false, count: 0, capacity: 0 };
}

async function getInstanceData(instanceUrl) {
    const now = Date.now();
    const cached = cache.specificInstance.get(instanceUrl);
    if (cached && (now - cached.timestamp < CACHE_TTL)) return cached.data;
    if (!instanceUrl) return null;
    if (!instanceUrl.includes("worldId=")) return getGroupInstanceData(instanceUrl);
    if (!authCookie) await loginVRC();
    if (!authCookie) return { active: false, count: 0, capacity: 0 };
    const url = new URL(instanceUrl);
    const target = `${url.searchParams.get('worldId')}:${url.searchParams.get('instanceId')}`;
    try {
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/instances/${target}`);
        if (res.status === 200) {
            const data = await res.json();
            const result = { active: true, count: data.n_users, capacity: data.capacity, location: target };
            cache.specificInstance.set(instanceUrl, { data: result, timestamp: now });
            return result;
        }
    } catch (err) {}
    return { active: false, count: 0, capacity: 0 };
}

async function getGroupStats(groupShortName) {
    const now = Date.now();
    if (cache.groupStats.data && (now - cache.groupStats.timestamp < CACHE_TTL)) return cache.groupStats.data;
    if (!authCookie) await loginVRC();
    if (!authCookie) return null;
    const groupId = await getGroupId(groupShortName);
    if (!groupId) return null;
    try {
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/groups/${groupId}`);
        if (res.ok) {
            const data = await res.json();
            const result = { totalMembers: data.memberCount || 0, onlineMembers: data.onlineMemberCount || 0 };
            console.log(`[VRC API] 📈 Group Stats for ${groupShortName}: ${result.onlineMembers} online`);
            cache.groupStats = { data: result, timestamp: now };
            return result;
        }
    } catch (e) {}
    return null;
}

/**
 * Fetch detailed information about a user
 */
async function getUserInfo(userId) {
    if (!authCookie) await loginVRC();
    if (!authCookie) return null;
    try {
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/users/${userId}`);
        if (res.ok) return await res.json();
    } catch (e) {}
    return null;
}

/**
 * Fetch all members of a group
 */
async function getGroupMembers(groupShortName) {
    if (!authCookie) await loginVRC();
    if (!authCookie) return [];
    const groupId = await getGroupId(groupShortName);
    if (!groupId) return [];
    
    try {
        // VRChat Group Members endpoint: GET /groups/{groupId}/members
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/groups/${groupId}/members?n=100&sort=joinedAt:desc`);
        if (res.ok) return await res.json();
    } catch (e) {}
    return [];
}

/**
 * Ban a user from a group
 */
async function banGroupMember(groupShortName, userId) {
    if (!authCookie) await loginVRC();
    if (!authCookie) return false;
    const groupId = await getGroupId(groupShortName);
    if (!groupId) return false;

    try {
        const res = await vrcFetch(`https://api.vrchat.cloud/api/1/groups/${groupId}/bans`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        return res.ok;
    } catch (e) { return false; }
}

async function autoAcceptFriends() {
    if (!authCookie) await loadCookieFromDB();
    if (!authCookie) await loginVRC();
    if (!authCookie) return;
    try {
        const res = await vrcFetch('https://api.vrchat.cloud/api/1/auth/user/notifications?type=friendRequest');
        if (res.ok) {
            const notifications = await res.json();
            if (notifications.length > 0) {
                console.log(`\x1b[32m[VRC API] 🤝 Found ${notifications.length} friend requests. Accepting...\x1b[0m`);
                for (const notif of notifications) {
                    await vrcFetch(`https://api.vrchat.cloud/api/1/auth/user/notifications/${notif.id}/accept`, {
                        method: 'PUT'
                    }).catch(() => {});
                }
            }
        }
    } catch (err) {}
}

/**
 * Terminate any instance (Group, Public, etc) if permissions allow.
 */
async function closeGroupInstance(location) {
    if (!authCookie) await loginVRC();
    if (!authCookie) return false;

    let target = location;
    // If it's a full URL, extract the worldId:instanceId
    if (target.includes('worldId=')) {
        try {
            const url = new URL(target);
            const worldId = url.searchParams.get('worldId');
            const instanceId = url.searchParams.get('instanceId');
            target = `${worldId}:${instanceId}`;
        } catch (e) { return false; }
    }

    try {
        // Universal VRChat Instance Close endpoint: DELETE /instances/{worldId}:{instanceId}
        const url = `https://api.vrchat.cloud/api/1/instances/${target}?hardClose=true`;
        
        console.log(`[VRC API] 🛑 Attempting to hard-close instance: ${target}`);
        
        const res = await vrcFetch(url, { method: 'DELETE' });

        if (res.ok) {
            console.log(`\x1b[32m[VRC API] ✅ Instance ${target} successfully terminated.\x1b[0m`);
            return true;
        } else {
            const err = await res.json().catch(() => ({}));
            console.error(`\x1b[31m[VRC API] ❌ Failed to close instance: ${res.status} ${err.error?.message || ''}\x1b[0m`);
            return false;
        }
    } catch (e) {
        console.error("[VRC API] Error closing instance:", e);
        return false;
    }
}

module.exports = { loginVRC, getInstanceData, getGroupInstanceData, getGroupStats, verifyVRC, getVrcStatus, connectPipeline, disconnectPipeline, updateBotPresence, autoAcceptFriends, closeGroupInstance, getUserInfo, getGroupMembers, banGroupMember };
