const { ActivityType } = require('discord.js');

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

        if (settings && !settings.forceOffline) {
            const now = new Date();
            const start = new Date(settings.eventStartTime);
            const end = new Date(settings.eventEndTime);

            if (now >= start && now < end) {
                statusText = '🔊 Club is LIVE!';
                statusIcon = 'online';
            } else if (now < start) {
                const timeDiff = start - now;
                const totalMinutes = Math.floor(timeDiff / (1000 * 60));
                const hours = Math.floor(totalMinutes / 60);
                const mins = totalMinutes % 60;

                statusIcon = 'online';
                
                if (hours > 0) {
                    statusText = `⏳ Starting in ${hours}h ${mins}m`;
                } else {
                    statusText = `⏳ Starting in ${mins}m`;
                }
                
                if (totalMinutes < 1) {
                    statusText = `⏳ Starting imminently!`;
                }
            } else {
                statusText = '🌙 Thanks for coming!';
                statusIcon = 'dnd';
            }
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

module.exports = { autoUpdateStatus, getGuildMember, updateBotStatus };
