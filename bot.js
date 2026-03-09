const { Client, GatewayIntentBits, Events, REST, Routes, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { autoUpdateStatus, getGuildMember, updateBotStatus } = require('./utils/bot-utils');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
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
        console.log(`Refreshing ${slashCommands.length} slash commands...`);
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: slashCommands },
        );
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
}

// --- EVENTS ---

client.once(Events.ClientReady, (c) => {
    console.log(`Discord Bot logged in as ${c.user.tag}`);
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

client.login(process.env.DISCORD_BOT_TOKEN);

// Export utilities so server.js can use them
module.exports = { 
    client, 
    getGuildMember: (userId) => getGuildMember(client, userId), 
    updateBotStatus: (statusText) => updateBotStatus(client, statusText) 
};
