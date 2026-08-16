const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { sequelize, Roster, Settings, Schedule, Archive, Stats, AppSlot, ApplicationSubmission, InstanceLog, InstanceLogPerformers, Partner, PartnerEvent } = require('../db');
const { getGuildMember, getDiscordStatus } = require('../bot');
const { getInstanceData, verifyVRC, getVrcStatus, getUserInfo, getGroupMember, getGroupRoles, addGroupMemberRole, removeGroupMemberRole } = require('../utils/vrc-api');
const { isStaff, isHostOrOwner, isAuthenticated, isOwner, isPartnerOrStaff, getUserRoles, hasRole, hasAnyRole } = require('../middleware/auth');
const { parseGenres, POPULAR_GENRES } = require('../utils/genre-taxonomy');

// Multer Setup (Memory Storage for Sharp processing)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB Limit
});

// Middleware wrapper for Multer error handling
const handleUpload = (fieldName) => {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(400).json({ error: 'File is too large! Maximum allowed size is 10MB.' });
                    }
                    return res.status(400).json({ error: `Upload error: ${err.message}` });
                }
                return res.status(400).json({ error: err.message || 'Failed to upload file' });
            }
            next();
        });
    };
};

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
            name: 'Partner',
            discordEnvId: process.env.DISCORD_ROLE_PARTNER,
            discordFallbackName: 'partner',
            vrcEnvId: process.env.VRC_ROLE_PARTNER,
            vrcFallbackName: 'partner'
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
router.post('/profile/upload-avatar', isAuthenticated, handleUpload('avatar'), async (req, res) => {
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

// Helper function to convert club name to URL-safe slug
function slugify(text) {
    if (!text) return "partner-club";
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

// --- PARTNER API ENDPOINTS ---

// 1. Partner Profile Update (Owner or Staff)
function getPartnerCoOwners(partner) {
    if (!partner || !partner.coOwnerDiscordIds) return [];
    if (Array.isArray(partner.coOwnerDiscordIds)) return partner.coOwnerDiscordIds;
    try {
        const parsed = JSON.parse(partner.coOwnerDiscordIds);
        if (Array.isArray(parsed)) return parsed;
    } catch(e) {}
    return String(partner.coOwnerDiscordIds).split(/\s*,\s*/).filter(Boolean);
}

function canManagePartner(partner, user) {
    if (!partner || !user) return false;
    const userType = (user.type || "").toLowerCase();
    const isStaffUser = ['host', 'staff', 'owner'].some(r => userType.includes(r));
    if (isStaffUser) return true;
    if (partner.ownerDiscordId === user.discordId) return true;
    const coOwners = getPartnerCoOwners(partner);
    return coOwners.includes(user.discordId);
}

function isPrimaryPartnerOwner(partner, user) {
    if (!partner || !user) return false;
    const userType = (user.type || "").toLowerCase();
    const isStaffUser = ['host', 'staff', 'owner'].some(r => userType.includes(r));
    if (isStaffUser) return true;
    return partner.ownerDiscordId === user.discordId;
}

// 1. Update Partner Club Info
router.post('/partner/update', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const { id, name, description, customSlug, accentColor, vrcGroupUrl, discordInvite, websiteUrl } = req.body;
        const { Op } = require('sequelize');
        let partner = null;
        
        const userType = (req.user.type || "").toLowerCase();
        const isStaffUser = ['host', 'staff', 'owner'].some(r => userType.includes(r));

        if (id) {
            partner = await Partner.findByPk(id);
        } else {
            partner = await Partner.findOne({
                where: {
                    [Op.or]: [
                        { ownerDiscordId: req.user.discordId },
                        { coOwnerDiscordIds: { [Op.like]: `%"${req.user.discordId}"%` } },
                        { coOwnerDiscordIds: { [Op.like]: `%${req.user.discordId}%` } }
                    ]
                }
            });
        }

        if (!partner && !isStaffUser) {
            partner = await Partner.create({
                ownerDiscordId: req.user.discordId,
                name: name || `${req.user.name}'s Club`,
                slug: slugify(customSlug || name || req.user.name || "partner"),
                coOwnerDiscordIds: '[]'
            });
        }

        if (!partner) return res.status(404).json({ error: 'Partner profile not found' });
        if (!canManagePartner(partner, req.user)) {
            return res.status(403).json({ error: 'Not authorized to edit this partner club' });
        }

        // Handle custom slug
        let finalSlug = partner.slug;
        if (customSlug && customSlug.trim()) {
            const sanitized = slugify(customSlug.trim());
            if (sanitized.length < 2) {
                return res.status(400).json({ error: 'Custom URL slug must be at least 2 characters long (letters, numbers, and hyphens).' });
            }
            if (sanitized !== partner.slug) {
                const existing = await Partner.findOne({ where: { slug: sanitized } });
                if (existing && existing.id !== partner.id) {
                    return res.status(400).json({ error: `The URL slug "/partner/${sanitized}" is already taken by another club. Please choose a different slug!` });
                }
                finalSlug = sanitized;
            }
        } else if (name && !partner.slug) {
            finalSlug = slugify(name);
        }

        // Validate accent color format
        let validColor = partner.accentColor || '#f2008d';
        if (accentColor && /^#([0-9a-fA-F]{3}){1,2}$/.test(accentColor.trim())) {
            validColor = accentColor.trim();
        }

        await partner.update({
            name: name || partner.name,
            slug: finalSlug,
            description: description !== undefined ? description : partner.description,
            accentColor: validColor,
            vrcGroupUrl: vrcGroupUrl !== undefined ? vrcGroupUrl : partner.vrcGroupUrl,
            discordInvite: discordInvite !== undefined ? discordInvite : partner.discordInvite,
            websiteUrl: websiteUrl !== undefined ? websiteUrl : partner.websiteUrl
        });

        res.json({ success: true, partner });
    } catch (err) {
        console.error("[PARTNER API] Update Error:", err);
        res.status(500).json({ error: 'Failed to update partner profile' });
    }
});

// Co-Owners Management Endpoints
router.post('/partner/:id/co-owners/add', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const partner = await Partner.findByPk(req.params.id);
        if (!partner) return res.status(404).json({ error: 'Partner club not found' });

        if (!isPrimaryPartnerOwner(partner, req.user)) {
            return res.status(403).json({ error: 'Only the Primary Owner or Staff can add co-owners.' });
        }

        const { targetDiscordId } = req.body;
        if (!targetDiscordId || !targetDiscordId.trim()) {
            return res.status(400).json({ error: 'Discord ID or user is required.' });
        }
        const discordId = targetDiscordId.trim();

        if (discordId === partner.ownerDiscordId) {
            return res.status(400).json({ error: 'User is already the Primary Owner of this club.' });
        }

        let coOwners = getPartnerCoOwners(partner);
        if (coOwners.includes(discordId)) {
            return res.status(400).json({ error: 'User is already a Co-Owner of this club.' });
        }

        // Find or create in Roster
        let targetRoster = await Roster.findByPk(discordId);
        if (!targetRoster) {
            const guildMember = await getGuildMember(discordId).catch(() => null);
            const initialName = guildMember ? (guildMember.nickname || guildMember.user.username) : `User ${discordId.slice(-4)}`;
            const initialAvatar = (guildMember && guildMember.user) ? guildMember.user.displayAvatarURL({ extension: 'png', size: 512 }) : '';

            targetRoster = await Roster.create({
                discordId: discordId,
                name: initialName,
                type: JSON.stringify(['Partner']),
                title: 'Partner Co-Owner',
                imageUrl: initialAvatar,
                links: {}
            });
        } else {
            const currentRoles = getUserRoles(targetRoster);
            if (!currentRoles.includes('partner')) {
                const updatedRoles = [...currentRoles.map(r => r.charAt(0).toUpperCase() + r.slice(1)), 'Partner'];
                await targetRoster.update({ type: JSON.stringify(updatedRoles) });
            }
        }

        coOwners.push(discordId);
        await partner.update({ coOwnerDiscordIds: JSON.stringify(coOwners) });

        const updatedCoOwners = await Roster.findAll({ where: { discordId: coOwners } });
        res.json({ success: true, coOwners: updatedCoOwners, addedUser: targetRoster });
    } catch (err) {
        console.error('[PARTNER API] Add Co-Owner Error:', err);
        res.status(500).json({ error: 'Failed to add co-owner.' });
    }
});

