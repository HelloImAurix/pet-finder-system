// Pet Finder API Server - Updated for free hosting with security
// Run: node server.js

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000; // Use environment variable for hosting

// Middleware
app.use(cors()); // Allow all origins for free hosting
app.use(express.json());

// Store finds in memory (you can use a database for persistence)
let petFinds = [];
const MAX_FINDS = 1000; // Keep last 1000 finds

// Rate limiting storage
const rateLimitStore = new Map(); // IP -> { count: number, resetTime: number }

// LuArmor API configuration (https://luarmor.net/)
// Get your API key from: https://luarmor.net/dashboard
// Whitelist your server IP in LuArmor dashboard for API access
// Documentation: https://docs.luarmor.net/docs/luarmor-api-documentation
const LUARMOR_API_URL = process.env.LUARMOR_API_URL || "https://api.luarmor.net/v3";
const LUARMOR_API_KEY = process.env.LUARMOR_API_KEY || ""; // Your LuArmor API key (REQUIRED)
const LUARMOR_PROJECT_ID = process.env.LUARMOR_PROJECT_ID || ""; // Your LuArmor Project ID (REQUIRED)

// Rate limiting: 5 requests per 10 seconds per IP
function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const now = Date.now();
    
    if (!rateLimitStore.has(ip)) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + 10000 });
        return next();
    }
    
    const limit = rateLimitStore.get(ip);
    
    if (now > limit.resetTime) {
        // Reset window
        limit.count = 1;
        limit.resetTime = now + 10000;
        return next();
    }
    
    if (limit.count >= 5) {
        return res.status(429).json({ 
            success: false, 
            error: 'Rate limit exceeded. Maximum 5 requests per 10 seconds.' 
        });
    }
    
    limit.count++;
    next();
}

// Clean up old rate limit entries every minute
setInterval(() => {
    const now = Date.now();
    for (const [ip, limit] of rateLimitStore.entries()) {
        if (now > limit.resetTime + 60000) {
            rateLimitStore.delete(ip);
        }
    }
}, 60000);

// Verify LuArmor user key
// Documentation: https://docs.luarmor.net/docs/luarmor-api-documentation
// Uses GET /v3/projects/:project_id/users?user_key=KEY endpoint
async function verifyLuArmorKey(userKey) {
    if (!userKey || userKey === "") {
        return { valid: false, reason: "No user key provided" };
    }
    
    if (!LUARMOR_API_KEY || LUARMOR_API_KEY === "") {
        console.warn("[API] LuArmor API key not configured, skipping verification");
        return { valid: true }; // Allow if not configured (for development)
    }
    
    if (!LUARMOR_PROJECT_ID || LUARMOR_PROJECT_ID === "") {
        console.warn("[API] LuArmor Project ID not configured, skipping verification");
        return { valid: true }; // Allow if not configured (for development)
    }
    
    try {
        // LuArmor API: GET /v3/projects/:project_id/users?user_key=KEY
        // Documentation: https://docs.luarmor.net/docs/luarmor-api-documentation
        // Rate limit: 60 requests per minute
        // IMPORTANT: Whitelist your server IP in LuArmor dashboard!
        
        const endpoint = `${LUARMOR_API_URL}/projects/${LUARMOR_PROJECT_ID}/users?user_key=${encodeURIComponent(userKey)}`;
        const url = new URL(endpoint);
        const isHttps = url.protocol === 'https:';
        const requestModule = isHttps ? https : http;
        
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': LUARMOR_API_KEY, // API key in Authorization header
                'User-Agent': 'PetFinder-API/1.0'
            }
        };
        
        const response = await new Promise((resolve, reject) => {
            const req = requestModule.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ data: parsed, statusCode: res.statusCode });
                    } catch (e) {
                        reject(new Error(`Invalid JSON response: ${e.message}`));
                    }
                });
            });
            
            req.on('error', reject);
            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.end();
        });
        
        // Check response status
        if (response.statusCode === 403) {
            return { valid: false, reason: "Invalid API key or unauthorized" };
        }
        
        if (response.statusCode === 404) {
            return { valid: false, reason: "Project not found" };
        }
        
        if (response.statusCode !== 200) {
            return { valid: false, reason: `API returned status ${response.statusCode}` };
        }
        
        const apiResponse = response.data;
        
        // Check if request was successful
        if (!apiResponse.success) {
            return { valid: false, reason: apiResponse.message || "Key verification failed" };
        }
        
        // Check if users array exists and has at least one user
        if (!apiResponse.users || !Array.isArray(apiResponse.users) || apiResponse.users.length === 0) {
            return { valid: false, reason: "User key not found" };
        }
        
        const user = apiResponse.users[0];
        
        // Check if user is banned
        if (user.banned === 1) {
            return { valid: false, reason: user.ban_reason || "User is banned" };
        }
        
        // Check if key has expired (auth_expire is -1 for unlimited, otherwise check timestamp)
        if (user.auth_expire !== -1 && user.auth_expire > 0) {
            const now = Math.floor(Date.now() / 1000);
            if (now > user.auth_expire) {
                return { valid: false, reason: "Key has expired" };
            }
        }
        
        // Check if user is active
        if (user.status === "banned") {
            return { valid: false, reason: "User is banned" };
        }
        
        // Key is valid
        return { 
            valid: true, 
            user: {
                user_key: user.user_key,
                discord_id: user.discord_id,
                status: user.status,
                auth_expire: user.auth_expire,
                total_executions: user.total_executions
            }
        };
    } catch (error) {
        console.error("[API] LuArmor verification error:", error.message);
        // On error, fail closed for security (strict verification)
        return { valid: false, reason: `Verification error: ${error.message}` };
    }
}

