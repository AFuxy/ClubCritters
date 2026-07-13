const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { sequelize, Roster, Settings, Schedule, Archive, Stats, AppSlot, ApplicationSubmission, InstanceLog, InstanceLogPerformers } = require('../db');
const { getGuildMember, getDiscordStatus } = require('../bot');
const { getInstanceData, verifyVRC, getVrcStatus, getUserInfo, getGroupMember, getGroupRoles, addGroupMemberRole, removeGroupMemberRole } = require('../utils/vrc-api');
const { isStaff, isHostOrOwner, isAuthenticated, isOwner } = require('../middleware/auth');

// Multer Setup (Memory Storage for Sharp processing)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB Limit
});

// Helper to handle Sequelize/MySQL/MariaDB JSON parsing inconsistencies
const safeParseJSON = (data) => {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } 
        catch (e) { return {}; }
    }
    return data || {};
};

// Parse VRChat User ID from input (User ID or profile URL)
function parseVrcUserId(input) {
    if (!input) return null;
    const trimmed = input.trim();
    const match = trimmed.match(/usr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    return match ? match[0] : null;
}

// Get VRChat user details and group roles
async function getVrcUserDetails(vrcUserId) {
    const groupShortName = process.env.VRC_GROUPID || "FURN.9601";
    const vrcUser = await getUserInfo(vrcUserId);
    if (!vrcUser) return null;

    let inGroup = false;
    let groupRoles = [];
    const memberDetails = await getGroupMember(groupShortName, vrcUserId);
    if (memberDetails) {
        inGroup = true;
        const allRoles = await getGroupRoles(groupShortName);
        const roleMap = {};
        allRoles.forEach(r => { roleMap[r.id] = r.name; });
        groupRoles = (memberDetails.roleIds || []).map(id => roleMap[id] || id);
    }

    return {
        id: vrcUser.id,
        username: vrcUser.username,
        displayName: vrcUser.displayName,
        thumbnailUrl: vrcUser.profilePicOverrideThumbnail || vrcUser.currentAvatarThumbnailImageUrl,
        inGroup,
        roles: groupRoles
    };
}

// Sync VRChat roles based on Discord roles
async function executeRoleSync(vrcUserId, discordId) {
    const groupShortName = process.env.VRC_GROUPID || "FURN.9601";

    // 1. Fetch Discord Member Roles
    const member = await getGuildMember(discordId);
    if (!member) {
        throw new Error("Could not find Discord member in the guild.");
    }
    const discordRoleIds = (member.roles || []).map(r => r.id);
    const discordRoleNames = (member.roles || []).map(r => r.name.toLowerCase());

    // 2. Fetch VRChat Group Member & Roles
    const vrcMember = await getGroupMember(groupShortName, vrcUserId);
    if (!vrcMember) {
        throw new Error("User is not a member of the VRChat Group.");
    }
    const currentVrcRoleIds = vrcMember.roleIds || [];

    // 3. Fetch VRChat Group Roles list to map names to IDs
    const groupRoles = await getGroupRoles(groupShortName);
    if (!groupRoles || groupRoles.length === 0) {
        throw new Error("Failed to fetch VRChat Group roles.");
    }

    // Role mapping setup (supports precise .env ID mappings with name fallbacks)
    const mappings = [
        {
            name: 'Performer',
            discordEnvId: process.env.DISCORD_ROLE_PERFORMER,
            discordFallbackName: 'performer',
            vrcEnvId: process.env.VRC_ROLE_PERFORMER,
            vrcFallbackName: 'performers'
        },
        {
            name: 'Staff',
            discordEnvId: process.env.DISCORD_ROLE_STAFF,
            discordFallbackName: 'staff',
            vrcEnvId: process.env.VRC_ROLE_STAFF,
            vrcFallbackName: 'moderator'
        },
        {
            name: 'VIP',
            discordEnvId: process.env.DISCORD_ROLE_VIP,
            discordFallbackName: 'vip',
            vrcEnvId: process.env.VRC_ROLE_VIP,
            vrcFallbackName: 'vip'
        }
    ];

    const results = { added: [], removed: [], current: [] };

    for (const map of mappings) {
        // Find VRChat Role ID
        let vrcRole = null;
        if (map.vrcEnvId) {
            vrcRole = groupRoles.find(r => r.id === map.vrcEnvId);
        }
        if (!vrcRole) {
            vrcRole = groupRoles.find(r => r.name.toLowerCase() === map.vrcFallbackName);
        }

        if (!vrcRole) {
            console.warn(`[VRC ROLE SYNC] VRChat role mapping for "${map.name}" could not be resolved by ID or name.`);
            continue;
        }

        // Check if user has Discord Role
        let hasDiscordRole = false;
        if (map.discordEnvId) {
            hasDiscordRole = discordRoleIds.includes(map.discordEnvId);
        }
        if (!hasDiscordRole) {
            hasDiscordRole = discordRoleNames.includes(map.discordFallbackName);
        }

        const hasVrcRole = currentVrcRoleIds.includes(vrcRole.id);

        if (hasDiscordRole && !hasVrcRole) {
            const success = await addGroupMemberRole(groupShortName, vrcUserId, vrcRole.id);
            if (success) results.added.push(vrcRole.name);
        } else if (!hasDiscordRole && hasVrcRole) {
            const success = await removeGroupMemberRole(groupShortName, vrcUserId, vrcRole.id);
            if (success) results.removed.push(vrcRole.name);
        } else if (hasVrcRole) {
            results.current.push(vrcRole.name);
        }
    }

    return results;
}

// --- PROFILE ROUTES ---

// Avatar Upload Route
router.post('/profile/upload-avatar', isAuthenticated, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const isAnimated = req.file.mimetype === 'image/gif' || req.file.mimetype === 'image/webp';
        const filename = `${req.user.discordId}_${Date.now()}.webp`;
        const filePath = path.join(__dirname, '..', 'public', 'uploads', 'avatars', filename);
        const webPath = `/uploads/avatars/${filename}`;

        let pipeline = sharp(req.file.buffer, { animated: isAnimated });
        pipeline = pipeline.resize(512, 512, { fit: 'cover', position: 'center' });

        await pipeline.webp({ effort: 6, quality: 80, lossless: false }).toFile(filePath);

        if (req.user.imageUrl && req.user.imageUrl.startsWith('/uploads/avatars/')) {
            const oldPath = path.join(__dirname, '..', 'public', req.user.imageUrl);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        await Roster.update({ imageUrl: webPath }, { where: { discordId: req.user.discordId } });
        req.user.imageUrl = webPath;

        res.json({ success: true, imageUrl: webPath });
    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).json({ error: 'Failed' });
    }
});

