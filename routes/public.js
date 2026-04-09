const express = require('express');
const router = express.Router();
const { Roster, Settings, Schedule, Archive, Gallery, AppSlot, ApplicationSubmission, InstanceLog, sequelize } = require('../db');
const { getGuildMember } = require('../bot');
const { getInstanceData, getGroupInstanceData, getGroupStats } = require('../utils/vrc-api');

// Helper to handle Sequelize/MySQL/MariaDB JSON parsing inconsistencies
const safeParseJSON = (data) => {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } 
        catch (e) { return {}; }
    }
    return data || {};
};

// --- PUBLIC PAGES ---

router.get('/', (req, res) => { res.render('index', { user: req.user || null, page: 'index' }); });
router.get('/archive', (req, res) => { res.render('archive', { user: req.user || null, page: 'archive' }); });
router.get('/events', (req, res) => { res.render('events', { user: req.user || null, page: 'events' }); });
router.get('/team', (req, res) => { res.render('team', { user: req.user || null, page: 'team' }); });
router.get('/gallery', (req, res) => { res.render('gallery', { user: req.user || null, page: 'gallery' }); });
router.get('/apply', (req, res) => { res.render('apply', { user: req.user || null, page: 'apply' }); });
router.get('/flyer', (req, res) => { res.render('flyer', { user: req.user || null, page: 'flyer' }); });

router.get('/performer/:id', async (req, res) => {
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
        const archives = await Archive.findAll({ where: { performerId: performer.discordId }, order: [['date', 'DESC'], ['createdAt', 'DESC']] });
        
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
            eventStartTime: settings ? settings.eventStartTime : null,
            page: 'performer'
        });
    } catch (err) { res.status(500).send('Error'); }
});

router.get('/login-error', (req, res) => { 
    res.render('error', {
        title: 'Team Access Required',
        message: "This area is reserved for members of the Club FuRN team. If you're interested in joining us as a performer or staff member, please check out our application page!",
        icon: '🔒',
        buttons: [
            { label: 'Apply to Join', link: '/apply', class: 'btn-primary' },
            { label: 'Back to Home', link: '/', class: 'btn-secondary' }
        ]
    });
});

// --- PUBLIC API ROUTES ---

router.get('/api/public/settings', async (req, res) => { try { const settings = await Settings.findOne(); res.json(settings); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
router.get('/api/public/schedule', async (req, res) => { 
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

router.get('/api/public/roster', async (req, res) => { 
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

router.get('/api/public/archives', async (req, res) => { 
    try { 
        const archives = await Archive.findAll({ include: [{ model: Roster, attributes: ['name', 'useDiscordName', 'imageUrl'] }], order: [['date', 'DESC'], ['createdAt', 'DESC']] }); 
        const mapped = await Promise.all(archives.map(async arc => { 
            let djName = arc.Roster.name; 
            if (arc.Roster.useDiscordName) { 
                const member = await getGuildMember(arc.performerId); 
                if (member) djName = member.nickname; 
            } 
            return { id: arc.id, performerId: arc.performerId, title: arc.title, date: arc.date, genre: arc.genre, link: arc.linkUrl, djName: djName, djImage: arc.Roster.imageUrl }; 
        })); 
        res.json(mapped); 
    } catch (err) { res.status(500).json({ error: 'Failed' }); } 
});

router.get('/api/public/apps', async (req, res) => {
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

router.get('/api/public/vrc-status', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        const groupId = process.env.VRC_GROUPID || "FURN.9601";
        const groupStats = await getGroupStats(groupId);
        
        if (!settings || settings.forceOffline) {
            return res.json({ active: false, count: 0, capacity: 0, groupStats });
        }
        
        const activeLogs = await InstanceLog.findAll({ where: { isActive: true } });
        let aggregateData = { active: false, count: 0, capacity: 0, groupStats };

        if (activeLogs.length > 0) {
            aggregateData.active = true;
            for (const log of activeLogs) {
                let vrcData = null;
                if (log.instanceUrl && log.instanceUrl.includes("worldId=")) {
                    vrcData = await getInstanceData(log.instanceUrl);
                } else {
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

router.get('/api/public/events', async (req, res) => {
    try {
        const logs = await InstanceLog.findAll({
            where: { isEventSession: true },
            order: [['startTime', 'DESC']],
            limit: 100
        });

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
                    instances: [log]
                };
                dateMap.set(dateKey, entry);
                groupedEvents.push(entry);
            } else {
                const existing = dateMap.get(dateKey);
                existing.peakCapacity += log.peakCapacity;
                existing.uniqueUsers += log.uniqueUsers;
                existing.isGrouped = true;
                existing.instances.push(log);
                if ((log.totalDuration || 0) > existing.totalDuration) {
                    existing.totalDuration = log.totalDuration;
                }
            }
        });

        res.json(groupedEvents.slice(0, 50));
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/api/public/gallery', async (req, res) => {
    try {
        const photos = await Gallery.findAll({ order: [['timestamp', 'DESC']] });
        
        const mapped = await Promise.all(photos.map(async p => {
            let uploader = { name: "Unknown", avatar: "/cdn/logos/club/Logo.png" };
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

router.post('/api/public/apps/submit', async (req, res) => {
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

        const { createApplicationTicket } = require('../utils/bot-utils');
        await createApplicationTicket(submission, slot);

        res.json({ success: true });
    } catch (err) {
        console.error("Submission Error:", err);
        res.status(500).json({ error: 'Failed to submit application.' });
    }
});

module.exports = router;
