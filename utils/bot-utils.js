const { ActivityType, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { 
    getInstanceData, getGroupInstanceData, getGroupStats, autoAcceptFriends, 
    updateBotPresence, connectPipeline, closeGroupInstance, 
    getUserInfo, getGroupMembers, banGroupMember 
} = require('./vrc-api');
const { Settings, Schedule, Roster, InstanceLog, InstanceVisitor, VrcGroupAudit } = require('../db');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Automatically determine the bot's status based on current DB state
 */
async function autoUpdateStatus(client) {
    if (!client || !client.user) return;

    try {
        const settings = await Settings.findOne();
        let statusText = '💤 Offline';
        let statusIcon = 'dnd';
        
        // VRChat Status components
        let vrcPresenceStatus = 'active'; 
        let vrcPresenceDesc = '💤 Offline';

        // 1. Fetch general group activity
        const groupId = process.env.VRC_GROUPID || "FURN.9601";
        const groupData = await getGroupStats(groupId);
        let groupOnlineStr = (groupData && groupData.onlineMembers > 0) ? ` | 🟢 ${groupData.onlineMembers} Online` : "";

        // 2. Handle Friend Requests (24/7)
        await autoAcceptFriends();

        // 3. Ensure Pipeline is ALWAYS connected (24/7)
        let currentLocation = null;
        let vrcDataAggregate = { active: false, count: 0, capacity: 0, names: [] };

        /**
         * Helper to close an instance via API and clear DB
         */
        const closeVrcInstance = async (log, settings, reason) => {
            if (!log) return;
            console.log(`[VRC AUTO-CLOSE] ${reason} for ${log.worldName}. Terminating...`);
            
            // Call universal terminator
            await closeGroupInstance(log.instanceUrl || log.instanceId);

            const now = new Date();
            const durationMins = Math.floor((now - new Date(log.startTime)) / 60000);
            await log.update({ 
                isActive: false, 
                endTime: now, 
                totalDuration: durationMins 
            });
        };

        if (settings && !settings.forceOffline) {
            const now = new Date();
            const start = new Date(settings.eventStartTime);
            const end = new Date(settings.eventEndTime);
            const isLive = (now >= start && now < end);

            // 1. AUTO-DISCOVERY: Fetch ALL active instances from VRChat API
            const vrcInstances = await getGroupInstanceData(groupId);
            
            // If live, ensure all discovered instances are being tracked in DB
            if (isLive && vrcInstances.length > 0) {
                for (const inst of vrcInstances) {
                    const existing = await InstanceLog.findOne({ where: { instanceId: inst.location, isActive: true } });
                    if (!existing) {
                        await InstanceLog.create({
                            instanceId: inst.location,
                            worldName: inst.name,
                            isEventSession: true,
                            startTime: new Date(),
                            isActive: true
                        });
                        console.log(`[VRC DISCOVERY] 📡 Auto-started tracking for newly discovered instance: ${inst.name} (${inst.location})`);
                    }
                }
            }

            // 2. AGGREGATION: Fetch ALL active logs from DB and update stats
            const activeLogs = await InstanceLog.findAll({ where: { isActive: true } });
            
            for (const log of activeLogs) {
                let vrcData = null;
                // Check if this log is specifically for the override URL or a group discovery
                if (log.instanceUrl && log.instanceUrl.includes("worldId=")) {
                    vrcData = await getInstanceData(log.instanceUrl);
                } else {
                    // Find this specific instance in the vrcInstances list
                    vrcData = vrcInstances.find(i => i.location === log.instanceId);
                    
                    // If we found the instance but it lacks user details, fetch them specifically
                    if (vrcData && (!vrcData.users || vrcData.users.length === 0)) {
                        const detailed = await getInstanceData(vrcData.location);
                        if (detailed) vrcData = detailed;
                    }
                }

                if (vrcData && vrcData.active) {
                    vrcDataAggregate.active = true;
                    vrcDataAggregate.count += vrcData.count;
                    vrcDataAggregate.capacity += vrcData.capacity;
                    if (vrcData.name && !vrcDataAggregate.names.includes(vrcData.name)) {
                        vrcDataAggregate.names.push(vrcData.name);
                    }
                    
                    // Set primary location for pipeline (usually the first one or most populated)
                    if (!currentLocation || vrcData.count > 0) {
                        currentLocation = vrcData.location || log.instanceUrl;
                    }

                    // Update peak capacity for this specific log
                    if (vrcData.count > log.peakCapacity) {
                        await log.update({ peakCapacity: vrcData.count });
                    }
                    if (isLive && !log.isEventSession) {
                        await log.update({ isEventSession: true });
                    }

                    // --- AUTOMATED UNIQUE USER TRACKING ---
                    if (vrcData.users && vrcData.users.length > 0) {
                        for (const vrcUser of vrcData.users) {
                            const [visitor, created] = await InstanceVisitor.findOrCreate({
                                where: { 
                                    instanceLogId: log.id,
                                    vrcUserId: vrcUser.id
                                },
                                defaults: { vrcUsername: vrcUser.displayName || vrcUser.username }
                            });

                            if (created) {
                                // New unique visitor detected for this instance!
                                await log.increment('uniqueUsers');
                            }
                        }
                    }

                    // --- AUTO-CLOSE LOGIC ---
                    const thirtyMinsAfterEvent = new Date(end.getTime() + 30 * 60000);
                    if (now > thirtyMinsAfterEvent) {
                        await closeVrcInstance(log, settings, "Event ended 30+ mins ago");
                    }
                } else {
                    // Instance is dead, finalize log
                    const durationMins = Math.floor((now - new Date(log.startTime)) / 60000);
                    await log.update({ 
                        isActive: false, 
                        endTime: now, 
                        totalDuration: durationMins 
                    });
                    console.log(`[ANALYTICS] 📉 Auto-finalized dead instance log: ${log.id}`);
                }
            }

            let vrcStats = vrcDataAggregate.active ? ` (${vrcDataAggregate.count}/${vrcDataAggregate.capacity})` : "";

            if (isLive) {
                statusText = `🔊 Club is LIVE!${vrcStats}`;
                statusIcon = 'online';
                vrcPresenceStatus = 'join me'; // Blue
                vrcPresenceDesc = `🔊 LIVE! Invite Me to join${vrcStats}`;
            } else if (now < start) {
                const timeDiff = start - now;
                const totalMinutes = Math.floor(timeDiff / (1000 * 60));
                const hours = Math.floor(totalMinutes / 60);

                statusIcon = 'online';
                vrcPresenceStatus = 'active'; // Green
                
                if (hours < 48) {
                    let timeStr = "";
                    if (hours >= 1) {
                        timeStr = `${hours}h`;
                    } else if (totalMinutes >= 1) {
                        timeStr = `${totalMinutes}m`;
                    } else {
                        timeStr = "SOON";
                    }
                    statusText = `⏳ Starting in ${timeStr}${vrcStats}`;
                    vrcPresenceDesc = `⏳ Starts in ${timeStr}${vrcStats}`;
                } else {
                    statusText = `📜 Lineup is LIVE!${vrcStats}`;
                    vrcPresenceDesc = `📜 Lineup is LIVE!${vrcStats}`;
                }
            } else {
                statusText = `🌙 Thanks for coming!${groupOnlineStr}`;
                statusIcon = 'dnd';
                vrcPresenceStatus = 'busy'; // Red
                vrcPresenceDesc = '🌙 Thanks for coming!';
            }
        } else {
            statusText = `💤 Offline${groupOnlineStr}`;
            statusIcon = 'dnd';
            vrcPresenceStatus = 'busy'; // Red
            vrcPresenceDesc = '💤 Offline';
        }

        // Maintain Pipeline connection 24/7
        await connectPipeline(currentLocation);

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
    if (!guildId) return null;
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return {
            nickname: member.nickname || member.user.globalName || member.user.username,
            roles: member.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? '#888888' : r.hexColor })),
            avatar: member.displayAvatarURL(),
            joinedAt: member.joinedAt
        };
    } catch (err) { return null; }
}

