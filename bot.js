const { Client, GatewayIntentBits, Events, REST, Routes, Collection, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { autoUpdateStatus, getGuildMember, updateBotStatus, downloadFile, joinGuild } = require('./utils/bot-utils');
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
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: slashCommands },
        );
        console.log('\x1b[32m[BOT] ✅ Slash commands registered successfully.\x1b[0m');
    } catch (error) {
        console.error('\x1b[31m[BOT] ❌ Error registering slash commands:\x1b[0m', error);
    }
}

// --- EVENTS ---

client.once(Events.ClientReady, (c) => {
    console.log(`\x1b[35m[BOT] 💜 Discord Bot logged in as ${c.user.tag}\x1b[0m`);
    registerSlashCommands();
    
    // Start automated status loop
    if (process.env.DISABLE_VRC_BOT !== 'true') {
        setInterval(() => autoUpdateStatus(client), 60000);
        autoUpdateStatus(client);
    } else {
        console.log(`\x1b[33m[BOT] ⚠️ Logic & Status updates DISABLED (DISABLE_VRC_BOT=true)\x1b[0m`);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (process.env.DISABLE_VRC_BOT === 'true') return;
    // 1. Handle Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
        }
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

                    const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
                    const fields = originalEmbed.data.fields.map(f => {
                        if (f.name === 'Status') return { ...f, value: 'ACCEPTED' };
                        return f;
                    });
                    originalEmbed.setFields(fields);
                    originalEmbed.addFields({ name: 'Decision By', value: `<@${interaction.user.id}>`, inline: true });
                    originalEmbed.setColor('#00e676');

                    await interaction.update({ 
                        content: `📢 **Application Processed: ACCEPTED**`,
                        embeds: [originalEmbed],
                        components: [] 
                    });

                    // DM Applicant
                    try {
                        const applicant = await client.users.fetch(submission.discordId);
                        await applicant.send({
                            content: `✨ **Congratulations!** Your application for **${submission.AppSlot.roleName}** at Club Critters has been **ACCEPTED**! \n\nA staff member will be in touch shortly.`
                        });
                    } catch (e) { console.log(`[BOT] Could not DM applicant ${submission.discordId} (DMs closed)`); }

                } else if (action === 'deny') {
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
    }

    // 3. Handle Modal Submissions
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('app_deny_modal_')) {
            const { ApplicationSubmission, AppSlot } = require('./db');
            const submissionId = interaction.customId.split('_')[3];
            const reason = interaction.fields.getTextInputValue('deny_reason') || "No reason provided.";

            try {
                const submission = await ApplicationSubmission.findByPk(submissionId, { include: [AppSlot] });
                await submission.update({ status: 'declined' });

                const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
                const fields = originalEmbed.data.fields.map(f => {
                    if (f.name === 'Status') return { ...f, value: 'DECLINED' };
                    return f;
                });
                originalEmbed.setFields(fields);
                originalEmbed.addFields(
                    { name: 'Decision By', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                );
                originalEmbed.setColor('#ff5252');

                await interaction.update({ 
                    content: `📢 **Application Processed: DECLINED**`,
                    embeds: [originalEmbed],
                    components: [] 
                });

                // DM Applicant
                try {
                    const applicant = await client.users.fetch(submission.discordId);
                    await applicant.send({
                        content: `📩 **Update on your application:** Your application for **${submission.AppSlot.roleName}** at Club Critters has been **DECLINED**. \n\n**Reason provided:** ${reason}`
                    });
                } catch (e) { console.log(`[BOT] Could not DM applicant ${submission.discordId} (DMs closed)`); }

            } catch (err) { console.error("[BOT] Modal Error:", err); }
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
