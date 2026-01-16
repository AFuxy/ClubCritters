# Club Critters Community Hub

A serverless, static website for the Club Critters VRChat community. It features a live event schedule with timezone intelligence, a searchable set archive, and a dynamic team roster—all powered by Google Sheets.

## 🚀 Features

* **Live Schedule:** Automatically highlights the current DJ with a "Live" status and **CSS Audio Visualizer**.
* **Smart Countdown:** Displays the date for upcoming events, but switches to a **Live Ticking Timer** when the event is less than 2 hours away.
* **Time Zone Intelligence:** Converts all event times from UTC to the user's local time automatically.
* **Social Sharing:** A "Share" button appears for the active DJ, copying a pre-formatted hype message to the clipboard.
* **Smart Contrast:** DJ names are auto-colored based on their preference, with automatic brightness adjustment to ensure readability on dark backgrounds.
* **Team Roster:** A dedicated page listing Staff and Resident DJs, sorted dynamically.
* **Archive System:** Automatically groups past sets by DJ and sorts them chronologically.

## 🛠️ Configuration

The site is controlled by a single Google Sheet with **three tabs**. You must publish each tab as a separate CSV link.

### 1. "Schedule" Tab (Tab 1)
Controls the homepage and live event logic.

| Row | Column A | Column B | Column C |
| :--- | :--- | :--- | :--- |
| **1 (Header)** | `Start Time` | `End Time` | `Force Offline` |
| **2 (Settings)** | `2026-01-16T20:00:00Z` | `2026-01-17T02:00:00Z` | `FALSE` |

**DJ Rows (Row 3+):**
* **Col D:** DJ Name
* **Col E:** Time Slot (UTC, e.g., `20:00 - 21:00`)
* **Col F:** Genre
* **Col G:** Image URL
* **Col H:** Accent Color (Hex, e.g., `#FF00FF`)
* **Col I+:** Social Links (Header = Button Name, Cell = URL)

---

### 2. "Archive" Tab (Tab 2)
Controls the `/archive/` page.

**DJ Rows (Row 2+):**
* **Col A:** DJ Name
* **Col B:** DJ Image URL
* **Col C:** Set 1 Title
* **Col D:** Set 1 Date
* **Col E:** Set 1 Link
* **Col F, G, H:** Set 2 Title, Date, Link... (Repeat pattern indefinitely)

---

### 3. "Team" Tab (Tab 3)
Controls the `/team/` page.

**Member Rows (Row 2+):**
* **Col A:** Name
* **Col B:** Type (`Staff` = Top Section, `Resident` = Bottom Section)
* **Col C:** Title (e.g., "Event Host")
* **Col D:** Image URL
* **Col E:** Accent Color (Hex)
* **Col F+:** Social Links (Header = Button Name, Cell = URL)

## ⚙️ Code Configuration

### Changing the "Share" Message
To change the text that is copied when users click the "Share" button, open `cdn/js/main.js` and edit the template at the top of the file:

```javascript
const shareMessageTemplate = "🔊 LIVE NOW: {dj} is playing {genre}! Join us: [https://club.afuxy.com](https://club.afuxy.com)";
```

### Changing Sheet URLs
If you create a new spreadsheet, update the const url variables at the top of:

1. `cdn/js/main.js` (Schedule Tab URL)

2. `cdn/js/archive.js` (Archive Tab URL)

3. `cdn/js/team.js` (Team Tab URL)

## 📂 Project Structure

```text
/
├── index.html           # Main landing page (Live/Upcoming view)
├── README.md            # Documentation
│
├── archive/
│   └── index.html       # Archive page (Past Sets view)
│
├── team/
│   └── index.html       # Team page (Staff & Residents view)
│
└── cdn/
    ├── css/
    │   └── main.css     # Master stylesheet (Visuals, Animations, Layouts)
    │
    ├── js/
    │   ├── main.js      # Home Logic (Countdown, Share, Visualizer, Timezones)
    │   ├── archive.js   # Archive Logic (Grouping, Sorting)
    │   └── team.js      # Team Logic (Filtering Staff vs Residents)
    │
    └── logos/
        └── club/
            ├── HeadOnly.png  # Favicon/Card Image
            └── logo.webm     # Animated Header Logo
```