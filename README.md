# 🔍 Pet Finder System

Complete automated system for finding and tracking rare pets across multiple Roblox accounts.

## 📁 Files Overview

### Core Scripts
- **PetFinderBot.lua** - Bot script that runs on each account, scans servers, and sends finds to API
- **PetFinderGUI.lua** - GUI interface to view all finds in real-time with green join buttons
- **server.js** - Node.js API server that collects and serves pet finds

### Configuration
- **package.json** - Node.js dependencies
- **Procfile** - Railway deployment config
- **render.yaml** - Render deployment config
- **.gitignore** - Git ignore rules

### Startup Scripts
- **START_LOCAL.bat** - Windows batch file to start local server
- **START_LOCAL.ps1** - PowerShell script to start local server

### Documentation
- **LOCAL_HOSTING.md** - Guide for running locally
- **DEPLOYMENT.md** - Guide for free hosting options
- **QUICK_START.md** - Quick setup guide
- **RAILWAY_SETUP.md** - Railway deployment with environment variables ⭐
- **ENV_SETUP.md** - Environment variables setup (API keys)
- **SECURITY.md** - Security features documentation
- **LUARMOR_SETUP.md** - LuArmor integration guide

## 🚀 Quick Start

### Option 1: Local Hosting (Easiest)
1. Install Node.js: https://nodejs.org/
2. Run `npm install` in this folder
3. Double-click `START_LOCAL.bat` to start server
4. Update scripts to use `http://localhost:3000`
5. Load bot scripts on your accounts
6. Load GUI script on your main account

### Option 2: Free Cloud Hosting
1. Deploy to Railway/Render (see DEPLOYMENT.md)
2. Update API_URL in scripts to your hosted URL
3. Load scripts and start finding pets!

## ⚙️ Configuration

### Bot Settings (PetFinderBot.lua)
```lua
local API_URL = "https://your-api-url.com/api/pet-found"
local MIN_GENERATION = 1000  -- Minimum MPS (1K/s)
local SCAN_INTERVAL = 0.5    -- Seconds between scans
local SCANS_BEFORE_HOP = 10  -- Scans before server hop
```

### GUI Settings (PetFinderGUI.lua)
```lua
local API_URL = "https://your-api-url.com/api/finds/recent"
local UPDATE_INTERVAL = 2  -- Seconds between updates
```

## 🎯 Features

- ✅ Multi-account support (unlimited bots)
- ✅ Real-time GUI updates (every 2 seconds)
- ✅ Green join buttons (SetFinder/sabLujiHub style)
- ✅ Green stats display (pet name, generation, account)
- ✅ Automatic server hopping
- ✅ Account tracking
- ✅ Live find notifications

## 📊 How It Works

```
Bots (PetFinderBot.lua) → Find Pets → Send to API → API Stores → GUI Displays → You Click JOIN
```

1. **Bots** scan servers automatically
2. When pets above threshold are found, bots send data to **API**
3. **API** stores all finds
4. **GUI** fetches finds every 2 seconds and displays them
5. Click **JOIN** button to teleport to server with pet

## 🌐 API Endpoints

- `POST /api/pet-found` - Receive pet finds from bots
- `GET /api/finds` - Get all finds (limit with `?limit=50`)
- `GET /api/finds/recent` - Get finds from last 10 minutes
- `DELETE /api/finds` - Clear all finds
- `GET /api/health` - Health check

## 📝 Usage

### Running Bots
1. Load `PetFinderBot.lua` on each Roblox account
2. Bots automatically scan and hop servers
3. Finds are sent to API automatically

### Viewing Finds
1. Load `PetFinderGUI.lua` on your main account
2. GUI shows all finds in real-time
3. Click green JOIN button to teleport

## 🔧 Troubleshooting

**Bots not sending finds:**
- Check API server is running
- Verify API_URL is correct
- Check Roblox HttpService is enabled

**GUI not showing finds:**
- Check API server is running
- Verify API_URL matches server
- Check console for errors

**Can't join servers:**
- Make sure TeleportService is working
- Check placeId and jobId are valid

## 📚 Documentation

- **LOCAL_HOSTING.md** - Run API on your computer
- **DEPLOYMENT.md** - Deploy to free hosting (Railway, Render, etc.)
- **QUICK_START.md** - 5-minute setup guide

## 🎨 GUI Features

- Green join buttons with hover effects
- Green stats (pet name, generation, account, players)
- SetFinder/sabLujiHub styling
- Draggable window
- Mobile responsive
- Real-time updates

## ⚠️ Important Notes

- API must be running for bots to send finds
- Localhost only works on same computer
- For multiple devices, use cloud hosting or ngrok
- Server stores finds in memory (resets on restart)

## 📞 Support

Check documentation files for detailed guides:
- Local hosting issues → `LOCAL_HOSTING.md`
- Deployment issues → `DEPLOYMENT.md`
- Quick setup → `QUICK_START.md`

---

**Status**: ✅ Production Ready
