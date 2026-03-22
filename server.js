const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { sequelize, initDB, Roster, Settings, Schedule, Archive, Stats, AppSlot, Gallery, ApplicationSubmission, InstanceLog } = require('./db');
const { getGuildMember, updateBotStatus, joinGuild, getDiscordStatus } = require('./bot');
const { getInstanceData, getGroupInstanceData, getGroupStats, verifyVRC, getVrcStatus } = require('./utils/vrc-api');
const path = require('path');
require('dotenv').config();

const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');

// Multer Setup (Memory Storage for Sharp processing)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB Limit
});

const app = express();
const PORT = process.env.PORT || 3000;

// Helper to handle Sequelize/MySQL/MariaDB JSON parsing inconsistencies
const safeParseJSON = (data) => {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } 
        catch (e) { return {}; }
    }
    return data || {};
};

// Passport Serialization
passport.serializeUser((user, done) => done(null, user.discordId));
passport.deserializeUser(async (id, done) => {
    try {
        let user = await Roster.findByPk(id);
        
        if (user) {
            // Block banned users
            if (user.isBanned) return done(null, false);

            // Fix JSON parsing for Linux/MariaDB
            user.links = safeParseJSON(user.links);
        }

        const guildMember = await getGuildMember(id);
        
        // If not on roster, create a basic user object for applicants
        if (!user) {
            user = { 
                discordId: id, 
                name: guildMember?.nickname || "Applicant", 
                type: "Public", 
                links: {},
                isPublic: true 
            };
        }

        if (guildMember) {
            user.discordData = guildMember;
        }
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// Configure Discord Strategy
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_REDIRECT_URI,
    scope: ['identify', 'guilds.join']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // 1. Try to join the user to the guild automatically
        await joinGuild(profile.id, accessToken);

        // 2. Check if they are now in the guild
        const guildMember = await getGuildMember(profile.id);
        if (!guildMember) {
            return done(null, false, { message: 'You must be in the Club Critters Discord to login.' });
        }

        // 3. Find or identify user
        let user = await Roster.findByPk(profile.id);
        
        if (user && user.isBanned) {
            return done(null, false, { message: 'Banned' });
        }

        if (!user) {
            // For applicants, we return a virtual user object
            return done(null, { discordId: profile.id, name: profile.username, type: "Public", isPublic: true });
        }

        return done(null, user);
    } catch (err) {
        return done(err, null);
    }
}));

// --- MIDDLEWARE ---

const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    // Save the intended destination to session
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/discord');
};

const isStaff = (req, res, next) => {
    const allowedRoles = ['host', 'staff', 'owner'];
    const userType = (req.user?.type || "").toLowerCase();
    if (req.isAuthenticated() && allowedRoles.some(role => userType.includes(role))) {
        return next();
    }
    res.status(403).json({ error: 'Staff access required' });
};

const isHostOrOwner = (req, res, next) => {
    const allowedRoles = ['host', 'owner'];
    const userType = (req.user?.type || "").toLowerCase();
    if (req.isAuthenticated() && allowedRoles.some(role => userType.includes(role))) {
        return next();
    }
    res.status(403).json({ error: 'Host or Owner access required' });
};

const isOwner = (req, res, next) => {
    if (req.isAuthenticated() && req.user.type.toLowerCase().includes('owner')) {
        return next();
    }
    res.status(403).json({ error: 'Owner access required' });
};

app.set('view engine', 'ejs');
app.set('trust proxy', 1); // Trust first proxy (needed for secure cookies behind Nginx/etc)
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.COOKIE_SECURE !== 'false', 
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 Days
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// Auth Routes
app.get('/auth/discord', (req, res, next) => {
    // 1. Check session for returnTo first, then query, then Referer
    let returnTo = req.session.returnTo || req.query.returnTo || req.get('Referer') || '/';
    
    // 2. Safety: Never redirect back to auth or login-error
    if (returnTo.includes('/auth/discord') || returnTo.includes('/login-error')) {
        returnTo = '/';
    }

    // 3. Safety: Clean returnTo if it's a full URL
    if (returnTo.includes(req.get('host'))) {
        try {
            const url = new URL(returnTo, `http://${req.get('host')}`);
            returnTo = url.pathname + url.search;
        } catch (e) { returnTo = '/'; }
    } else if (returnTo.startsWith('http')) {
        returnTo = '/'; // Don't redirect to external sites
    }

    console.log(`[AUTH] 🔑 Starting Login. Target: ${returnTo}`);
    
    // Pass returnTo as state
    const state = Buffer.from(returnTo).toString('base64');
    passport.authenticate('discord', { state, prompt: 'none' })(req, res, next);
});