// Update Profile Route
router.post('/profile/update', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { bio, colorStyle, useDiscordName, links } = req.body;
        await Roster.update({ bio, colorStyle, useDiscordName, links }, { where: { discordId: req.user.discordId } });
        req.user.bio = bio;
        req.user.colorStyle = colorStyle;
        req.user.useDiscordName = useDiscordName;
        req.user.links = links;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// VRChat Details route
router.get('/profile/vrc-details', isAuthenticated, async (req, res) => {
    try {
        const user = await Roster.findByPk(req.user.discordId);
        if (!user || !user.vrcUserId) {
            return res.json({ linked: false });
        }

        const vrcStatus = getVrcStatus();
        if (vrcStatus !== 'Connected') {
            return res.json({ linked: true, vrcUserId: user.vrcUserId, error: `VRChat API is offline (Status: ${vrcStatus}).` });
        }

        const details = await getVrcUserDetails(user.vrcUserId);
        if (!details) {
            return res.json({ linked: true, vrcUserId: user.vrcUserId, error: 'Could not fetch VRChat details.' });
        }

        res.json({ linked: true, ...details });
    } catch (err) {
        console.error("VRC Details Fetch Error:", err);
        res.status(500).json({ error: 'Failed to fetch details.' });
    }
});

// Link VRChat Profile
router.post('/profile/link-vrc', isAuthenticated, async (req, res) => {
    try {
        const { vrcInput } = req.body;
        const vrcUserId = parseVrcUserId(vrcInput);
        if (!vrcUserId) {
            return res.status(400).json({ error: 'Invalid VRChat User ID or Profile URL format.' });
        }

        const vrcStatus = getVrcStatus();
        if (vrcStatus !== 'Connected') {
            let errorMsg = `VRChat API is currently offline (Status: ${vrcStatus}).`;
            if (vrcStatus === '2FA Required') {
                errorMsg = 'VRChat API requires 2FA verification. Please ask an Admin to submit the OTP in the Settings panel.';
            } else if (vrcStatus.includes('Rate Limited')) {
                errorMsg = 'VRChat API is temporarily rate-limited. Please try again in a few minutes.';
            } else if (vrcStatus === 'Invalid Credentials' || vrcStatus === 'Missing Credentials') {
                errorMsg = 'VRChat API credentials are missing or incorrect. Check server config.';
            }
            return res.status(503).json({ error: errorMsg });
        }

        const details = await getVrcUserDetails(vrcUserId);
        if (!details) {
            return res.status(404).json({ error: 'VRChat user not found.' });
        }

        // Check if already linked to someone else
        const existing = await Roster.findOne({
            where: {
                vrcUserId,
                discordId: { [require('sequelize').Op.ne]: req.user.discordId }
            }
        });
        if (existing) {
            return res.status(400).json({ error: 'This VRChat account is already linked to another performer.' });
        }

        await Roster.update({
            vrcUserId: details.id,
            vrcUsername: details.username,
            vrcDisplayName: details.displayName
        }, { where: { discordId: req.user.discordId } });

        req.user.vrcUserId = details.id;
        req.user.vrcUsername = details.username;
        req.user.vrcDisplayName = details.displayName;

        let syncResults = null;
        try {
            if (details.inGroup) {
                syncResults = await executeRoleSync(details.id, req.user.discordId);
            }
        } catch (syncErr) {
            console.error("Auto sync roles error on link:", syncErr);
        }

        res.json({ success: true, details, syncResults });
    } catch (err) {
        console.error("Link VRC Error:", err);
        res.status(500).json({ error: 'Failed to link VRChat profile.' });
    }
});

// Sync Roles route
router.post('/profile/sync-vrc-roles', isAuthenticated, async (req, res) => {
    try {
        const user = await Roster.findByPk(req.user.discordId);
        if (!user || !user.vrcUserId) {
            return res.status(400).json({ error: 'No VRChat profile linked.' });
        }

        const results = await executeRoleSync(user.vrcUserId, req.user.discordId);
        res.json({ success: true, ...results });
    } catch (err) {
        console.error("Sync VRC Roles Error:", err);
        res.status(500).json({ error: err.message || 'Failed to sync roles.' });
    }
});

// --- SETTINGS ROUTES ---
router.get('/settings', isStaff, async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});
        res.json(settings);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/vrchat/status', isStaff, (req, res) => {
    res.json({ status: getVrcStatus() });
});

