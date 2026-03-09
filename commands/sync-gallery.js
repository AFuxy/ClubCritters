const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { Gallery } = require('../db');
const { downloadFile } = require('../utils/bot-utils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sync-gallery')
        .setDescription('Scan the gallery channel and sync all existing photos to the website (Oldest First)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const channelId = process.env.DISCORD_GALLERY_CH_ID;
        if (!channelId) return interaction.editReply("❌ Gallery Channel ID not set in .env");

        const channel = await interaction.guild.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return interaction.editReply("❌ Invalid gallery channel.");

        try {
            let allMessages = [];
            let lastId = null;
            let fetching = true;

            await interaction.editReply("📡 Fetching message history... please wait.");

            // 1. Fetch ALL messages from the channel
            while (fetching) {
                const options = { limit: 100 };
                if (lastId) options.before = lastId;

                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) break;

                allMessages.push(...Array.from(messages.values()));
                lastId = messages.last().id;
                
                if (messages.size < 100) fetching = false;
            }

            // 2. Reverse to process Oldest First
            allMessages.reverse();
            
            let count = 0;
            await interaction.editReply(`📸 Found ${allMessages.length} messages. Downloading and processing from oldest first...`);

            // 3. Process each message
            for (const message of allMessages) {
                if (message.author.bot) continue;
                
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
                                count++;
                            } catch (err) {
                                console.error(`[GALLERY SYNC] Failed to process ${attachment.id}:`, err);
                            }
                        }
                    }
                }
            }

            await interaction.editReply(`✅ Sync complete! Successfully processed **${count}** photos in chronological order.`);
        } catch (err) {
            console.error(err);
            await interaction.editReply("❌ Failed to sync gallery.");
        }
    },
};
