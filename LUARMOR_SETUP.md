# 🔐 LuArmor.net Integration Setup

This system integrates with **LuArmor.net** (https://luarmor.net/) for license key verification.

## 📋 Prerequisites

1. **LuArmor Account**: Sign up at https://luarmor.net/
2. **API Access**: Get your API key from the LuArmor dashboard
3. **IP Whitelisting**: Whitelist your server IP address in LuArmor dashboard
   - Without whitelisting, API requests will be blocked!

## 🔧 Configuration Steps

### Step 1: Get Your LuArmor API Key

1. Log into https://luarmor.net/dashboard
2. Navigate to API settings
3. Copy your API key

### Step 2: Whitelist Server IP

**CRITICAL**: You must whitelist your server's IP address in LuArmor dashboard, otherwise all API requests will fail!

1. Go to LuArmor dashboard → API Settings
2. Add your server's public IP address
3. Save changes

### Step 3: Set Environment Variables

On your server (Railway, Render, etc.), set:

```bash
# Required
LUARMOR_API_KEY=your-api-key-from-dashboard
LUARMOR_PROJECT_ID=your-project-id-here

# Optional (defaults shown)
LUARMOR_API_URL=https://api.luarmor.net/v3
PORT=3000
```

**Where to find Project ID:**
- Go to your LuArmor dashboard
- Select your project
- The Project ID is shown in the project settings/URL

### Step 4: API Implementation Details

The implementation uses LuArmor's official API:
- **Endpoint**: `GET /v3/projects/:project_id/users?user_key=KEY`
- **Method**: GET (no request body needed)
- **Authentication**: API key in `Authorization` header
- **Documentation**: https://docs.luarmor.net/docs/luarmor-api-documentation

The code automatically:
- Checks if user key exists
- Verifies user is not banned
- Checks if key has expired
- Validates user status (active/reset/banned)

## 📚 LuArmor API Reference

- **Documentation**: https://docs.luarmor.net/docs/luarmor-api-documentation
- **Rate Limit**: 60 requests per minute
- **Authentication**: Bearer token or API key header (check docs)

## 🧪 Testing

### Test Key Verification

```bash
curl -X POST https://your-api.com/api/verify-key \
  -H "X-API-Key: user-license-key" \
  -H "Content-Type: application/json"
```

### Check Server Logs

Look for:
- `[API] LuArmor verification error:` - API call failed
- `Authentication failed:` - Invalid license key
- `Rate limit exceeded` - Too many requests

## ⚠️ Important Notes

1. **IP Whitelisting is REQUIRED** - Without it, all requests fail
2. **Rate Limits** - LuArmor allows 60 requests/minute
3. **Endpoint Format** - May vary, check LuArmor docs
4. **Request Format** - Update body format per LuArmor API spec

## 🐛 Troubleshooting

**"Request timeout" or "Connection refused"**
- Check if server IP is whitelisted in LuArmor dashboard
- Verify API URL is correct
- Check firewall settings

**"Invalid key" or "Authentication failed"**
- Verify the license key format
- Check if key is active in LuArmor dashboard
- Ensure request body format matches LuArmor API spec

**"Rate limit exceeded"**
- LuArmor allows 60 requests/minute
- Implement caching for verified keys
- Reduce verification frequency

## 📝 Next Steps

1. Read LuArmor API documentation
2. Update endpoint URL in `server.js` if different
3. Update request body format if different
4. Test with a real license key
5. Monitor server logs for errors

