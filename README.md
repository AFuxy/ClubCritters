# Club Critters Ecosystem

This platform is a comprehensive event management system for the Club Critters VRChat community. It replaces the legacy static site with a full-stack Node.js application, integrating Discord OAuth2 authentication, a role-based management panel, real-time engagement analytics, a community photo gallery, and a specialized VRChat-aware Discord bot.

## 🏗 Architecture

The system is built on a modern stack designed for high availability and community engagement:

- **Frontend:** Server-side rendered EJS templates and static HTML styled with professional CSS, featuring staggered animations, glassmorphism, and responsive masonry layouts.
- **Backend:** Node.js (Express) handling OAuth2 flows, RESTful APIs, and high-performance image processing (Sharp/Multer).
- **Database:** MySQL (Sequelize ORM) managing persistent state for the roster, schedule, set archives, community gallery, and granular tracking.
- **VRChat Integration:** Real-time instance tracking and community activity monitoring via the VRChat API.
- **Discord Bot:** A dedicated Discord.js bot that synchronizes the club's live state, manages gallery syncing, and provides administrative slash commands.

## 🛠 Setup & Local Development

### 1. Prerequisites
- Node.js (v18 or higher)
- MySQL Server
- Discord Developer Application (with **Message Content Intent** enabled)
- VRChat Account (Bot account recommended, without 2FA for fully headless operation)

### 2. Configuration
Create a `.env` file in the root directory based on the following template:

```env
PORT=3000
SESSION_SECRET="your_random_secret_here"

# MySQL Configuration
DB_HOST=localhost
DB_USER=root
DB_PASS=your_password
DB_NAME=club_critters

# Discord API Configuration
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_GUILD_ID=your_server_id
DISCORD_GALLERY_CH_ID=1462254698567569588
DISCORD_APPS_CATEGORY_ID=your_category_id_here
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback

# VRChat Configuration
VRC_USERNAME="your_vrchat_username"
VRC_PASSWORD="your_vrchat_password"
```

### 3. Installation
```bash
npm install
```

### 4. Database Initialization & Migration
To initialize the schema and import legacy data:
```bash
node migrate-data.js
```

### 5. Running the Application
```bash
npm start
```

## 🌐 Hosting & Deployment

### Recommended Environment: VPS (Linux/Ubuntu)
For production hosting, a VPS with at least 1GB RAM is recommended.

1. **Process Management:** Use **PM2** to keep the application running.
   ```bash
   npm install pm2 -g
   pm2 start server.js --name "club-critters"
   ```
2. **Image Storage:** Ensure the `public/uploads/` directory has write permissions.
3. **VRChat Auth:** If using an account with 2FA/Email verification, log into the Admin Panel after first launch to enter the verification code.

## 🕹 Management Workflow

### Staff Hub
Accessible to authorized Discord members (Admin/Host/Staff roles):
- **Event Schedule:** Manage the live lineup and genres.
- **Roster Management:** Control DJ profiles and roles.
- **Gallery Sync:** Run `/sync-gallery` in Discord to backfill community photos.
- **Analytics:** Monitor real-time page views and community engagement.

### Performer Profiles
DJs can log in to customize their own presence:
- **Bio & Links:** Update social media links and personal descriptions.
- **Avatar Upload:** Upload and crop custom profile pictures (supports animated WebP/GIF).
- **Archives:** Link set recordings directly to their public profile.
