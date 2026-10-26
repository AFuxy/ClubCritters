const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ChannelType, 
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    StringSelectMenuBuilder
} = require('discord.js');
const { Schedule, Roster, EventCall } = require('../db');

/**
 * Format Date to UTC HH:mm
 */
function formatUtcTime(date) {
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Safely parse slotsData whether it is an Array, string, dictionary object, or model instance
 */
function parseSlotsData(eventCall) {
    if (!eventCall) return [];
    let data = eventCall.slotsData;
    if (typeof data === 'string') {
        if (!data.trim()) return [];
        try {
            data = JSON.parse(data);
        } catch (e) {
            console.error('[EVENT-CALL] Error parsing slotsData JSON:', e);
            return [];
        }
    }
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        const values = Object.values(data);
        if (values.some(v => v && typeof v === 'object' && ('index' in v || 'startTimeUtc' in v || 'timeSlotStr' in v))) {
            return values.filter(v => v && typeof v === 'object' && ('index' in v || 'startTimeUtc' in v || 'timeSlotStr' in v));
        }
    }
    return [];
}

/**
 * Build slots data array from date, start time, slot count, and duration
 */
function buildSlotsData(dateStr, startUtcStr, slotCount = 6, durationMinutes = 60) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [startHour, startMin] = startUtcStr.split(':').map(Number);

    const baseStart = new Date(Date.UTC(year, month - 1, day, startHour || 0, startMin || 0, 0));
    const slots = [];

    for (let i = 0; i < slotCount; i++) {
        const slotStart = new Date(baseStart.getTime() + (i * durationMinutes * 60000));
        const slotEnd = new Date(slotStart.getTime() + (durationMinutes * 60000));
        const startUnix = Math.floor(slotStart.getTime() / 1000);
        const endUnix = Math.floor(slotEnd.getTime() / 1000);
        const timeSlotStr = `${formatUtcTime(slotStart)} - ${formatUtcTime(slotEnd)} UTC`;

        slots.push({
            index: i,
            startTimeUtc: slotStart.toISOString(),
            endTimeUtc: slotEnd.toISOString(),
            startUnix,
            endUnix,
            timeSlotStr,
            startLabel: `${formatUtcTime(slotStart)} UTC`,
            isClaimed: false,
            claimedByDiscordId: null,
            djName: null,
            genre: null,
            setType: null,
            visuals: null,
            hasSet: false,
            hasVideo: false,
            hasLights: false
        });
    }

    return slots;
}

/**
 * Render Public Announcement Embed with Dynamic Discord Timestamps
 */
function renderAnnouncementEmbed(eventCall) {
    const slots = parseSlotsData(eventCall);
    const firstSlot = slots[0];
    const startUnixDesc = firstSlot && Number.isFinite(firstSlot.startUnix) ? firstSlot.startUnix : Math.floor(Date.now() / 1000);

    const embed = new EmbedBuilder()
        .setTitle(`Lineup Call: ${eventCall.title}`)
        .setColor('#29C5F6')
        .setDescription(
            `**Event Date:** <t:${startUnixDesc}:D>\n` +
            `Click an open slot button below to claim your set (first-come, first-served).\n` +
            `Times are displayed in your local device timezone.`
        )
        .setFooter({ text: 'Club FuRN Event System • Times shown in your local timezone' })
        .setTimestamp();

    if (slots.length > 0) {
        slots.forEach(slot => {
            const startUnix = Number.isFinite(slot.startUnix) ? slot.startUnix : 0;
            const endUnix = Number.isFinite(slot.endUnix) ? slot.endUnix : 0;
            if (!slot.isClaimed) {
                embed.addFields({
                    name: `Slot ${slot.index + 1}: ${slot.timeSlotStr || 'TBD'}`,
                    value: `<t:${startUnix}:t> – <t:${endUnix}:t>\n**OPEN**`,
                    inline: false
                });
            } else {
                const b2bInfo = slot.setType && slot.setType.toLowerCase().includes('b2b') ? ` [${slot.setType}]` : '';
                embed.addFields({
                    name: `Slot ${slot.index + 1}: ${slot.timeSlotStr || 'TBD'}`,
                    value: `<t:${startUnix}:t> – <t:${endUnix}:t>\nClaimed by **${slot.djName || 'DJ'}**${b2bInfo} • *${slot.genre || 'Open Format'}*`,
                    inline: false
                });
            }
        });
    }

    return embed;
}

