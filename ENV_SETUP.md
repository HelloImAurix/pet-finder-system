# 🔐 Environment Variables Setup

## Your LuArmor Credentials

Set these environment variables on your server:

```bash
LUARMOR_API_KEY=d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9
LUARMOR_PROJECT_ID=7e771572421c77e6fbf41c5f796cd6ce
LUARMOR_API_URL=https://api.luarmor.net/v3
PORT=3000
```

## Setting Up Environment Variables

### Option 1: Railway/Render (Cloud Hosting)

1. Go to your project settings
2. Navigate to "Environment Variables" or "Secrets"
3. Add each variable:
   - `LUARMOR_API_KEY` = `d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9`
   - `LUARMOR_PROJECT_ID` = `7e771572421c77e6fbf41c5f796cd6ce`
   - `LUARMOR_API_URL` = `https://api.luarmor.net/v3` (optional)
   - `PORT` = `3000` (optional)

### Option 2: Local Development (.env file)

Create a `.env` file in the `PetFinderSystem` folder:

```bash
LUARMOR_API_KEY=d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9
LUARMOR_PROJECT_ID=7e771572421c77e6fbf41c5f796cd6ce
LUARMOR_API_URL=https://api.luarmor.net/v3
PORT=3000
```

**Note**: `.env` is already in `.gitignore` so it won't be committed to git.

### Option 3: Command Line (Linux/Mac)

```bash
export LUARMOR_API_KEY=d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9
export LUARMOR_PROJECT_ID=7e771572421c77e6fbf41c5f796cd6ce
export LUARMOR_API_URL=https://api.luarmor.net/v3
export PORT=3000
```

### Option 4: PowerShell (Windows)

```powershell
$env:LUARMOR_API_KEY="d0b0073a437fdbc540f31088ccf7e5f86170b173a0ef8ab176a9"
$env:LUARMOR_PROJECT_ID="7e771572421c77e6fbf41c5f796cd6ce"
$env:LUARMOR_API_URL="https://api.luarmor.net/v3"
$env:PORT="3000"
```

## ⚠️ Important Security Notes

1. **NEVER commit these values to git** - They're already in `.gitignore`
2. **NEVER share these keys publicly** - They give access to your LuArmor account
3. **Whitelist your server IP** in LuArmor dashboard for API access
4. **Rotate keys** if they're ever exposed

## ✅ Verify Setup

After setting environment variables, restart your server and check the logs:

```
[API] LuArmor API Key: ✅ Configured
[API] LuArmor Project ID: ✅ Configured
```

If you see "❌ Not configured", the environment variables aren't being read correctly.

