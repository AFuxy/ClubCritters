const { 
    ContextMenuCommandBuilder, 
    ApplicationCommandType, 
    PermissionFlagsBits, 
    MessageFlags 
} = require('discord.js');
const { EventCall } = require('../db');
const { buildStaffManagePanel } = require('./event-check');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Manage Lineup Checklist')
        .setType(ApplicationCommandType.Message)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const message = interaction.targetMessage;
        
        let eventCall = await EventCall.findOne({
            where: { trackerMessageId: message.id }
        });

        if (!eventCall) {
            eventCall = await EventCall.findOne({
                where: { coordinationChannelId: interaction.channelId, status: 'open' },
                order: [['createdAt', 'DESC']]
            });
        }

        if (!eventCall) {
            eventCall = await EventCall.findOne({
                where: { channelId: interaction.channelId, status: 'open' },
                order: [['createdAt', 'DESC']]
            });
        }

        if (!eventCall) {
            return interaction.reply({
                content: '❌ No active event call linked to this channel or message.',
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
