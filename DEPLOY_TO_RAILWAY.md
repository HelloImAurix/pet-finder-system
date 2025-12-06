# 🚀 Deploy Updated Files to Railway

Railway auto-deploys from your Git repository. Here's how to upload the new files:

## Method 1: Git Push (Recommended)

### Step 1: Commit Your Changes

Open terminal in the `PetFinderSystem` folder and run:

```bash
# Check what files changed
git status

# Add all changed files
git add .

# Commit with a message
git commit -m "Add security features: batching, LuArmor auth, rate limiting"

# Push to your repository
git push
```

### Step 2: Railway Auto-Deploys

Railway will automatically:
1. Detect the push
2. Build your project
3. Deploy the new version
4. Show progress in Railway dashboard

**Check Railway dashboard** → Your service → "Deploy Logs" tab to watch the deployment.

## Method 2: Railway CLI (Alternative)

If you have Railway CLI installed:

```bash
# Login to Railway
railway login

# Link to your project
railway link

# Deploy
railway up
```

## Method 3: Manual Upload (If not using Git)

If Railway is connected to a GitHub repo:

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Update server with security features"
   git push origin main
   ```

2. **Railway will auto-deploy** from GitHub

## 📁 Files That Need to Be Deployed

Make sure these files are in your repository:

- ✅ `server.js` (updated with security features)
- ✅ `package.json` (dependencies)
- ✅ `.gitignore` (to exclude .env)
- ✅ All other project files

## ⚠️ Important: Environment Variables

**Don't forget**: After deploying, make sure environment variables are set in Railway:

1. Go to Railway dashboard
2. Click your service
3. Go to "Variables" tab
4. Add:
   - `LUARMOR_API_KEY`
   - `LUARMOR_PROJECT_ID`
   - `LUARMOR_API_URL` (optional)
   - `PORT` (optional)

## ✅ Verify Deployment

After deployment completes:

1. **Check logs** for:
   ```
   [API] LuArmor API Key: ✅ Configured
   [API] LuArmor Project ID: ✅ Configured
   [API] Pet Finder API Server running on port 3000
   ```

2. **Test health endpoint:**
   ```
   https://your-railway-url.up.railway.app/api/health
   ```

## 🐛 Troubleshooting

**"No changes detected"?**
- Make sure you committed and pushed to the correct branch
- Check Railway is connected to the right repository

**"Build failed"?**
- Check Railway build logs for errors
- Verify `package.json` has all dependencies
- Make sure Node.js version is compatible

**"Environment variables missing"?**
- Go to Variables tab in Railway
- Add them manually (they don't come from Git)

## 📝 Quick Commands Summary

```bash
# Navigate to project folder
cd PetFinderSystem

# Check status
git status

# Add all files
git add .

# Commit
git commit -m "Deploy security updates"

# Push (Railway auto-deploys)
git push
```

That's it! Railway will handle the rest automatically.

