const { WebSocketServer } = require('ws');

// Global maps to keep track of active connections
// cameraWebClients: Map<ws, { userId, username }>
// cameraBotClient: ws
// cameraTokens: Map<token, { userId, username, expires }>
global.cameraWebClients = global.cameraWebClients || new Map();
global.cameraBotClient = global.cameraBotClient || null;
global.cameraTokens = global.cameraTokens || new Map();

function initCameraWS(server) {
    const wss = new WebSocketServer({ noServer: true });

    // Handle HTTP Upgrade manually to support route matching
    server.on('upgrade', (request, socket, head) => {
        const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname;

        if (pathname === '/ws/camera') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
    });

    wss.on('connection', (ws, request) => {
        const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const token = parsedUrl.searchParams.get('token');
        const secret = parsedUrl.searchParams.get('secret');

        let clientType = null;
        let clientInfo = null;

        // 1. Authenticate Bot Client
        if (secret && secret === process.env.BOT_CAMERA_SECRET) {
            clientType = 'bot';
            if (global.cameraBotClient) {
                console.log("[CAMERA WS] 🤖 Disconnecting previous bot client...");
                global.cameraBotClient.close();
            }
            global.cameraBotClient = ws;
            console.log("[CAMERA WS] 🤖 Camera Bot Client connected successfully.");
            
            // Notify web clients that bot is online
            broadcastToWeb({ type: 'status', botOnline: true });
        } 
        // 2. Authenticate Web Client (Browser)
        else if (token) {
            const tokenData = global.cameraTokens.get(token);
            if (tokenData && tokenData.expires > Date.now()) {
                clientType = 'web';
                clientInfo = { userId: tokenData.userId, username: tokenData.username || 'Staff' };
                global.cameraWebClients.set(ws, clientInfo);
                console.log(`[CAMERA WS] 🦊 Mascot Web Client connected: ${clientInfo.username}`);
                
                // Immediately notify this client of the current bot status and active roster
                updateBotVrcLocation().then(() => {
                    ws.send(JSON.stringify({
                        type: 'status',
                        botOnline: !!global.cameraBotClient,
                        vrc_running: global.cameraVrcRunning || false,
                        obs_running: global.cameraObsRunning || false,
                        vrc_location: cachedVrcLocation,
                        vrc_world_name: cachedVrcWorldName,
                        vrc_world_thumbnail: cachedVrcWorldThumbnail,
                        vrc_player_count: cachedVrcPlayerCount,
                        players: getPlayersInInstance(),
                        vrc_notification_logs: global.vrcNotificationLogs || []
                    }));
                }).catch(() => {
                    ws.send(JSON.stringify({
                        type: 'status',
                        botOnline: !!global.cameraBotClient,
                        vrc_running: global.cameraVrcRunning || false,
                        obs_running: global.cameraObsRunning || false,
                        players: getPlayersInInstance(),
                        vrc_notification_logs: global.vrcNotificationLogs || []
                    }));
                });
                
                // Single-use token validation
                global.cameraTokens.delete(token);
            } else {
                const mapKeys = Array.from(global.cameraTokens.keys());
                console.warn(`[CAMERA WS] ❌ Web connection failed: Invalid or expired token. Received token: "${token}", found in map: ${!!tokenData}, expired: ${tokenData ? (tokenData.expires <= Date.now()) : 'N/A'}. Keys in map: ${JSON.stringify(mapKeys)}`);
                ws.close(4001, "Invalid token");
                return;
            }
        } else {
            console.warn("[CAMERA WS] ❌ Connection rejected: No credentials provided.");
            ws.close(4002, "Unauthorized");
            return;
        }

        // Handle incoming messages
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                if (clientType === 'web') {
                    // Browser -> Server -> Bot relay (Inputs, Launches, closing commands, etc.)
                    if (global.cameraBotClient && global.cameraBotClient.readyState === ws.OPEN) {
                        global.cameraBotClient.send(JSON.stringify({
                            type: data.type,
                            action: data.action,
                            key: data.key,
                            state: data.state, // e.g. down, up
                            x: data.x,
                            y: data.y,
                                payload: data.payload,
                                sender: clientInfo.username
                            }));
                        }
                    }
                } else if (clientType === 'bot') {
                    // Cache last known states
                    if (data.vrc_running !== undefined) global.cameraVrcRunning = data.vrc_running;
                    if (data.obs_running !== undefined) global.cameraObsRunning = data.obs_running;
                    
                    if (data.vrc_location) {
                        updateBotVrcLocationFromClient(data.vrc_location).then(() => {
                            data.vrc_world_name = cachedVrcWorldName;
                            data.vrc_world_thumbnail = cachedVrcWorldThumbnail;
                            data.vrc_player_count = cachedVrcPlayerCount;
                            broadcastToWeb(data);
                        }).catch(() => {
                            broadcastToWeb(data);
                        });
                    } else {
                        // Bot -> Server -> Browsers (OBS Status, telemetry)
                        broadcastToWeb(data);
                    }
                }
            } catch (err) {
                console.error("[CAMERA WS] Error parsing message:", err);
            }
        });

        // Handle connection close
        ws.on('close', () => {
            if (clientType === 'bot') {
                console.log("[CAMERA WS] 🤖 Camera Bot Client disconnected.");
                global.cameraBotClient = null;
                global.cameraVrcRunning = false;
                global.cameraObsRunning = false;
                broadcastToWeb({ type: 'status', botOnline: false });
            } else if (clientType === 'web') {
                console.log(`[CAMERA WS] 🦊 Mascot Web Client disconnected: ${clientInfo.username}`);
                global.cameraWebClients.delete(ws);
            }
        });

        ws.on('error', (err) => {
            console.error(`[CAMERA WS] Socket error (${clientType}):`, err);
        });
    });

    // Hook up live VRChat Notification Pipeline updates to broadcast to browsers
    global.cameraRosterUpdated = () => {
        updateBotVrcLocation().then(() => {
            broadcastToWeb({
                type: 'telemetry',
                vrc_location: cachedVrcLocation,
                vrc_world_name: cachedVrcWorldName,
                vrc_world_thumbnail: cachedVrcWorldThumbnail,
                vrc_player_count: cachedVrcPlayerCount,
                players: getPlayersInInstance()
            });
        }).catch(() => {
            broadcastToWeb({
                type: 'telemetry',
                players: getPlayersInInstance()
            });
        });
    };

    console.log("[SERVER] 📡 Camera WebSocket relay initialized on /ws/camera");
}

