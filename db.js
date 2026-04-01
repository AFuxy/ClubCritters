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
    eventTitle: { type: DataTypes.STRING }, // e.g. "Neon Nights"
    forceOffline: { type: DataTypes.BOOLEAN, defaultValue: false },
    instanceUrl: { type: DataTypes.STRING },
    eventTheme: { type: DataTypes.STRING }, // CSS class for special events
    eventLogo: { type: DataTypes.STRING }, // Custom logo URL for special events
    vrcCookie: { type: DataTypes.TEXT }, // Persist VRChat session
    maintenanceMode: { type: DataTypes.BOOLEAN, defaultValue: false }
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
    isBanned: { type: DataTypes.BOOLEAN, defaultValue: false },
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
    roleType: { type: DataTypes.ENUM('DJ', 'Singer', 'Musician/Band', 'Event Staff', 'Other'), defaultValue: 'DJ' },
    description: { type: DataTypes.TEXT },
    formUrl: { type: DataTypes.STRING },
    isInternal: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('open', 'closed'), defaultValue: 'closed' },
    deadline: { type: DataTypes.STRING }, // Display string
    autoCloseAt: { type: DataTypes.DATE }, // Machine readable date for auto-close
    order: { type: DataTypes.INTEGER, defaultValue: 0 }
});

// 7. Gallery (Discord Synced)
const Gallery = sequelize.define('Gallery', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    messageId: { type: DataTypes.STRING, allowNull: false },
    attachmentId: { type: DataTypes.STRING, unique: true },
    imageUrl: { type: DataTypes.STRING, allowNull: false },
    thumbnailUrl: { type: DataTypes.STRING },
    uploaderId: { type: DataTypes.STRING }, // Discord ID to fetch fresh data
    caption: { type: DataTypes.TEXT },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// 8. Application Submissions (Internal)
const ApplicationSubmission = sequelize.define('ApplicationSubmission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    slotId: { type: DataTypes.INTEGER },
    discordId: { type: DataTypes.STRING },
    discordTag: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('pending', 'reviewed', 'accepted', 'declined'), defaultValue: 'pending' },
    answers: { type: DataTypes.JSON }, // Store all form fields here
    channelId: { type: DataTypes.STRING }, // The private Discord channel created for this app
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// 9. Historical Instance Analytics
const InstanceLog = sequelize.define('InstanceLog', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    instanceId: { type: DataTypes.STRING },
    instanceUrl: { type: DataTypes.STRING }, // Store the full URL for tracking
    worldName: { type: DataTypes.STRING, defaultValue: 'Club Critters Hub' },
    startTime: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    endTime: { type: DataTypes.DATE },
    peakCapacity: { type: DataTypes.INTEGER, defaultValue: 0 },
    uniqueUsers: { type: DataTypes.INTEGER, defaultValue: 0 },
    totalDuration: { type: DataTypes.INTEGER }, // Stored in minutes
    isEventSession: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true } // New field to track active status
});

// 10. VRChat Group Audit (Automated Moderation)
const VrcGroupAudit = sequelize.define('VrcGroupAudit', {
    vrcUserId: { type: DataTypes.STRING, primaryKey: true },
    username: { type: DataTypes.STRING },
    displayName: { type: DataTypes.STRING },
    trustRank: { type: DataTypes.STRING },
    accountAgeDays: { type: DataTypes.INTEGER },
    ageVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    ageVerified18: { type: DataTypes.BOOLEAN, defaultValue: false },
    joinDate: { type: DataTypes.DATE },
    status: { type: DataTypes.ENUM('processed', 'monitored', 'banned'), defaultValue: 'processed' },
    alertSent: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// 11. Visitor tracking for unique users
const InstanceVisitor = sequelize.define('InstanceVisitor', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    instanceLogId: { type: DataTypes.INTEGER, references: { model: InstanceLog, key: 'id' } },
    vrcUserId: { type: DataTypes.STRING },
    vrcUsername: { type: DataTypes.STRING }
});

// Relationships
Roster.hasMany(Schedule, { foreignKey: 'performerId' });
Schedule.belongsTo(Roster, { foreignKey: 'performerId' });

Roster.hasMany(Archive, { foreignKey: 'performerId' });
Archive.belongsTo(Roster, { foreignKey: 'performerId' });

AppSlot.hasMany(ApplicationSubmission, { foreignKey: 'slotId' });
ApplicationSubmission.belongsTo(AppSlot, { foreignKey: 'slotId' });

InstanceLog.hasMany(InstanceVisitor, { foreignKey: 'instanceLogId' });
InstanceVisitor.belongsTo(InstanceLog, { foreignKey: 'instanceLogId' });

async function initDB() {
    try {
        await sequelize.authenticate();
        console.log('\x1b[32m[DATABASE] ✅ Connected to MySQL successfully!\x1b[0m');
        await sequelize.sync({ alter: true });
        console.log('\x1b[36m[DATABASE] 📊 Tables synchronized and ready.\x1b[0m');
    } catch (err) {
        console.error('\x1b[31m[DATABASE] ❌ Connection Error:\x1b[0m', err);
    }
}

module.exports = { sequelize, Settings, Roster, Schedule, Archive, Stats, AppSlot, Gallery, ApplicationSubmission, InstanceLog, VrcGroupAudit, InstanceVisitor, initDB };