/**
 * Update the bot's status with manual text
 */
async function updateBotStatus(client, statusText) {
    if (!client || !client.user) return;
    client.user.setPresence({ activities: [{ name: 'customstatus', type: ActivityType.Custom, state: statusText }], status: 'online' });
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
    const mainFileName = `${baseFileName}.webp`;
    const mainPath = path.join(dir, mainFileName);
    await sharp(buffer).webp({ quality: 75, effort: 6 }).toFile(mainPath);
    const thumbFileName = `${baseFileName}_thumb.webp`;
    const thumbPath = path.join(dir, thumbFileName);
    await sharp(buffer).resize(600, null, { withoutEnlargement: true }).webp({ quality: 65 }).toFile(thumbPath);
    return { imageUrl: `/uploads/gallery/${mainFileName}`, thumbnailUrl: `/uploads/gallery/${thumbFileName}` };
}

/**
 * Create a private Discord channel for an application submission
 */
async function createApplicationTicket(submission, slot) {
    const { client } = require('../bot');
    const guildId = process.env.DISCORD_GUILD_ID;
    const categoryId = process.env.DISCORD_APPS_CATEGORY_ID;
    if (!guildId || !categoryId) return;

    try {
        const guild = await client.guilds.fetch(guildId);

        // Use Username for channel and embed (instead of nickname)
        const user = await client.users.fetch(submission.discordId);
        const username = user.username;
        const appType = slot.roleName.toLowerCase().replace(/\s+/g, '-');

        const channelName = `${appType}-${username}`.toLowerCase().replace(/[^\w-]/g, '');

        const channel = await guild.channels.create({
            name: channelName, type: ChannelType.GuildText, parent: categoryId
        });
        await submission.update({ channelId: channel.id });

        const embed = new EmbedBuilder()
            .setTitle(`Application: ${slot.roleName}`)
            .setColor('#29C5F6').setTimestamp().setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: 'Applicant', value: `<@${submission.discordId}> (${username})`, inline: true },
                { name: 'Status', value: submission.status.toUpperCase(), inline: true }
            );
        if (submission.answers) {
            Object.keys(submission.answers).forEach(key => {
                if (submission.answers[key]) embed.addFields({ name: key, value: submission.answers[key].toString().substring(0, 1024) });
            });
        }
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`app_approve_${submission.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`app_deny_${submission.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
        await channel.send({ content: `🔔 **New Recruitment Application received!**`, embeds: [embed], components: [buttons] });
    } catch (err) { console.error("[BOT] Failed to create application ticket:", err); }
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
        return true;
    } catch (err) { return false; }
}

