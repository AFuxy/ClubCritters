# Club Critters Ecosystem

This platform is a comprehensive event management system for the Club Critters VRChat community. It replaces the legacy static site with a full-stack Node.js application, integrating Discord OAuth2 authentication, a role-based management panel, real-time engagement analytics, and an automated Discord bot.

## 🏗 Architecture

The system is built on a modern stack designed for high availability and community engagement:

- **Frontend:** Server-side rendered EJS templates styled with professional CSS, featuring staggered animations, glassmorphism, and responsive layouts.
- **Backend:** Node.js (Express) handling OAuth2 flows, RESTful APIs, and secure file uploads (Sharp/Multer).
- **Database:** MySQL (Sequelize ORM) managing persistent state for the roster, schedule, set archives, and granular tracking.
- **Automation:** A dedicated Discord.js bot that synchronizes the club's live state with the Discord server via Custom Presences and automated countdowns.

## 🛠 Setup & Local Development

### 1. Prerequisites
- Node.js (v18 or higher)
- MySQL Server
- Discord Developer Application (for OAuth and Bot)

### 2. Configuration
Create a `.env` file in the root directory based on the following template:

```env
PORT=3000
SESSION_SECRET=your_random_secret_here

# MySQL Configuration
DB_HOST=localhost
DB_USER=root
DB_PASS=your_password
DB_NAME=club_critters

# Discord API Configuration
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_GUILD_ID=1327116819445944431
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
```

### 3. Installation
```bash
npm install
```

### 4. Database Initialization & Migration
To populate the database with legacy data and initialize the schema:
```bash
node migrate-data.js
```

### 5. Running the Application
```bash
# Start the web server and the discord bot
npm start
```

## 🌐 Hosting & Deployment

### Recommended Environment: VPS (Linux/Ubuntu)
For production hosting, a VPS with at least 1GB RAM is recommended.

1. **Process Management:** Use **PM2** to keep the application running in the background.
   ```bash
   npm install pm2 -g
   pm2 start server.js --name "club-critters"
   ```
2. **Reverse Proxy:** Use **Nginx** to handle SSL (HTTPS) and port forwarding from 80/443 to 3000.
3. **Database:** Ensure your MySQL instance is secured and regular backups are performed.

## 🕹 Management Workflow

The system features a "Secret Panel" accessible only to authorized Discord members.

- **Staff Access:** Users with "Host", "Staff", or "Owner" roles in the database can manage the global event schedule, update the VRChat instance link, and monitor recruitment applications.
- **DJ Access:** Performers can log in to customize their own bio, upload animated profile pictures, and link their social sets to the archive.
- **Analytics:** The dashboard provides real-time data on page views, social link clicks, and set popularity, allowing for data-driven community growth.