router.delete('/partner/:id/co-owners/:discordId', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const partner = await Partner.findByPk(req.params.id);
        if (!partner) return res.status(404).json({ error: 'Partner club not found' });

        if (!isPrimaryPartnerOwner(partner, req.user)) {
            return res.status(403).json({ error: 'Only the Primary Owner or Staff can remove co-owners.' });
        }

        const targetDiscordId = req.params.discordId;
        let coOwners = getPartnerCoOwners(partner);
        coOwners = coOwners.filter(id => id !== targetDiscordId);

        await partner.update({ coOwnerDiscordIds: JSON.stringify(coOwners) });

        const updatedCoOwners = await Roster.findAll({ where: { discordId: coOwners } });
        res.json({ success: true, coOwners: updatedCoOwners });
    } catch (err) {
        console.error('[PARTNER API] Remove Co-Owner Error:', err);
        res.status(500).json({ error: 'Failed to remove co-owner.' });
    }
});

router.post('/partner/:id/transfer-ownership', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const partner = await Partner.findByPk(req.params.id);
        if (!partner) return res.status(404).json({ error: 'Partner club not found' });

        if (!isPrimaryPartnerOwner(partner, req.user)) {
            return res.status(403).json({ error: 'Only the Primary Owner or Staff can transfer club ownership.' });
        }

        const { targetDiscordId } = req.body;
        if (!targetDiscordId || targetDiscordId === partner.ownerDiscordId) {
            return res.status(400).json({ error: 'Invalid target user for ownership transfer.' });
        }

        const oldOwnerDiscordId = partner.ownerDiscordId;
        let coOwners = getPartnerCoOwners(partner);

        // Remove new owner from co-owners list and add old owner as co-owner
        coOwners = coOwners.filter(id => id !== targetDiscordId);
        if (!coOwners.includes(oldOwnerDiscordId)) {
            coOwners.push(oldOwnerDiscordId);
        }

        await partner.update({
            ownerDiscordId: targetDiscordId,
            coOwnerDiscordIds: JSON.stringify(coOwners)
        });

        // Ensure new owner has Partner role in Roster
        const targetRoster = await Roster.findByPk(targetDiscordId);
        if (targetRoster) {
            const currentRoles = getUserRoles(targetRoster);
            if (!currentRoles.includes('partner')) {
                const updatedRoles = [...currentRoles.map(r => r.charAt(0).toUpperCase() + r.slice(1)), 'Partner'];
                await targetRoster.update({ type: JSON.stringify(updatedRoles) });
            }
        }

        res.json({ success: true, newOwnerDiscordId: targetDiscordId });
    } catch (err) {
        console.error('[PARTNER API] Transfer Ownership Error:', err);
        res.status(500).json({ error: 'Failed to transfer ownership.' });
    }
});