/**
 * Audit VRChat Group Members for suspicious/new accounts
 */
async function auditGroupMembers(client) {
    const groupId = process.env.VRC_GROUPID || "FURN.9601";
    const logChannelId = process.env.VRC_GROUP_LOG_CH_ID;
    if (!logChannelId) return;

    try {
        const members = await getGroupMembers(groupId);
        if (!members || members.length === 0) return;

        for (const member of members) {
            // 1. Check if we've already seen this user
            const existing = await VrcGroupAudit.findByPk(member.userId);
            if (existing) continue;

            // 2. Fetch full user info for age/trust checks
            const fullInfo = await getUserInfo(member.userId);
            if (!fullInfo) continue;

            const createdAt = new Date(fullInfo.date_joined || fullInfo.created_at);
            const ageDays = Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24));
            
            // Correctly parse Trust Rank from tags array (VRChat API standard)
            const tags = fullInfo.tags || [];
            let rank = 'Visitor'; // Default if no system trust tag is found
            
            if (tags.includes('system_trust_legend')) rank = 'Legendary';
            else if (tags.includes('system_trust_veteran')) rank = 'Trusted';
            else if (tags.includes('system_trust_trusted')) rank = 'Known';
            else if (tags.includes('system_trust_known')) rank = 'User';
            else if (tags.includes('system_trust_basic')) rank = 'New User';

            // 3. Save to DB
            const audit = await VrcGroupAudit.create({
                vrcUserId: member.userId,
                username: fullInfo.username,
                displayName: fullInfo.displayName,
                trustRank: rank,
                accountAgeDays: ageDays,
                ageVerified: fullInfo.ageVerified || false,
                ageVerified18: fullInfo.ageVerified18 || false,
                joinDate: member.joinedAt,
                status: 'processed'
            });

            // 4. Check Thresholds (Suspicious if Visitor/New User OR < 30 days old)
            const isSuspiciousRank = (rank === 'Visitor' || rank === 'New User');
            const isSuspiciousAge = (ageDays < (parseInt(process.env.VRC_ACCOUNT_AGE_THRESHOLD) || 30));

            if (isSuspiciousRank || isSuspiciousAge) {
                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) {
                    const accountDate = createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                    const groupJoinDate = new Date(member.joinedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                    
                    const ageVerifiedStr = fullInfo.ageVerified18 ? "✅ Verified 18+" : (fullInfo.ageVerified ? "✅ Verified" : "❌ Unverified");

                    // Prioritize VRChat Plus profile pics/icons
                    const userImage = fullInfo.profilePicOverrideThumbnail || 
                                     fullInfo.profilePicOverride || 
                                     fullInfo.userIcon || 
                                     fullInfo.currentAvatarThumbnailImageUrl || 
                                     fullInfo.currentAvatarImageUrl;

                    const embed = new EmbedBuilder()
                        .setTitle(`🛡️ Group Audit: Suspicious Join`)
                        .setColor(isSuspiciousRank ? '#ff9800' : '#29C5F6')
                        .setThumbnail(userImage)
                        .addFields(
                            { name: 'User', value: `**${fullInfo.displayName}** (${fullInfo.username})`, inline: false },
                            { name: 'Trust Rank', value: `**${rank}**`, inline: true },
                            { name: 'Age Verified', value: ageVerifiedStr, inline: true },
                            { name: 'Account Age', value: `${ageDays} days\n*(Created: ${accountDate})*`, inline: true },
                            { name: 'Group Joined', value: groupJoinDate, inline: true },
                            { name: 'Reason', value: `**${[isSuspiciousRank ? '⚠️ Low Trust Rank' : '', isSuspiciousAge ? '🆕 Young Account' : ''].filter(Boolean).join(' | ')}**` }
                        )
                        .setFooter({ text: `VRChat User ID: ${member.userId}` })
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`vrcmod:safe:${member.userId}`)
                            .setLabel('Safe')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`vrcmod:monitor:${member.userId}`)
                            .setLabel('Monitor')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`vrcmod:ban:${member.userId}`)
                            .setLabel('Ban from Group')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await logChannel.send({ embeds: [embed], components: [row] });
                    await audit.update({ alertSent: true });
                }
            }
        }
    } catch (err) {
        console.error("[VRC AUDIT] Error auditing members:", err);
    }
}

