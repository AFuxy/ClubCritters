const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { Roster, Settings, initDB } = require('./db');
const { getGuildMember, joinGuild } = require('./bot');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Helper to handle Sequelize/MySQL/MariaDB JSON parsing inconsistencies
const safeParseJSON = (data) => {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } 
        catch (e) { return {}; }
    }
    return data || {};
};

// Passport Serialization
passport.serializeUser((user, done) => done(null, user.discordId));
passport.deserializeUser(async (id, done) => {
    try {
        let user = await Roster.findByPk(id);
        
        if (user) {
            // Block banned users
            if (user.isBanned) return done(null, false);

            // Fix JSON parsing for Linux/MariaDB
            user.links = safeParseJSON(user.links);
        }

        const guildMember = await getGuildMember(id);
        
        // If not on roster, create a basic user object for applicants
        if (!user) {
            user = { 
                discordId: id, 
                name: guildMember?.nickname || "Applicant", 
                type: "Public", 
                links: {},
                isPublic: true 
            };
        }

        if (guildMember) {
            user.discordData = guildMember;
        }
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// Configure Discord Strategy
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_REDIRECT_URI,
    scope: ['identify', 'guilds.join']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // 1. Try to join the user to the guild automatically
        await joinGuild(profile.id, accessToken);

        // 2. Check if they are now in the guild
        const guildMember = await getGuildMember(profile.id);
        if (!guildMember) {
            return done(null, false, { message: 'You must be in the Club FuRN Discord to login.' });
        }

        // 3. Find or identify user
        let user = await Roster.findByPk(profile.id);
        
        if (user && user.isBanned) {
            return done(null, false, { message: 'Banned' });
        }

        if (!user) {
            // For applicants, we return a virtual user object
            return done(null, { discordId: profile.id, name: profile.username, type: "Public", isPublic: true });
        }

        return done(null, user);
    } catch (err) {
        return done(err, null);
    }
}));

app.set('view engine', 'ejs');
app.set('trust proxy', 1);

// Global Permissions Policy for Media Embeds
app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "autoplay=(self *), encrypted-media=(self *), picture-in-picture=(self *)");
    next();
});

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.COOKIE_SECURE !== 'false', 
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 Days
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// --- MAINTENANCE MIDDLEWARE ---
let cachedMaintenance = { value: false, lastCheck: 0 };
app.use(async (req, res, next) => {
    try {
        const now = Date.now();
        // Cache setting for 60 seconds to reduce DB load
        if (now - cachedMaintenance.lastCheck > 60000) {
            const settings = await Settings.findOne();
            cachedMaintenance = { value: settings?.maintenanceMode || false, lastCheck: now };
        }

        if (cachedMaintenance.value) {
            // Define allowed paths during maintenance (auth, panel, assets)
            const isAllowedPath = req.path.startsWith('/panel') || 
                                 req.path.startsWith('/auth') || 
                                 req.path.startsWith('/api') || 
                                 req.path.startsWith('/cdn') || 
                                 req.path.startsWith('/css') || 
                                 req.path.startsWith('/js') || 
                                 req.path.startsWith('/uploads');

            // Allow staff to bypass maintenance (case-insensitive check)
            const userType = (req.user?.type || "").toLowerCase();
            const isStaff = ['owner', 'resident dj', 'event staff', 'staff'].some(role => userType.includes(role));

            if (!isAllowedPath && !isStaff) {
                return res.render('maintenance');
            }
        }
        next();
    } catch (err) {
        console.error("Maintenance check error:", err);
        next();
    }
});

// --- ROUTES ---
const authRoutes = require('./routes/auth');
const panelRoutes = require('./routes/panel');
const apiRoutes = require('./routes/api');
const publicRoutes = require('./routes/public');

app.use('/auth', authRoutes);
app.use('/panel', panelRoutes);
app.use('/api', apiRoutes);
app.use('/', publicRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Lost the Scent!',
        message: "Even our best scouts can't find this page. It looks like you've wandered down the wrong burrow!",
        icon: '🐾',
        buttons: [
            { label: 'Back to the Den', link: '/', class: 'btn-primary' }
        ]
    });
});

async function start() {
    await initDB();
    app.listen(PORT, () => { 
        console.log(`\x1b[34m[SERVER] 🚀 Hub running on http://localhost:${PORT}\x1b[0m`); 
    });
}
start();