// 2. Partner Icon Upload
router.post('/partner/upload-icon', isAuthenticated, isPartnerOrStaff, handleUpload('icon'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'partners');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const partnerId = req.body.partnerId;
        const { Op } = require('sequelize');
        let partner = null;
        if (partnerId) {
            partner = await Partner.findByPk(partnerId);
        } else {
            partner = await Partner.findOne({
                where: {
                    [Op.or]: [
                        { ownerDiscordId: req.user.discordId },
                        { coOwnerDiscordIds: { [Op.like]: `%"${req.user.discordId}"%` } },
                        { coOwnerDiscordIds: { [Op.like]: `%${req.user.discordId}%` } }
                    ]
                }
            });
        }

        if (partner && !canManagePartner(partner, req.user)) {
            return res.status(403).json({ error: 'Not authorized to update this partner profile' });
        }

        if (!partner) {
            partner = await Partner.create({
                ownerDiscordId: req.user.discordId,
                name: `${req.user.name}'s Club`,
                slug: slugify(req.user.name || "partner") + `-${Date.now()}`
            });
        }

        const isAnimated = req.file.mimetype === 'image/gif' || req.file.mimetype === 'image/webp';
        const filename = `icon_${req.user.discordId}_${Date.now()}.webp`;
        const filePath = path.join(uploadDir, filename);
        const webPath = `/uploads/partners/${filename}`;

        let pipeline = sharp(req.file.buffer, { animated: isAnimated });
        pipeline = pipeline.resize(512, 512, { fit: 'cover', position: 'center' });
        await pipeline.webp({ effort: 6, quality: 85 }).toFile(filePath);

        if (partner.iconUrl && partner.iconUrl.startsWith('/uploads/partners/')) {
            const oldPath = path.join(__dirname, '..', 'public', partner.iconUrl);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        await partner.update({ iconUrl: webPath });

        res.json({ success: true, iconUrl: webPath });
    } catch (err) {
        console.error("[PARTNER API] Icon Upload Error:", err);
        res.status(500).json({ error: 'Failed to upload icon' });
    }
});

