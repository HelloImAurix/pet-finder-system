# ⚙️ Configuration Guide

Easy way to switch between local and remote hosting.

## 🔄 Switching Between Local and Remote

### For Local Hosting

**PetFinderBot.lua** (line 14):
```lua
local API_URL = "http://localhost:3000/api/pet-found"
```

**PetFinderGUI.lua** (line 21):
```lua
local API_URL = "http://localhost:3000/api/finds/recent"
```

### For Remote Hosting (Railway/Render/etc.)

**PetFinderBot.lua** (line 14):
```lua
local API_URL = "https://your-app.railway.app/api/pet-found"
```

**PetFinderGUI.lua** (line 21):
```lua
local API_URL = "https://your-app.railway.app/api/finds/recent"
```

## 📋 Current Configuration

### Bot Settings
- **API URL**: Check line 14 in `PetFinderBot.lua`
- **Min Generation**: 1000 (1K/s) - Line 15
- **Scan Interval**: 0.5 seconds - Line 16
- **Scans Before Hop**: 10 - Line 17

### GUI Settings
- **API URL**: Check line 21 in `PetFinderGUI.lua`
- **Update Interval**: 2 seconds - Line 22

### Server Settings
- **Port**: 3000 (or PORT env var) - `server.js` line 10
- **Max Finds**: 1000 - `server.js` line 18

## 🎯 Quick Config Changes

### Change Minimum Generation
Edit `PetFinderBot.lua` line 15:
```lua
local MIN_GENERATION = 5000  -- Now 5K/s instead of 1K/s
```

### Change Update Speed
Edit `PetFinderGUI.lua` line 22:
```lua
local UPDATE_INTERVAL = 1  -- Updates every 1 second instead of 2
```

### Change Server Port
Edit `server.js` line 10:
```javascript
const PORT = process.env.PORT || 3001  // Use port 3001
```
Then update scripts to use port 3001.

## 🔍 Finding Your Current Settings

**Bot API URL:**
```bash
# Windows PowerShell
Select-String -Path "PetFinderBot.lua" -Pattern "API_URL"
```

**GUI API URL:**
```bash
# Windows PowerShell
Select-String -Path "PetFinderGUI.lua" -Pattern "API_URL"
```

## ✅ Configuration Checklist

Before running:
- [ ] API_URL in bot script matches your server
- [ ] API_URL in GUI script matches your server
- [ ] Server is running (local or remote)
- [ ] MIN_GENERATION is set to your desired threshold
- [ ] Port numbers match (if using custom port)

---

**Tip**: Keep a backup of your configs before changing!