// Helper to broadcast to all open Mascot Panel browsers
function broadcastToWeb(data) {
    const payload = JSON.stringify(data);
    for (const [ws] of global.cameraWebClients.entries()) {
        if (ws.readyState === ws.OPEN) {
            ws.send(payload);
        }
    }
}

// Helper to extract active players inside the bot's instance
function getPlayersInInstance() {
    const vrcApi = require('./vrc-api');
    if (typeof vrcApi.getPlayersInBotInstance === 'function') {
        return vrcApi.getPlayersInBotInstance();
    }
    return [];
}

let lastVrcLocationCheck = 0;
let cachedVrcLocation = 'offline';
let cachedVrcWorldName = 'Offline';
let cachedVrcWorldThumbnail = null;
let cachedVrcPlayerCount = 0;

async function updateBotVrcLocation() {
    const now = Date.now();
    // Cache for 15 seconds to avoid spamming VRChat API
    if (now - lastVrcLocationCheck < 15000 && lastVrcLocationCheck > 0) return;
    lastVrcLocationCheck = now;

    const vrcApi = require('./vrc-api');
    try {
        const location = await vrcApi.getBotCurrentLocation();
        if (location && location !== 'offline') {
            cachedVrcLocation = location;
            
            let isPrivate = location.includes('~private') || location.includes('~hidden') || location === 'private';
            const worldId = location.split(':')[0];
            
            let worldData = null;
            let instanceName = '';
            let nUsers = 0;
            
            if (!isPrivate) {
                try {
                    const instanceData = await vrcApi.getInstanceData(location);
                    if (instanceData && instanceData.world) {
                        worldData = instanceData.world;
                        instanceName = ` (Instance #${instanceData.name})`;
                        nUsers = instanceData.n_users || 0;
                    }
                } catch (e) {
                    console.warn("[CAMERA WS] getInstanceData failed for location, trying world fallback:", e.message || e);
                }
            }
            
            if (!worldData && worldId && worldId.startsWith('wrld_')) {
                worldData = await vrcApi.getWorldData(worldId);
                instanceName = isPrivate ? ' (Private)' : '';
                nUsers = 0;
            }
            
            if (worldData) {
                cachedVrcWorldName = `${worldData.name}${instanceName}`;
                cachedVrcWorldThumbnail = worldData.thumbnailImageUrl || worldData.imageUrl || null;
                cachedVrcPlayerCount = Math.max(nUsers, getPlayersInInstance().length);
            } else {
                cachedVrcWorldName = location === 'private' ? 'Private Instance' : location;
                cachedVrcWorldThumbnail = null;
                cachedVrcPlayerCount = getPlayersInInstance().length;
            }
        } else {
            cachedVrcLocation = location || 'offline';
            cachedVrcWorldName = location === 'private' ? 'Private Instance' : 'Offline';
            cachedVrcWorldThumbnail = null;
            cachedVrcPlayerCount = 0;
        }
    } catch (err) {
        console.error("[CAMERA WS] Failed to update bot VRC location:", err);
    }
}

