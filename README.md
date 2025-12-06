# 🔍 Pet Finder System

Automated system for finding and tracking rare pets across multiple Roblox accounts with real-time GUI.

## 📁 Core Files

- **PetFinderBot.lua** - Bot script that scans servers and sends finds to API
- **PetFinderGUI.lua** - GUI interface to view finds with join buttons
- **server.js** - Node.js API server with security features
- **package.json** - Node.js dependencies
- **Procfile** - Railway deployment config

## 🚀 Quick Setup

### 1. Deploy Server to Railway

1. Push this repo to GitHub
2. Connect Railway to your GitHub repo
3. Add environment variables in Railway:
   - `LUARMOR_API_KEY` - Your LuArmor API key
   - `LUARMOR_PROJECT_ID` - Your LuArmor project ID
   - `PORT` - 3000 (optional)

### 2. Update Bot Script

In `PetFinderBot.lua`, set:
```lua
local API_URL = "https://your-railway-url.up.railway.app/api/pet-found"
local API_KEY = "user-luarmor-license-key"  -- User's license key
```

### 3. Load Scripts

- Load `PetFinderBot.lua` on bot accounts
- Load `PetFinderGUI.lua` on your main account

## ⚙️ Features

- ✅ **Batched requests** - Sends finds in groups (every 5 seconds)
- ✅ **API key authentication** - Requires valid LuArmor keys
- ✅ **Rate limiting** - 5 requests per 10 seconds per IP
- ✅ **LuArmor integration** - Validates user license keys
- ✅ **Real-time GUI** - Updates every 2 seconds with green join buttons

## 🔐 Security

- All bot requests require valid LuArmor license keys
- Rate limiting prevents spam/abuse
- Batched requests reduce server load
- Environment variables for sensitive data

## 📝 API Endpoints

- `POST /api/pet-found` - Receive pet finds (batched, requires auth)
- `GET /api/finds/recent` - Get recent finds (public, for GUI)
- `POST /api/verify-key` - Verify LuArmor key
- `GET /api/health` - Health check

## ⚠️ Important

- **Whitelist Railway IP** in LuArmor dashboard for API access
- Set environment variables in Railway (not in code)
- Update `API_URL` in bot script with your Railway URL
