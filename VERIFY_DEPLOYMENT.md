# ✅ Deployment Verification Checklist

## Step 1: Check Railway Logs

1. Go to your Railway project
2. Click on your service
3. Open the **"Logs"** tab
4. Look for these messages:

```
[API] Pet Finder API Server running on port 3000
[API] LuArmor API Key: ✅ Configured
[API] LuArmor Project ID: ✅ Configured
```

**If you see "❌ Not configured":**
- Environment variables aren't set correctly
- Go back to Variables tab and double-check

## Step 2: Test Health Endpoint

Get your Railway URL (looks like: `https://your-app.up.railway.app`)

Test in browser or terminal:
```bash
curl https://your-railway-url.up.railway.app/api/health
```

**Expected response:**
```json
{
  "success": true,
  "status": "running",
  "totalFinds": 0,
  "uptime": 123.45
}
```

## Step 3: Test Key Verification Endpoint

Test with a valid user key:
```bash
curl -X POST https://your-railway-url.up.railway.app/api/verify-key \
  -H "X-API-Key: test-user-key-here" \
  -H "Content-Type: application/json"
```

**Expected responses:**
- ✅ Valid key: `{"success": true, "valid": true, ...}`
- ❌ Invalid key: `{"success": false, "valid": false, "error": "..."}`

## Step 4: Check LuArmor IP Whitelisting

**CRITICAL**: If API calls fail, check:

1. Go to https://luarmor.net/dashboard
2. Navigate to API Settings
3. Find your Railway server's IP address
4. Add it to whitelist

**How to find Railway IP:**
- Check Railway logs for outbound IP
- Or use: `curl ifconfig.me` from Railway (if you have shell access)
- Or check Railway's network settings

## Step 5: Update Bot Script

In `PetFinderBot.lua`, update the API URL:

```lua
local API_URL = "https://your-railway-url.up.railway.app/api/pet-found"
```

Replace `your-railway-url.up.railway.app` with your actual Railway URL.

## Step 6: Test Bot Connection

1. Load `PetFinderBot.lua` in Roblox
2. Check console for:
   - `[Bot] Added to batch: ...`
   - `[Bot] Successfully sent batch of X pets to API`

3. Check Railway logs for:
   - `[API] Received batch of X pet finds from ...`

## 🐛 Troubleshooting

### Server not responding?
- Check Railway logs for errors
- Verify PORT is set (default 3000)
- Check if service is running (not paused)

### "LuArmor verification error"?
- IP not whitelisted in LuArmor dashboard
- API key or Project ID incorrect
- Check Railway logs for exact error

### "Rate limit exceeded"?
- Normal if testing quickly
- Wait 10 seconds between requests
- Check rate limit: 5 requests per 10 seconds

### Bot can't connect?
- Verify API_URL in bot script matches Railway URL
- Check if server is running
- Test health endpoint first

## 📝 Quick Test Commands

```bash
# 1. Health check
curl https://your-url.up.railway.app/api/health

# 2. Verify key (replace with real user key)
curl -X POST https://your-url.up.railway.app/api/verify-key \
  -H "X-API-Key: user-key-here" \
  -H "Content-Type: application/json"

# 3. Get recent finds (should be empty at first)
curl https://your-url.up.railway.app/api/finds/recent
```

## ✅ Success Indicators

You're good to go when:
- ✅ Railway logs show "✅ Configured" for both API key and Project ID
- ✅ Health endpoint returns 200 OK
- ✅ Bot can send finds to API
- ✅ GUI can fetch finds from API
- ✅ No errors in Railway logs

