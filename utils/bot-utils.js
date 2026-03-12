const { ActivityType, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getInstanceData, getGroupInstanceData, getGroupStats, autoAcceptFriends, updateBotPresence, connectPipeline, closeGroupInstance } = require('./vrc-api');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Automatically determine the bot's status based on current DB state
 */
async function autoUpdateStatus(client) {
    if (!client || !client.user) return;

    const { Settings, Schedule, Roster, InstanceLog } = require('../db');

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

        // 2. Handle Friend Requests (24/7)
        await autoAcceptFriends();

        // 3. Ensure Pipeline is ALWAYS connected (24/7)
        // We pass the current location (even if null) so the responder knows where to invite people
        let currentLocation = null;
        let vrcData = null;

        /**
         * Helper to close an instance via API and clear DB
         */
        const closeVrcInstance = async (location, settings, reason) => {
            if (!location) return;
            console.log(`[VRC AUTO-CLOSE] ${reason}. Terminating instance...`);
            
            // Call universal terminator with full location string
            await closeGroupInstance(location);

            await settings.update({ instanceUrl: null, instanceEmptySince: null });
        };

        if (settings && !settings.forceOffline) {
            const now = new Date();
            const start = new Date(settings.eventStartTime);
            const end = new Date(settings.eventEndTime);

            // Fetch VRChat instance data
            let vrcStats = "";
            
            if (settings.instanceUrl && settings.instanceUrl.includes("worldId=")) {
                vrcData = await getInstanceData(settings.instanceUrl);
            } else {
                vrcData = await getGroupInstanceData(groupId);
            }

            if (vrcData && vrcData.active) {
                vrcStats = ` (${vrcData.count}/${vrcData.capacity})`;
                currentLocation = vrcData.location || settings.instanceUrl;

                // --- AUTO-CLOSE LOGIC ---
                // 1. Check if event is over by 30 mins
                const thirtyMinsAfterEvent = new Date(end.getTime() + 30 * 60000);
                if (now > thirtyMinsAfterEvent) {
                    await closeVrcInstance(currentLocation, settings, "Event ended 30+ mins ago");
                    vrcData.active = false;
                } 
                // 2. Check if instance is empty (0 players) for 10 mins
                else if (vrcData.count === 0) {
                    if (!settings.instanceEmptySince) {
                        await settings.update({ instanceEmptySince: now });
                    } else {
                        const emptyDuration = now - new Date(settings.instanceEmptySince);
                        if (emptyDuration > 10 * 60000) { // 10 minutes
                            await closeVrcInstance(currentLocation, settings, "Instance empty for 10+ mins");
                            vrcData.active = false;
                        }
                    }
                } else {
                    // Reset empty tracker if players are present
                    if (settings.instanceEmptySince) {
                        await settings.update({ instanceEmptySince: null });
                    }
                }
            } else if (settings.instanceEmptySince) {
                // Clean up tracker if instance is no longer active anyway
                await settings.update({ instanceEmptySince: null });
            }

            if (vrcData && vrcData.active) {
                vrcStats = ` (${vrcData.count}/${vrcData.capacity})`;
                currentLocation = vrcData.location || settings.instanceUrl;
            } else {
                vrcStats = "";
                currentLocation = null;
            }

            if (now >= start && now < end) {
                statusText = `🔊 Club is LIVE!${vrcStats}`;
                statusIcon = 'online';
                vrcPresenceStatus = 'join me'; // Blue
                vrcPresenceDesc = `🔊 LIVE! Invite Me to join ${vrcStats}`;
            } else if (now < start) {
                const timeDiff = start - now;
                const totalMinutes = Math.floor(timeDiff / (1000 * 60));
                const hours = Math.floor(totalMinutes / 60);
                const mins = totalMinutes % 60;

                statusIcon = 'online';
                vrcPresenceStatus = 'active'; // Green
                
                let timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                if (totalMinutes < 1) timeStr = "SOON";

                statusText = `⏳ Starting in ${timeStr}${vrcStats}`;
                vrcPresenceDesc = `⏳ Starts in ${timeStr} ${vrcStats}`;
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

        // --- HISTORICAL INSTANCE ANALYTICS ---
        if (currentLocation) {
            const isLive = (new Date() >= new Date(settings.eventStartTime) && new Date() < new Date(settings.eventEndTime));
            
            if (!settings.currentInstanceLogId) {
                // Start a new session log
                const newLog = await InstanceLog.create({
                    instanceId: currentLocation,
                    worldName: (vrcData && vrcData.name) ? vrcData.name : 'Club Critters Hub',
                    isEventSession: isLive,
                    startTime: new Date()
                });
                await settings.update({ currentInstanceLogId: newLog.id });
                console.log(`[ANALYTICS] 📈 Started new instance session log: ${newLog.id} (${newLog.worldName})`);
            } else {
                // Update existing session
                const log = await InstanceLog.findByPk(settings.currentInstanceLogId);
                if (log) {
                    const currentCount = (vrcData && vrcData.active) ? vrcData.count : 0;
                    if (currentCount > log.peakCapacity) {
                        await log.update({ peakCapacity: currentCount });
                    }
                    // If it becomes an event while open, mark it
                    if (isLive && !log.isEventSession) {
                        await log.update({ isEventSession: true });
                    }
                }
            }
        } else if (settings.currentInstanceLogId) {
            // Instance was just cleared, finalize the log
            const log = await InstanceLog.findByPk(settings.currentInstanceLogId);
            if (log) {
                const now = new Date();
                const durationMins = Math.floor((now - new Date(log.startTime)) / 60000);
                await log.update({ 
                    endTime: now,
                    totalDuration: durationMins
                });
                console.log(`[ANALYTICS] 📉 Finalized instance session log: ${log.id} (${durationMins} mins, Peak: ${log.peakCapacity})`);
            }
            await settings.update({ currentInstanceLogId: null });
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
            name: channelName, type: ChannelType.GuildText, parent: categoryId,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }],
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

const { getUserInfo, getGroupMembers, banGroupMember } = require('./vrc-api');

/**
 * Audit VRChat Group Members for suspicious/new accounts
 */
async function auditGroupMembers(client) {
    const { VrcGroupAudit } = require('../db');
    const groupId = process.env.VRC_GROUPID || "CLUBLC.9601";
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

module.exports = { autoUpdateStatus, getGuildMember, updateBotStatus, downloadFile, createApplicationTicket, joinGuild, auditGroupMembers };