async function updateBotVrcLocationFromClient(location) {
    if (!location || location === 'offline') {
        cachedVrcLocation = 'offline';
        cachedVrcWorldName = 'Offline';
        cachedVrcWorldThumbnail = null;
        cachedVrcPlayerCount = 0;
        return;
    }
    
    // If location is the same, no need to query world info again
    if (cachedVrcLocation === location) return;
    
    cachedVrcLocation = location;
    
    const vrcApi = require('./vrc-api');
    try {
        // Sync active invite location
        vrcApi.setActiveInviteLocation(location);
        
        // Handle world transition states
        if (location.startsWith('joining:')) {
            const rawLoc = location.substring(8);
            const worldId = rawLoc.split(':')[0];
            
            cachedVrcWorldThumbnail = null;
            cachedVrcPlayerCount = 0;
            cachedVrcWorldName = 'Traveling...';
            
            try {
                const worldData = await vrcApi.getWorldData(worldId);
                if (worldData) {
                    cachedVrcWorldName = `Traveling: ${worldData.name}...`;
                    cachedVrcWorldThumbnail = worldData.thumbnailImageUrl || worldData.imageUrl || null;
                }
            } catch (e) {
                // Ignore, fallback to Traveling...
            }
            return;
        }

        let isPrivate = location.includes('~private') || location.includes('~hidden') || location === 'private';
        const worldId = location.split(':')[0];
        
        let worldData = null;
        let instanceName = '';
        let nUsers = 0;
        
        if (!isPrivate) {
            try {
                const instanceData = await vrcApi.getInstanceData(location);
                if (instanceData && instanceData.world) {
                    worldData = instanceData.world;
                    instanceName = ` (Instance #${instanceData.name})`;
                    nUsers = instanceData.n_users || 0;
                }
            } catch (e) {
                console.warn("[CAMERA WS] Client-relayed getInstanceData failed, trying world fallback:", e.message || e);
            }
        }
        
        if (!worldData && worldId && worldId.startsWith('wrld_')) {
            worldData = await vrcApi.getWorldData(worldId);
            instanceName = isPrivate ? ' (Private)' : '';
            nUsers = 0;
        }
        
        if (worldData) {
            cachedVrcWorldName = `${worldData.name}${instanceName}`;
            cachedVrcWorldThumbnail = worldData.thumbnailImageUrl || worldData.imageUrl || null;
            cachedVrcPlayerCount = Math.max(nUsers, getPlayersInInstance().length);
        } else {
            cachedVrcWorldName = location;
            cachedVrcWorldThumbnail = null;
            cachedVrcPlayerCount = getPlayersInInstance().length;
        }
    } catch (err) {
        console.error("[CAMERA WS] Failed to resolve client VRC location:", err);
        cachedVrcWorldName = location;
    }
}

module.exports = {
    initCameraWS,
    broadcastToWeb,
    getPlayersInInstance
};