/**
 * Build Announcement Slot Buttons (Up to 5 buttons per row)
 */
function buildAnnouncementButtons(eventCall) {
    const slots = parseSlotsData(eventCall);
    const rows = [];
    let currentRow = new ActionRowBuilder();

    slots.forEach((slot, i) => {
        if (currentRow.components.length >= 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }

        if (!slot.isClaimed) {
            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`evt_claim_${eventCall.id}_${slot.index}`)
                    .setLabel(`Slot ${slot.index + 1} (${slot.startLabel || 'Open'})`)
                    .setStyle(ButtonStyle.Success)
            );
        } else {
            const rawLabel = `Slot ${slot.index + 1}: ${slot.djName || 'Claimed'}`;
            const label = rawLabel.length > 75 ? rawLabel.slice(0, 72) + '...' : rawLabel;
            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`evt_claimed_${slot.index}`)
                    .setLabel(label)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
        }
    });

    if (currentRow.components.length > 0) {
        rows.push(currentRow);
    }

    return rows;
}

/**
 * Render the Lineup Checklist Tracker message for the coordination channel
 */
function renderTrackerContent(eventCall) {
    const slots = parseSlotsData(eventCall);
    const firstSlot = slots[0];

    let lines = [];
    lines.push(`**Lineup Status Tracker — ${eventCall.title}**`);
    if (firstSlot && Number.isFinite(firstSlot.startUnix)) {
        lines.push(`Event Date: <t:${firstSlot.startUnix}:D>`);
    }
    lines.push(`───────────────────────────────────────`);

    slots.forEach(slot => {
        const isAllDone = slot.isClaimed && 
            slot.hasSet && 
            slot.hasVideo && 
            (!eventCall.hasLights || slot.hasLights);

        const statusIcon = isAllDone ? '✅' : '⏳';
        const djLabel = slot.isClaimed ? slot.djName : '[Open Slot]';
        const startUnix = Number.isFinite(slot.startUnix) ? slot.startUnix : 0;

        lines.push(`\n${statusIcon} **<t:${startUnix}:t> – ${djLabel}**`);
        lines.push(`  - Set: ${slot.hasSet ? '✅' : '❌'}`);
        lines.push(`  - Video: ${slot.hasVideo ? '✅' : '❌'}`);
        if (eventCall.hasLights) {
            lines.push(`  - Lights: ${slot.hasLights ? '✅' : '❌'}`);
        }
    });

    return lines.join('\n');
}

/**
 * Find or create #{month}-event-coordination channel under the specified category
 */
