# Club Critters Community Hub

A serverless, static website for the Club Critters VRChat community. It features a live event schedule, automatic time zone conversion, and a searchable set archive, all powered by a single Google Sheet.

## 🚀 Features

* **Live Schedule:** Automatically highlights the current DJ and displays "Live" status.
* **Time Zone Intelligence:** Converts event times from UTC to the user's local time.
* **Smart Contrast:** DJ names are auto-colored based on their preference, with automatic brightness adjustment for readability.
* **Archive System:** Automatically groups past sets by DJ and sorts them chronologically.
* **Zero Maintenance:** The site runs entirely from `index.html` and fetches data from Google Sheets. No database or backend server required.

## 🛠️ Configuration

The site is controlled by a Google Sheet published as CSV.

### 1. Main Schedule Tab
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

### 2. Archive Tab
Controls the "Past Sets" page.

**DJ Rows (Row 2+):**
* **Col A:** DJ Name
* **Col B:** DJ Image URL
* **Col C:** Set 1 Title
* **Col D:** Set 1 Date (ISO or Readable)
* **Col E:** Set 1 Link
* **Col F, G, H:** Set 2 Title, Date, Link... (Repeat pattern indefinitely)

## 📂 Project Structure

```text
/
├── index.html           # Main landing page (Live/Upcoming view)
├── README.md            # Documentation
│
├── archive/
│   └── index.html       # Archive page (Past Sets view)
│
└── cdn/
    ├── css/
    │   └── main.css     # Master stylesheet for both pages
    │
    ├── js/
    │   ├── main.js      # Logic for Home (Schedule, Timezones, Color)
    │   └── archive.js   # Logic for Archive (Grouping, Sorting)
    │
    └── logos/
        └── club/
            ├── HeadOnly.png  # Favicon/Card Image
            └── logo.webm     # Animated Header Logo
```