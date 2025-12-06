# 🚂 Railway Deployment Guide

## Step 1: Add Environment Variables in Railway

### Method 1: Via Railway Dashboard (Recommended)

1. **Go to your Railway project**
   - Visit https://railway.app/
   - Select your project (or create a new one)

2. **Navigate to Variables**
   - Click on your service/deployment
   - Click on the **"Variables"** tab (or look for "Environment" or "Secrets" in the sidebar)

3. **Add Your LuArmor Credentials**
   Click **"New Variable"** and add each one:

   **Variable 1:**
   - **Name**: `LUARMOR_API_KEY`
   - **Value**: `d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9`
   - Click **"Add"**

   **Variable 2:**
   - **Name**: `LUARMOR_PROJECT_ID`
   - **Value**: `7e771572421c77e6fbf41c5f796cd6ce`
   - Click **"Add"**

   **Variable 3 (Optional):**
   - **Name**: `LUARMOR_API_URL`
   - **Value**: `https://api.luarmor.net/v3`
   - Click **"Add"**

   **Variable 4 (Optional):**
   - **Name**: `PORT`
   - **Value**: `3000`
   - Click **"Add"`

4. **Save and Redeploy**
   - Railway will automatically redeploy when you add variables
   - Or click **"Redeploy"** button if needed

### Method 2: Via Railway CLI

If you have Railway CLI installed:

```bash
railway variables set LUARMOR_API_KEY=d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9
railway variables set LUARMOR_PROJECT_ID=7e771572421c77e6fbf41c5f796cd6ce
railway variables set LUARMOR_API_URL=https://api.luarmor.net/v3
railway variables set PORT=3000
```

## Step 2: Verify Variables Are Set

1. Go to your Railway service
2. Click on **"Variables"** tab
3. You should see all 4 variables listed:
   - ✅ `LUARMOR_API_KEY`
   - ✅ `LUARMOR_PROJECT_ID`
   - ✅ `LUARMOR_API_URL` (optional)
   - ✅ `PORT` (optional)

## Step 3: Check Deployment Logs

After redeploying, check your Railway logs. You should see:

```
[API] LuArmor API Key: ✅ Configured
[API] LuArmor Project ID: ✅ Configured
```

If you see "❌ Not configured", the variables aren't being read. Check:
- Variable names are exactly correct (case-sensitive)
- No extra spaces in variable names or values
- Service has been redeployed after adding variables

## Step 4: Whitelist Railway IP in LuArmor

**IMPORTANT**: You must whitelist Railway's IP addresses in LuArmor dashboard!

1. Go to https://luarmor.net/dashboard
2. Navigate to **API Settings**
3. Find your Railway service's public IP (check Railway logs or use a service like `curl ifconfig.me` from Railway)
4. Add the IP to whitelist
5. Save changes

**Note**: Railway IPs can change. You may need to:
- Use Railway's static IP feature (if available)
- Or whitelist a range of IPs
- Or contact LuArmor support for Railway IP ranges

## Step 5: Test Your API

Once deployed, test your API:

```bash
# Test health endpoint
curl https://your-railway-app.up.railway.app/api/health

# Test key verification
curl -X POST https://your-railway-app.up.railway.app/api/verify-key \
  -H "X-API-Key: test-user-key" \
  -H "Content-Type: application/json"
```

## 🎯 Quick Reference

**Your Credentials:**
- API Key: `d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9`
- Project ID: `7e771572421c77e6fbf41c5f796cd6ce`

**Railway Variables to Add:**
```
LUARMOR_API_KEY=d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9
LUARMOR_PROJECT_ID=7e771572421c77e6fbf41c5f796cd6ce
LUARMOR_API_URL=https://api.luarmor.net/v3
PORT=3000
```

## ⚠️ Troubleshooting

**Variables not working?**
- Make sure variable names match exactly (case-sensitive)
- Redeploy after adding variables
- Check Railway logs for errors

**API calls failing?**
- Verify IP is whitelisted in LuArmor dashboard
- Check Railway logs for connection errors
- Test with `curl` to see exact error messages

**Can't find Variables tab?**
- Railway UI may vary
- Look for "Environment", "Secrets", or "Config" tabs
- Or use Railway CLI method above

