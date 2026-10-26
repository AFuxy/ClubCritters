const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    MessageFlags, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    StringSelectMenuBuilder 
} = require('discord.js');
const { EventCall } = require('../db');
const { parseSlotsData } = require('../utils/event-call-utils');

function buildStaffManagePanel(eventCall, selectedIndex = 0) {
    const slots = parseSlotsData(eventCall);
    if (slots.length === 0) {
        return {
            embeds: [new EmbedBuilder().setTitle(`Lineup Checklist Manager — ${eventCall.title}`).setDescription('No slots defined.')],
            components: []
        };
    }
    const slot = slots[selectedIndex] || slots[0];

    const checklistStatusText = slot.isClaimed
        ? `• Set / Audio: ${slot.hasSet ? '✅ Complete' : '❌ Pending'}\n` +
          `• Video Visuals: ${slot.hasVideo ? '✅ Complete' : '❌ Pending'}\n` +
          (eventCall.hasLights ? `• Stage Lights: ${slot.hasLights ? '✅ Complete' : '❌ Pending'}\n` : '')
        : '*Slot is currently OPEN / Unclaimed. Toggle buttons activate once a DJ claims this slot.*';

    const embed = new EmbedBuilder()
        .setTitle(`Lineup Checklist Manager — ${eventCall.title}`)
        .setColor('#29C5F6')
        .setDescription(
            `Use the controls below to verify DJ deliverables and toggle checkmarks on the public tracker.\n\n` +
            `**Currently Managing:** Slot ${slot.index + 1} (${slot.timeSlotStr})\n` +
            `**Performer:** ${slot.isClaimed ? `**${slot.djName}** (<@${slot.claimedByDiscordId}>)` : '*Open Slot*'}\n` +
            `• **Genre:** ${slot.genre || 'N/A'}\n` +
            `• **Set Type:** ${slot.setType || 'N/A'}\n` +
            `• **Visuals Notes:** ${slot.visuals || 'None provided'}\n\n` +
            `**Checklist Status:**\n` +
            checklistStatusText
        )
        .setFooter({ text: 'Private Staff Panel • Changes update the public tracker live' });

    // Select menu to choose slot
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`evt_sel_slot_${eventCall.id}`)
        .setPlaceholder('Select a slot to manage...')
        .addOptions(
            slots.map(s => {
                const label = `Slot ${s.index + 1}: ${s.isClaimed ? s.djName : '[Open]'}`;
                const isAllDone = s.isClaimed && s.hasSet && s.hasVideo && (!eventCall.hasLights || s.hasLights);
                return {
                    label: label.slice(0, 100),
                    description: s.timeSlotStr,
                    value: String(s.index),
                    default: s.index === slot.index,
                    emoji: isAllDone ? '✅' : undefined
                };
            })
        );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    // Toggle buttons row
    const buttonsRow = new ActionRowBuilder();

    buttonsRow.addComponents(
        new ButtonBuilder()
            .setCustomId(`evt_tgl_set_${eventCall.id}_${slot.index}`)
            .setLabel(`Set: ${slot.hasSet ? '✅ Done' : '❌ Missing'}`)
            .setStyle(slot.hasSet ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(!slot.isClaimed),
        new ButtonBuilder()
            .setCustomId(`evt_tgl_vid_${eventCall.id}_${slot.index}`)
            .setLabel(`Video: ${slot.hasVideo ? '✅ Done' : '❌ Missing'}`)
            .setStyle(slot.hasVideo ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(!slot.isClaimed)
    );

    if (eventCall.hasLights) {
        buttonsRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`evt_tgl_lgt_${eventCall.id}_${slot.index}`)
                .setLabel(`Lights: ${slot.hasLights ? '✅ Done' : '❌ Missing'}`)
                .setStyle(slot.hasLights ? ButtonStyle.Success : ButtonStyle.Danger)
                .setDisabled(!slot.isClaimed)
        );
    }

    if (slot.isClaimed) {
        buttonsRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`evt_reopen_${eventCall.id}_${slot.index}`)
                .setLabel('Re-open Slot')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    return { embeds: [embed], components: [selectRow, buttonsRow] };
}

module.exports = {
    buildStaffManagePanel,
    data: new SlashCommandBuilder()
        .setName('event-check')
        .setDescription('Open the private staff control panel to manage the DJ lineup checklist')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.Administrator),

    async execute(interaction) {
        // Find active event call for this channel or latest open call
        let eventCall = await EventCall.findOne({
            where: { coordinationChannelId: interaction.channelId, status: 'open' },
            order: [['createdAt', 'DESC']]
        });

        if (!eventCall) {
            eventCall = await EventCall.findOne({
                where: { channelId: interaction.channelId, status: 'open' },
                order: [['createdAt', 'DESC']]
            });
        }

        if (!eventCall) {
            eventCall = await EventCall.findOne({
                where: { status: 'open' },
                order: [['createdAt', 'DESC']]
            });
        }

        if (!eventCall) {
            return interaction.reply({
                content: '❌ No active event calls found. Run `/event-call` first to create one.',
                flags: MessageFlags.Ephemeral
            });
        }

        const panel = buildStaffManagePanel(eventCall, 0);
        await interaction.reply({
            ...panel,
            flags: MessageFlags.Ephemeral
        });
    }
};