async function getOrCreateCoordinationChannel(guild, eventDateStr, categoryId = '1462255416023974111') {
    const [year, month, day] = eventDateStr.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day || 1));
    const monthName = dateObj.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
    const targetChannelName = `${monthName}-event-coordination`;

    // 1. Check if channel already exists
    const channels = await guild.channels.fetch();
    const existing = channels.find(c => 
        c && 
        c.type === ChannelType.GuildText && 
        c.name === targetChannelName && 
        (!categoryId || c.parentId === categoryId)
    );

    if (existing) {
        await existing.setPosition(0, { reason: 'Move coordination channel to top of category' }).catch(() => {});
        return existing;
    }

    // 2. Create channel at the top of the specified category
    const permissionOverwrites = [
        {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: guild.client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];

    // Give staff role access if configured
    const staffRoleId = process.env.DISCORD_ROLE_STAFF;
    if (staffRoleId) {
        permissionOverwrites.push({
            id: staffRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    const createdChannel = await guild.channels.create({
        name: targetChannelName,
        type: ChannelType.GuildText,
        parent: categoryId || null,
        position: 0,
        permissionOverwrites,
        reason: `Event coordination channel for ${monthName}`
    });

    await createdChannel.setPosition(0, { reason: 'Move coordination channel to top of category' }).catch(() => {});

    return createdChannel;
}

/**
 * Synchronize claimed slots into the MySQL Schedule table
 */
async function syncScheduleSlot(slot, isReopen = false) {
    try {
        if (!slot || !slot.startTimeUtc) return;
        const startDate = new Date(slot.startTimeUtc);
        const endDate = new Date(slot.endTimeUtc);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            console.error('[SCHEDULE-SYNC] ❌ Invalid date for slot:', slot.timeSlotStr, slot.startTimeUtc, slot.endTimeUtc);
            return;
        }

        if (isReopen) {
            // Delete from Schedule table if re-opened
            await Schedule.destroy({
                where: {
                    startTimeUtc: startDate
                }
            });
            console.log(`[SCHEDULE-SYNC] 🗑️ Cleared slot for ${slot.timeSlotStr} from Schedule table.`);
            return;
        }

        if (!slot.isClaimed || !slot.claimedByDiscordId) return;

        // Ensure Roster profile exists (prevent foreign key failures)
        let rosterMember = await Roster.findByPk(slot.claimedByDiscordId);
        if (!rosterMember) {
            rosterMember = await Roster.create({
                discordId: slot.claimedByDiscordId,
                name: slot.djName || 'Performer',
                type: JSON.stringify(['Performer']),
                imageUrl: '/cdn/logos/club/Logo.png',
                links: {}
            });
        }

        const b2bName = slot.setType && slot.setType.toLowerCase().includes('b2b')
            ? slot.setType
            : null;

        // Upsert into Schedule
        const existingSlot = await Schedule.findOne({
            where: {
                startTimeUtc: startDate
            }
        });

        if (existingSlot) {
            await existingSlot.update({
                performerId: slot.claimedByDiscordId,
                timeSlot: slot.timeSlotStr,
                genre: slot.genre || 'Multi-Genre',
                b2bName: b2bName,
                endTimeUtc: endDate
            });
            console.log(`[SCHEDULE-SYNC] 🔄 Updated Schedule slot for ${slot.timeSlotStr}: ${slot.djName}`);
        } else {
            await Schedule.create({
                performerId: slot.claimedByDiscordId,
                timeSlot: slot.timeSlotStr,
                genre: slot.genre || 'Multi-Genre',
                b2bName: b2bName,
                startTimeUtc: startDate,
                endTimeUtc: endDate
            });
            console.log(`[SCHEDULE-SYNC] ✅ Inserted Schedule slot for ${slot.timeSlotStr}: ${slot.djName}`);
        }
    } catch (err) {
        console.error('[SCHEDULE-SYNC] ❌ Error synchronizing schedule slot:', err);
    }
}

/**
 * Master dispatcher for all Event Call interactions (buttons, modals, select menus)
 */
async function handleEventCallInteraction(interaction, client) {
    const customId = interaction.customId || '';

    // 1. Post Checklist Tracker Prompt Button Click
    if (customId.startsWith('evt_post_tracker_')) {
        const callId = customId.replace('evt_post_tracker_', '');
        
        // Permission check
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && 
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: '⛔ Only staff members can post the checklist tracker.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const eventCall = await EventCall.findByPk(callId);
        if (!eventCall) {
            return interaction.reply({ content: '❌ Event call not found in database.', flags: MessageFlags.Ephemeral });
        }

        const trackerText = renderTrackerContent(eventCall);
        const targetChannel = interaction.channel || (interaction.channelId ? await client.channels.fetch(interaction.channelId).catch(() => null) : null);
        if (!targetChannel) {
            return interaction.reply({ content: '❌ Could not find coordination channel.', flags: MessageFlags.Ephemeral });
        }
        const trackerMsg = await targetChannel.send({ content: trackerText });

        await eventCall.update({ trackerMessageId: trackerMsg.id });
        await interaction.message.delete().catch(() => {});

        return interaction.reply({
            content: '**Lineup Checklist Tracker posted.**\nRight-click it anytime → Apps → **Manage Lineup Checklist** (or run `/event-check`) to update checkmarks.',
            flags: MessageFlags.Ephemeral
        });
    }

    // 2. DJ Clicks Open Slot Button
    if (customId.startsWith('evt_claim_')) {
        const parts = customId.split('_');
        const callId = parts[2];
        const slotIndex = parseInt(parts[3], 10);

        const eventCall = await EventCall.findByPk(callId);
        if (!eventCall) {
            return interaction.reply({ content: '❌ Event call not found.', flags: MessageFlags.Ephemeral });
        }

        const slots = parseSlotsData(eventCall);
        const slot = slots[slotIndex];
        if (!slot) {
            return interaction.reply({ content: '❌ Slot not found.', flags: MessageFlags.Ephemeral });
        }

        if (slot.isClaimed) {
            return interaction.reply({ 
                content: '⚠️ This slot has already been claimed! Please select another open slot.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        // Show Modal
        const modal = new ModalBuilder()
            .setCustomId(`evt_modal_claim_${callId}_${slotIndex}`)
            .setTitle(`Claim Slot ${slotIndex + 1} (${slot.startLabel})`);

        const genreInput = new TextInputBuilder()
            .setCustomId('genre')
            .setLabel('Style / Genre(s) you will be playing')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. Future House, Bass, Techno...')
            .setRequired(true)
            .setMaxLength(100);

        const typeInput = new TextInputBuilder()
            .setCustomId('set_type')
            .setLabel('Performance Type: Solo or B2B?')
            .setStyle(TextInputStyle.Short)
            .setValue('Solo')
            .setPlaceholder('e.g. Solo or B2B with @DJ...')
            .setRequired(true)
            .setMaxLength(100);

        const visualsInput = new TextInputBuilder()
            .setCustomId('visuals')
            .setLabel(eventCall.hasLights ? 'Visuals / Stage Lights' : 'Video Visuals / Overlay')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(eventCall.hasLights ? 'Will you stream your own video or control world stage lights?' : 'Will you stream your own video visuals / overlay?')
            .setRequired(false)
            .setMaxLength(300);

        modal.addComponents(
            new ActionRowBuilder().addComponents(genreInput),
            new ActionRowBuilder().addComponents(typeInput),
            new ActionRowBuilder().addComponents(visualsInput)
        );

        return interaction.showModal(modal);
    }

    // 3. DJ Submits Claim Modal
    if (customId.startsWith('evt_modal_claim_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const parts = customId.split('_');
        const callId = parts[3];
        const slotIndex = parseInt(parts[4], 10);

        const eventCall = await EventCall.findByPk(callId);
        if (!eventCall) {
            return interaction.editReply({ content: '❌ Event call not found.' });
        }

        const slots = parseSlotsData(eventCall);
        const slot = slots[slotIndex];
        if (!slot || slot.isClaimed) {
            return interaction.editReply({ 
                content: '⚠️ Sorry! Another DJ just claimed this slot a few seconds ago. Please select another open slot.' 
            });
        }

        // Determine DJ Name: check website Roster first
        let djName = null;
        let rosterMember = await Roster.findByPk(interaction.user.id);
        if (rosterMember) {
            djName = rosterMember.name;
        } else {
            djName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
            // Provision in Roster to prevent foreign key errors
            await Roster.create({
                discordId: interaction.user.id,
                name: djName,
                type: JSON.stringify(['Performer']),
                imageUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 512 }) || '',
                links: {}
            }).catch(() => {});
        }

        const genre = interaction.fields.getTextInputValue('genre').trim();
        const setType = interaction.fields.getTextInputValue('set_type').trim();
        const visuals = interaction.fields.getTextInputValue('visuals').trim();

        // Update slot in eventCall
        slots[slotIndex] = {
            ...slot,
            isClaimed: true,
            claimedByDiscordId: interaction.user.id,
            djName,
            genre,
            setType,
            visuals,
            hasSet: false,
            hasVideo: false,
            hasLights: false
        };

        eventCall.slotsData = slots;
        eventCall.changed('slotsData', true);
        await eventCall.save();

        // Sync with MySQL Schedule table
        await syncScheduleSlot(slots[slotIndex], false);

        // Update Public Announcement Message
        try {
            const annChannel = await client.channels.fetch(eventCall.channelId);
            if (annChannel) {
                const annMsg = await annChannel.messages.fetch(eventCall.messageId).catch(() => null);
                if (annMsg) {
                    await annMsg.edit({
                        embeds: [renderAnnouncementEmbed(eventCall)],
                        components: buildAnnouncementButtons(eventCall)
                    });
                }
            }
        } catch (msgErr) {
            console.error('[EVENT-CALL] Failed to update announcement message:', msgErr.message);
        }

        // Add DJ to Coordination Channel
        try {
            const coordChannel = await client.channels.fetch(eventCall.coordinationChannelId);
            if (coordChannel) {
                // Grant DJ channel permissions
                await coordChannel.permissionOverwrites.create(interaction.user.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true
                });

                // Update Tracker Message if present
                if (eventCall.trackerMessageId) {
                    const trackerMsg = await coordChannel.messages.fetch(eventCall.trackerMessageId).catch(() => null);
                    if (trackerMsg) {
                        await trackerMsg.edit({ content: renderTrackerContent(eventCall) });
                    }
                }
            }
        } catch (coordErr) {
            console.error('[EVENT-CALL] Failed to update coordination channel:', coordErr.message);
        }

        return interaction.editReply({
            content: `**Slot ${slotIndex + 1} (${slot.timeSlotStr}) successfully claimed.**\n` +
                     `You have been added to <#${eventCall.coordinationChannelId}>. Head over there for event coordination!`
        });
    }

    // 4. Staff Selects Slot in Checklist Management Panel
    if (customId.startsWith('evt_sel_slot_')) {
        const callId = customId.replace('evt_sel_slot_', '');
        const eventCall = await EventCall.findByPk(callId);
        if (!eventCall) {
            return interaction.reply({ content: '❌ Event call not found.', flags: MessageFlags.Ephemeral });
        }

        const { buildStaffManagePanel } = require('../commands/event-check');
        const selectedIndex = parseInt(interaction.values[0], 10) || 0;
        const panel = buildStaffManagePanel(eventCall, selectedIndex);
        return interaction.update(panel);
    }

    // 5. Staff Toggles Set / Video / Lights
    if (customId.startsWith('evt_tgl_')) {
        // Staff permission check
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && 
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: '⛔ Only staff members can toggle checklist items.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const parts = customId.split('_');
        const action = parts[2]; // 'set', 'vid', 'lgt'
        const callId = parts[3];
        const slotIndex = parseInt(parts[4], 10);

        const eventCall = await EventCall.findByPk(callId);
        if (!eventCall) {
            return interaction.reply({ content: '❌ Event call not found.', flags: MessageFlags.Ephemeral });
        }

        const slots = parseSlotsData(eventCall);
        if (!slots[slotIndex]) {
            return interaction.reply({ content: '❌ Slot not found.', flags: MessageFlags.Ephemeral });
        }

        if (action === 'set') slots[slotIndex].hasSet = !slots[slotIndex].hasSet;
        if (action === 'vid') slots[slotIndex].hasVideo = !slots[slotIndex].hasVideo;
        if (action === 'lgt') slots[slotIndex].hasLights = !slots[slotIndex].hasLights;

        eventCall.slotsData = slots;
        eventCall.changed('slotsData', true);
        await eventCall.save();

        // Update Tracker Message in coordination channel
        if (eventCall.trackerMessageId) {
            try {
                const coordChannel = await client.channels.fetch(eventCall.coordinationChannelId);
                const trackerMsg = await coordChannel?.messages.fetch(eventCall.trackerMessageId).catch(() => null);
                if (trackerMsg) {
                    await trackerMsg.edit({ content: renderTrackerContent(eventCall) });
                }
            } catch (e) {}
        }

        const { buildStaffManagePanel } = require('../commands/event-check');
        const panel = buildStaffManagePanel(eventCall, slotIndex);
        return interaction.update(panel);
    }

    // 6. Staff Re-opens a Slot
    if (customId.startsWith('evt_reopen_')) {
        // Staff permission check
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && 
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: '⛔ Only staff members can re-open slots.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const parts = customId.split('_');
        const callId = parts[2];
        const slotIndex = parseInt(parts[3], 10);

        const eventCall = await EventCall.findByPk(callId);
        if (!eventCall) {
            return interaction.reply({ content: '❌ Event call not found.', flags: MessageFlags.Ephemeral });
        }

        const slots = parseSlotsData(eventCall);
        const slot = slots[slotIndex];
        if (!slot) {
            return interaction.reply({ content: '❌ Slot not found.', flags: MessageFlags.Ephemeral });
        }

        // Clear slot from MySQL Schedule
        await syncScheduleSlot(slot, true);

        // Reset slot data
        slots[slotIndex] = {
            ...slot,
            isClaimed: false,
            claimedByDiscordId: null,
            djName: null,
            genre: null,
            setType: null,
            visuals: null,
            hasSet: false,
            hasVideo: false,
            hasLights: false
        };

        eventCall.slotsData = slots;
        eventCall.changed('slotsData', true);
        await eventCall.save();

        // Update announcement message (re-enables slot button and marks OPEN)
        try {
            const annChannel = await client.channels.fetch(eventCall.channelId);
            const annMsg = await annChannel?.messages.fetch(eventCall.messageId).catch(() => null);
            if (annMsg) {
                await annMsg.edit({
                    embeds: [renderAnnouncementEmbed(eventCall)],
                    components: buildAnnouncementButtons(eventCall)
                });
            }
        } catch (e) {}

        // Update tracker message & manage channel access
        try {
            const coordChannel = await client.channels.fetch(eventCall.coordinationChannelId);
            if (coordChannel) {
                // If the DJ has no other slots in this event, revoke coordination channel access
                if (slot.claimedByDiscordId) {
                    const hasOtherSlots = slots.some((s, idx) => idx !== slotIndex && s.isClaimed && s.claimedByDiscordId === slot.claimedByDiscordId);
                    if (!hasOtherSlots) {
                        await coordChannel.permissionOverwrites.delete(slot.claimedByDiscordId).catch(() => {});
                    }
                }

                if (eventCall.trackerMessageId) {
                    const trackerMsg = await coordChannel.messages.fetch(eventCall.trackerMessageId).catch(() => null);
                    if (trackerMsg) {
                        await trackerMsg.edit({ content: renderTrackerContent(eventCall) });
                    }
                }
            }
        } catch (e) {}

        const { buildStaffManagePanel } = require('../commands/event-check');
        const panel = buildStaffManagePanel(eventCall, slotIndex);
        return interaction.update(panel);
    }
}

module.exports = {
    formatUtcTime,
    parseSlotsData,
    buildSlotsData,
    renderAnnouncementEmbed,
    buildAnnouncementButtons,
    renderTrackerContent,
    getOrCreateCoordinationChannel,
    syncScheduleSlot,
    handleEventCallInteraction
};
