# 🔍 Pet Finder System

Automated system for finding and tracking rare pets across multiple Roblox accounts with real-time GUI.

## 📁 Core Files

- **PetFinderBot.lua** - Bot script that scans servers and sends finds to API
- **PetFinderGUI.lua** - GUI interface to view finds with join buttons
- **server.js** - Node.js API server
- **package.json** - Node.js dependencies
- **Procfile** - Railway deployment config

## 🚀 Quick Setup

### 1. Deploy Server to Railway

1. Push this repo to GitHub
2. Connect Railway to your GitHub repo
3. Add environment variable in Railway (optional):
   - `PORT` - 3000 (defaults to 3000 if not set)

### 2. Update Bot Script

In `PetFinderBot.lua`, set:
```lua
local API_URL = "https://your-railway-url.up.railway.app/api/pet-found"
```

### 3. Load Scripts

- Load `PetFinderBot.lua` on bot accounts
- Load `PetFinderGUI.lua` on your main account

## ⚙️ Features

- ✅ **Batched requests** - Sends finds in groups (every 5 seconds)
- ✅ **Rate limiting** - 5 requests per 10 seconds per IP
- ✅ **Real-time GUI** - Updates every 1 second with join buttons
- ✅ **No authentication required** - Simple and fast

## 🔐 Security

- Rate limiting prevents spam/abuse
- Batched requests reduce server load

## 📝 API Endpoints

- `POST /api/pet-found` - Receive pet finds (batched)
- `GET /api/finds/recent` - Get recent finds (last 10 minutes)
- `GET /api/finds` - Get all finds
- `DELETE /api/finds` - Clear all finds
- `GET /api/health` - Health check

## ⚠️ Important

- Update `API_URL` in bot script with your Railway URL
- Update `API_URL` in GUI script with your Railway URL
