const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { sequelize, Roster, Settings, Schedule, Archive, Stats, AppSlot, ApplicationSubmission, InstanceLog } = require('../db');
const { getGuildMember, getDiscordStatus } = require('../bot');
const { getInstanceData, verifyVRC, getVrcStatus } = require('../utils/vrc-api');
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
            worldName: (worldData && worldData.name) ? worldData.name : 'Club Critters Hub',
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
        const { eventStartTime, eventEndTime, eventTitle, forceOffline, instanceUrl, eventTheme, eventLogo } = req.body;
        const userType = (req.user?.type || "").toLowerCase();
        const isFullAdmin = userType.includes('host') || userType.includes('owner');

        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});

        // If a new instanceUrl is provided via legacy settings, we can auto-start it
        if (instanceUrl && instanceUrl !== settings.instanceUrl) {
            // Auto-start tracking for this new URL
            let instanceId = instanceUrl;
            if (instanceUrl.includes('worldId=')) {
                const url = new URL(instanceUrl);
                instanceId = `${url.searchParams.get('worldId')}:${url.searchParams.get('instanceId')}`;
            }

            const existing = await InstanceLog.findOne({ where: { instanceId, isActive: true } });
            if (!existing) {
                const worldData = await getInstanceData(instanceUrl);
                await InstanceLog.create({
                    instanceId,
                    instanceUrl,
                    worldName: (worldData && worldData.name) ? worldData.name : 'Club Critters Hub',
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
        }

        await settings.update(updateData);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- SCHEDULE ROUTES ---
router.get('/schedule', async (req, res) => {
    try {
        const schedule = await Schedule.findAll({ include: [Roster], order: [['createdAt', 'ASC']] });
        res.json(schedule);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/schedule/add', isHostOrOwner, async (req, res) => {
    try {
        const { performerId, timeSlot, genre } = req.body;
        await Schedule.create({ performerId, timeSlot, genre });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/schedule/clear', isHostOrOwner, async (req, res) => {
    try {
        await Schedule.destroy({ where: {}, truncate: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/schedule/:id', isHostOrOwner, async (req, res) => {
    try {
        await Schedule.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/schedule/:id', isHostOrOwner, async (req, res) => {
    try {
        const { timeSlot, genre } = req.body;
        await Schedule.update({ timeSlot, genre }, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/roster/search', isStaff, async (req, res) => {
    try {
        const members = await Roster.findAll({ attributes: ['discordId', 'name', 'type'] });
        res.json(members);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/roster/all', isStaff, async (req, res) => {
    try {
        const members = await Roster.findAll({ order: [['name', 'ASC']] });
        res.json(members);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/roster/:id', isStaff, async (req, res) => {
    try {
        const { title, type, name, isBanned } = req.body;
        const updateData = { title, type };
        
        // Only allow Host or Owner to change the stored name or ban status
        const userType = (req.user?.type || "").toLowerCase();
        const canManageUser = userType.includes('host') || userType.includes('owner');
        
        if (canManageUser) {
            if (name) updateData.name = name;
            if (isBanned !== undefined) updateData.isBanned = isBanned;
        }

        await Roster.update(updateData, { where: { discordId: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
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
        const archives = await Archive.findAll({ where: { performerId: req.user.discordId }, order: [['date', 'DESC']] });
        res.json(archives);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/archives/all', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        const archives = await Archive.findAll({ include: [Roster], order: [['date', 'DESC']] });
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
            order: [['startTime', 'DESC']],
            limit: 50
        });
        res.json(logs);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/stats/instances/add', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        const { worldName, startTime, endTime, peakCapacity, uniqueUsers, isEventSession } = req.body;
        const start = new Date(startTime);
        const end = new Date(endTime);
        const duration = Math.floor((end - start) / 60000);
        
        await InstanceLog.create({
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
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/stats/instances/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        await InstanceLog.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/stats/instances/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        const { worldName, startTime, endTime, peakCapacity, uniqueUsers, isEventSession } = req.body;
        const updateData = { worldName, peakCapacity, uniqueUsers, isEventSession };
        
        if (startTime && endTime) {
            const start = new Date(startTime);
            const end = new Date(endTime);
            updateData.startTime = start;
            updateData.endTime = end;
            updateData.totalDuration = Math.floor((end - start) / 60000);
        }

        await InstanceLog.update(updateData, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
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