app.get('/auth/discord/callback', (req, res, next) => {
    let returnTo = '/';
    if (req.query.state) {
        try {
            returnTo = Buffer.from(req.query.state, 'base64').toString('ascii');
        } catch (e) { console.error("[AUTH] ❌ Failed to decode state", e); }
    }

    passport.authenticate('discord', { failureRedirect: '/login-error' })(req, res, async (err) => {
        if (err) return next(err);
        if (!req.user) return res.redirect('/login-error');

        // Clear the session returnTo now that we used it
        delete req.session.returnTo;

        console.log(`[AUTH] ✅ Login Success: ${req.user.name}. Redirect: ${returnTo}`);

        if (!req.user.isPublic && returnTo === '/') {
            return res.redirect('/panel');
        }

        res.redirect(returnTo);
    });
});
app.get('/logout', (req, res) => {
    req.logout(() => { res.redirect('/'); });
});

// --- PANEL ROUTES ---

app.get('/panel', isAuthenticated, (req, res) => { res.redirect('/panel/profile'); });
app.get('/panel/profile', isAuthenticated, (req, res) => { res.render('panel/profile', { user: req.user, page: 'profile' }); });
app.get('/panel/schedule', isAuthenticated, isStaff, (req, res) => { res.render('panel/schedule', { user: req.user, page: 'schedule' }); });
app.get('/panel/roster', isAuthenticated, isStaff, (req, res) => { res.render('panel/roster', { user: req.user, page: 'roster' }); });
app.get('/panel/apps', isAuthenticated, isStaff, (req, res) => { res.render('panel/apps', { user: req.user, page: 'apps' }); });
app.get('/panel/settings', isAuthenticated, isStaff, (req, res) => { res.render('panel/settings', { user: req.user, page: 'settings' }); });
app.get('/panel/stats', isAuthenticated, isStaff, (req, res) => { res.render('panel/stats', { user: req.user, page: 'stats' }); });
app.get('/panel/links', isAuthenticated, isStaff, (req, res) => { res.render('panel/links', { user: req.user, page: 'links' }); });
app.get('/panel/archives', isAuthenticated, (req, res) => { res.render('panel/archives', { user: req.user, page: 'archives' }); });