/**
 * Posts a partner event announcement embed with instance join button and DJ set list to Discord
 */
async function postPartnerEventAnnouncement(client, partnerEventId, options = {}) {
    if (!client || !client.isReady()) {
        throw new Error('Discord bot is not connected');
    }

    const { PartnerEvent, Partner } = require('../db');
    const evt = await PartnerEvent.findByPk(partnerEventId, {
        include: [{ model: Partner, as: 'partner' }]
    });

    if (!evt || !evt.partner) {
        throw new Error('Partner event record not found');
    }

    const isManualUpcoming = options.isManualUpcoming || false;
    if (isManualUpcoming && (evt.hasPostedDiscordUpcoming || evt.hasPostedDiscordLive)) {
        throw new Error('This event announcement has already been posted to Discord.');
    }

    const partner = evt.partner;
    const now = new Date();
    const isLive = now >= new Date(evt.startTime) && now < new Date(evt.endTime);
    const isEnded = now >= new Date(evt.endTime);

    // Determine target channel
    const channelId = process.env.PARTNER_EVENT_CHANNEL_ID || process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
    if (!channelId) {
        throw new Error('No Discord announcement channel ID configured (PARTNER_EVENT_CHANNEL_ID or DISCORD_ANNOUNCEMENT_CHANNEL_ID)');
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
        throw new Error(`Target channel ${channelId} is invalid or not text-based`);
    }

    // Domain for links
    const domain = process.env.PUBLIC_DOMAIN || 'https://clubfurn.com';
    const showcaseUrl = `${domain}/partner/${partner.slug}`;

    // Format Lineup / Set List
    let lineupText = '';
    if (evt.lineup) {
        try {
            const slots = typeof evt.lineup === 'string' ? JSON.parse(evt.lineup) : evt.lineup;
            if (Array.isArray(slots) && slots.length > 0) {
                lineupText = slots.map(s => {
                    const dj = s.djName || 'TBA';
                    const genre = s.genre ? ` *(${s.genre})*` : '';
                    let timeStr = '';
                    if (s.startUtc && s.endUtc) {
                        const startUnix = Math.floor(new Date(s.startUtc).getTime() / 1000);
                        const endUnix = Math.floor(new Date(s.endUtc).getTime() / 1000);
                        timeStr = `<t:${startUnix}:t> - <t:${endUnix}:t>`;
                    } else if (s.start || s.end) {
                        timeStr = `${s.start || ''} - ${s.end || ''}`;
                    }
                    return `• ${timeStr ? `**${timeStr}**: ` : ''}**${dj}**${genre}`;
                }).join('\n');
            }
        } catch(e) {}
    }

    // Hex Color conversion
    let hexColor = partner.accentColor || '#f2008d';
    if (hexColor.startsWith('#')) hexColor = hexColor.replace('#', '');
    const colorInt = parseInt(hexColor, 16) || 0xf2008d;

    // Status titles, colors, and messages
    let embedTitle = `📅 UPCOMING EVENT: ${evt.title}`;
    let embedColor = colorInt;
    let embedDesc = evt.description || `Join us for **${evt.title}** hosted by **${partner.name}**!`;
    let messageContent = `📅 **New Partner Event Scheduled!**`;

    if (isLive) {
        embedTitle = `⚡ LIVE NOW: ${evt.title}`;
        embedColor = 0xff1744; // Glowing Red
        messageContent = `🚨 **${partner.name} is LIVE NOW in VRChat!** @everyone`;
    } else if (isEnded) {
        embedTitle = `🏁 EVENT CONCLUDED: ${evt.title}`;
        embedColor = 0x555555; // Muted Dark Gray
        embedDesc = `This event hosted by **${partner.name}** has concluded. Thank you to everyone who joined us!`;
        messageContent = `🏁 **This partner event has concluded.**`;
    }

    // Build Embed
    const embed = new EmbedBuilder()
        .setTitle(embedTitle)
        .setURL(showcaseUrl)
        .setColor(embedColor)
        .setDescription(embedDesc)
        .addFields(
            { name: '🏛️ Partner Club', value: `**[${partner.name}](${showcaseUrl})**`, inline: true },
            { name: '🕒 Event Duration', value: `<t:${Math.floor(new Date(evt.startTime).getTime()/1000)}:F>\n(<t:${Math.floor(new Date(evt.startTime).getTime()/1000)}:R>)`, inline: true }
        )
        .setFooter({ text: 'Club FuRN Network • Partner Showcase', iconURL: `${domain}/cdn/logos/club/Logo.png` })
        .setTimestamp();

    if (lineupText) {
        embed.addFields({ name: '🎧 DJ Set List & Timetable', value: lineupText, inline: false });
    }

    // Attach flyer banner image if present
    if (evt.bannerUrl) {
        const fullBannerUrl = evt.bannerUrl.startsWith('http') ? evt.bannerUrl : `${domain}${evt.bannerUrl}`;
        embed.setImage(fullBannerUrl);
    } else if (partner.bannerUrl) {
        const fullBannerUrl = partner.bannerUrl.startsWith('http') ? partner.bannerUrl : `${domain}${partner.bannerUrl}`;
        embed.setImage(fullBannerUrl);
    }

    // Action Row Buttons
    const row = new ActionRowBuilder();

    // Button 1: Instance Join Link (Only show if instance link is explicitly set and event is NOT ended)
    if (evt.eventUrl && evt.eventUrl.trim().length > 0 && !isEnded) {
        row.addComponents(
            new ButtonBuilder()
                .setLabel('🌐 Join VRChat Instance')
                .setStyle(ButtonStyle.Link)
                .setURL(evt.eventUrl.trim())
        );
    }

    // Button 2: Partner Showcase Link
    row.addComponents(
        new ButtonBuilder()
            .setLabel('⭐ View Partner Showcase')
            .setStyle(ButtonStyle.Link)
            .setURL(showcaseUrl)
    );

    let message = null;

    // Check if an existing message was already posted to Discord and edit it in-place
    if (evt.discordMessageId) {
        try {
            const existingMsg = await channel.messages.fetch(evt.discordMessageId);
            if (existingMsg) {
                await existingMsg.edit({
                    content: messageContent,
                    embeds: [embed],
                    components: [row]
                });
                message = existingMsg;
            }
        } catch (e) {
            console.log(`[BOT] Existing message ${evt.discordMessageId} not found, posting new announcement.`);
        }
    }

    if (!message) {
        message = await channel.send({
            content: messageContent,
            embeds: [embed],
            components: [row]
        });
    }

    // Update DB record
    await evt.update({
        hasPostedDiscordUpcoming: isManualUpcoming ? true : evt.hasPostedDiscordUpcoming,
        hasPostedDiscordLive: isLive ? true : evt.hasPostedDiscordLive,
        hasPostedDiscordEnded: isEnded ? true : evt.hasPostedDiscordEnded,
        discordMessageId: message.id
    });

    return { success: true, messageId: message.id };
}

