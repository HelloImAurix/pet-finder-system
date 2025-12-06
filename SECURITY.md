# 🔒 Security Configuration Guide

This document explains how to configure the security features for the Pet Finder API.

## 🔑 API Key Authentication

The API now requires authentication using LuArmor keys. All bot requests must include a valid API key.

### Setting Up API Keys

1. **Get your LuArmor API key** from your LuArmor dashboard
2. **Set environment variable** on your server:
   ```bash
   export LUARMOR_API_KEY="your-luarmor-api-key"
   export LUARMOR_API_URL="https://api.luarmor.net/v3"  # Update if different
   ```

3. **Update bot script** with your API key:
   ```lua
   local API_KEY = "your-luarmor-license-key"  -- User's LuArmor license key
   ```

### How It Works

- Bots send their LuArmor license key in the `X-API-Key` header or `apiKey` field
- Server verifies the key with LuArmor API
- Only valid keys can submit pet finds

## 🚦 Rate Limiting

Rate limiting prevents API abuse:
- **Limit**: 5 requests per 10 seconds per IP address
- **Response**: 429 Too Many Requests if exceeded

This prevents:
- Spam attacks
- Fake data injection
- API abuse

## 📦 Batched Requests

Pet finds are now sent in groups instead of individually:
- **Batch interval**: Every 5 seconds
- **Max batch size**: 20 pets per request
- **Benefits**: 
  - Reduced server load
  - Better performance
  - Lower API call count

## 🛡️ Protection Features

### What's Protected

✅ **API Key Authentication** - Only whitelisted keys can submit data  
✅ **Rate Limiting** - Prevents spam/abuse  
✅ **Batched Requests** - Reduces server load  
✅ **LuArmor Integration** - Validates keys through LuArmor API  

### What's NOT Protected (Public Endpoints)

- `GET /api/finds/recent` - Public (for GUI)
- `GET /api/health` - Public (health check)

## 🔧 Configuration

### Environment Variables

```bash
# Required for production
LUARMOR_API_KEY=your-luarmor-api-key
LUARMOR_API_URL=https://api.luarmor.net/v3

# Optional
PORT=3000
```

### Bot Configuration

In `PetFinderBot.lua`:
```lua
local API_KEY = "" -- User's LuArmor license key (set by user)
local BATCH_SEND_INTERVAL = 5 -- Seconds between batch sends
local MAX_BATCH_SIZE = 20 -- Max pets per batch
```

## 🚨 Security Notes

1. **Never commit API keys** to version control
2. **Use environment variables** for sensitive data
3. **Update LuArmor API URL** if it changes
4. **Monitor rate limit logs** for abuse attempts
5. **Keep server updated** with latest security patches

## 📝 Testing

### Test Key Verification
```bash
curl -X POST http://localhost:3000/api/verify-key \
  -H "X-API-Key: test-key" \
  -H "Content-Type: application/json"
```

### Test Rate Limiting
```bash
# Send 6 requests quickly (should fail on 6th)
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/pet-found \
    -H "X-API-Key: valid-key" \
    -H "Content-Type: application/json" \
    -d '{"finds":[],"apiKey":"valid-key"}'
done
```

## 🐛 Troubleshooting

**"Authentication failed"**
- Check API key is correct
- Verify LuArmor API is accessible
- Check server logs for details

**"Rate limit exceeded"**
- Wait 10 seconds between batches
- Reduce request frequency

**"Invalid request format"**
- Ensure `finds` is an array
- Check JSON format is valid