// Avatar Upload Route
app.post('/api/profile/upload-avatar', isAuthenticated, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const isAnimated = req.file.mimetype === 'image/gif' || req.file.mimetype === 'image/webp';
        const filename = `${req.user.discordId}_${Date.now()}.webp`;
        const filePath = path.join(__dirname, 'public', 'uploads', 'avatars', filename);
        const webPath = `/uploads/avatars/${filename}`;

        let pipeline = sharp(req.file.buffer, { animated: isAnimated });
        pipeline = pipeline.resize(512, 512, { fit: 'cover', position: 'center' });

        await pipeline.webp({ effort: 6, quality: 80, lossless: false }).toFile(filePath);

        if (req.user.imageUrl && req.user.imageUrl.startsWith('/uploads/avatars/')) {
            const oldPath = path.join(__dirname, 'public', req.user.imageUrl);
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
app.post('/api/profile/update', async (req, res) => {
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
app.get('/api/settings', isStaff, async (req, res) => {
    try {
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});
        res.json(settings);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/vrchat/status', isStaff, (req, res) => {
    res.json({ status: getVrcStatus() });
});

app.get('/api/discord/status', isStaff, (req, res) => {
    res.json({ status: getDiscordStatus() });
});

app.post('/api/vrchat/verify', isStaff, async (req, res) => {
    const { code } = req.body;
    const result = await verifyVRC(code);
    res.json(result);
});

// Multi-Instance Management
app.get('/api/vrchat/instances', isStaff, async (req, res) => {
    try {
        const activeInstances = await InstanceLog.findAll({ where: { isActive: true } });
        res.json(activeInstances);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/vrchat/instances/start', isHostOrOwner, async (req, res) => {
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

app.delete('/api/vrchat/instances/:id/stop', isHostOrOwner, async (req, res) => {
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

        // Optional: Trigger VRC API to close instance if desired
        // await closeGroupInstance(log.instanceUrl);

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/settings/update', isStaff, async (req, res) => {
    try {
        const { eventStartTime, eventEndTime, forceOffline, instanceUrl, eventTheme, eventLogo } = req.body;
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

        const updateData = { instanceUrl, eventTheme, eventLogo };
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
app.get('/api/schedule', async (req, res) => {
    try {
        const schedule = await Schedule.findAll({ include: [Roster], order: [['createdAt', 'ASC']] });
        res.json(schedule);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/schedule/add', isHostOrOwner, async (req, res) => {
    try {
        const { performerId, timeSlot, genre } = req.body;
        await Schedule.create({ performerId, timeSlot, genre });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/schedule/clear', isHostOrOwner, async (req, res) => {
    try {
        await Schedule.destroy({ where: {}, truncate: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/schedule/:id', isHostOrOwner, async (req, res) => {
    try {
        await Schedule.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.patch('/api/schedule/:id', isHostOrOwner, async (req, res) => {
    try {
        const { timeSlot, genre } = req.body;
        await Schedule.update({ timeSlot, genre }, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/roster/search', isStaff, async (req, res) => {
    try {
        const members = await Roster.findAll({ attributes: ['discordId', 'name', 'type'] });
        res.json(members);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/roster/all', isStaff, async (req, res) => {
    try {
        const members = await Roster.findAll({ order: [['name', 'ASC']] });
        res.json(members);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.patch('/api/roster/:id', isStaff, async (req, res) => {
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

app.delete('/api/roster/:id', isAuthenticated, isOwner, async (req, res) => {
    try {
        await Roster.destroy({ where: { discordId: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- APPLICATION SLOTS ROUTES ---
app.get('/api/apps/all', isStaff, async (req, res) => {
    try {
        const slots = await AppSlot.findAll({ order: [['order', 'ASC']] });
        res.json(slots);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/apps/add', isHostOrOwner, async (req, res) => {
    try {
        const { roleName, roleType, description, formUrl, isInternal, status, deadline, autoCloseAt } = req.body;
        await AppSlot.create({ roleName, roleType, description, formUrl, isInternal, status, deadline, autoCloseAt });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.patch('/api/apps/:id', isHostOrOwner, async (req, res) => {
    try {
        await AppSlot.update(req.body, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- SUBMIT APPLICATION ---
app.post('/api/public/apps/submit', async (req, res) => {
    try {
        const { slotId, answers, discordId, discordTag } = req.body;
        const slot = await AppSlot.findByPk(slotId);
        if (!slot || slot.status !== 'open') return res.status(400).json({ error: 'Slot is closed or invalid.' });

        const submission = await ApplicationSubmission.create({
            slotId,
            discordId,
            discordTag,
            answers
        });

        // Trigger Discord Bot to create channel
        const { createApplicationTicket } = require('./utils/bot-utils');
        await createApplicationTicket(submission, slot);

        res.json({ success: true });
    } catch (err) {
        console.error("Submission Error:", err);
        res.status(500).json({ error: 'Failed to submit application.' });
    }
});

app.delete('/api/apps/:id', isHostOrOwner, async (req, res) => {
    try {
        await AppSlot.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- ARCHIVE ROUTES ---
app.get('/api/archives/my', isAuthenticated, async (req, res) => {
    try {
        const archives = await Archive.findAll({ where: { performerId: req.user.discordId }, order: [['date', 'DESC']] });
        res.json(archives);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/archives/all', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        const archives = await Archive.findAll({ include: [Roster], order: [['date', 'DESC']] });
        res.json(archives);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/archives/add', isAuthenticated, async (req, res) => {
    try {
        const { title, date, genre, linkUrl } = req.body;
        await Archive.create({ performerId: req.user.discordId, title, date, genre, linkUrl });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.patch('/api/archives/:id', isAuthenticated, async (req, res) => {
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

app.delete('/api/archives/:id', isAuthenticated, async (req, res) => {
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
app.delete('/api/gallery/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        await Gallery.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// --- STATISTICS ROUTES ---
app.post('/api/stats/track', async (req, res) => {
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

app.get('/api/stats/global', isAuthenticated, isStaff, async (req, res) => {
    try {
        const { Op, fn, col } = require('sequelize');
        const pageViews = await Stats.findAll({ attributes: ['targetId', [fn('COUNT', col('id')), 'count']], where: { type: 'page_view' }, group: ['targetId'] });
        
        // NO LIMITS - LOAD ALL DATA
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

        // 5. Application Interest (Clicks)
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

        // 6. Actual Submissions
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

app.get('/api/stats/instances', isAuthenticated, isStaff, async (req, res) => {
    try {
        const logs = await InstanceLog.findAll({
            order: [['startTime', 'DESC']],
            limit: 50
        });
        res.json(logs);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/stats/instances/add', isAuthenticated, isHostOrOwner, async (req, res) => {
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
            isActive: false // Manual entries are historical, never active
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/stats/instances/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
    try {
        await InstanceLog.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.patch('/api/stats/instances/:id', isAuthenticated, isHostOrOwner, async (req, res) => {
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

app.get('/api/stats/my', isAuthenticated, async (req, res) => {
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

// --- PUBLIC API ROUTES ---
app.get('/api/public/settings', async (req, res) => { try { const settings = await Settings.findOne(); res.json(settings); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/public/schedule', async (req, res) => { 
    try { 
        const schedule = await Schedule.findAll({ 
            include: [{ model: Roster, attributes: ['name', 'useDiscordName', 'colorStyle', 'imageUrl', 'links', 'discordId'] }], 
            order: [['createdAt', 'ASC']] 
        }); 
        const mapped = await Promise.all(schedule.map(async item => { 
            let displayName = item.Roster.name; 
            if (item.Roster.useDiscordName) { 
                const member = await getGuildMember(item.performerId); 
                if (member) displayName = member.nickname; 
            } 
            return { 
                id: item.id, 
                timeSlot: item.timeSlot, 
                genre: item.genre, 
                performer: { 
                    discordId: item.Roster.discordId, 
                    name: displayName, 
                    color: item.Roster.colorStyle, 
                    image: item.Roster.imageUrl, 
                    links: safeParseJSON(item.Roster.links) 
                } 
            }; 
        })); 
        res.json(mapped); 
    } catch (err) { res.status(500).json({ error: 'Failed' }); } 
});

app.get('/api/public/roster', async (req, res) => { 
    try { 
        const roster = await Roster.findAll({ 
            where: { isBanned: false },
            order: [['name', 'ASC']] 
        }); 
        const mapped = await Promise.all(roster.map(async user => { 
            let displayName = user.name; 
            if (user.useDiscordName) { 
                const member = await getGuildMember(user.discordId); 
                if (member) displayName = member.nickname; 
            } 
            return { 
                discordId: user.discordId, 
                name: displayName, 
                type: user.type, 
                title: user.title, 
                imageUrl: user.imageUrl, 
                colorStyle: user.colorStyle, 
                bio: user.bio, 
                links: safeParseJSON(user.links) 
            }; 
        })); 
        res.json(mapped); 
    } catch (err) { res.status(500).json({ error: 'Failed' }); } 
});
app.get('/api/public/archives', async (req, res) => { try { const archives = await Archive.findAll({ include: [{ model: Roster, attributes: ['name', 'useDiscordName', 'imageUrl'] }], order: [['date', 'DESC']] }); const mapped = await Promise.all(archives.map(async arc => { let djName = arc.Roster.name; if (arc.Roster.useDiscordName) { const member = await getGuildMember(arc.performerId); if (member) djName = member.nickname; } return { id: arc.id, performerId: arc.performerId, title: arc.title, date: arc.date, genre: arc.genre, link: arc.linkUrl, djName: djName, djImage: arc.Roster.imageUrl }; })); res.json(mapped); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/public/apps', async (req, res) => {
    try {
        const slots = await AppSlot.findAll({ order: [['order', 'ASC']] });
        const now = new Date();
        const mapped = slots.map(s => {
            let status = s.status;
            if (s.autoCloseAt && new Date(s.autoCloseAt) < now) status = 'closed';
            return { id: s.id, roleName: s.roleName, roleType: s.roleType, description: s.description, formUrl: s.formUrl, isInternal: s.isInternal, status: status, deadline: s.deadline };
        });
        res.json(mapped);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/public/vrc-status', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        const groupId = process.env.VRC_GROUPID || "CLUBLC.9601";
        const groupStats = await getGroupStats(groupId);
        
        if (!settings || settings.forceOffline) {
            return res.json({ active: false, count: 0, capacity: 0, groupStats });
        }
        
        // AGGREGATE ALL ACTIVE INSTANCES
        const activeLogs = await InstanceLog.findAll({ where: { isActive: true } });
        let aggregateData = { active: false, count: 0, capacity: 0, groupStats };

        if (activeLogs.length > 0) {
            aggregateData.active = true;
            for (const log of activeLogs) {
                let vrcData = null;
                if (log.instanceUrl && log.instanceUrl.includes("worldId=")) {
                    vrcData = await getInstanceData(log.instanceUrl);
                } else {
                    // Fetch specifically for this instance ID from the group
                    const groupInstances = await getGroupInstanceData(groupId);
                    vrcData = groupInstances.find(i => i.location === log.instanceId);
                }
                
                if (vrcData && vrcData.active) {
                    aggregateData.count += vrcData.count;
                    aggregateData.capacity += vrcData.capacity;
                }
            }
        }
        
        res.json(aggregateData);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/public/events', async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const logs = await InstanceLog.findAll({
            where: { isEventSession: true },
            order: [['startTime', 'DESC']],
            limit: 100
        });

        // GROUP LOGS BY DAY (to treat multiple instances as one event)
        const groupedEvents = [];
        const dateMap = new Map();

        logs.forEach(log => {
            const dateKey = new Date(log.startTime).toISOString().split('T')[0];
            if (!dateMap.has(dateKey)) {
                const entry = {
                    worldName: log.worldName,
                    startTime: log.startTime,
                    peakCapacity: log.peakCapacity,
                    uniqueUsers: log.uniqueUsers,
                    totalDuration: log.totalDuration || 0,
                    isGrouped: false,
                    instances: [log] // Start with the first instance
                };
                dateMap.set(dateKey, entry);
                groupedEvents.push(entry);
            } else {
                const existing = dateMap.get(dateKey);
                // Aggregation logic for the same day
                existing.peakCapacity += log.peakCapacity;
                existing.uniqueUsers += log.uniqueUsers;
                existing.isGrouped = true;
                existing.instances.push(log); // Add this overflow to the list
                // Use the longest duration of the set
                if ((log.totalDuration || 0) > existing.totalDuration) {
                    existing.totalDuration = log.totalDuration;
                }
            }
        });

        res.json(groupedEvents.slice(0, 50));
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/public/gallery', async (req, res) => {
    try {
        const photos = await Gallery.findAll({ order: [['timestamp', 'DESC']] });
        
        // Fetch fresh member data for each uploader
        const mapped = await Promise.all(photos.map(async p => {
            let uploader = { name: "Unknown", avatar: "/cdn/logos/club/HeadOnly.png" };
            if (p.uploaderId) {
                const member = await getGuildMember(p.uploaderId);
                if (member) {
                    uploader.name = member.nickname;
                    uploader.avatar = member.avatar;
                }
            }
            return {
                id: p.id,
                imageUrl: p.imageUrl,
                thumbnailUrl: p.thumbnailUrl,
                uploaderName: uploader.name,
                uploaderAvatar: uploader.avatar,
                caption: p.caption,
                timestamp: p.timestamp
            };
        }));

        res.json(mapped);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/performer/:id', async (req, res) => {
    try {
        const performer = await Roster.findByPk(req.params.id);
        if (!performer || performer.isBanned) return res.status(404).render('error', {
            title: 'Lost the Scent!',
            message: "This performer's trail has gone cold. They might have left the club or moved on to new adventures!",
            icon: '🐾',
            buttons: [{ label: 'Back to the Den', link: '/', class: 'btn-primary' }]
        });
        let displayName = performer.name;
        if (performer.useDiscordName) { const member = await getGuildMember(performer.discordId); if (member) displayName = member.nickname; }
        const archives = await Archive.findAll({ where: { performerId: performer.discordId }, order: [['date', 'DESC']] });
        
        // Fix JSON parsing for Linux
        performer.links = safeParseJSON(performer.links);

        const settings = await Settings.findOne();
        const scheduleItem = await Schedule.findOne({ where: { performerId: performer.discordId }, include: [Roster] });
        let liveStatus = null; let activeSlot = null;
        if (settings && !settings.forceOffline && scheduleItem) {
            const now = new Date(); const start = new Date(settings.eventStartTime); const end = new Date(settings.eventEndTime);
            if (now >= start && now < end) {
                const times = scheduleItem.timeSlot.match(/(\d{1,2}):(\d{2})/g);
                if (times && times.length >= 2) {
                    const djStart = new Date(start); const [sh, sm] = times[0].split(':').map(Number); djStart.setUTCHours(sh, sm, 0, 0);
                    const djEnd = new Date(start); const [eh, em] = times[1].split(':').map(Number); djEnd.setUTCHours(eh, em, 0, 0);
                    if (sh < start.getUTCHours() - 6) { djStart.setDate(djStart.getDate() + 1); djEnd.setDate(djEnd.getDate() + 1); } else if (djEnd < djStart) { djEnd.setDate(djEnd.getDate() + 1); }
                    if (now >= djStart && now < djEnd) liveStatus = 'live'; else liveStatus = 'scheduled';
                } else liveStatus = 'scheduled';
                activeSlot = scheduleItem;
            } else if (now < start) {
                liveStatus = 'scheduled';
                activeSlot = scheduleItem;
            }
        }
        res.render('performer', { 
            performer, 
            displayName, 
            archives, 
            liveStatus, 
            activeSlot, 
            eventStartTime: settings ? settings.eventStartTime : null 
        });
    } catch (err) { res.status(500).send('Error'); }
});

app.get('/apply', (req, res) => { res.render('apply', { user: req.user || null }); });
app.get('/gallery', (req, res) => { res.render('gallery', { user: req.user || null }); });
app.get('/flyer', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'flyer.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.get('/login-error', (req, res) => { 
    res.render('error', {
        title: 'Team Access Required',
        message: "This area is reserved for members of the Club Critters team. If you're interested in joining us as a performer or staff member, please check out our application page!",
        icon: '🔒',
        buttons: [
            { label: 'Apply to Join', link: '/apply', class: 'btn-primary' },
            { label: 'Back to Home', link: '/', class: 'btn-secondary' }
        ]
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Lost the Scent!',
        message: "Even our best scouts can't find this page. It looks like you've wandered down the wrong burrow!",
        icon: '🐾',
        buttons: [
            { label: 'Back to the Den', link: '/', class: 'btn-primary' }
        ]
    });
});

async function start() {
    await initDB();
    app.listen(PORT, () => { 
        console.log(`\x1b[34m[SERVER] 🚀 Hub running on http://localhost:${PORT}\x1b[0m`); 
    });
}
start();
