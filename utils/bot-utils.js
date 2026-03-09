const { ActivityType, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getInstanceData, getGroupInstanceData, getGroupStats, autoAcceptFriends, updateBotPresence } = require('./vrc-api');
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
        
        // VRChat Status components
        let vrcPresenceStatus = 'active';
        let vrcPresenceDesc = '💤 Offline';

        // 1. Fetch general group activity
        const groupId = process.env.VRC_GROUPID || "CLUBLC.9601";
        const groupData = await getGroupStats(groupId);
        let groupOnlineStr = (groupData && groupData.onlineMembers > 0) ? ` | 🟢 ${groupData.onlineMembers} Online` : "";

        // 2. Handle Friend Requests
        await autoAcceptFriends();

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
                vrcData = await getGroupInstanceData(groupId);
            }

            if (vrcData && vrcData.active) {
                vrcStats = ` (${vrcData.count}/${vrcData.capacity})`;
            }

            if (now >= start && now < end) {
                statusText = `🔊 Club is LIVE!${vrcStats}`;
                statusIcon = 'online';
                vrcPresenceStatus = 'join me';
                vrcPresenceDesc = `🔊 Club is LIVE!${vrcStats}`;
            } else if (now < start) {
                const timeDiff = start - now;
                const totalMinutes = Math.floor(timeDiff / (1000 * 60));
                const hours = Math.floor(totalMinutes / 60);
                const mins = totalMinutes % 60;

                statusIcon = 'online';
                vrcPresenceStatus = 'active';
                
                if (hours > 0) {
                    statusText = `⏳ Starting in ${hours}h ${mins}m${vrcStats}`;
                } else {
                    statusText = `⏳ Starting in ${mins}m${vrcStats}`;
                }
                
                if (totalMinutes < 1) {
                    statusText = `⏳ Starting imminently!${vrcStats}`;
                }
                vrcPresenceDesc = statusText;
            } else {
                statusText = `🌙 Thanks for coming!${groupOnlineStr}`;
                statusIcon = 'dnd';
                vrcPresenceStatus = 'busy';
                vrcPresenceDesc = '🌙 Thanks for coming!';
            }
        } else {
            statusText = `💤 Offline${groupOnlineStr}`;
            statusIcon = 'dnd';
            vrcPresenceStatus = 'busy';
            vrcPresenceDesc = '💤 Offline';
        }

        // Update Discord Presence
        client.user.setPresence({
            activities: [{ name: 'customstatus', type: ActivityType.Custom, state: statusText }],
            status: statusIcon
        });

        // Update VRChat Presence (Beacon)
        await updateBotPresence(vrcPresenceStatus, vrcPresenceDesc);

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
    
    const filePath = path.join(dir, `${baseFileName}.webp`);
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

/**
 * Create a private Discord channel for an application submission
 */
async function createApplicationTicket(submission, slot) {
    const { client } = require('../bot');
    const guildId = process.env.DISCORD_GUILD_ID;
    const categoryId = process.env.DISCORD_APPS_CATEGORY_ID;

    if (!guildId || !categoryId) {
        console.warn("[BOT] Missing Guild or Category ID for apps.");
        return;
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        
        // Create the channel
        const channelName = `app-${submission.discordTag || submission.id}`.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    deny: [PermissionFlagsBits.ViewChannel],
                }
            ],
        });

        // Store channel ID in DB
        await submission.update({ channelId: channel.id });

        // Fetch fresh member data for avatar
        const member = await getGuildMember(client, submission.discordId);

        // Post the application details
        const embed = new EmbedBuilder()
            .setTitle(`New Application: ${slot.roleName} (${slot.roleType})`)
            .setColor('#29C5F6')
            .setTimestamp()
            .setThumbnail(member ? member.avatar : null)
            .addFields(
                { name: 'Applicant', value: `<@${submission.discordId}> (${submission.discordTag})`, inline: true },
                { name: 'Status', value: submission.status.toUpperCase(), inline: true },
                { name: 'Form Type', value: slot.roleType, inline: true }
            );

        // Add dynamic fields from answers
        if (submission.answers) {
            Object.keys(submission.answers).forEach(key => {
                if (submission.answers[key]) {
                    embed.addFields({ name: key, value: submission.answers[key].toString().substring(0, 1024) });
                }
            });
        }

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`app_approve_${submission.id}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`app_deny_${submission.id}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ 
            content: `🔔 **New Recruitment Application received!**`, 
            embeds: [embed],
            components: [buttons]
        });
        
        console.log(`\x1b[32m[BOT] 🎫 Created app ticket channel: ${channel.name}\x1b[0m`);

    } catch (err) {
        console.error("[BOT] Failed to create application ticket:", err);
    }
}

/**
 * Add a user to the main guild using their OAuth2 access token
 */
async function joinGuild(client, userId, accessToken) {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) return false;

    try {
        const guild = await client.guilds.fetch(guildId);
        await guild.members.add(userId, { accessToken });
        console.log(`[BOT] 📥 Added user ${userId} to the guild.`);
        return true;
    } catch (err) {
        // If they are already in the guild, this will error, which is fine
        return false;
    }
}

module.exports = { autoUpdateStatus, getGuildMember, updateBotStatus, downloadFile, createApplicationTicket, joinGuild };