router.get('/discord/status', isStaff, (req, res) => {
    res.json({ status: getDiscordStatus() });
});

router.post('/vrchat/verify', isStaff, async (req, res) => {
    const { code } = req.body;
    const result = await verifyVRC(code);
    res.json(result);
});

// Multi-Instance Management
router.get('/vrchat/instances', isStaff, async (req, res) => {
    try {
        const activeInstances = await InstanceLog.findAll({ where: { isActive: true } });
        res.json(activeInstances);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/vrchat/instances/start', isHostOrOwner, async (req, res) => {
    try {
        const { instanceUrl, isEventSession } = req.body;
        if (!instanceUrl) return res.status(400).json({ error: 'URL required' });

        // Extract ID for identification
        let instanceId = instanceUrl;
        if (instanceUrl.includes('worldId=')) {
            const url = new URL(instanceUrl);
            instanceId = `${url.searchParams.get('worldId')}:${url.searchParams.get('instanceId')}`;
        }

        // Check if already active
        const existing = await InstanceLog.findOne({ where: { instanceId, isActive: true } });
        if (existing) return res.json({ success: true, message: 'Already tracking' });

        // Fetch basic world info for the log
        const worldData = await getInstanceData(instanceUrl);

        const newLog = await InstanceLog.create({
            instanceId,
            instanceUrl,
            worldName: (worldData && worldData.name) ? worldData.name : 'Club FuRN Hub',
            isEventSession: isEventSession || false,
            startTime: new Date(),
            isActive: true
        });

        res.json({ success: true, instance: newLog });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/vrchat/instances/:id/stop', isHostOrOwner, async (req, res) => {
    try {
        const log = await InstanceLog.findByPk(req.params.id);
        if (!log) return res.status(404).json({ error: 'Log not found' });

        const now = new Date();
        const durationMins = Math.floor((now - new Date(log.startTime)) / 60000);

        // Finalize the log
        await log.update({ 
            isActive: false, 
            endTime: now, 
            totalDuration: durationMins 
        });

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/settings/update', isStaff, async (req, res) => {
    try {
        const { 
            eventStartTime, eventEndTime, eventTitle, forceOffline, maintenanceMode, instanceUrl, eventTheme, eventLogo
        } = req.body;
        const userType = (req.user?.type || "").toLowerCase();
        const isFullAdmin = userType.includes('host') || userType.includes('owner');

        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});

        // If a new instanceUrl is provided via legacy settings, we can auto-start it
        if (instanceUrl && instanceUrl !== settings.instanceUrl) {
            // Auto-start tracking for this new URL
            let instanceId = instanceUrl;
            if (instanceUrl.includes('worldId=')) {
                try {
                    const url = new URL(instanceUrl);
                    instanceId = `${url.searchParams.get('worldId')}:${url.searchParams.get('instanceId')}`;
                } catch (e) {}
            }

            const existing = await InstanceLog.findOne({ where: { instanceId, isActive: true } });
            if (!existing) {
                const worldData = await getInstanceData(instanceUrl);
                await InstanceLog.create({
                    instanceId,
                    instanceUrl,
                    worldName: (worldData && worldData.name) ? worldData.name : 'Club FuRN Hub',
                    isEventSession: (new Date() >= new Date(eventStartTime || settings.eventStartTime) && new Date() < new Date(eventEndTime || settings.eventEndTime)),
                    startTime: new Date(),
                    isActive: true
                });
            }
        }

        const updateData = { instanceUrl, eventTheme, eventLogo, eventTitle };

        if (isFullAdmin) {
            updateData.eventStartTime = eventStartTime;
            updateData.eventEndTime = eventEndTime;
            updateData.forceOffline = forceOffline;
            updateData.maintenanceMode = maintenanceMode;
        }

        await settings.update(updateData);

        res.json({ success: true });
    } catch (err) { 
        console.error("Failed to update settings:", err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

// --- SCHEDULE ROUTES ---
router.get('/schedule', async (req, res) => {
    try {
        const schedule = await Schedule.findAll({ 
            include: [
                { model: Roster }, 
                { model: Roster, as: 'performers' }
            ], 
            order: [['createdAt', 'ASC']] 
        });
        res.json(schedule);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/schedule/add', isHostOrOwner, async (req, res) => {
    try {
        const { performerId, performerIds, timeSlot, genre, b2bName, b2bLogo } = req.body;
        
        // performerId is still supported for single DJ (legacy/fallback)
        const slot = await Schedule.create({ 
            performerId: performerId || (performerIds && performerIds.length === 1 ? performerIds[0] : null), 
            timeSlot, 
            genre,
            b2bName,
            b2bLogo
        });

        // Handle multiple performers for B2B
        if (performerIds && Array.isArray(performerIds) && performerIds.length > 0) {
            await slot.setPerformers(performerIds);
        } else if (performerId) {
            await slot.setPerformers([performerId]);
        }

        res.json({ success: true });
    } catch (err) { 
        console.error("Schedule Add Error:", err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

router.post('/schedule/clear', isHostOrOwner, async (req, res) => {
    try {
        // 1. Gather all performers (primary and B2B) from the current schedule
        const items = await Schedule.findAll({
            include: [{ model: Roster, as: 'performers', attributes: ['discordId'] }]
        });
        const performerIds = new Set();
        items.forEach(item => {
            if (item.performerId) performerIds.add(item.performerId);
            if (item.performers) {
                item.performers.forEach(p => performerIds.add(p.discordId));
            }
        });

        // 2. Find the most recent event InstanceLog to link these performers to
        if (performerIds.size > 0) {
            const lastEvent = await InstanceLog.findOne({
                where: { isEventSession: true },
                order: [['startTime', 'DESC']]
            });
            if (lastEvent) {
                await lastEvent.addPerformers(Array.from(performerIds));
                console.log(`[ARCHIVE] Automatically linked ${performerIds.size} performers to InstanceLog ${lastEvent.id}`);
            }
        }

        // 3. Clear schedule
        await Schedule.destroy({ where: {}, truncate: true });
        res.json({ success: true });
    } catch (err) { 
        console.error("Archive Schedule Error:", err);
        res.status(500).json({ error: 'Failed to clear schedule' }); 
    }
});

router.delete('/schedule/:id', isHostOrOwner, async (req, res) => {
    try {
        await Schedule.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/schedule/:id', isHostOrOwner, async (req, res) => {
    try {
        const { timeSlot, genre, b2bName, b2bLogo, performerIds } = req.body;
        const slot = await Schedule.findByPk(req.params.id);
        if (!slot) return res.status(404).json({ error: 'Slot not found' });

        await slot.update({ 
            timeSlot, 
            genre,
            b2bName,
            b2bLogo,
            performerId: (performerIds && performerIds.length === 1) ? performerIds[0] : slot.performerId
        });

        if (performerIds && Array.isArray(performerIds)) {
            await slot.setPerformers(performerIds);
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/roster/search', isStaff, async (req, res) => {
    try {
        const members = await Roster.findAll({ attributes: ['discordId', 'name', 'type', 'hasMascotAccess'] });
        res.json(members);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/roster/all', isStaff, async (req, res) => {
    try {
        const members = await Roster.findAll({ order: [['name', 'ASC']] });
        
        // Fetch event counts for all performers
        const counts = await InstanceLogPerformers.findAll({
            attributes: ['performerId', [sequelize.fn('COUNT', sequelize.col('instanceLogId')), 'count']],
            group: ['performerId']
        });
        
        const countsMap = {};
        counts.forEach(c => {
            countsMap[c.performerId] = parseInt(c.get('count')) || 0;
        });

        const mapped = members.map(m => {
            const json = m.toJSON();
            json.eventCount = countsMap[m.discordId] || 0;
            return json;
        });

        res.json(mapped);
    } catch (err) { 
        console.error("Failed to load roster stats:", err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

router.patch('/roster/:id', isStaff, async (req, res) => {
    try {
        const { title, type, name, isBanned, hasMascotAccess } = req.body;
        
        const targetUser = await Roster.findByPk(req.params.id);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        const userType = (req.user?.type || "").toLowerCase();
        const isOwner = userType.includes('owner');
        const isHost = userType.includes('host');
        
        const targetType = (targetUser.type || "").toLowerCase();
        const targetIsOwner = targetType.includes('owner');

        // SECURITY: Non-owners cannot modify an Owner's account (except maybe their own title, but let's be strict)
        if (targetIsOwner && !isOwner) {
            return res.status(403).json({ error: 'You do not have permission to modify an Owner account.' });
        }

        const updateData = { title };
        
        // Role Change Logic
        if (type && type !== targetUser.type) {
            const newTypeLower = type.toLowerCase();
            if (newTypeLower.includes('owner')) {
                if (isOwner) updateData.type = type;
                else return res.status(403).json({ error: 'Only Owners can grant the Owner role.' });
            } else {
                // demoting/changing role to non-owner
                // isStaff middleware ensures they are at least Staff/Host/Owner
                updateData.type = type;
            }
        }
        
        // Name and Ban status (Host or Owner only)
        if (isHost || isOwner) {
            if (name) updateData.name = name;
            if (isBanned !== undefined) updateData.isBanned = isBanned;

            if (req.body.vrcUserId !== undefined) {
                const inputVal = req.body.vrcUserId ? req.body.vrcUserId.trim() : "";
                if (inputVal === "") {
                    updateData.vrcUserId = null;
                    updateData.vrcUsername = null;
                    updateData.vrcDisplayName = null;
                } else {
                    const parsedId = parseVrcUserId(inputVal);
                    if (!parsedId) {
                        return res.status(400).json({ error: 'Invalid VRChat User ID or Profile URL format.' });
                    }

                    // Check if already linked to someone else
                    const existing = await Roster.findOne({
                        where: {
                            vrcUserId: parsedId,
                            discordId: { [require('sequelize').Op.ne]: req.params.id }
                        }
                    });
                    if (existing) {
                        return res.status(400).json({ error: 'This VRChat account is already linked to another performer.' });
                    }

                    const vrcStatus = getVrcStatus();
                    if (vrcStatus !== 'Connected') {
                        let errorMsg = `VRChat API is currently offline (Status: ${vrcStatus}).`;
                        if (vrcStatus === '2FA Required') {
                            errorMsg = 'VRChat API requires 2FA verification. Verify via the Settings panel.';
                        } else if (vrcStatus.includes('Rate Limited')) {
                            errorMsg = 'VRChat API is rate-limited. Try again in a few minutes.';
                        } else if (vrcStatus === 'Invalid Credentials' || vrcStatus === 'Missing Credentials') {
                            errorMsg = 'VRChat API configuration error.';
                        }
                        return res.status(503).json({ error: errorMsg });
                    }

                    const details = await getVrcUserDetails(parsedId);
                    if (!details) {
                        return res.status(404).json({ error: 'VRChat user not found.' });
                    }
                    updateData.vrcUserId = details.id;
                    updateData.vrcUsername = details.username;
                    updateData.vrcDisplayName = details.displayName;
                }
            }
        }

        // Mascot Access (Owner only)
        if (isOwner && hasMascotAccess !== undefined) {
            updateData.hasMascotAccess = hasMascotAccess;
        }

        await targetUser.update(updateData);
        res.json({ success: true });
    } catch (err) { 
        console.error("Roster update error:", err);
        res.status(500).json({ error: err.message || 'Failed' }); 
    }
});

// Sync Member VRChat Roles (Hosts/Owners only)
router.post('/roster/:id/sync-vrc-roles', isHostOrOwner, async (req, res) => {
    try {
        const targetUser = await Roster.findByPk(req.params.id);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (!targetUser.vrcUserId) {
            return res.status(400).json({ error: 'User does not have a linked VRChat profile.' });
        }

        const results = await executeRoleSync(targetUser.vrcUserId, targetUser.discordId);
        res.json({ success: true, ...results });
    } catch (err) {
        console.error("Staff Sync VRC Roles Error:", err);
        res.status(500).json({ error: err.message || 'Failed to sync roles.' });
    }
});

router.delete('/roster/:id', isAuthenticated, isOwner, async (req, res) => {
    try {
        await Roster.destroy({ where: { discordId: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- APPLICATION SLOTS ROUTES ---
router.get('/apps/all', isStaff, async (req, res) => {
    try {
        const slots = await AppSlot.findAll({ order: [['order', 'ASC']] });
        res.json(slots);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/apps/add', isHostOrOwner, async (req, res) => {
    try {
        const { roleName, roleType, description, formUrl, isInternal, status, deadline, autoCloseAt } = req.body;
        await AppSlot.create({ roleName, roleType, description, formUrl, isInternal, status, deadline, autoCloseAt });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/apps/:id', isHostOrOwner, async (req, res) => {
    try {
        await AppSlot.update(req.body, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/apps/:id', isHostOrOwner, async (req, res) => {
    try {
        await AppSlot.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- ARCHIVE ROUTES ---
router.get('/archives/my', isAuthenticated, async (req, res) => {
    try {
        const archives = await Archive.findAll({ where: { performerId: req.user.discordId }, order: [['date', 'DESC'], ['createdAt', 'DESC']] });
        res.json(archives);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/archives/all', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        const archives = await Archive.findAll({ include: [Roster], order: [['date', 'DESC'], ['createdAt', 'DESC']] });
        res.json(archives);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/archives/add', isAuthenticated, async (req, res) => {
    try {
        const { title, date, genre, linkUrl } = req.body;
        await Archive.create({ performerId: req.user.discordId, title, date, genre, linkUrl });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/archives/:id', isAuthenticated, async (req, res) => {
    try {
        const { title, date, genre, linkUrl } = req.body;
        const archive = await Archive.findByPk(req.params.id);
        if (!archive) return res.status(404).json({ error: 'Archive not found' });

        const userType = (req.user?.type || "").toLowerCase();
        const isHostOrOwner = userType.includes('host') || userType.includes('owner');
        
        if (archive.performerId !== req.user.discordId && !isHostOrOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await archive.update({ title, date, genre, linkUrl });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/archives/:id', isAuthenticated, async (req, res) => {
    try {
        const archive = await Archive.findByPk(req.params.id);
        if (!archive) return res.status(404).json({ error: 'Archive not found' });

        const userType = (req.user?.type || "").toLowerCase();
        const isHostOrOwner = userType.includes('host') || userType.includes('owner');
        
        if (archive.performerId !== req.user.discordId && !isHostOrOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await archive.destroy();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- GALLERY ROUTES ---
router.delete('/gallery/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        await Gallery.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- STATISTICS ROUTES ---
router.post('/stats/track', async (req, res) => {
    try {
        let { type, targetId, metadata } = req.body;
        if (type === 'link_click' && metadata && metadata.label) {
            const label = metadata.label.trim();
            const lower = label.toLowerCase();
            const mapping = { 'twitter': 'Twitter', 'x': 'Twitter', 'soundcloud': 'SoundCloud', 'mixcloud': 'Mixcloud', 'twitch': 'Twitch', 'bluesky': 'Bluesky', 'youtube': 'YouTube', 'yt': 'YouTube', 'tiktok': 'TikTok', 'vrc': 'VRChat', 'vrchat': 'VRChat', 'linktree': 'Linktree', 'allmylinks': 'AllMyLinks' };
            if (mapping[lower]) metadata.label = mapping[lower];
            else metadata.label = label.charAt(0).toUpperCase() + label.slice(1);
        }
        await Stats.create({ type, targetId, metadata });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/stats/global', isAuthenticated, isStaff, async (req, res) => {
    try {
        const { Op, fn, col } = require('sequelize');
        const pageViews = await Stats.findAll({ attributes: ['targetId', [fn('COUNT', col('id')), 'count']], where: { type: 'page_view' }, group: ['targetId'] });
        
        const topPlatforms = await Stats.findAll({ attributes: [[sequelize.literal("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.label'))"), 'label'], [fn('COUNT', col('id')), 'count']], where: { type: 'link_click' }, group: [sequelize.literal("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.label'))")], order: [[fn('COUNT', col('id')), 'DESC']] });
        const topArchives = await Stats.findAll({ attributes: ['targetId', [fn('COUNT', col('id')), 'count']], where: { type: 'archive_click' }, group: ['targetId'], order: [[fn('COUNT', col('id')), 'DESC']] });
        const archiveIds = topArchives.map(a => a.targetId);
        const archiveRecords = await Archive.findAll({ 
            where: { id: { [Op.in]: archiveIds } }, 
            attributes: ['id', 'title'],
            include: [{ model: Roster, attributes: ['name'] }]
        });
        const topDJs = await Stats.findAll({ attributes: ['targetId', [fn('COUNT', col('id')), 'count']], where: { type: 'link_click' }, group: ['targetId'], order: [[fn('COUNT', col('id')), 'DESC']] });
        const djIds = topDJs.map(a => a.targetId);
        const djRecords = await Roster.findAll({ where: { discordId: { [Op.in]: djIds } }, attributes: ['discordId', 'name'] });

        const appInterest = await Stats.findAll({
            attributes: [
                [sequelize.literal("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.label'))"), 'label'],
                [fn('COUNT', col('id')), 'count']
            ],
            where: { 
                type: 'link_click',
                [Op.and]: sequelize.literal("JSON_EXTRACT(metadata, '$.category') = 'application'")
            },
            group: [sequelize.literal("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.label'))")],
            order: [[fn('COUNT', col('id')), 'DESC']]
        });

        const appSubmissions = await ApplicationSubmission.findAll({
            attributes: [[fn('COUNT', col('ApplicationSubmission.id')), 'count']],
            include: [{ model: AppSlot, attributes: ['roleName'] }],
            group: ['slotId', 'AppSlot.id'],
            order: [[fn('COUNT', col('ApplicationSubmission.id')), 'DESC']]
        });

        res.json({
            pageViews: pageViews.map(p => ({ page: p.targetId, count: p.get('count') })),
            topPlatforms: topPlatforms.map(p => ({ label: p.get('label') || "Unknown", count: p.get('count') })),
            topArchives: topArchives.map(a => { 
                const rec = archiveRecords.find(r => r.id.toString() === a.targetId); 
                return { 
                    title: rec ? rec.title : 'Unknown', 
                    djName: rec && rec.Roster ? rec.Roster.name : 'Unknown',
                    count: a.get('count') 
                }; 
            }),
            topDJs: topDJs.map(d => { const rec = djRecords.find(r => r.discordId === d.targetId); return { name: rec ? rec.name : 'Unknown', count: d.get('count') }; }),
            appInterest: appInterest.map(a => ({ label: a.get('label'), count: a.get('count') })),
            appSubmissions: appSubmissions.map(s => ({ label: s.AppSlot ? s.AppSlot.roleName : 'Unknown', count: s.get('count') }))
        });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/stats/instances', isAuthenticated, isStaff, async (req, res) => {
    try {
        const logs = await InstanceLog.findAll({
            include: [{ model: Roster, as: 'performers', attributes: ['discordId', 'name'] }],
            order: [['startTime', 'DESC']],
            limit: 50
        });
        res.json(logs);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/stats/instances/add', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        const { worldName, startTime, endTime, peakCapacity, uniqueUsers, isEventSession, performerIds } = req.body;
        const start = new Date(startTime);
        const end = new Date(endTime);
        const duration = Math.floor((end - start) / 60000);
        
        const log = await InstanceLog.create({
            worldName,
            startTime: start,
            endTime: end,
            peakCapacity,
            uniqueUsers,
            totalDuration: duration,
            isEventSession,
            instanceId: 'manual-entry',
            isActive: false
        });

        if (performerIds && Array.isArray(performerIds)) {
            await log.setPerformers(performerIds);
        }

        res.json({ success: true });
    } catch (err) { 
        console.error("Failed to add instance:", err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

router.delete('/stats/instances/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        await InstanceLog.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/stats/instances/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        const { worldName, startTime, endTime, peakCapacity, uniqueUsers, isEventSession, performerIds } = req.body;
        const updateData = { worldName, peakCapacity, uniqueUsers, isEventSession };
        
        if (startTime && endTime) {
            const start = new Date(startTime);
            const end = new Date(endTime);
            updateData.startTime = start;
            updateData.endTime = end;
            updateData.totalDuration = Math.floor((end - start) / 60000);
        }

        const log = await InstanceLog.findByPk(req.params.id);
        if (log) {
            await log.update(updateData);
            if (performerIds && Array.isArray(performerIds)) {
                await log.setPerformers(performerIds);
            }
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    } catch (err) { 
        console.error("Failed to update instance:", err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

router.get('/stats/my', isAuthenticated, async (req, res) => {
    try {
        const { Op, fn, col } = require('sequelize');
        const myArchives = await Archive.findAll({ where: { performerId: req.user.discordId } });
        const archiveIds = myArchives.map(a => a.id.toString());
        const archiveStats = await Stats.findAll({ where: { targetId: { [Op.in]: archiveIds }, type: 'archive_click' } });
        const counts = {};
        archiveStats.forEach(s => { counts[s.targetId] = (counts[s.targetId] || 0) + 1; });
        const socialBreakdown = await Stats.findAll({ attributes: [[sequelize.literal("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.label'))"), 'label'], [fn('COUNT', col('id')), 'count']], where: { targetId: req.user.discordId, type: 'link_click' }, group: [sequelize.literal("JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.label'))")] });
        const socialClicks = socialBreakdown.reduce((acc, curr) => acc + parseInt(curr.get('count')), 0);
        const profileViews = await Stats.count({ where: { targetId: req.user.discordId, type: 'page_view' } });
        res.json({ archiveClicks: counts, linkClicks: socialClicks, profileViews: profileViews, platformBreakdown: socialBreakdown.map(p => ({ label: p.get('label') || "Unknown", count: p.get('count') })) });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