// 3. Partner Banner Upload
router.post('/partner/upload-banner', isAuthenticated, isPartnerOrStaff, handleUpload('banner'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'partners');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const partnerId = req.body.partnerId;
        const { Op } = require('sequelize');
        let partner = null;
        if (partnerId) {
            partner = await Partner.findByPk(partnerId);
        } else {
            partner = await Partner.findOne({
                where: {
                    [Op.or]: [
                        { ownerDiscordId: req.user.discordId },
                        { coOwnerDiscordIds: { [Op.like]: `%"${req.user.discordId}"%` } },
                        { coOwnerDiscordIds: { [Op.like]: `%${req.user.discordId}%` } }
                    ]
                }
            });
        }

        if (partner && !canManagePartner(partner, req.user)) {
            return res.status(403).json({ error: 'Not authorized to update this partner profile' });
        }

        if (!partner) {
            partner = await Partner.create({
                ownerDiscordId: req.user.discordId,
                name: `${req.user.name}'s Club`,
                slug: slugify(req.user.name || "partner") + `-${Date.now()}`,
                coOwnerDiscordIds: '[]'
            });
        }

        const isAnimated = req.file.mimetype === 'image/gif' || req.file.mimetype === 'image/webp';
        const filename = `banner_${req.user.discordId}_${Date.now()}.webp`;
        const filePath = path.join(uploadDir, filename);
        const webPath = `/uploads/partners/${filename}`;

        let pipeline = sharp(req.file.buffer, { animated: isAnimated });
        pipeline = pipeline.resize(1920, 600, { fit: 'cover', position: 'center' });
        await pipeline.webp({ effort: 6, quality: 85 }).toFile(filePath);

        if (partner.bannerUrl && partner.bannerUrl.startsWith('/uploads/partners/')) {
            const oldPath = path.join(__dirname, '..', 'public', partner.bannerUrl);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        await partner.update({ bannerUrl: webPath });

        res.json({ success: true, bannerUrl: webPath });
    } catch (err) {
        console.error("[PARTNER API] Banner Upload Error:", err);
        res.status(500).json({ error: 'Failed to upload banner' });
    }
});

// --- ADMIN / STAFF PARTNER MANAGEMENT ENDPOINTS ---

// Admin: Create Partner
router.post('/admin/partners/create', isAuthenticated, isStaff, async (req, res) => {
    try {
        const { ownerDiscordId, name, slug, description, accentColor, vrcGroupUrl, discordInvite, websiteUrl, isApproved, order } = req.body;
        if (!ownerDiscordId || !name) {
            return res.status(400).json({ error: 'Owner Discord ID and Name are required' });
        }

        const cleanSlug = slugify(slug || name);
        const existing = await Partner.findOne({ where: { slug: cleanSlug } });
        if (existing) {
            return res.status(400).json({ error: `The slug "${cleanSlug}" is already in use by another club.` });
        }

        const partner = await Partner.create({
            ownerDiscordId,
            name,
            slug: cleanSlug,
            description,
            accentColor: accentColor || '#f2008d',
            vrcGroupUrl,
            discordInvite,
            websiteUrl,
            isApproved: isApproved !== undefined ? isApproved : true,
            order: order ? parseInt(order) : 0,
            coOwnerDiscordIds: '[]'
        });

        res.json({ success: true, partner });
    } catch (err) {
        console.error("[ADMIN PARTNER API] Create Error:", err);
        res.status(500).json({ error: 'Failed to create partner profile' });
    }
});

// Admin: Update Partner
router.put('/admin/partners/:id', isAuthenticated, isStaff, async (req, res) => {
    try {
        const partner = await Partner.findByPk(req.params.id);
        if (!partner) return res.status(404).json({ error: 'Partner not found' });

        const { ownerDiscordId, name, slug, description, accentColor, vrcGroupUrl, discordInvite, websiteUrl, isApproved, order } = req.body;
        
        let finalSlug = partner.slug;
        if (slug && slug !== partner.slug) {
            const cleanSlug = slugify(slug);
            const existing = await Partner.findOne({ where: { slug: cleanSlug } });
            if (existing && existing.id !== partner.id) {
                return res.status(400).json({ error: `The slug "${cleanSlug}" is already in use.` });
            }
            finalSlug = cleanSlug;
        }

        await partner.update({
            ownerDiscordId: ownerDiscordId !== undefined ? ownerDiscordId : partner.ownerDiscordId,
            name: name !== undefined ? name : partner.name,
            slug: finalSlug,
            description: description !== undefined ? description : partner.description,
            accentColor: accentColor !== undefined ? accentColor : partner.accentColor,
            vrcGroupUrl: vrcGroupUrl !== undefined ? vrcGroupUrl : partner.vrcGroupUrl,
            discordInvite: discordInvite !== undefined ? discordInvite : partner.discordInvite,
            websiteUrl: websiteUrl !== undefined ? websiteUrl : partner.websiteUrl,
            isApproved: isApproved !== undefined ? isApproved : partner.isApproved,
            order: order !== undefined ? parseInt(order) : partner.order
        });

        res.json({ success: true, partner });
    } catch (err) {
        console.error("[ADMIN PARTNER API] Update Error:", err);
        res.status(500).json({ error: 'Failed to update partner profile' });
    }
});

