const fs = require('fs');
const { Roster, Schedule, Archive, Settings, sequelize } = require('./db');

async function migrate() {
    try {
        await sequelize.sync({ force: true }); // Wipe existing data to start fresh
        console.log("Database tables reset.");

        // 1. Migrate Roster
        const rosterData = JSON.parse(fs.readFileSync('./legacy_data/roster.json', 'utf8'));
        const rosterHeaders = rosterData.values[0];
        const rosterRows = rosterData.values.slice(1);

        for (const row of rosterRows) {
            let discordId = row[6];
            let name = row[0];
            let type = row[1];
            
            // Handle missing DiscordID for legacy users
            if (!discordId) {
                discordId = `legacy_${name.toLowerCase().replace(/\s+/g, '_')}`;
                console.log(`Generated placeholder ID for ${name}: ${discordId}`);
            }

            // AUTO CONVERSIONS
            // - Convert "Guest" type to "Performer"
            if (type === 'Guest') {
                type = 'Performer';
            }
            // - Set specific ID to "Owner"
            if (discordId === '1147939347807600641') {
                type = 'Owner';
            }

            // Collect extra links
            const links = {};
            for (let i = 7; i < row.length; i++) {
                if (row[i] && rosterHeaders[i]) {
                    links[rosterHeaders[i]] = row[i];
                }
            }

            await Roster.create({
                discordId: discordId,
                name: name,
                type: type,
                title: row[2],
                imageUrl: row[3],
                colorStyle: row[4],
                bio: row[5] || "",
                links: links
            });
        }
        console.log(`Migrated ${rosterRows.length} roster entries with type auto-conversions.`);

        // 2. Migrate Schedule & Settings
        const scheduleData = JSON.parse(fs.readFileSync('./legacy_data/schedule.json', 'utf8'));
        const scheduleRows = scheduleData.values;
        
        if (scheduleRows.length >= 2) {
            const settings = scheduleRows[1];
            await Settings.create({
                eventStartTime: settings[0],
                eventEndTime: settings[1],
                forceOffline: (settings[2] === "TRUE"),
                instanceUrl: settings[3]
            });
            console.log("Global event settings migrated.");

            // DJ Lineup (Rows 3+)
            for (let i = 2; i < scheduleRows.length; i++) {
                const row = scheduleRows[i];
                if (!row[4]) continue;

                const dj = await Roster.findOne({ where: { name: row[4] } });
                if (dj) {
                    await Schedule.create({
                        performerId: dj.discordId,
                        timeSlot: row[5],
                        genre: row[6]
                    });
                } else {
                    console.warn(`Could not find DiscordID for DJ: ${row[4]}`);
                }
            }
            console.log("Schedule lineup migrated.");
        }

        // 3. Migrate Archive
        const archiveData = JSON.parse(fs.readFileSync('./legacy_data/archive.json', 'utf8'));
        const archiveRows = archiveData.values.slice(1);

        for (const row of archiveRows) {
            const djName = row[0];
            const dj = await Roster.findOne({ where: { name: djName } });
            if (!dj) {
                console.warn(`Skipping archive for ${djName} (DJ not found)`);
                continue;
            }

            for (let i = 1; i < row.length; i += 4) {
                const title = row[i];
                let dateStr = row[i+1];
                const genre = row[i+2];
                const link = row[i+3];

                if (title && link) {
                    let formattedDate = null;
                    if (dateStr) {
                        const parts = dateStr.split(/[./-]/);
                        if (parts.length === 3) {
                            let [m, d, y] = parts;
                            const fullYear = y.length === 2 ? `20${y}` : y;
                            formattedDate = `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                        }
                    }

                    await Archive.create({
                        performerId: dj.discordId,
                        title: title,
                        date: formattedDate || new Date(),
                        genre: genre || "Other",
                        linkUrl: link
                    });
                }
            }
        }
        console.log("Archive data migrated.");

        console.log("\nMigration complete! Legacy data has been re-imported with the requested role conversions.");
        process.exit(0);
    } catch (err) {
        console.error("Migration Failed:", err);
        process.exit(1);
    }
}

migrate();
