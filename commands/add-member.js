const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { Roster } = require('../db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add-member')
        .setDescription('Register a new member in the Club FuRN roster database')
        .addUserOption(option => 
            option.setName('user').setDescription('The Discord user to register').setRequired(true))
        .addStringOption(option => 
            option.setName('name').setDescription('Their DJ, Stage, or Display name').setRequired(true))
        .addStringOption(option => 
            option.setName('role')
                .setDescription('Their primary role in Club FuRN')
                .setRequired(true)
                .addChoices(
                    { name: 'Resident (Resident DJ / Artist)', value: 'Resident' },
                    { name: 'Performer (Guest Performer / DJ)', value: 'Performer' },
                    { name: 'Staff (Club Staff / Crew)', value: 'Staff' },
                    { name: 'Partner (Partner Community Lead)', value: 'Partner' },
                    { name: 'VIP (Community VIP)', value: 'VIP' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const name = interaction.options.getString('name');
        const role = interaction.options.getString('role');

        try {
            // Check if member already exists
            const existing = await Roster.findByPk(user.id);
            if (existing) {
                let existingRoles = [];
                const raw = existing.type;
                if (Array.isArray(raw)) existingRoles = raw;
                else if (typeof raw === 'string') {
                    if (raw.startsWith('[') && raw.endsWith(']')) {
                        try { existingRoles = JSON.parse(raw); } catch(e) {}
                    } else {
                        existingRoles = raw.split(/\s*,\s*|\s*\/\s*/).filter(Boolean);
                    }
                }
                
                if (!existingRoles.some(r => r.toLowerCase() === role.toLowerCase())) {
                    existingRoles.push(role);
                }
                
                await existing.update({
                    name: name || existing.name,
                    type: JSON.stringify(existingRoles)
                });

                return await interaction.reply({ 
                    content: `✅ Updated existing roster member **${existing.name}** with role **${role}**!`, 
                    flags: MessageFlags.Ephemeral 
                });
            }

            await Roster.create({
                discordId: user.id,
                name: name,
                type: JSON.stringify([role]),
                title: "", 
                imageUrl: user.displayAvatarURL({ extension: 'png', size: 512 }) || "", 
                links: {}
            });
            await interaction.reply({ 
                content: `✅ Successfully registered **${name}** as **${role}** (ID: \`${user.id}\`) to the Club FuRN roster!`, 
                flags: MessageFlags.Ephemeral 
            });
        } catch (err) {
            console.error('[BOT] Error registering roster member:', err);
            await interaction.reply({ content: '❌ Failed to register roster member in the database.', flags: MessageFlags.Ephemeral });
        }
    },
};
