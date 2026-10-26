const { Client, GatewayIntentBits, Events, REST, Routes, Collection, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { autoUpdateStatus, getGuildMember, updateBotStatus, downloadFile, joinGuild, auditGroupMembers, autoAnnounceLivePartnerEvents, archiveTicketChannel } = require('./utils/bot-utils');
const { checkAndCloseEventCalls } = require('./utils/event-call-utils');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Load Commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

const slashCommands = [];

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        slashCommands.push(command.data.toJSON());
    } else {
        console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Register Slash Commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

async function registerSlashCommands() {
    try {
        console.log(`[BOT] 📡 Refreshing ${slashCommands.length} slash commands...`);
        // Overwrites and deletes any removed guild commands (e.g. /add-performer)
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: slashCommands },
        );
        // Clear any global commands so no duplicate or ghost commands linger
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: [] }
        ).catch(() => {});
        console.log('\x1b[32m[BOT] ✅ Slash commands synced (old commands removed).\x1b[0m');
    } catch (error) {
        console.error('\x1b[31m[BOT] ❌ Error registering slash commands:\x1b[0m', error);
    }
}

// --- EVENTS ---

client.once(Events.ClientReady, (c) => {
    console.log(`\x1b[35m[BOT] 💜 Discord Bot logged in as ${c.user.tag}\x1b[0m`);
    registerSlashCommands();
    
    // Partner Event Live Announcements Loop (Every 60s)
    setInterval(() => autoAnnounceLivePartnerEvents(client), 60000);
    setTimeout(() => autoAnnounceLivePartnerEvents(client), 5000);

    // Event Call Auto-Close Check Loop (Every 60s)
    setInterval(() => checkAndCloseEventCalls(client), 60000);
    setTimeout(() => checkAndCloseEventCalls(client), 5000);

    // VRChat Status & Group Audit Loops
    if (process.env.DISABLE_VRC_BOT !== 'true') {
        setInterval(() => autoUpdateStatus(client), 60000);
        autoUpdateStatus(client);

        // Group Audit Loop (Every 10 minutes)
        setInterval(() => auditGroupMembers(client), 600000);
        setTimeout(() => auditGroupMembers(client), 15000); // Initial run
    } else {
        console.log(`\x1b[33m[BOT] ⚠️ VRChat Status & Audit updates DISABLED (DISABLE_VRC_BOT=true)\x1b[0m`);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (process.env.DISABLE_VRC_BOT === 'true') return;

    // 1. Handle Slash & Context Menu Commands
    if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: 'There was an error while executing this command!' }).catch(() => {});
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
        return;
    }

    // 2. Handle Event Call Interactions (Slot Claims, Modals, Trackers, Checklist Toggles)
    if (interaction.customId && interaction.customId.startsWith('evt_')) {
        const { handleEventCallInteraction } = require('./utils/event-call-utils');
        return await handleEventCallInteraction(interaction, client).catch(err => {
            if (err?.code === 10062) {
                console.warn('[EVENT-CALL] Interaction expired before completion (Discord 10062).');
            } else {
                console.error('[EVENT-CALL] Error handling interaction:', err);
            }
        });
    }

    // 2. Handle Application Buttons
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('app_')) {
            const { ApplicationSubmission, AppSlot } = require('./db');
            const parts = interaction.customId.split('_');
            const action = parts[1]; // 'approve' or 'deny'
            const submissionId = parts[2];

            try {
                const submission = await ApplicationSubmission.findByPk(submissionId, { include: [AppSlot] });
                if (!submission) return interaction.reply({ content: "❌ Submission not found in database.", flags: MessageFlags.Ephemeral });

                if (action === 'approve') {
                    await submission.update({ status: 'accepted' });
                    const slot = submission.AppSlot;

                    // 1. Give Discord Role if configured
                    let discordRoleStatus = null;
                    if (slot?.giveDiscordRole && slot?.discordRoleId) {
                        try {
                            const guildId = interaction.guildId || process.env.DISCORD_GUILD_ID;
                            let guild = interaction.guild;
                            if (!guild && guildId) {
                                guild = await client.guilds.fetch(guildId).catch(() => null);
                            }
                            if (guild) {
                                const member = await guild.members.fetch(submission.discordId).catch(() => null);
                                if (member) {
                                    await member.roles.add(slot.discordRoleId);
                                    discordRoleStatus = `✅ Added Role <@&${slot.discordRoleId}>`;
                                } else {
                                    discordRoleStatus = `⚠️ User not found in Discord server`;
                                }
                            } else {
                                discordRoleStatus = `⚠️ Could not access Discord server`;
                            }
                        } catch (roleErr) {
                            console.error("[BOT] Failed to add Discord role on app approval:", roleErr);
                            discordRoleStatus = `❌ Role assign failed: ${roleErr.message}`;
                        }
                    }

                    // 2. Auto-Create / Update Website Account if configured
                    let rosterStatus = null;
                    let siteAccountCreatedOrUpdated = false;
                    if (slot?.createSiteAccount) {
                        try {
                            const { Roster } = require('./db');
                            let siteRolesToAdd = ['Performer'];
                            if (slot.siteRoles) {
                                try {
                                    const parsed = JSON.parse(slot.siteRoles);
                                    if (Array.isArray(parsed) && parsed.length > 0) siteRolesToAdd = parsed;
                                } catch (e) {
                                    if (typeof slot.siteRoles === 'string') {
                                        siteRolesToAdd = slot.siteRoles.split(',').map(s => s.trim()).filter(Boolean);
                                    }
                                }
                            }

                            const existingRoster = await Roster.findByPk(submission.discordId);
                            if (existingRoster) {
                                let existingRoles = [];
                                const raw = existingRoster.type;
                                if (Array.isArray(raw)) {
                                    existingRoles = raw;
                                } else if (typeof raw === 'string') {
                                    if (raw.startsWith('[') && raw.endsWith(']')) {
                                        try { existingRoles = JSON.parse(raw); } catch (e) {}
                                    } else {
                                        existingRoles = raw.split(/\s*,\s*|\s*\/\s*/).filter(Boolean);
                                    }
                                }
                                let addedAny = false;
                                for (const r of siteRolesToAdd) {
                                    if (!existingRoles.some(er => er.toLowerCase() === r.toLowerCase())) {
                                        existingRoles.push(r);
                                        addedAny = true;
                                    }
                                }
                                if (addedAny) {
                                    await existingRoster.update({ type: JSON.stringify(existingRoles) });
                                }
                                rosterStatus = `✅ Profile updated with: **${siteRolesToAdd.join(', ')}**`;
                                siteAccountCreatedOrUpdated = true;
                            } else {
                                let applicantUser = null;
                                try {
                                    applicantUser = await client.users.fetch(submission.discordId);
                                } catch (e) {}

                                let displayName = applicantUser ? (applicantUser.globalName || applicantUser.username) : (submission.discordTag || 'New Member');
                                let vrcUserId = null;
                                let vrcDisplayName = null;

                                if (submission.answers) {
                                    const answers = typeof submission.answers === 'string' ? JSON.parse(submission.answers) : submission.answers;
                                    for (const [key, val] of Object.entries(answers)) {
                                        if (typeof val === 'string' && val.trim()) {
                                            const kLower = key.toLowerCase();
                                            if (kLower.includes('dj name') || kLower.includes('stage name') || kLower.includes('performer name') || (kLower.includes('name') && !applicantUser?.globalName)) {
                                                displayName = val.trim();
                                            }
                                            if (kLower.includes('vrchat') || kLower.includes('vrc')) {
                                                const match = val.match(/usr_[a-f0-9-]+/i);
                                                if (match) {
                                                    vrcUserId = match[0];
                                                } else {
                                                    vrcDisplayName = val.trim();
                                                }
                                            }
                                        }
                                    }
                                }

                                const avatarUrl = applicantUser && applicantUser.avatar
                                    ? applicantUser.displayAvatarURL({ extension: 'png', size: 512 })
                                    : '/cdn/logos/club/Logo.png';

                                await Roster.create({
                                    discordId: submission.discordId,
                                    name: displayName || 'New Member',
                                    type: JSON.stringify(siteRolesToAdd),
                                    title: '',
                                    imageUrl: avatarUrl,
                                    links: {},
                                    vrcUserId: vrcUserId,
                                    vrcDisplayName: vrcDisplayName
                                });
                                rosterStatus = `✅ Created site profile as **${displayName}** (${siteRolesToAdd.join(', ')})`;
                                siteAccountCreatedOrUpdated = true;
                            }
                        } catch (rosterErr) {
                            console.error("[BOT] Failed to create/update roster account on app approval:", rosterErr);
                            rosterStatus = `❌ Site profile error: ${rosterErr.message}`;
                        }
                    }

                    const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
                    const fields = originalEmbed.data.fields.map(f => {
                        if (f.name === 'Status') return { ...f, value: 'ACCEPTED' };
                        return f;
                    });
                    originalEmbed.setFields(fields);
                    originalEmbed.addFields({ name: 'Decision By', value: `<@${interaction.user.id}>`, inline: true });
                    if (discordRoleStatus) {
                        originalEmbed.addFields({ name: 'Discord Role', value: discordRoleStatus, inline: false });
                    }
                    if (rosterStatus) {
                        originalEmbed.addFields({ name: 'Website Account', value: rosterStatus, inline: false });
                    }
                    originalEmbed.setColor('#00e676');

                    await interaction.update({ 
                        content: `📢 **Application Processed: ACCEPTED**`,
                        embeds: [originalEmbed],
                        components: [] 
                    });

                    // DM Applicant
                    try {
                        const applicant = await client.users.fetch(submission.discordId);
                        let dmContent = `✨ **Congratulations!** Your application for **${slot?.roleName || 'Club FuRN'}** has been **ACCEPTED**!\n\n`;
                        if (siteAccountCreatedOrUpdated) {
                            dmContent += `🌐 **Website Profile:** An account has been created/updated for you on our site! You can log in via Discord at https://clubfurn.com/panel to customize your bio, links, and avatar.\n\n`;
                        }
                        if (discordRoleStatus && discordRoleStatus.startsWith('✅')) {
                            dmContent += `🏷️ **Discord Role:** You have been granted your role in our Discord server!\n\n`;
                        }
                        dmContent += `A staff member will also be in touch shortly. Welcome to the team! 🎉`;

                        await applicant.send({ content: dmContent });
                    } catch (e) { console.log(`[BOT] Could not DM applicant ${submission.discordId} (DMs closed)`); }

                    // Move ticket channel to top of Archive category
                    const ticketChannel = interaction.channel || (interaction.channelId ? await client.channels.fetch(interaction.channelId).catch(() => null) : null);
                    if (ticketChannel) {
                        await archiveTicketChannel(ticketChannel, `Application accepted by ${interaction.user.tag}`, client);
                    } else {
                        console.warn(`[BOT] ⚠️ Could not find ticket channel to archive for accepted submission #${submission.id}`);
                    }

                } else if (action === 'deny') {
                    console.log(`[BOT] 🔴 Staff ${interaction.user.tag} clicked Deny on submission #${submissionId}. Showing modal...`);
                    // Show Modal for reason
                    const modal = new ModalBuilder()
                        .setCustomId(`app_deny_modal_${submissionId}`)
                        .setTitle('Deny Application');

                    const reasonInput = new TextInputBuilder()
                        .setCustomId('deny_reason')
                        .setLabel("Reason for denial (Optional)")
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder("e.g. Needs more experience, Not a fit at this time...")
                        .setRequired(false)
                        .setMaxLength(500);

                    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                    await interaction.showModal(modal);
                }

            } catch (err) {
                console.error("[BOT] Failed to process application button:", err);
                if (!interaction.replied) await interaction.reply({ content: "❌ Failed to update status.", flags: MessageFlags.Ephemeral });
            }
        }

        // 2.1 Handle VRChat Moderation Buttons
        if (interaction.customId.startsWith('vrcmod:')) {
            const { VrcGroupAudit } = require('./db');
            const { banGroupMember } = require('./utils/vrc-api');
            const parts = interaction.customId.split(':');
            const action = parts[1]; // 'safe', 'monitor' or 'ban'
            const vrcUserId = parts[2];

            try {
                const audit = await VrcGroupAudit.findByPk(vrcUserId);
                if (!audit) return interaction.reply({ content: "❌ Audit record not found.", flags: MessageFlags.Ephemeral });

                const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

                if (action === 'safe') {
                    await audit.update({ status: 'processed' });
                    originalEmbed.setColor('#00e676');
                    originalEmbed.addFields({ name: 'Action Taken', value: `✅ Marked as Safe by <@${interaction.user.id}>` });
                    
                    await interaction.update({ 
                        content: `✅ User **${audit.displayName}** has been marked as safe.`,
                        embeds: [originalEmbed],
                        components: [] 
                    });
                } else if (action === 'monitor') {
                    await audit.update({ status: 'monitored' });
                    originalEmbed.setColor('#B36AF4');
                    originalEmbed.addFields({ name: 'Action Taken', value: `👀 Marked for Monitoring by <@${interaction.user.id}>` });
                    
                    await interaction.update({ 
                        content: `✅ User **${audit.displayName}** is now being monitored.`,
                        embeds: [originalEmbed],
                        components: [] 
                    });
                } else if (action === 'ban') {
                    const success = await banGroupMember(process.env.VRC_GROUPID || "FURN.9601", vrcUserId);
                    if (success) {
                        await audit.update({ status: 'banned' });
                        originalEmbed.setColor('#ff4444');
                        originalEmbed.addFields({ name: 'Action Taken', value: `🔨 BANNED from Group by <@${interaction.user.id}>` });
                        
                        await interaction.update({ 
                            content: `🔨 User **${audit.displayName}** has been banned from the VRChat Group.`,
                            embeds: [originalEmbed],
                            components: [] 
                        });
                    } else {
                        await interaction.reply({ content: "❌ Failed to ban user from VRChat group. Check bot permissions.", flags: MessageFlags.Ephemeral });
                    }
                }
            } catch (err) {
                console.error("[BOT] Mod Error:", err);
                if (!interaction.replied) await interaction.reply({ content: "❌ Error processing action.", flags: MessageFlags.Ephemeral });
            }
        }
    }

    // 3. Handle Modal Submissions
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('app_deny_modal_')) {
            const { ApplicationSubmission, AppSlot } = require('./db');
            const submissionId = interaction.customId.split('_')[3];
            const rawReason = interaction.fields.getTextInputValue('deny_reason');
            
            const reason = rawReason || "We don't have specific feedback to share at this time, but we really appreciate your interest in the team! Please don't let this discourage you from applying again in the future.";
            const dmReason = rawReason ? `**Reason provided:** ${rawReason}` : "The team didn't provide specific feedback this time, but we'd love to see you keep hanging out in the community and apply again during our next recruitment cycle!";

            try {
                console.log(`[BOT] 📝 Processing denial modal for submission ID #${submissionId}...`);
                const submission = await ApplicationSubmission.findByPk(submissionId, { include: [AppSlot] });
                if (!submission) {
                    console.warn(`[BOT] ⚠️ Submission #${submissionId} not found in database.`);
                    if (!interaction.replied) await interaction.reply({ content: "❌ Submission not found in database.", flags: MessageFlags.Ephemeral });
                    return;
                }

                await submission.update({ status: 'declined' });
                console.log(`[BOT] ❌ Marked submission #${submission.id} as DECLINED in database.`);

                let originalEmbed;
                if (interaction.message?.embeds?.[0]) {
                    originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
                    const fields = (originalEmbed.data.fields || []).map(f => {
                        if (f.name === 'Status') return { ...f, value: 'DECLINED' };
                        return f;
                    });
                    originalEmbed.setFields(fields);
                } else {
                    originalEmbed = new EmbedBuilder()
                        .setTitle(`Application: ${submission.AppSlot?.roleName || 'Recruitment'}`)
                        .addFields(
                            { name: 'Applicant', value: `<@${submission.discordId}> (${submission.discordTag})`, inline: true },
                            { name: 'Status', value: 'DECLINED', inline: true }
                        );
                }

                originalEmbed.addFields(
                    { name: 'Decision By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                );
                originalEmbed.setColor('#ff5252');

                if (interaction.message) {
                    await interaction.update({ 
                        content: `📢 **Application Processed: DECLINED**`,
                        embeds: [originalEmbed],
                        components: [] 
                    });
                } else {
                    await interaction.reply({ 
                        content: `📢 **Application Processed: DECLINED**`,
                        embeds: [originalEmbed] 
                    });
                }

                // DM Applicant
                try {
                    const applicant = await client.users.fetch(submission.discordId);
                    await applicant.send({
                        content: `📩 **Update on your application:** Your application for **${submission.AppSlot?.roleName || 'Club FuRN'}** at Club FuRN has been **DECLINED**. \n\n${dmReason}`
                    });
                    console.log(`[BOT] 📬 Sent decline DM to ${submission.discordId}`);
                } catch (e) { console.log(`[BOT] Could not DM applicant ${submission.discordId} (DMs closed)`); }

                // Move ticket channel to top of Archive category
                const ticketChannel = interaction.channel || (interaction.channelId ? await client.channels.fetch(interaction.channelId).catch(() => null) : null);
                if (ticketChannel) {
                    await archiveTicketChannel(ticketChannel, `Application declined by ${interaction.user.tag}`, client);
                } else {
                    console.warn(`[BOT] ⚠️ Could not find ticket channel to archive for denied submission #${submission.id}`);
                }

            } catch (err) {
                console.error("[BOT] Modal Error:", err);
                if (!interaction.replied) {
                    await interaction.reply({ content: `❌ Error processing denial: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            }
        }
    }
});

// Gallery Sync Listener
client.on(Events.MessageCreate, async message => {
    if (process.env.DISABLE_VRC_BOT === 'true') return;
    if (message.author.bot) return;
    if (message.channelId !== process.env.DISCORD_GALLERY_CH_ID) return;

    const { Gallery } = require('./db');

    if (message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                try {
                    const baseName = `${message.id}_${attachment.id}`;
                    const localFiles = await downloadFile(attachment.url, baseName);

                    await Gallery.upsert({
                        messageId: message.id,
                        attachmentId: attachment.id,
                        imageUrl: localFiles.imageUrl,
                        thumbnailUrl: localFiles.thumbnailUrl,
                        uploaderId: message.author.id,
                        caption: message.content || "",
                        timestamp: message.createdAt
                    });
                    console.log(`\x1b[32m[GALLERY] 📸 Synced & Compressed photo ${attachment.id} from ${message.author.username}\x1b[0m`);
                } catch (err) {
                    console.error("[GALLERY] Error syncing photo:", err);
                }
            }
        }
    }
});

client.on(Events.MessageDelete, async message => {
    if (process.env.DISABLE_VRC_BOT === 'true') return;
    if (message.channelId !== process.env.DISCORD_GALLERY_CH_ID) return;
    const { Gallery } = require('./db');
    try {
        const records = await Gallery.findAll({ where: { messageId: message.id } });
        for (const rec of records) {
            const fullPath = path.join(__dirname, 'public', rec.imageUrl);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        await Gallery.destroy({ where: { messageId: message.id } });
        console.log(`\x1b[33m[GALLERY] 🗑️ Removed all photos and local files from deleted message: ${message.id}\x1b[0m`);
    } catch (e) {}
});

client.login(process.env.DISCORD_BOT_TOKEN);

// Export utilities so server.js can use them
module.exports = { 
    client, 
    getGuildMember: (userId) => getGuildMember(client, userId), 
    updateBotStatus: (statusText) => updateBotStatus(client, statusText),
    joinGuild: (userId, accessToken) => joinGuild(client, userId, accessToken),
    getDiscordStatus: () => {
        if (!client || !client.user) return "Offline";
        const status = client.isReady() ? "Connected" : "Connecting";
        if (process.env.DISABLE_VRC_BOT === 'true') return `${status} (Limited)`;
        return status;
    }
};
