const { WebSocketServer } = require('ws');
const url = require('url');

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
        const pathname = url.parse(request.url).pathname;

        if (pathname === '/ws/camera') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
    });

    wss.on('connection', (ws, request) => {
        const query = url.parse(request.url, true).query;
        const token = query.token;
        const secret = query.secret;

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
                ws.send(JSON.stringify({
                    type: 'status',
                    botOnline: !!global.cameraBotClient,
                    players: getPlayersInInstance()
                }));
                
                // Single-use token validation
                global.cameraTokens.delete(token);
            } else {
                console.warn("[CAMERA WS] ❌ Web connection failed: Invalid or expired token.");
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
                    // Browser -> Server -> Bot (WASD inputs, App launching commands, etc.)
                    if (global.cameraBotClient && global.cameraBotClient.readyState === ws.OPEN) {
                        global.cameraBotClient.send(JSON.stringify({
                            type: data.type,
                            action: data.action,
                            state: data.state, // e.g. down, up
                            payload: data.payload,
                            sender: clientInfo.username
                        }));
                    }
                } else if (clientType === 'bot') {
                    // Bot -> Server -> Browsers (OBS Status, telemetry)
                    broadcastToWeb(data);
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
        broadcastToWeb({
            type: 'telemetry',
            players: getPlayersInInstance()
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

module.exports = {
    initCameraWS,
    broadcastToWeb,
    getPlayersInInstance
};