// Admin: Delete Partner
router.delete('/admin/partners/:id', isAuthenticated, isStaff, async (req, res) => {
    try {
        const partner = await Partner.findByPk(req.params.id, {
            include: [{ model: PartnerEvent, as: 'events' }]
        });
        if (!partner) return res.status(404).json({ error: 'Partner not found' });

        if (partner.iconUrl && partner.iconUrl.startsWith('/uploads/partners/')) {
            const iconPath = path.join(__dirname, '..', 'public', partner.iconUrl);
            if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath);
        }

        if (partner.bannerUrl && partner.bannerUrl.startsWith('/uploads/partners/')) {
            const bannerPath = path.join(__dirname, '..', 'public', partner.bannerUrl);
            if (fs.existsSync(bannerPath)) fs.unlinkSync(bannerPath);
        }

        if (partner.events && partner.events.length > 0) {
            for (const evt of partner.events) {
                if (evt.bannerUrl && evt.bannerUrl.startsWith('/uploads/partners/')) {
                    const flyerPath = path.join(__dirname, '..', 'public', evt.bannerUrl);
                    if (fs.existsSync(flyerPath)) fs.unlinkSync(flyerPath);
                }
            }
        }

        await partner.destroy();
        res.json({ success: true });
    } catch (err) {
        console.error("[ADMIN PARTNER API] Delete Error:", err);
        res.status(500).json({ error: 'Failed to delete partner' });
    }
});

// --- PARTNER EVENT API ENDPOINTS ---

// 1. Create Partner Event
router.post('/partner/events/create', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const { partnerId, title, description, lineup, startTime, endTime, eventUrl, bannerUrl, timezone, isStreamedByClubFurn, streamUrls } = req.body;
        const { Op } = require('sequelize');
        const userType = (req.user.type || "").toLowerCase();
        const isStaffUser = ['host', 'staff', 'owner'].some(r => userType.includes(r));

        let partner = null;
        if (partnerId) {
            partner = await Partner.findByPk(partnerId);
        } else {
            partner = await Partner.findOne({
                where: {
                    [Op.or]: [
                        { ownerDiscordId: req.user.discordId },
                        { coOwnerDiscordIds: { [Op.like]: `%"${req.user.discordId}"%` } },
                        { coOwnerDiscordIds: { [Op.like]: `%${req.user.discordId}%` } }
                    ]
                }
            });
        }

        if (!partner) {
            return res.status(403).json({ error: 'Partner profile not found. Please create a partner profile first.' });
        }

        if (!canManagePartner(partner, req.user)) {
            return res.status(403).json({ error: 'Not authorized to create events for this club.' });
        }

        if (!title || !startTime || !endTime) {
            return res.status(400).json({ error: 'Event Title, Start Time, and End Time are required.' });
        }

        const newEvent = await PartnerEvent.create({
            partnerId: partner.id,
            title,
            description,
            lineup: typeof lineup === 'object' ? JSON.stringify(lineup) : lineup,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            eventUrl,
            bannerUrl,
            timezone: timezone || 'UTC',
            isApproved: true,
            isStreamedByClubFurn: isStaffUser ? (isStreamedByClubFurn === true || isStreamedByClubFurn === 'true') : false,
            streamUrls: isStaffUser ? (typeof streamUrls === 'object' ? JSON.stringify(streamUrls) : streamUrls) : null
        });

        res.json({ success: true, event: newEvent });
    } catch (err) {
        console.error("[PARTNER EVENT API] Create error:", err);
        res.status(500).json({ error: 'Failed to create partner event' });
    }
});