/**
 * Auto-announces partner events when they turn live, and updates them when concluded
 */
async function autoAnnounceLivePartnerEvents(client) {
    if (!client || !client.isReady()) return;
    try {
        const { PartnerEvent, Partner } = require('../db');
        const { Op } = require('sequelize');
        const now = new Date();

        // 1. Auto-announce Live events
        const liveEventsToAnnounce = await PartnerEvent.findAll({
            where: {
                isApproved: true,
                hasPostedDiscordLive: false,
                startTime: { [Op.lte]: now },
                endTime: { [Op.gt]: now }
            },
            include: [{ model: Partner, as: 'partner' }]
        });

        for (const evt of liveEventsToAnnounce) {
            try {
                console.log(`\x1b[35m[BOT] ⚡ Auto-announcing live partner event #${evt.id}: "${evt.title}"\x1b[0m`);
                await postPartnerEventAnnouncement(client, evt.id, { auto: true });
            } catch (err) {
                console.error(`[BOT] Error auto-announcing live partner event #${evt.id}:`, err.message);
            }
        }

        // 2. Auto-update Concluded events
        const endedEventsToUpdate = await PartnerEvent.findAll({
            where: {
                isApproved: true,
                discordMessageId: { [Op.ne]: null },
                hasPostedDiscordEnded: false,
                endTime: { [Op.lte]: now }
            },
            include: [{ model: Partner, as: 'partner' }]
        });

        for (const evt of endedEventsToUpdate) {
            try {
                console.log(`\x1b[35m[BOT] 🏁 Auto-updating concluded partner event #${evt.id}: "${evt.title}"\x1b[0m`);
                await postPartnerEventAnnouncement(client, evt.id, { auto: true });
            } catch (err) {
                console.error(`[BOT] Error auto-updating concluded partner event #${evt.id}:`, err.message);
            }
        }
    } catch (e) {
        console.error('[BOT] Auto-announce partner events error:', e);
    }
}

module.exports = { autoUpdateStatus, getGuildMember, updateBotStatus, downloadFile, createApplicationTicket, joinGuild, auditGroupMembers, postPartnerEventAnnouncement, autoAnnounceLivePartnerEvents };

