const { Client, GatewayIntentBits, Events, REST, Routes, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { autoUpdateStatus, getGuildMember, updateBotStatus, downloadFile } = require('./utils/bot-utils');
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
    setInterval(() => autoUpdateStatus(client), 60000);
    autoUpdateStatus(client);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// Gallery Sync Listener
client.on(Events.MessageCreate, async message => {
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
    updateBotStatus: (statusText) => updateBotStatus(client, statusText) 
};
