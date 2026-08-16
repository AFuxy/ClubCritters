const express = require('express');
const router = express.Router();
const { Roster, Settings, Schedule, Archive, Gallery, AppSlot, ApplicationSubmission, InstanceLog, Partner, PartnerEvent, sequelize } = require('../db');
const { getGuildMember } = require('../bot');
const { getInstanceData, getGroupInstanceData, getGroupStats, getUserInfo, getVrcStatus } = require('../utils/vrc-api');
const { parseGenres, getParentCategory } = require('../utils/genre-taxonomy');
const { Op } = require('sequelize');

// Helper to handle Sequelize/MySQL/MariaDB JSON parsing inconsistencies
const safeParseJSON = (data) => {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } 
        catch (e) { return {}; }
    }
    return data || {};
};

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Helper to verify Cloudflare Turnstile token
const verifyTurnstile = async (token) => {
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) {
        // Fallback: if keys are not set up, bypass verification
        return true;
    }
    if (!token) return false;

    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`
        });
        const outcome = await response.json();
        return !!outcome.success;
    } catch (e) {
        console.error("[TURNSTILE] Verification failed:", e);
        return false;
    }
};

// --- PUBLIC PAGES ---

router.get('/', (req, res) => { res.render('index', { user: req.user || null, page: 'index' }); });
router.get('/archive', (req, res) => { res.render('archive', { user: req.user || null, page: 'archive' }); });
router.get('/events', (req, res) => { res.render('events', { user: req.user || null, page: 'events' }); });
router.get('/djs', (req, res) => { res.render('djs', { user: req.user || null, page: 'djs' }); });
router.get('/performers', (req, res) => { res.redirect('/djs'); });
router.get('/team', (req, res) => { res.render('team', { user: req.user || null, page: 'team' }); });
router.get('/vips', (req, res) => { res.render('vips', { user: req.user || null, page: 'vips' }); });
router.get('/vip', (req, res) => { res.redirect('/vips'); });
router.get('/partner-with-us', (req, res) => { res.render('partner-pitch', { user: req.user || null, page: 'partner-with-us' }); });
router.get('/partners', async (req, res) => {
    try {
        const partners = await Partner.findAll({
            where: { isApproved: true },
            order: [['order', 'ASC'], ['name', 'ASC']]
        });
        res.render('partners', { user: req.user || null, page: 'partners', partners });
    } catch (err) {
        console.error("Error loading partners page:", err);
        res.status(500).send("Error loading partners page");
    }
});
router.get('/partner/:slug', async (req, res) => {
    try {
        const partner = await Partner.findOne({
            where: { slug: req.params.slug, isApproved: true },
            include: [
                { model: Roster, as: 'owner' },
                { model: PartnerEvent, as: 'events', where: { isApproved: true }, required: false }
            ]
        });
        if (!partner) {
            return res.status(404).render('error', {
                title: 'Partner Not Found',
                message: "We couldn't find this partnered club. They might have updated their link or moved to a new domain!",
                icon: '🤝',
                buttons: [{ label: 'Back to Partners', link: '/partners', class: 'btn-primary' }]
            });
        }
        
        // Sort events: Live first -> Upcoming (startTime ASC) -> Ended (endTime DESC)
        if (partner.events) {
            const now = new Date();
            partner.events.sort((a, b) => {
                const aStart = new Date(a.startTime);
                const aEnd = new Date(a.endTime);
                const bStart = new Date(b.startTime);
                const bEnd = new Date(b.endTime);

                const aLive = now >= aStart && now < aEnd;
                const bLive = now >= bStart && now < bEnd;
                if (aLive && !bLive) return -1;
                if (!aLive && bLive) return 1;

                const aEnded = now >= aEnd;
                const bEnded = now >= bEnd;
                if (!aEnded && bEnded) return -1;
                if (aEnded && !bEnded) return 1;

                if (aEnded && bEnded) return bEnd - aEnd; // past events newest first
                return aStart - bStart; // upcoming events soonest first
            });
        }

        res.render('partner', { user: req.user || null, page: 'partner', partner });
    } catch (err) {
        console.error("Error loading partner detail page:", err);
        res.status(500).send("Error loading partner page");
    }
});

// API endpoint to fetch featured partner events for home page (Live and upcoming events)
router.get('/api/public/featured-partner-event', async (req, res) => {
    try {
        const now = new Date();

        const activeEvents = await PartnerEvent.findAll({
            where: {
                endTime: { [Op.gt]: now }
            },
            include: [{
                model: Partner,
                as: 'partner'
            }],
            order: [['startTime', 'ASC']],
            limit: 10
        });

        if (!activeEvents || activeEvents.length === 0) {
            return res.json({ hasFeatured: false });
        }

        const eventsList = activeEvents.map(evt => {
            const isLive = now >= new Date(evt.startTime) && now < new Date(evt.endTime);
            return {
                status: isLive ? 'live' : 'upcoming',
                event: evt,
                partner: evt.partner
            };
        });

        res.json({
            hasFeatured: true,
            count: eventsList.length,
            events: eventsList
        });
    } catch (err) {
        console.error("Failed to fetch featured partner events:", err);
        res.status(500).json({ error: 'Failed' });
    }
});
router.get('/gallery', (req, res) => { res.render('gallery', { user: req.user || null, page: 'gallery' }); });
router.get('/apply', (req, res) => { res.render('apply', { user: req.user || null, page: 'apply', siteKey: process.env.TURNSTILE_SITE_KEY || null, slotId: req.query.slotId || null }); });
router.get('/rules', (req, res) => { res.render('rules', { user: req.user || null, page: 'rules' }); });
router.get('/discord', (req, res) => {
    if (req.user) {
        // Authenticated users bypass verification completely
        const inviteLink = process.env.DISCORD_INVITE_URL || 'https://discord.gg/hbtDmeC6gG';
        return res.redirect(inviteLink);
    }
    res.render('join', { user: null, page: 'join', siteKey: process.env.TURNSTILE_SITE_KEY || null });
});
router.get('/flyer', (req, res) => { res.render('flyer', { user: req.user || null, page: 'flyer' }); });
router.get('/overlay', (req, res) => { res.render('overlay', { layout: false }); });

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
        archives.forEach(arc => {
            arc.parsedGenres = parseGenres(arc.genre);
        });
        
        // Count how many events this performer has played in (using InstanceLogPerformers many-to-many relationship)
        const { sequelize } = require('../db');
        const eventCount = await sequelize.model('InstanceLogPerformers').count({
            where: { performerId: performer.discordId }
        }).catch(() => 0);

        performer.links = safeParseJSON(performer.links);

        const settings = await Settings.findOne();
        
        // Find if they are in the current schedule (either as primary or in a B2B)
        const { Op } = require('sequelize');
        const scheduleItem = await Schedule.findOne({ 
            include: [
                { model: Roster },
                { model: Roster, as: 'performers', where: { discordId: performer.discordId } }
            ]
        }).catch(() => {
            // Fallback if the association where clause fails to find anything
            return Schedule.findOne({ where: { performerId: performer.discordId }, include: [Roster] });
        });

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
            eventCount,
            liveStatus, 
            activeSlot, 
            eventStartTime: settings ? settings.eventStartTime : null,
            user: req.user || null,
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

router.get('/api/public/vrc-performer-status/:id', async (req, res) => {
    try {
        const performer = await Roster.findByPk(req.params.id);
        if (!performer || !performer.vrcUserId) {
            return res.json({ linked: false });
        }

        const vrcStatus = getVrcStatus();
        if (vrcStatus !== 'Connected') {
            return res.json({ linked: true, apiOffline: true });
        }

        const vrcUser = await getUserInfo(performer.vrcUserId);
        if (!vrcUser) {
            return res.json({ linked: true, error: 'User not found' });
        }

        res.json({
            linked: true,
            displayName: vrcUser.displayName,
            status: vrcUser.status || 'offline',
            statusDescription: vrcUser.statusDescription || ""
        });
    } catch (err) {
        console.error("Failed to fetch performer VRC status:", err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.get('/api/public/schedule', async (req, res) => { 
    try { 
        const schedule = await Schedule.findAll({ 
            include: [
                { model: Roster, attributes: ['name', 'useDiscordName', 'colorStyle', 'imageUrl', 'links', 'discordId'] },
                { model: Roster, as: 'performers', attributes: ['name', 'useDiscordName', 'colorStyle', 'imageUrl', 'links', 'discordId'] }
            ], 
            order: [['createdAt', 'ASC']] 
        }); 
        const mapped = await Promise.all(schedule.map(async item => { 
            // Fallback for single performer (legacy or primary)
            let primaryPerformer = null;
            if (item.Roster) {
                let displayName = item.Roster.name; 
                if (item.Roster.useDiscordName) { 
                    const member = await getGuildMember(item.performerId); 
                    if (member) displayName = member.nickname; 
                } 
                primaryPerformer = { 
                    discordId: item.Roster.discordId, 
                    name: displayName, 
                    color: item.Roster.colorStyle, 
                    image: item.Roster.imageUrl, 
                    links: safeParseJSON(item.Roster.links) 
                };
            }

            // Map multiple performers
            const performers = await Promise.all((item.performers || []).map(async p => {
                let pName = p.name;
                if (p.useDiscordName) {
                    const member = await getGuildMember(p.discordId);
                    if (member) pName = member.nickname;
                }
                return {
                    discordId: p.discordId,
                    name: pName,
                    color: p.colorStyle,
                    image: p.imageUrl,
                    links: safeParseJSON(p.links)
                };
            }));

            return { 
                id: item.id, 
                timeSlot: item.timeSlot, 
                genre: item.genre,
                b2bName: item.b2bName,
                b2bLogo: item.b2bLogo,
                performer: primaryPerformer || (performers.length > 0 ? performers[0] : null),
                performers: performers
            }; 
        })); 
        res.json(mapped); 
    } catch (err) { 
        console.error("Public Schedule Error:", err);
        res.status(500).json({ error: 'Failed' }); 
    } 
});

router.get('/api/public/roster', async (req, res) => { 
    try { 
        const { Op } = require('sequelize');
        const roster = await Roster.findAll({ 
            where: { 
                isBanned: false,
                type: { [Op.or]: [{ [Op.ne]: 'Partner' }, { [Op.eq]: null }] }
            },
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
            const parsedGenres = parseGenres(arc.genre);
            return { 
                id: arc.id, 
                performerId: arc.performerId, 
                title: arc.title, 
                date: arc.date, 
                genre: parsedGenres.join(' / '), 
                genres: parsedGenres,
                link: arc.linkUrl, 
                djName: djName, 
                djImage: arc.Roster.imageUrl 
            }; 
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
            include: [{ model: Roster, as: 'performers', attributes: ['discordId', 'name', 'colorStyle', 'imageUrl', 'links'] }],
            order: [['startTime', 'DESC']],
            limit: 100
        });

        const groupedEvents = [];
        const dateMap = new Map();

        logs.forEach(log => {
            const dateKey = new Date(log.startTime).toISOString().split('T')[0];
            
            // Map the performers to clean JSON objects
            const performersList = (log.performers || []).map(p => ({
                discordId: p.discordId,
                name: p.name,
                colorStyle: p.colorStyle,
                imageUrl: p.imageUrl,
                links: safeParseJSON(p.links)
            }));

            if (!dateMap.has(dateKey)) {
                const entry = {
                    worldName: log.worldName,
                    startTime: log.startTime,
                    peakCapacity: log.peakCapacity,
                    uniqueUsers: log.uniqueUsers,
                    totalDuration: log.totalDuration || 0,
                    isGrouped: false,
                    instances: [log],
                    performers: performersList
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
                // Merge unique performers who played in any instance on this date
                performersList.forEach(p => {
                    if (!existing.performers.some(ep => ep.discordId === p.discordId)) {
                        existing.performers.push(p);
                    }
                });
            }
        });

        res.json(groupedEvents.slice(0, 50));
    } catch (err) { 
        console.error("Failed to load public events:", err);
        res.status(500).json({ error: 'Failed' }); 
    }
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
        if (!req.user) {
            return res.status(401).json({ error: 'You must be logged in with Discord to submit an application.' });
        }

        const { slotId, answers } = req.body;

        const slot = await AppSlot.findByPk(slotId);
        if (!slot || slot.status !== 'open') return res.status(400).json({ error: 'Slot is closed or invalid.' });

        const discordId = req.user.discordId;
        const discordTag = req.user.discordData?.username || req.user.name || "Unknown";

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

router.post('/api/public/verify-discord', async (req, res) => {
    try {
        const { token } = req.body;
        const isValid = await verifyTurnstile(token);
        if (!isValid) {
            return res.status(400).json({ success: false, error: 'Invalid verification token' });
        }

        const inviteLink = process.env.DISCORD_INVITE_URL || 'https://discord.gg/hbtDmeC6gG';
        res.json({ success: true, inviteLink });
    } catch (err) {
        console.error("Discord verification error:", err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/api/public/overlay-data', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        const schedule = await Schedule.findAll({
            include: [
                { model: Roster, attributes: ['name', 'useDiscordName', 'colorStyle', 'imageUrl', 'links', 'discordId'] },
                { model: Roster, as: 'performers', attributes: ['name', 'useDiscordName', 'colorStyle', 'imageUrl', 'links', 'discordId'] }
            ],
            order: [['createdAt', 'ASC']]
        });

        const now = new Date();
        const start = settings ? new Date(settings.eventStartTime) : null;
        let end = settings ? new Date(settings.eventEndTime) : null;

        // Parse start/end for all schedule items chronologically
        const parsedSchedule = schedule.map(item => {
            const times = item.timeSlot.match(/(\d{1,2}):(\d{2})/g);
            let djStart = null;
            let djEnd = null;
            if (times && times.length >= 2 && start) {
                djStart = new Date(start); const [sh, sm] = times[0].split(':').map(Number); djStart.setUTCHours(sh, sm, 0, 0);
                djEnd = new Date(start); const [eh, em] = times[1].split(':').map(Number); djEnd.setUTCHours(eh, em, 0, 0);
                if (sh < start.getUTCHours() - 6) { djStart.setDate(djStart.getDate() + 1); djEnd.setDate(djEnd.getDate() + 1); } 
                else if (djEnd < djStart) { djEnd.setDate(djEnd.getDate() + 1); }
            }
            return { item, djStart, djEnd };
        }).filter(x => x.djStart !== null);

        // Sort chronologically by start time
        parsedSchedule.sort((a, b) => a.djStart - b.djStart);

        // Fail-safe: Extend eventEndTime to match the end of the last set in the schedule if it runs late
        if (parsedSchedule.length > 0) {
            const maxDjEnd = new Date(Math.max(...parsedSchedule.map(x => x.djEnd)));
            if (!end || maxDjEnd > end) {
                end = maxDjEnd;
            }
        }

        let currentDJ = null;
        let currentDJStart = null;
        let currentDJEnd = null;
        let isTransition = false;
        let upNext = [];

        if (settings && !settings.forceOffline && start && end && now >= start && now < end) {
            // Find current active DJ chronologically
            for (let i = 0; i < parsedSchedule.length; i++) {
                const { item, djStart, djEnd } = parsedSchedule[i];
                if (now >= djStart && now < djEnd) {
                    currentDJ = item;
                    currentDJStart = djStart;
                    currentDJEnd = djEnd;
                    // Get next 2 sets chronologically
                    upNext = parsedSchedule.slice(i + 1, i + 3).map(x => x.item);
                    break;
                }
            }

            // If we are during the event bounds but no DJ is currently live, we are in a set break/transition!
            if (!currentDJ) {
                // Find the first upcoming set chronologically
                for (let i = 0; i < parsedSchedule.length; i++) {
                    const { item, djStart, djEnd } = parsedSchedule[i];
                    if (now < djStart) {
                        currentDJ = item;
                        currentDJStart = djStart;
                        currentDJEnd = djStart; // Set end time target to the start of the upcoming set!
                        isTransition = true;
                        // Include this upcoming set in the Up Next card as the first item, plus the next one
                        upNext = parsedSchedule.slice(i, i + 2).map(x => x.item);
                        break;
                    }
                }
            }
        } else if (settings && start && now < start) {
            // Pre-event: show first 2 as upNext chronologically
            upNext = parsedSchedule.slice(0, 2).map(x => x.item);
        }

        const mapPerformer = async (item, isCurrent = false) => {
            if (!item) return null;
            let performers = await Promise.all((item.performers || []).map(async p => {
                let pName = p.name;
                if (p.useDiscordName) {
                    const member = await getGuildMember(p.discordId);
                    if (member) pName = member.nickname;
                }
                return { name: pName, color: p.colorStyle, image: p.imageUrl, links: safeParseJSON(p.links) };
            }));

            return {
                id: item.id,
                timeSlot: item.timeSlot,
                startTime: isCurrent && currentDJStart ? currentDJStart.toISOString() : null,
                endTime: isCurrent && currentDJEnd ? currentDJEnd.toISOString() : null,
                genre: item.genre,
                b2bName: item.b2bName,
                b2bLogo: item.b2bLogo,
                performers: performers
            };
        };

        let mappedCurrent = await mapPerformer(currentDJ, true);
        let mappedNext = await Promise.all(upNext.map(item => mapPerformer(item, false)));

        // VRC Status
        const groupId = process.env.VRC_GROUPID || "FURN.9601";
        const activeLogs = await InstanceLog.findAll({ where: { isActive: true } });
        let vrcStatus = { count: 0, capacity: 0, active: activeLogs.length > 0 };

        if (vrcStatus.active) {
            for (const log of activeLogs) {
                let vrcData = null;
                if (log.instanceUrl && log.instanceUrl.includes("worldId=")) {
                    vrcData = await getInstanceData(log.instanceUrl);
                } else {
                    const groupInstances = await getGroupInstanceData(groupId);
                    vrcData = groupInstances.find(i => i.location === log.instanceId);
                }
                if (vrcData && vrcData.active) {
                    vrcStatus.count += vrcData.count;
                    vrcStatus.capacity += vrcData.capacity;
                }
            }
        }

        // Check for active Partner Event live stream
        let activePartnerStream = null;
        const livePartnerEvent = await PartnerEvent.findOne({
            where: {
                isApproved: true,
                isStreamedByClubFurn: true,
                startTime: { [Op.lte]: now },
                endTime: { [Op.gt]: now }
            },
            include: [{ model: Partner, as: 'partner' }]
        });

        if (livePartnerEvent) {
            let streamUrlsObj = {};
            if (livePartnerEvent.streamUrls) {
                try { streamUrlsObj = typeof livePartnerEvent.streamUrls === 'string' ? JSON.parse(livePartnerEvent.streamUrls) : livePartnerEvent.streamUrls; } catch(e) {}
            }
            
            const partnerAccent = livePartnerEvent.partner ? (livePartnerEvent.partner.accentColor || '#f2008d') : '#f2008d';
            const partnerLogo = livePartnerEvent.partner ? livePartnerEvent.partner.iconUrl : '/cdn/logos/club/Logo.png';
            const partnerName = livePartnerEvent.partner ? livePartnerEvent.partner.name : 'Partner Club';

            activePartnerStream = {
                id: livePartnerEvent.id,
                eventTitle: livePartnerEvent.title,
                partnerName: partnerName,
                partnerLogo: partnerLogo,
                accentColor: partnerAccent,
                streamUrls: streamUrlsObj
            };

            // If main VRC status is not active, attempt to fetch population directly from the partner event's VRChat instance URL
            if ((!vrcStatus.active || vrcStatus.count === 0) && livePartnerEvent.eventUrl && livePartnerEvent.eventUrl.includes('worldId=')) {
                const partnerVrc = await getInstanceData(livePartnerEvent.eventUrl);
                if (partnerVrc && partnerVrc.active) {
                    vrcStatus = {
                        count: partnerVrc.count,
                        capacity: partnerVrc.capacity,
                        active: true
                    };
                }
            }

            // If main Club FuRN schedule is not active, populate currentDJ & upNext from the Partner Event's lineup!
            if (!mappedCurrent) {
                let partnerLineup = [];
                if (livePartnerEvent.lineup) {
                    try { partnerLineup = typeof livePartnerEvent.lineup === 'string' ? JSON.parse(livePartnerEvent.lineup) : livePartnerEvent.lineup; } catch(e) {}
                }

                if (Array.isArray(partnerLineup) && partnerLineup.length > 0) {
                    const evtDateStr = new Date(livePartnerEvent.startTime).toISOString().split('T')[0];

                    const parsedPartnerSlots = partnerLineup.map((slot, idx) => {
                        let slotStart = null, slotEnd = null;
                        if (slot.startUtc) slotStart = new Date(slot.startUtc);
                        else if (slot.start) slotStart = new Date(`${evtDateStr}T${slot.start}:00Z`);
                        
                        if (slot.endUtc) slotEnd = new Date(slot.endUtc);
                        else if (slot.end) slotEnd = new Date(`${evtDateStr}T${slot.end}:00Z`);

                        return { slot, idx, slotStart, slotEnd };
                    });

                    let currentPartnerSlot = null;
                    let nextPartnerSlots = [];

                    for (let i = 0; i < parsedPartnerSlots.length; i++) {
                        const { slot, slotStart, slotEnd } = parsedPartnerSlots[i];
                        if (slotStart && slotEnd && now >= slotStart && now < slotEnd) {
                            currentPartnerSlot = parsedPartnerSlots[i];
                            nextPartnerSlots = parsedPartnerSlots.slice(i + 1, i + 3);
                            break;
                        }
                    }

                    if (!currentPartnerSlot) {
                        for (let i = 0; i < parsedPartnerSlots.length; i++) {
                            const { slotStart } = parsedPartnerSlots[i];
                            if (slotStart && now < slotStart) {
                                currentPartnerSlot = parsedPartnerSlots[i];
                                isTransition = true;
                                nextPartnerSlots = parsedPartnerSlots.slice(i, i + 2);
                                break;
                            }
                        }
                    }

                    if (currentPartnerSlot) {
                        const { slot, slotStart, slotEnd } = currentPartnerSlot;
                        mappedCurrent = {
                            id: `partner-dj-${slot.idx}`,
                            timeSlot: slot.start && slot.end ? `${slot.start} - ${slot.end}` : '',
                            startTime: slotStart ? slotStart.toISOString() : null,
                            endTime: slotEnd ? slotEnd.toISOString() : null,
                            genre: slot.genre || 'Electronic',
                            performers: [{
                                name: slot.djName || slot.name || partnerName,
                                image: partnerLogo,
                                color: partnerAccent
                            }]
                        };

                        mappedNext = nextPartnerSlots.map(ps => ({
                            id: `partner-dj-${ps.idx}`,
                            timeSlot: ps.slot.start && ps.slot.end ? `${ps.slot.start} - ${ps.slot.end}` : '',
                            genre: ps.slot.genre || 'Electronic',
                            performers: [{
                                name: ps.slot.djName || ps.slot.name || partnerName,
                                image: partnerLogo,
                                color: partnerAccent
                            }]
                        }));
                    }
                }

                // Fallback if no specific slots match
                if (!mappedCurrent) {
                    mappedCurrent = {
                        id: `partner-evt-${livePartnerEvent.id}`,
                        genre: livePartnerEvent.title || 'Partner Showcase',
                        startTime: new Date(livePartnerEvent.startTime).toISOString(),
                        endTime: new Date(livePartnerEvent.endTime).toISOString(),
                        performers: [{
                            name: partnerName,
                            image: partnerLogo,
                            color: partnerAccent
                        }]
                    };
                }
            }
        }

        res.json({
            currentDJ: mappedCurrent,
            upNext: mappedNext,
            vrcStatus,
            isTransition,
            eventTitle: settings ? settings.eventTitle : "Club FuRN",
            activePartnerStream
        });
    } catch (err) {
        console.error("Overlay Data Error:", err);
        res.status(500).json({ error: 'Failed' });
    }
});

module.exports = router;