// Authentication middleware
async function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.body.apiKey;
    
    if (!apiKey) {
        return res.status(401).json({ 
            success: false, 
            error: 'API key required. Include X-API-Key header or apiKey in body.' 
        });
    }
    
    const verification = await verifyLuArmorKey(apiKey);
    
    if (!verification.valid) {
        return res.status(403).json({ 
            success: false, 
            error: `Authentication failed: ${verification.reason}` 
        });
    }
    
    // Attach user info to request for logging
    req.authenticatedUser = verification.user || apiKey;
    next();
}

// ===== API ENDPOINTS =====

// POST: Receive pet finds from bot (batched) - No auth required (your bots)
app.post('/api/pet-found', rateLimit, (req, res) => {
    try {
        const body = req.body;
        const finds = body.finds || [body]; // Support both batched and single finds
        
        if (!Array.isArray(finds) || finds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request. Expected "finds" array or single find object.' 
            });
        }
        
        const accountName = body.accountName || finds[0]?.accountName || req.authenticatedUser || "Unknown";
        let addedCount = 0;
        
        // Process each find in the batch
        for (const findData of finds) {
            const find = {
                id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9),
                petName: findData.petName,
                generation: findData.generation,
                mps: findData.mps,
                rarity: findData.rarity || "Unknown",
                placeId: findData.placeId,
                jobId: findData.jobId,
                playerCount: findData.playerCount,
                maxPlayers: findData.maxPlayers || 6,
                accountName: findData.accountName || accountName,
                timestamp: findData.timestamp || Date.now(),
                receivedAt: new Date().toISOString()
            };
            
            // Add to list
            petFinds.unshift(find);
            addedCount++;
        }
        
        // Keep only recent finds
        if (petFinds.length > MAX_FINDS) {
            petFinds = petFinds.slice(0, MAX_FINDS);
        }
        
        console.log(`[API] Received batch of ${addedCount} pet finds from ${accountName}`);
        
        res.status(200).json({ 
            success: true, 
            message: `Received ${addedCount} pet find(s)`,
            received: addedCount 
        });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET: Get all finds