// 2. Update Partner Event
router.put('/partner/events/:id', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const eventId = req.params.id;
        const partnerEvent = await PartnerEvent.findByPk(eventId, { include: [{ model: Partner, as: 'partner' }] });
        if (!partnerEvent) return res.status(404).json({ error: 'Event not found' });

        if (!canManagePartner(partnerEvent.partner, req.user)) {
            return res.status(403).json({ error: 'Not authorized to edit this event' });
        }

        const userType = (req.user.type || "").toLowerCase();
        const isStaffUser = ['host', 'staff', 'owner'].some(r => userType.includes(r));
        const { title, description, lineup, startTime, endTime, eventUrl, bannerUrl, timezone, isApproved, isStreamedByClubFurn, streamUrls } = req.body;
        
        let updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (lineup !== undefined) updates.lineup = typeof lineup === 'object' ? JSON.stringify(lineup) : lineup;
        if (startTime !== undefined) updates.startTime = new Date(startTime);
        if (endTime !== undefined) updates.endTime = new Date(endTime);
        if (eventUrl !== undefined) updates.eventUrl = eventUrl;
        if (bannerUrl !== undefined) updates.bannerUrl = bannerUrl;
        if (timezone !== undefined) updates.timezone = timezone;
        
        // Staff-Only Moderation & Streaming Controls
        if (isStaffUser) {
            if (isApproved !== undefined) updates.isApproved = isApproved;
            if (isStreamedByClubFurn !== undefined) updates.isStreamedByClubFurn = isStreamedByClubFurn === true || isStreamedByClubFurn === 'true';
            if (streamUrls !== undefined) updates.streamUrls = typeof streamUrls === 'object' ? JSON.stringify(streamUrls) : streamUrls;
        }

        await partnerEvent.update(updates);

        // Auto-update existing Discord message embed if one was already posted
        if (partnerEvent.discordMessageId) {
            try {
                const { client } = require('../bot');
                const { postPartnerEventAnnouncement } = require('../utils/bot-utils');
                await postPartnerEventAnnouncement(client, partnerEvent.id);
            } catch (e) {
                console.error('[PARTNER EVENT API] Failed to auto-update Discord message:', e.message);
            }
        }

        res.json({ success: true, event: partnerEvent });
    } catch (err) {
        console.error("[PARTNER EVENT API] Update error:", err);
        res.status(500).json({ error: 'Failed to update partner event' });
    }
});

// 3. Delete Partner Event
router.delete('/partner/events/:id', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const eventId = req.params.id;
        const partnerEvent = await PartnerEvent.findByPk(eventId, { include: [{ model: Partner, as: 'partner' }] });
        if (!partnerEvent) return res.status(404).json({ error: 'Event not found' });

        if (!canManagePartner(partnerEvent.partner, req.user)) {
            return res.status(403).json({ error: 'Not authorized to delete this event' });
        }

        if (partnerEvent.bannerUrl && partnerEvent.bannerUrl.startsWith('/uploads/partners/')) {
            const flyerPath = path.join(__dirname, '..', 'public', partnerEvent.bannerUrl);
            if (fs.existsSync(flyerPath)) fs.unlinkSync(flyerPath);
        }

        await partnerEvent.destroy();
        res.json({ success: true });
    } catch (err) {
        console.error("[PARTNER EVENT API] Delete error:", err);
        res.status(500).json({ error: 'Failed to delete partner event' });
    }
});

// 4. Partner Event Flyer Upload
router.post('/partner/events/upload-flyer', isAuthenticated, isPartnerOrStaff, handleUpload('flyer'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'partners');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const isAnimated = req.file.mimetype === 'image/gif' || req.file.mimetype === 'image/webp';
        const filename = `flyer_${req.user.discordId}_${Date.now()}.webp`;
        const filePath = path.join(uploadDir, filename);
        const webPath = `/uploads/partners/${filename}`;

        let pipeline = sharp(req.file.buffer, { animated: isAnimated });
        pipeline = pipeline.resize(1920, 1080, { fit: 'inside', withoutEnlargement: true });
        await pipeline.webp({ effort: 6, quality: 85 }).toFile(filePath);

        res.json({ success: true, flyerUrl: webPath });
    } catch (err) {
        console.error("[PARTNER EVENT API] Flyer Upload Error:", err);
        res.status(500).json({ error: 'Failed to upload event flyer' });
    }
});

