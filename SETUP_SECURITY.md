# 🚀 Quick Security Setup

## Step 1: Configure Server Environment Variables

Add these to your hosting platform (Railway, Render, etc.) or `.env` file:

```bash
# Required for LuArmor verification
LUARMOR_API_KEY=your-luarmor-api-key-here
LUARMOR_PROJECT_ID=your-project-id-here

# Optional (defaults shown)
LUARMOR_API_URL=https://api.luarmor.net/v3
PORT=3000
```

**Where to find these:**
- **LUARMOR_API_KEY**: Get from https://luarmor.net/dashboard → API Settings
- **LUARMOR_PROJECT_ID**: Get from your LuArmor project settings (the project ID where your users/keys are stored)

## Step 2: Update Bot Script

In `PetFinderBot.lua`, users need to set their LuArmor license key:

```lua
local API_KEY = "user-luarmor-license-key"  -- Each user sets their own key
```

## Step 3: Deploy Server

The server now includes:
- ✅ **Batched requests** - Sends finds in groups every 5 seconds
- ✅ **API key authentication** - Requires valid LuArmor keys
- ✅ **Rate limiting** - 5 requests per 10 seconds per IP
- ✅ **LuArmor verification** - Validates keys through LuArmor API

## Step 4: Whitelist Server IP

**CRITICAL**: You must whitelist your server's IP address in LuArmor dashboard, otherwise API requests will be blocked by Cloudflare!

1. Go to https://luarmor.net/dashboard
2. Navigate to API Settings
3. Add your server's public IP address
4. Save changes

## Step 5: Test

1. **Test key verification:**
   ```bash
   curl -X POST https://your-api.com/api/verify-key \
     -H "X-API-Key: user-license-key" \
     -H "Content-Type: application/json"
   ```

2. **Test rate limiting:**
   Send 6 requests quickly - the 6th should return 429 error.

## 🔧 LuArmor API Integration

The server uses LuArmor's official API endpoint:
- **Endpoint**: `GET /v3/projects/:project_id/users?user_key=KEY`
- **Documentation**: https://docs.luarmor.net/docs/luarmor-api-documentation
- **Authentication**: API key in `Authorization` header
- **Rate Limit**: 60 requests per minute

## 📝 What Changed

### Bot (`PetFinderBot.lua`)
- Collects finds in a batch queue
- Sends batches every 5 seconds (or when batch reaches 20 items)
- Includes API key in requests

### Server (`server.js`)
- Requires `X-API-Key` header or `apiKey` in body
- Verifies keys with LuArmor API
- Rate limits: 5 requests per 10 seconds
- Handles batched requests (array of finds)

### Security Features
- ✅ No more spam attacks (rate limiting)
- ✅ No more fake data (key authentication)
- ✅ Reduced server load (batching)
- ✅ LuArmor integration (key validation)

## ⚠️ Important Notes

1. **Development Mode**: If `LUARMOR_API_KEY` is not set, the server allows all requests (for testing)
2. **Production**: Always set `LUARMOR_API_KEY` in production
3. **Key Format**: Update LuArmor API endpoint/format based on their documentation

