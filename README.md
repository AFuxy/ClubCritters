# Club Critters Ecosystem

This platform is a comprehensive event management system for the Club Critters VRChat community. It replaces the legacy static site with a full-stack Node.js application, integrating Discord OAuth2 authentication, a role-based management panel, real-time engagement analytics, a community photo gallery, and a specialized VRChat-aware Discord bot.

## 🏗 Architecture

The system is built on a modern stack designed for high availability and community engagement:

- **Frontend:** Server-side rendered EJS templates and static HTML styled with professional CSS, featuring staggered animations, glassmorphism, and responsive masonry layouts.
- **Backend:** Node.js (Express) handling OAuth2 flows, RESTful APIs, and high-performance image processing (Sharp/Multer).
- **Database:** MySQL (Sequelize ORM) managing persistent state for the roster, schedule, set archives, community gallery, and recruitment.
- **VRChat Integration:** Real-time instance tracking, community pulse monitoring, and a permanent "Pipeline" WebSocket connection for 24/7 presence and automated auto-invites.
- **Discord Bot:** A dedicated Discord.js bot that synchronizes the club's live state, manages gallery syncing, and provides an automated recruitment ticket system.

## 🛠 Setup & Local Development

### 1. Prerequisites
- Node.js (v18 or higher)
- MySQL Server
- Discord Developer Application (with **Message Content Intent** and **Server Members Intent** enabled)
- VRChat Account (Bot account recommended)

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
VRC_GROUPID="grp_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. Installation
```bash
npm install
```

### 4. Database Initialization
To initialize the schema and import legacy data:
```bash
node migrate-data.js
```

### 5. Running the Application
```bash
npm start
```

## 🌐 Features & Workflows

### 🎫 Automated Recruitment
- **Dynamic Forms:** Specialized application forms for DJs, Singers, Musician/Bands, and Event Staff.
- **Staff Review Tickets:** Submissions automatically create private Discord channels for review.
- **Discord Decisions:** Staff can Approve or Deny applicants directly from Discord via interactive buttons.
- **Identity Verification:** Users must be in the Discord server to apply; the system can automatically force-join them during login.

### 📸 Smart Gallery
- **Discord Sync:** Use `/sync-gallery` to pull community photos into the website.
- **Local Optimization:** Images are downloaded, compressed to WebP, and thumbnailed locally for maximum speed.
- **Dynamic Identity:** Uploader names and avatars are fetched live from Discord, keeping profiles fresh.

### 🦊 VRChat Beacon
- **Live Tracking:** Real-time player counts and group activity visible on the homepage.
- **Always Online:** The bot maintains a 24/7 WebSocket connection to VRChat's Notification Pipeline, appearing "Online (Web)" at all times.
- **Auto-Invites:** Bot automatically responds to "Request Invite" notifications in-game when the club is active.
- **Friend Management:** The bot automatically accepts all incoming friend requests to grow the joinable network.
- **Cache Shield:** Integrated 60-second caching prevents API rate-limiting.

### 🕹 Staff Management
- **Event Schedule:** Manage the live lineup and genres via the panel.
- **Roster Control:** Update DJ titles, roles, and colors.
- **Analytics:** Granular tracking of page views, link clicks, and set archive popularity.
