const { ActivityType } = require('discord.js');
const { getInstanceData, getGroupInstanceData, getGroupStats } = require('./vrc-api');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Automatically determine the bot's status based on current DB state
 */
async function autoUpdateStatus(client) {
    if (!client || !client.user) return;

    const { Settings, Schedule, Roster } = require('../db');

    try {
        const settings = await Settings.findOne();
        let statusText = '💤 Offline';
        let statusIcon = 'dnd';

        // Fetch general group activity
        const groupData = await getGroupStats("CLUBLC.9601");
        let groupOnlineStr = groupData ? ` | 🟢 ${groupData.onlineMembers} Online` : "";

        if (settings && !settings.forceOffline) {
            const now = new Date();
            const start = new Date(settings.eventStartTime);
            const end = new Date(settings.eventEndTime);

            // Fetch VRChat instance data
            let vrcStats = "";
            let vrcData = null;
            
            if (settings.instanceUrl && settings.instanceUrl.includes("worldId=")) {
                vrcData = await getInstanceData(settings.instanceUrl);
            } else {
                vrcData = await getGroupInstanceData("CLUBLC.9601");
            }

            if (vrcData && vrcData.active) {
                vrcStats = ` (${vrcData.count}/${vrcData.capacity})`;
            }

            if (now >= start && now < end) {
                statusText = `🔊 Club is LIVE!${vrcStats}`;
                statusIcon = 'online';
            } else if (now < start) {
                const timeDiff = start - now;
                const totalMinutes = Math.floor(timeDiff / (1000 * 60));
                const hours = Math.floor(totalMinutes / 60);
                const mins = totalMinutes % 60;

                statusIcon = 'online';
                
                if (hours > 0) {
                    statusText = `⏳ Starting in ${hours}h ${mins}m${vrcStats}`;
                } else {
                    statusText = `⏳ Starting in ${mins}m${vrcStats}`;
                }
                
                if (totalMinutes < 1) {
                    statusText = `⏳ Starting imminently!${vrcStats}`;
                }
            } else {
                statusText = `🌙 Thanks for coming!${groupOnlineStr}`;
                statusIcon = 'dnd';
            }
        } else {
            statusText = `💤 Offline${groupOnlineStr}`;
            statusIcon = 'dnd';
        }

        client.user.setPresence({
            activities: [{ name: 'customstatus', type: ActivityType.Custom, state: statusText }],
            status: statusIcon
        });

    } catch (err) {
        console.error("Failed to auto-update bot status:", err);
    }
}

/**
 * Fetch a user's member data from the main guild
 */
async function getGuildMember(client, userId) {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
        console.warn("DISCORD_GUILD_ID is not set in .env");
        return null;
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return {
            nickname: member.nickname || member.user.globalName || member.user.username,
            roles: member.roles.cache.map(r => ({ 
                id: r.id, 
                name: r.name, 
                color: r.hexColor === '#000000' ? '#888888' : r.hexColor 
            })),
            avatar: member.displayAvatarURL(),
            joinedAt: member.joinedAt
        };
    } catch (err) {
        return null;
    }
}

/**
 * Update the bot's status with manual text
 */
async function updateBotStatus(client, statusText) {
    if (!client || !client.user) return;
    client.user.setPresence({
        activities: [{ name: 'customstatus', type: ActivityType.Custom, state: statusText }],
        status: 'online'
    });
}

const sharp = require('sharp');

/**
 * Download, compress, and thumbnail a file from Discord
 */
async function downloadFile(url, baseFileName) {
    const dir = path.join(__dirname, '../public', 'uploads', 'gallery');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    // 1. Process Main Image (Highly Compressed WebP)
    const mainFileName = `${baseFileName}.webp`;
    const mainPath = path.join(dir, mainFileName);
    await sharp(buffer)
        .webp({ quality: 75, effort: 6 })
        .toFile(mainPath);

    // 2. Process Thumbnail (Respect Aspect Ratio, max 600px wide)
    const thumbFileName = `${baseFileName}_thumb.webp`;
    const thumbPath = path.join(dir, thumbFileName);
    await sharp(buffer)
        .resize(600, null, { withoutEnlargement: true }) // Scaled width, natural height
        .webp({ quality: 65 })
        .toFile(thumbPath);

    return {
        imageUrl: `/uploads/gallery/${mainFileName}`,
        thumbnailUrl: `/uploads/gallery/${thumbFileName}`
    };
}

module.exports = { autoUpdateStatus, getGuildMember, updateBotStatus, downloadFile };
