const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { Roster } = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add-performer')
        .setDescription('Register a new performer/DJ in the database')
        .addUserOption(option => 
            option.setName('user').setDescription('The user to register').setRequired(true))
        .addStringOption(option => 
            option.setName('name').setDescription('Their DJ/Stage name').setRequired(true))
        .addStringOption(option => 
            option.setName('type')
                .setDescription('Their standardized role')
                .setRequired(true)
                .addChoices(
                    { name: 'Host', value: 'Host' },
                    { name: 'Staff', value: 'Staff' },
                    { name: 'Resident', value: 'Resident' },
                    { name: 'Performer', value: 'Performer' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const name = interaction.options.getString('name');
        const type = interaction.options.getString('type');

        try {
            await Roster.upsert({
                discordId: user.id,
                name: name,
                type: type,
                title: "", 
                imageUrl: "", 
                links: {}
            });
            await interaction.reply({ content: `✅ Successfully registered **${name}** (ID: ${user.id})!`, flags: MessageFlags.Ephemeral });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: '❌ Failed to register performer.', flags: MessageFlags.Ephemeral });
        }
    },
};