// 5. Post Partner Event Announcement to Discord
router.post('/partner/events/:id/announce', isAuthenticated, isPartnerOrStaff, async (req, res) => {
    try {
        const { client } = require('../bot');
        const { postPartnerEventAnnouncement } = require('../utils/bot-utils');

        const result = await postPartnerEventAnnouncement(client, req.params.id, { isManualUpcoming: true });
        res.json({ success: true, message: 'Upcoming event announcement posted to Discord!', messageId: result.messageId });
    } catch (err) {
        console.error('[PARTNER EVENT API] Discord announcement error:', err);
        res.status(500).json({ error: err.message || 'Failed to post announcement to Discord' });
    }
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
        const { Op } = require('sequelize');
        const q = req.query.q ? req.query.q.trim() : '';
        const roleFilter = req.query.role ? req.query.role.trim() : '';
        const page = parseInt(req.query.page) || 1;
        const limitParam = req.query.limit;
        const isPaginated = req.query.page !== undefined || (limitParam !== undefined && limitParam !== 'all');
        const limit = limitParam === 'all' ? null : (parseInt(limitParam) || 15);
        const offset = limit ? (page - 1) * limit : 0;

        const whereClause = {};

        if (q) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${q}%` } },
                { title: { [Op.like]: `%${q}%` } },
                { type: { [Op.like]: `%${q}%` } },
                { discordId: { [Op.like]: `%${q}%` } },
                { vrcDisplayName: { [Op.like]: `%${q}%` } },
                { vrcUserId: { [Op.like]: `%${q}%` } }
            ];
        }

        if (roleFilter && roleFilter.toUpperCase() !== 'ALL') {
            if (roleFilter.toLowerCase() === 'banned') {
                whereClause.isBanned = true;
            } else if (roleFilter.toLowerCase() === 'staff') {
                whereClause[Op.and] = [
                    whereClause[Op.and] || {},
                    {
                        [Op.or]: [
                            { type: { [Op.like]: '%owner%' } },
                            { type: { [Op.like]: '%host%' } },
                            { type: { [Op.like]: '%staff%' } }
                        ]
                    }
                ];
            } else if (roleFilter.toLowerCase() === 'resident' || roleFilter.toLowerCase() === 'dj' || roleFilter.toLowerCase() === 'performer') {
                whereClause[Op.and] = [
                    whereClause[Op.and] || {},
                    {
                        [Op.or]: [
                            { type: { [Op.like]: '%resident%' } },
                            { type: { [Op.like]: '%performer%' } },
                            { type: { [Op.like]: '%dj%' } }
                        ]
                    }
                ];
            } else {
                whereClause.type = { [Op.like]: `%${roleFilter}%` };
            }
        }

        const { count, rows: members } = await Roster.findAndCountAll({
            where: whereClause,
            order: [['name', 'ASC']],
            limit: limit || undefined,
            offset: limit ? offset : undefined
        });
        
        // Fetch event counts for performers on this slice
        const performerIds = members.map(m => m.discordId);
        const countsMap = {};
        if (performerIds.length > 0) {
            const counts = await InstanceLogPerformers.findAll({
                attributes: ['performerId', [sequelize.fn('COUNT', sequelize.col('instanceLogId')), 'count']],
                where: { performerId: performerIds },
                group: ['performerId']
            });
            counts.forEach(c => {
                countsMap[c.performerId] = parseInt(c.get('count')) || 0;
            });
        }

        const mapped = members.map(m => {
            const json = m.toJSON();
            json.roles = getUserRoles(m);
            json.eventCount = countsMap[m.discordId] || 0;
            return json;
        });

        if (isPaginated) {
            const totalPages = limit ? Math.ceil(count / limit) : 1;
            return res.json({
                members: mapped,
                total: count,
                page: page,
                totalPages: totalPages,
                limit: limit || count
            });
        }

        res.json(mapped);
    } catch (err) { 
        console.error("Failed to load roster stats:", err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

router.patch('/roster/:id', isStaff, async (req, res) => {
    try {
        const { title, type, roles, name, isBanned, hasMascotAccess } = req.body;
        
        const targetUser = await Roster.findByPk(req.params.id);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        const isCallerOwner = hasRole(req.user, 'owner');
        const isCallerHost = hasRole(req.user, 'host');
        const isCallerStaff = hasRole(req.user, 'staff');

        const targetIsOwner = hasRole(targetUser, 'owner');
        const targetIsHost = hasRole(targetUser, 'host');
        const targetIsStaff = hasRole(targetUser, 'staff');

        // SECURITY 1: Hierarchy on TARGET user
        if (targetIsOwner && !isCallerOwner) {
            return res.status(403).json({ error: 'Only Owners can modify an Owner account.' });
        }
        if (targetIsHost && !isCallerOwner) {
            return res.status(403).json({ error: 'Only Owners can modify a Host account.' });
        }
        if (targetIsStaff && !isCallerOwner && !isCallerHost) {
            return res.status(403).json({ error: 'Staff cannot modify another Staff account.' });
        }

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        
        // SECURITY 2: Hierarchy on ROLES being granted/revoked
        const rawNewRoles = roles !== undefined ? roles : (type !== undefined ? type : null);
        if (rawNewRoles !== null) {
            let parsedNewRoles = [];
            if (Array.isArray(rawNewRoles)) {
                parsedNewRoles = rawNewRoles.map(r => String(r).trim()).filter(Boolean);
            } else if (typeof rawNewRoles === 'string') {
                if (rawNewRoles.startsWith('[') && rawNewRoles.endsWith(']')) {
                    try { parsedNewRoles = JSON.parse(rawNewRoles); } catch(e) {}
                } else {
                    parsedNewRoles = rawNewRoles.split(/\s*,\s*|\s*\/\s*/).map(r => r.trim()).filter(Boolean);
                }
            }

            // Standardize role casing
            const roleNameMap = {
                'owner': 'Owner',
                'host': 'Host',
                'staff': 'Staff',
                'resident': 'Resident',
                'performer': 'Performer',
                'partner': 'Partner',
                'vip': 'VIP'
            };
            const normalizedNewRoles = parsedNewRoles.map(r => roleNameMap[r.toLowerCase()] || (r.charAt(0).toUpperCase() + r.slice(1)));
            const newLowerRoles = normalizedNewRoles.map(r => r.toLowerCase());
            const currentTargetRoles = getUserRoles(targetUser);

            const wantsOwner = newLowerRoles.includes('owner');
            const hadOwner = currentTargetRoles.includes('owner');
            if (wantsOwner !== hadOwner && !isCallerOwner) {
                return res.status(403).json({ error: 'Only Owners can grant or revoke the Owner role.' });
            }

            const wantsHost = newLowerRoles.includes('host');
            const hadHost = currentTargetRoles.includes('host');
            if (wantsHost !== hadHost && !isCallerOwner) {
                return res.status(403).json({ error: 'Only Owners can grant or revoke the Host role.' });
            }

            const wantsStaff = newLowerRoles.includes('staff');
            const hadStaff = currentTargetRoles.includes('staff');
            if (wantsStaff !== hadStaff && !isCallerOwner && !isCallerHost) {
                return res.status(403).json({ error: 'Only Owners and Hosts can grant or revoke the Staff role.' });
            }

            if (normalizedNewRoles.length === 0) {
                normalizedNewRoles.push('Performer');
            }

            updateData.type = JSON.stringify(normalizedNewRoles);
        }
        
        // Name, Ban status, Mascot, and VRChat sync (Host or Owner only)
        if (isCallerHost || isCallerOwner) {
            if (name) updateData.name = name;
            if (isBanned !== undefined) updateData.isBanned = isBanned;
            if (hasMascotAccess !== undefined && isCallerOwner) {
                updateData.hasMascotAccess = hasMascotAccess;
            }

            if (req.body.vrcUserId !== undefined) {
                const inputVal = req.body.vrcUserId ? req.body.vrcUserId.trim() : "";
                if (inputVal === "") {
                    updateData.vrcUserId = null;
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

router.get('/archives/genres', (req, res) => {
    res.json(POPULAR_GENRES);
});

router.post('/archives/add', isAuthenticated, async (req, res) => {
    try {
        const { title, date, genre, genres, linkUrl } = req.body;
        const parsedGenres = parseGenres(genres !== undefined ? genres : genre);
        const genreValue = JSON.stringify(parsedGenres);
        await Archive.create({ performerId: req.user.discordId, title, date, genre: genreValue, linkUrl });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/archives/:id', isAuthenticated, async (req, res) => {
    try {
        const { title, date, genre, genres, linkUrl } = req.body;
        const archive = await Archive.findByPk(req.params.id);
        if (!archive) return res.status(404).json({ error: 'Archive not found' });

        const userType = (req.user?.type || "").toLowerCase();
        const isHostOrOwner = userType.includes('host') || userType.includes('owner');
        
        if (archive.performerId !== req.user.discordId && !isHostOrOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const parsedGenres = parseGenres(genres !== undefined ? genres : genre);
        const genreValue = JSON.stringify(parsedGenres);

        await archive.update({ title, date, genre: genreValue, linkUrl });
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
