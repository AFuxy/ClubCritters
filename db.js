const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false
});

// 1. Global Settings (The "clean" table)
const Settings = sequelize.define('Settings', {
    eventStartTime: { type: DataTypes.DATE },
    eventEndTime: { type: DataTypes.DATE },
    forceOffline: { type: DataTypes.BOOLEAN, defaultValue: false },
    instanceUrl: { type: DataTypes.STRING }
});

// 2. Roster (DJs/Staff)
const Roster = sequelize.define('Roster', {
    discordId: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING }, // e.g. 'Staff', 'Resident DJ', 'Owner'
    title: { type: DataTypes.STRING }, // e.g. 'Event Host'
    imageUrl: { type: DataTypes.STRING },
    colorStyle: { type: DataTypes.STRING }, // Support for hex or gradients
    bio: { type: DataTypes.TEXT },
    useDiscordName: { type: DataTypes.BOOLEAN, defaultValue: false },
    links: { type: DataTypes.JSON } // JSON storage for social links
});

// 3. Event Schedule (The "wipeable" table)
const Schedule = sequelize.define('Schedule', {
    performerId: {
        type: DataTypes.STRING,
        references: { model: Roster, key: 'discordId' }
    },
    timeSlot: { type: DataTypes.STRING }, // e.g. '20:00 - 21:00'
    genre: { type: DataTypes.STRING }
});

// 4. Archives (Sets)
const Archive = sequelize.define('Archive', {
    performerId: {
        type: DataTypes.STRING,
        references: { model: Roster, key: 'discordId' }
    },
    title: { type: DataTypes.STRING },
    date: { type: DataTypes.DATEONLY },
    genre: { type: DataTypes.STRING },
    linkUrl: { type: DataTypes.STRING }
});

// 5. Statistics (Tracking)
const Stats = sequelize.define('Stats', {
    type: { type: DataTypes.ENUM('page_view', 'archive_click', 'link_click') },
    targetId: { type: DataTypes.STRING }, // The ID of the DJ or Archive clicked
    metadata: { type: DataTypes.JSON }, // Extra info: { linkLabel: 'Twitch', page: 'team' }
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// 6. Application Slots
const AppSlot = sequelize.define('AppSlot', {
    roleName: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    formUrl: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('open', 'closed'), defaultValue: 'closed' },
    deadline: { type: DataTypes.STRING }, // Display string
    autoCloseAt: { type: DataTypes.DATE }, // Machine readable date for auto-close
    order: { type: DataTypes.INTEGER, defaultValue: 0 }
});

// Relationships
Roster.hasMany(Schedule, { foreignKey: 'performerId' });
Schedule.belongsTo(Roster, { foreignKey: 'performerId' });

Roster.hasMany(Archive, { foreignKey: 'performerId' });
Archive.belongsTo(Roster, { foreignKey: 'performerId' });

async function initDB() {
    try {
        await sequelize.authenticate();
        console.log('Connected to MySQL!');
        await sequelize.sync({ alter: true }); // Syncs models to DB tables
        console.log('Database tables synchronized.');
    } catch (err) {
        console.error('Database Connection Error:', err);
    }
}

module.exports = { sequelize, Settings, Roster, Schedule, Archive, Stats, AppSlot, initDB };