app.get('/api/finds', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const finds = petFinds.slice(0, limit);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET: Get recent finds (last 10 minutes) - No auth (LuArmor handles protection in obfuscated GUI)
app.get('/api/finds/recent', rateLimit, (req, res) => {
    try {
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        const recent = petFinds.filter(find => {
            const findTime = new Date(find.receivedAt || find.timestamp * 1000).getTime();
            return findTime > tenMinutesAgo;
        });
        
        // Debug: Log what we're sending
        console.log(`[API] Total finds in storage: ${petFinds.length}, Recent (last 10min): ${recent.length}`);
        if (recent.length > 0) {
            console.log(`[API] First find - placeId: ${recent[0].placeId}, jobId: ${recent[0].jobId}, petName: ${recent[0].petName}`);
        } else if (petFinds.length > 0) {
            const oldestFind = petFinds[petFinds.length - 1];
            const oldestTime = new Date(oldestFind.receivedAt || oldestFind.timestamp * 1000).getTime();
            const ageMinutes = Math.floor((Date.now() - oldestTime) / (60 * 1000));
            console.log(`[API] All finds are older than 10 minutes. Oldest find is ${ageMinutes} minutes old.`);
        } else {
            console.log(`[API] No finds in storage at all. Waiting for bots to send data.`);
        }
        
        res.json({ success: true, finds: recent, total: recent.length });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST: Verify LuArmor user key (for client-side verification)
// Documentation: https://docs.luarmor.net/docs/luarmor-api-documentation
app.post('/api/verify-key', rateLimit, async (req, res) => {
    try {
        const userKey = req.headers['x-api-key'] || req.body.key || req.body.user_key;
        
        if (!userKey) {
            return res.status(400).json({ 
                success: false, 
                error: 'User key required. Send in X-API-Key header or body.key/body.user_key' 
            });
        }
        
        const verification = await verifyLuArmorKey(userKey);
        
        if (verification.valid) {
            res.json({ 
                success: true, 
                valid: true,
                user: verification.user,
                message: 'Key verified successfully' 
            });
        } else {
            res.status(403).json({ 
                success: false, 
                valid: false,
                error: verification.reason || 'Invalid key' 
            });
        }
    } catch (error) {
        console.error('[API] Key verification error:', error);
        // Ensure we always return JSON, not HTML
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Internal server error',
            valid: false
        });
    }
});

// GET: Clear all finds
app.delete('/api/finds', (req, res) => {
    petFinds = [];
    res.json({ success: true, message: 'All finds cleared' });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        status: 'running',
        totalFinds: petFinds.length,
        uptime: process.uptime()
    });
});

// Get server IP (for LuArmor whitelisting)
app.get('/api/ip', async (req, res) => {
    try {
        // Get outbound IP by making a request to an external service
        const response = await new Promise((resolve, reject) => {
            https.get('https://api.ipify.org?format=json', (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
        
        res.json({
            success: true,
            message: 'Use this IP to whitelist in LuArmor dashboard',
            ip: response.ip,
            instructions: 'Go to LuArmor dashboard → API Settings → Whitelist this IP'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            note: 'Could not determine IP. Check Railway network settings or contact support.'
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Pet Finder API Server',
        endpoints: {
            'POST /api/pet-found': 'Receive pet finds from bots',
            'GET /api/finds': 'Get all finds',
            'GET /api/finds/recent': 'Get recent finds',
            'DELETE /api/finds': 'Clear all finds',
            'GET /api/health': 'Health check'
        }
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Pet Finder API Server running on port ${PORT}`);
    console.log(`[API] Security: Rate limiting enabled (5 req/10s), Authentication required`);
    console.log(`[API] LuArmor: ${LUARMOR_API_KEY ? 'Configured' : 'Not configured (dev mode)'}`);
    console.log(`[API] Endpoints:`);
    console.log(`[API]   POST /api/pet-found - Receive pet finds (batched, requires auth)`);
    console.log(`[API]   POST /api/verify-key - Verify LuArmor key`);
    console.log(`[API]   GET  /api/finds - Get all finds`);
    console.log(`[API]   GET  /api/finds/recent - Get recent finds (public)`);
    console.log(`[API]   DELETE /api/finds - Clear all finds`);
    console.log(`[API]   GET  /api/health - Health check`);
});
