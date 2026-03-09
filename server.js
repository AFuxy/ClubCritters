const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { sequelize, initDB, Roster, Settings, Schedule, Archive, Stats, AppSlot } = require('./db');
const { getGuildMember, updateBotStatus } = require('./bot');
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

// Passport Serialization
passport.serializeUser((user, done) => done(null, user.discordId));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await Roster.findByPk(id);
        if (user) {
            const guildMember = await getGuildMember(user.discordId);
            if (guildMember) {
                user.discordData = guildMember;
            }
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
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await Roster.findByPk(profile.id);
        if (!user) {
            return done(null, false, { message: 'You are not on the authorized roster.' });
        }
        const guildMember = await getGuildMember(profile.id);
        if (!guildMember) {
            return done(null, false, { message: 'You must be in the Club Critters Discord to login.' });
        }
        return done(null, user);
    } catch (err) {
        return done(err, null);
    }
}));

// --- MIDDLEWARE ---

const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
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
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));
app.use(passport.initialize());
app.use(passport.session());

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/login-error' }), (req, res) => {
    res.redirect('/panel');
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

app.post('/api/settings/update', isStaff, async (req, res) => {
    try {
        const { eventStartTime, eventEndTime, forceOffline, instanceUrl } = req.body;
        const userType = (req.user?.type || "").toLowerCase();
        const isFullAdmin = userType.includes('host') || userType.includes('owner');

        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});

        const updateData = { instanceUrl };
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
        const { title, type } = req.body;
        await Roster.update({ title, type }, { where: { discordId: req.params.id } });
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
        const { roleName, description, formUrl, status, deadline, autoCloseAt } = req.body;
        await AppSlot.create({ roleName, description, formUrl, status, deadline, autoCloseAt });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.patch('/api/apps/:id', isHostOrOwner, async (req, res) => {
    try {
        await AppSlot.update(req.body, { where: { id: req.params.id } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
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

app.post('/api/archives/add', isAuthenticated, async (req, res) => {
    try {
        const { title, date, genre, linkUrl } = req.body;
        await Archive.create({ performerId: req.user.discordId, title, date, genre, linkUrl });
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

        // 5. Application Interest
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
            appInterest: appInterest.map(a => ({ label: a.get('label'), count: a.get('count') }))
        });
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
app.get('/api/public/schedule', async (req, res) => { try { const schedule = await Schedule.findAll({ include: [{ model: Roster, attributes: ['name', 'useDiscordName', 'colorStyle', 'imageUrl', 'links', 'discordId'] }], order: [['createdAt', 'ASC']] }); const mapped = await Promise.all(schedule.map(async item => { let displayName = item.Roster.name; if (item.Roster.useDiscordName) { const member = await getGuildMember(item.performerId); if (member) displayName = member.nickname; } return { id: item.id, timeSlot: item.timeSlot, genre: item.genre, performer: { discordId: item.Roster.discordId, name: displayName, color: item.Roster.colorStyle, image: item.Roster.imageUrl, links: item.Roster.links } }; })); res.json(mapped); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/public/roster', async (req, res) => { try { const roster = await Roster.findAll({ order: [['name', 'ASC']] }); const mapped = await Promise.all(roster.map(async user => { let displayName = user.name; if (user.useDiscordName) { const member = await getGuildMember(user.discordId); if (member) displayName = member.nickname; } return { discordId: user.discordId, name: displayName, type: user.type, title: user.title, imageUrl: user.imageUrl, colorStyle: user.colorStyle, bio: user.bio, links: user.links }; })); res.json(mapped); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/public/archives', async (req, res) => { try { const archives = await Archive.findAll({ include: [{ model: Roster, attributes: ['name', 'useDiscordName', 'imageUrl'] }], order: [['date', 'DESC']] }); const mapped = await Promise.all(archives.map(async arc => { let djName = arc.Roster.name; if (arc.Roster.useDiscordName) { const member = await getGuildMember(arc.performerId); if (member) djName = member.nickname; } return { id: arc.id, performerId: arc.performerId, title: arc.title, date: arc.date, genre: arc.genre, link: arc.linkUrl, djName: djName, djImage: arc.Roster.imageUrl }; })); res.json(mapped); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/public/apps', async (req, res) => {
    try {
        const slots = await AppSlot.findAll({ order: [['order', 'ASC']] });
        const now = new Date();
        const mapped = slots.map(s => {
            let status = s.status;
            if (s.autoCloseAt && new Date(s.autoCloseAt) < now) status = 'closed';
            return { id: s.id, roleName: s.roleName, description: s.description, formUrl: s.formUrl, status: status, deadline: s.deadline };
        });
        res.json(mapped);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/performer/:id', async (req, res) => {
    try {
        const performer = await Roster.findByPk(req.params.id);
        if (!performer) return res.status(404).send('Performer not found');
        let displayName = performer.name;
        if (performer.useDiscordName) { const member = await getGuildMember(performer.discordId); if (member) displayName = member.nickname; }
        const archives = await Archive.findAll({ where: { performerId: performer.discordId }, order: [['date', 'DESC']] });
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
            } else if (now < start) liveStatus = 'scheduled';
            activeSlot = scheduleItem;
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

app.get('/apply', (req, res) => { res.render('apply'); });
app.get('/flyer', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'flyer.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/login-error', (req, res) => { res.send('<h1>Login Error</h1><p>You might not be on the authorized roster, or something went wrong.</p><a href="/">Back Home</a>'); });

async function start() {
    await initDB();
    app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });
}
start();
