const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    MessageFlags, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder 
} = require('discord.js');
const { EventCall } = require('../db');
const { 
    buildSlotsData, 
    renderAnnouncementEmbed, 
    buildAnnouncementButtons, 
    getOrCreateCoordinationChannel 
} = require('../utils/event-call-utils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('event-call')
        .setDescription('Post an interactive event lineup call for DJs with slot claiming and coordination')
        .addStringOption(opt => 
            opt.setName('title')
                .setDescription('Event Title (e.g. Club FuRN: Neon Nights)')
                .setRequired(true))
        .addStringOption(opt => 
            opt.setName('date')
                .setDescription('Event Date in YYYY-MM-DD (e.g. 2026-11-14)')
                .setRequired(true))
        .addStringOption(opt => 
            opt.setName('start_utc')
                .setDescription('Starting Time in UTC (e.g. 20:00)')
                .setRequired(true))
        .addIntegerOption(opt => 
            opt.setName('slots')
                .setDescription('Number of time slots (default: 6)')
                .setMinValue(1)
                .setMaxValue(15)
                .setRequired(false))
        .addIntegerOption(opt => 
            opt.setName('duration')
                .setDescription('Minutes per slot (default: 60)')
                .setMinValue(15)
                .setMaxValue(240)
                .setRequired(false))
        .addBooleanOption(opt => 
            opt.setName('has_lights')
                .setDescription('Does the VRChat world support stage lights? (default: False)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const title = interaction.options.getString('title').trim();
        const dateStr = interaction.options.getString('date').trim();
        const startUtcStr = interaction.options.getString('start_utc').trim();
        const slotsCount = interaction.options.getInteger('slots') || 6;
        const duration = interaction.options.getInteger('duration') || 60;
        const hasLights = interaction.options.getBoolean('has_lights') || false;

        // Basic date format validation
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return interaction.editReply({ 
                content: '❌ Invalid date format. Please use **YYYY-MM-DD** (e.g., `2026-11-14`).' 
            });
        }

        // Basic time format validation
        if (!/^\d{1,2}:\d{2}$/.test(startUtcStr)) {
            return interaction.editReply({ 
                content: '❌ Invalid start time format. Please use **HH:mm** in UTC (e.g., `20:00`).' 
            });
        }

        try {
            // 1. Build slot data
            const slotsData = buildSlotsData(dateStr, startUtcStr, slotsCount, duration);

            // 2. Find or create the coordination channel (under Performers category: 1462255416023974111)
            const coordCategory = '1462255416023974111';
            const coordChannel = await getOrCreateCoordinationChannel(interaction.guild, dateStr, coordCategory);

            // 3. Create EventCall record
            const eventCall = await EventCall.create({
                title,
                eventDate: dateStr,
                channelId: interaction.channelId,
                coordinationChannelId: coordChannel.id,
                hasLights,
                slotsData,
                status: 'open'
            });

            // 4. Send the prompt card in the coordination channel for staff
            const promptEmbed = new EmbedBuilder()
                .setTitle(`🛠️ Event Coordination Channel Ready — ${title}`)
                .setColor('#29C5F6')
                .setDescription(
                    `Welcome staff! You can post your welcome, guidelines, and event info message above.\n\n` +
                    `Whenever you are ready, click the button below to generate the **Live Lineup Checklist Tracker** directly underneath your post!`
                );

            const promptRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`evt_post_tracker_${eventCall.id}`)
                    .setLabel('📋 Post Checklist Tracker Here')
                    .setStyle(ButtonStyle.Primary)
            );

            await coordChannel.send({ embeds: [promptEmbed], components: [promptRow] });

            // 5. Send public announcement embed & buttons in the current channel
            const announcementEmbed = renderAnnouncementEmbed(eventCall);
            const announcementButtons = buildAnnouncementButtons(eventCall);

            const currentChannel = interaction.channel || (await interaction.guild?.channels.fetch(interaction.channelId).catch(() => null));
            if (!currentChannel) {
                return interaction.editReply({ content: '❌ Could not access the current channel to post the announcement.' });
            }

            const announcementMsg = await currentChannel.send({
                embeds: [announcementEmbed],
                components: announcementButtons
            });

            // Save message ID to DB
            await eventCall.update({ messageId: announcementMsg.id });

            // 6. Confirm to staff
            await interaction.editReply({
                content: `✅ **Event Lineup Call successfully posted!**\n` +
                         `• **Announcement Channel:** <#${interaction.channelId}>\n` +
                         `• **Coordination Channel:** <#${coordChannel.id}>\n\n` +
                         `*Tip: Go into <#${coordChannel.id}>, type your info/rules post, and click "Post Checklist Tracker Here"!*`
            });

        } catch (err) {
            console.error('[BOT] Error executing /event-call:', err);
            await interaction.editReply({ 
                content: `❌ An error occurred while creating the event call: ${err.message}` 
            });
        }
    }
};
