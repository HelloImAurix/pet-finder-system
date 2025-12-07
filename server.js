const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Try to load jobIdFetcher, but don't crash if it fails
let jobIdFetcher = null;
const jobIdFetcherPath = path.join(__dirname, 'jobIdFetcher.js');
if (fs.existsSync(jobIdFetcherPath)) {
    try {
        jobIdFetcher = require('./jobIdFetcher');
        console.log('[Server] Job ID fetcher module loaded successfully');
    } catch (error) {
        console.error('[Server] Failed to load jobIdFetcher module:', error.message);
        console.error('[Server] Server will continue without job ID caching');
    }
} else {
    console.warn('[Server] jobIdFetcher.js not found at:', jobIdFetcherPath);
    console.warn('[Server] Server will continue without job ID caching');
}

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEYS = {
    BOT: process.env.BOT_API_KEY || 'bot_key_change_me',
    GUI: process.env.GUI_API_KEY || 'gui_key_change_me',
    ADMIN: process.env.ADMIN_API_KEY || 'admin_key_change_me'
};

const requestLogs = new Map();

function logRequest(ip, endpoint, method) {
    const key = `${ip}_${endpoint}`;
    if (!requestLogs.has(key)) {
        requestLogs.set(key, []);
    }
    const logs = requestLogs.get(key);
    logs.push(Date.now());
    
    const recentLogs = logs.filter(time => Date.now() - time < 60000);
    requestLogs.set(key, recentLogs);
}

function authorize(requiredKey) {
    return (req, res, next) => {
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        
        if (!apiKey) {
            logRequest(ip, req.path, req.method);
            console.warn(`[SERVER] 🔒 Unauthorized request - Missing API key (IP: ${ip}, Endpoint: ${req.method} ${req.path})`);
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized. API key required.' 
            });
        }
        
        if (!API_KEYS[requiredKey] || apiKey !== API_KEYS[requiredKey]) {
            logRequest(ip, req.path, req.method);
            console.warn(`[SERVER] 🚫 Forbidden request - Invalid API key (IP: ${ip}, Endpoint: ${req.method} ${req.path})`);
            return res.status(403).json({ 
                success: false, 
                error: 'Forbidden. Invalid API key.' 
            });
        }
        
        next();
    };
}

function validateRequest(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    logRequest(ip, req.path, req.method);
    
    if (req.body && typeof req.body === 'object') {
        const bodySize = JSON.stringify(req.body).length;
        if (bodySize > 1000000) {
            return res.status(413).json({ 
                success: false, 
                error: 'Request body too large' 
            });
        }
    }
    
    next();
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(validateRequest);

let petFinds = [];
const MAX_FINDS = 1000;
const STORAGE_DURATION_HOURS = 1; // Store finds for 1 hour
const ALWAYS_SHOW_MINUTES = 10; // Always show last 10 minutes

// Helper function to get timestamp from find
function getFindTimestamp(find) {
    if (find.receivedAt) {
        return new Date(find.receivedAt).getTime();
    }
    if (find.timestamp) {
        const ts = typeof find.timestamp === 'number' ? find.timestamp : parseInt(find.timestamp);
        return ts < 10000000000 ? ts * 1000 : ts;
    }
    return Date.now(); // Default to now if no timestamp
}

// Cleanup function to remove finds older than 1 hour
function cleanupOldFinds() {
    const now = Date.now();
    const oneHourAgo = now - (STORAGE_DURATION_HOURS * 60 * 60 * 1000);
    
    const beforeCleanup = petFinds.length;
    
    // Remove finds older than 1 hour
    petFinds = petFinds.filter(find => {
        const findTime = getFindTimestamp(find);
        return findTime > oneHourAgo;
    });
    
    const afterCleanup = petFinds.length;
    if (beforeCleanup !== afterCleanup) {
        console.log(`[Cleanup] Removed ${beforeCleanup - afterCleanup} finds older than 1 hour. Remaining: ${afterCleanup}`);
    }
}

const rateLimitStore = new Map();

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const now = Date.now();
    
    if (!rateLimitStore.has(ip)) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + 10000 });
        return next();
    }
    
    const limit = rateLimitStore.get(ip);
    
    if (now > limit.resetTime) {
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

setInterval(() => {
    const now = Date.now();
    for (const [ip, limit] of rateLimitStore.entries()) {
        if (now > limit.resetTime + 60000) {
            rateLimitStore.delete(ip);
        }
    }
}, 60000);


function validatePetFind(findData) {
    const errors = [];
    
    if (!findData.petName || typeof findData.petName !== 'string' || findData.petName.trim().length === 0) {
        errors.push('Invalid or missing petName');
    }
    
    if (findData.petName && findData.petName.length > 100) {
        errors.push('petName too long (max 100 characters)');
    }
    
    if (findData.mps !== undefined) {
        const mps = typeof findData.mps === 'number' ? findData.mps : parseFloat(findData.mps);
        if (isNaN(mps) || mps < 0 || mps > 1e20) {
            errors.push('Invalid MPS value');
        }
    }
    
    if (findData.placeId !== undefined) {
        const placeId = typeof findData.placeId === 'number' ? findData.placeId : parseInt(findData.placeId);
        if (isNaN(placeId) || placeId <= 0 || placeId > 1e15) {
            errors.push('Invalid placeId');
        }
    }
    
    if (findData.jobId !== undefined && findData.jobId !== null) {
        const jobIdStr = String(findData.jobId);
        if (jobIdStr.length > 50) {
            errors.push('jobId too long');
        }
    }
    
    if (findData.playerCount !== undefined) {
        const playerCount = typeof findData.playerCount === 'number' ? findData.playerCount : parseInt(findData.playerCount);
        if (isNaN(playerCount) || playerCount < 0 || playerCount > 100) {
            errors.push('Invalid playerCount');
        }
    }
    
    if (findData.maxPlayers !== undefined) {
        const maxPlayers = typeof findData.maxPlayers === 'number' ? findData.maxPlayers : parseInt(findData.maxPlayers);
        if (isNaN(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) {
            errors.push('Invalid maxPlayers');
        }
    }
    
    if (findData.accountName && typeof findData.accountName === 'string' && findData.accountName.length > 50) {
        errors.push('accountName too long');
    }
    
    return errors;
}

app.post('/api/pet-found', authorize('BOT'), rateLimit, (req, res) => {
    try {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        const body = req.body;
        const finds = body.finds || [body];
        
        if (!Array.isArray(finds) || finds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request. Expected "finds" array or single find object.' 
            });
        }
        
        if (finds.length > 100) {
            return res.status(400).json({ 
                success: false, 
                error: 'Too many finds in batch. Maximum 100 per request.' 
            });
        }
        
        const accountName = body.accountName || finds[0]?.accountName || "Unknown";
        
        let addedCount = 0;
        let skippedCount = 0;
        let invalidCount = 0;
        
        for (const findData of finds) {
            const validationErrors = validatePetFind(findData);
            if (validationErrors.length > 0) {
                invalidCount++;
                continue;
            }
            
            const playerCount = findData.playerCount || 0;
            const maxPlayers = findData.maxPlayers || 6;
            if (playerCount >= maxPlayers) {
                skippedCount++;
                continue;
            }
            
            const mps = typeof findData.mps === 'number' ? findData.mps : (parseFloat(findData.mps) || 0);
            if (mps < 10000000) {
                skippedCount++;
                continue;
            }
            
            const generation = findData.generation ? String(findData.generation) : "N/A";
            
            const find = {
                id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9),
                petName: String(findData.petName).trim(),
                generation: generation,
                mps: mps,
                rarity: findData.rarity ? String(findData.rarity) : "Unknown",
                placeId: findData.placeId || 0,
                jobId: findData.jobId ? String(findData.jobId) : "",
                playerCount: playerCount,
                maxPlayers: maxPlayers,
                accountName: findData.accountName ? String(findData.accountName) : accountName,
                timestamp: findData.timestamp || Date.now(),
                receivedAt: new Date().toISOString()
            };
            
            petFinds.unshift(find);
            addedCount++;
        }
        
        // Clean up old finds before checking max limit
        cleanupOldFinds();
        
        if (petFinds.length > MAX_FINDS) {
            petFinds = petFinds.slice(0, MAX_FINDS);
        }
        
        console.log(`[SERVER] ✅ Pet finds batch received from account: ${accountName} (IP: ${ip})`);
        console.log(`[SERVER] 📊 Batch stats - Added: ${addedCount}, Skipped: ${skippedCount}, Invalid: ${invalidCount}, Total in batch: ${finds.length}`);
        
        if (addedCount > 0) {
            const addedPets = petFinds.slice(0, addedCount);
            console.log(`[SERVER] 🐾 New pet finds logged:`);
            addedPets.forEach((find, idx) => {
                const mpsFormatted = find.mps >= 1e9 ? `${(find.mps / 1e9).toFixed(2)}B` :
                                    find.mps >= 1e6 ? `${(find.mps / 1e6).toFixed(2)}M` :
                                    find.mps >= 1e3 ? `${(find.mps / 1e3).toFixed(2)}K` : find.mps;
                console.log(`[SERVER]   ${idx + 1}. ${find.petName} | Gen: ${find.generation} | MPS: ${mpsFormatted}/s | JobId: ${find.jobId.substring(0, 8)}... | Players: ${find.playerCount}/${find.maxPlayers}`);
            });
            console.log(`[SERVER] 💾 Total finds in storage: ${petFinds.length}`);
        }
        
        if (invalidCount > 0) {
            console.warn(`[SERVER] ⚠️  ${invalidCount} invalid find(s) rejected from ${accountName}`);
        }
        
        res.status(200).json({ 
            success: true, 
            message: `Received ${addedCount} pet find(s)`,
            received: addedCount 
        });
    } catch (error) {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.error(`[SERVER] ❌ Error processing pet finds (IP: ${ip}):`, error.message);
        console.error(`[SERVER] Stack trace:`, error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds', authorize('ADMIN'), (req, res) => {
    try {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        const limit = Math.min(parseInt(req.query.limit) || 50, 500);
        const finds = petFinds.slice(0, limit);
        console.log(`[SERVER] 👤 Admin requested finds (IP: ${ip}) - returning ${finds.length} finds (total: ${petFinds.length})`);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.error(`[SERVER] ❌ Error in ${req.path} (IP: ${ip}):`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds/recent', authorize('GUI'), rateLimit, (req, res) => {
    try {
        const now = Date.now();
        const oneHourAgo = now - (STORAGE_DURATION_HOURS * 60 * 60 * 1000);
        const tenMinutesAgo = now - (ALWAYS_SHOW_MINUTES * 60 * 1000);
        
        // Get finds from the last hour
        const hourFinds = petFinds.filter(find => {
            const findTime = getFindTimestamp(find);
            return findTime > oneHourAgo;
        });
        
        // Separate into last 10 minutes and older (but within hour)
        const last10Minutes = [];
        const olderButWithinHour = [];
        
        for (const find of hourFinds) {
            const findTime = getFindTimestamp(find);
            if (findTime > tenMinutesAgo) {
                last10Minutes.push(find);
            } else {
                olderButWithinHour.push(find);
            }
        }
        
        // Sort both groups by most recent first
        last10Minutes.sort((a, b) => getFindTimestamp(b) - getFindTimestamp(a));
        olderButWithinHour.sort((a, b) => getFindTimestamp(b) - getFindTimestamp(a));
        
        // Combine: last 10 minutes first, then older finds within the hour
        const combined = [...last10Minutes, ...olderButWithinHour];
        
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.log(`[SERVER] 📱 GUI requested recent finds (IP: ${ip}) - Total stored: ${petFinds.length}, Last hour: ${hourFinds.length}, Last 10min: ${last10Minutes.length}, Returning: ${combined.length}`);
        
        res.json({ 
            success: true, 
            finds: combined, 
            total: combined.length,
            last10Minutes: last10Minutes.length,
            lastHour: hourFinds.length
        });
    } catch (error) {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.error(`[SERVER] ❌ Error in ${req.path} (IP: ${ip}):`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/finds', authorize('ADMIN'), (req, res) => {
    petFinds = [];
    res.json({ success: true, message: 'All finds cleared' });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        status: 'running',
        totalFinds: petFinds.length,
        uptime: process.uptime()
    });
});

// Debug endpoint to see all finds (not filtered by time)
app.get('/api/finds/all', authorize('ADMIN'), (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const finds = petFinds.slice(0, limit);
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.log(`[SERVER] 👤 Admin requested all finds (IP: ${ip}) - returning ${finds.length} finds (total: ${petFinds.length})`);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.error(`[SERVER] ❌ Error in ${req.path} (IP: ${ip}):`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Job ID endpoints for server hopping
app.get('/api/job-ids', authorize('BOT'), (req, res) => {
    try {
        if (!jobIdFetcher) {
            console.warn(`[SERVER] ⚠️  Job ID fetcher module not available (IP: ${ip})`);
            // Return success with empty array instead of 503, so bot knows server is working
            return res.json({ 
                success: true,
                jobIds: [],
                count: 0,
                totalAvailable: 0,
                cacheInfo: {
                    count: 0,
                    lastUpdated: null,
                    placeId: 0
                },
                message: 'Job ID fetcher module not available. Server is running but job ID caching is disabled.'
            });
        }
        
        const limit = parseInt(req.query.limit) || 100;
        const exclude = req.query.exclude ? req.query.exclude.split(',') : [];
        
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.log(`[SERVER] 🤖 Bot requested job IDs (IP: ${ip}) - limit: ${limit}, exclude: ${exclude.length} IDs`);
        
        // Load cache
        try {
            jobIdFetcher.loadCache();
        } catch (cacheError) {
            console.error('[API] Error loading cache:', cacheError.message);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to load job ID cache',
                details: cacheError.message
            });
        }
        
        let jobIds = [];
        try {
            jobIds = jobIdFetcher.getJobIds();
            if (!Array.isArray(jobIds)) {
                console.warn(`[SERVER] ⚠️  getJobIds() did not return an array, defaulting to empty array (IP: ${ip})`);
                jobIds = [];
            }
        } catch (getError) {
            console.error(`[SERVER] ❌ Error getting job IDs (IP: ${ip}):`, getError.message);
            jobIds = [];
        }
        
        console.log(`[SERVER] 📦 Loaded ${jobIds.length} job IDs from cache (IP: ${ip})`);
        
        // If cache is empty, try to trigger a fetch
        if (jobIds.length === 0) {
            console.warn(`[SERVER] ⚠️  Cache is empty! Attempting to fetch job IDs... (IP: ${ip})`);
            // Trigger async fetch but don't wait for it
            jobIdFetcher.fetchBulkJobIds()
                .then(result => {
                    jobIdFetcher.saveCache();
                    console.log(`[SERVER] ✅ Background fetch complete: ${result.total} job IDs cached`);
                })
                .catch(fetchError => {
                    console.error(`[SERVER] ❌ Background fetch failed:`, fetchError.message);
                });
            
            // Return empty array but with success: true so bot knows server is working
            return res.json({
                success: true,
                jobIds: [],
                count: 0,
                totalAvailable: 0,
                cacheInfo: jobIdFetcher.getCacheInfo(),
                message: 'Cache is empty, fetching in background. Please retry in a few seconds.'
            });
        }
        
        // Filter out excluded job IDs
        const excludeSet = new Set(exclude);
        jobIds = jobIds.filter(id => !excludeSet.has(id.toString()));
        
        console.log(`[API] After filtering: ${jobIds.length} job IDs available`);
        
        // If no job IDs available after filtering, return empty but successful response
        if (jobIds.length === 0) {
            console.warn('[API] No job IDs available after filtering excluded IDs');
            return res.json({
                success: true,
                jobIds: [],
                count: 0,
                totalAvailable: 0,
                cacheInfo: jobIdFetcher.getCacheInfo(),
                message: 'All job IDs were excluded or cache is empty'
            });
        }
        
        // Shuffle and limit
        const shuffled = jobIds.sort(() => Math.random() - 0.5);
        const result = shuffled.slice(0, limit);
        
        console.log(`[SERVER] ✅ Returning ${result.length} job IDs to bot (IP: ${ip})`);
        
        res.json({
            success: true,
            jobIds: result,
            count: result.length,
            totalAvailable: jobIds.length,
            cacheInfo: jobIdFetcher.getCacheInfo()
        });
    } catch (error) {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.error(`[SERVER] ❌ Error fetching job IDs (IP: ${ip}):`, error.message);
        console.error(`[SERVER] Stack trace:`, error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/job-ids/info', (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.json({ 
                success: true,
                count: 0,
                lastUpdated: null,
                placeId: 0,
                message: 'Job ID fetcher module not available'
            });
        }
        
        jobIdFetcher.loadCache();
        const cacheInfo = jobIdFetcher.getCacheInfo();
        res.json({
            success: true,
            ...cacheInfo
        });
    } catch (error) {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.error(`[SERVER] ❌ Error getting cache info (IP: ${ip}):`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/job-ids/refresh', authorize('ADMIN'), (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.json({ 
                success: false,
                message: 'Job ID fetcher module not available. Cannot refresh cache.'
            });
        }
        
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.log(`[SERVER] 🔄 Manual cache refresh requested by admin (IP: ${ip})`);
        jobIdFetcher.fetchBulkJobIds()
            .then(result => {
                jobIdFetcher.saveCache();
                console.log(`[SERVER] ✅ Cache refresh complete: ${result.total} job IDs cached`);
                res.json({
                    success: true,
                    message: 'Cache refreshed successfully',
                    ...result
                });
            })
            .catch(error => {
                console.error(`[SERVER] ❌ Error refreshing cache (IP: ${ip}):`, error.message);
                res.status(500).json({ success: false, error: error.message });
            });
    } catch (error) {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        console.error(`[SERVER] ❌ Error in ${req.path} (IP: ${ip}):`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'Pet Finder API Server',
        endpoints: {
            'POST /api/pet-found': 'Receive pet finds from bots',
            'GET /api/finds': 'Get all finds',
            'GET /api/finds/recent': 'Get recent finds',
            'DELETE /api/finds': 'Clear all finds',
            'GET /api/health': 'Health check',
            'GET /api/job-ids': 'Get cached job IDs for server hopping',
            'GET /api/job-ids/info': 'Get cache info',
            'POST /api/job-ids/refresh': 'Manually refresh job ID cache'
        }
    });
});

// Load job ID cache on startup (only if module loaded)
if (jobIdFetcher) {
    try {
        jobIdFetcher.loadCache();
        const cacheInfo = jobIdFetcher.getCacheInfo();
        console.log(`[JobIDs] Loaded ${cacheInfo.count} cached job IDs (last updated: ${cacheInfo.lastUpdated || 'never'})`);
        
        // If cache is empty or low, fetch immediately on startup
        if (cacheInfo.count < 1000) {
            console.log('[JobIDs] Cache is low, fetching job IDs immediately...');
            jobIdFetcher.fetchBulkJobIds()
                .then(result => {
                    jobIdFetcher.saveCache();
                    console.log(`[JobIDs] Initial fetch complete: ${result.total} total job IDs cached`);
                })
                .catch(error => {
                    console.error('[JobIDs] Initial fetch failed:', error.message);
                });
        }
        
        // Auto-refresh cache every 10 minutes to get fresh servers
        setInterval(() => {
            console.log('[JobIDs] Auto-refreshing job ID cache (every 10 minutes)...');
            jobIdFetcher.fetchBulkJobIds()
                .then(result => {
                    jobIdFetcher.saveCache();
                    console.log(`[JobIDs] Auto-refresh complete: ${result.total} total job IDs cached`);
                })
                .catch(error => {
                    console.error('[JobIDs] Auto-refresh failed:', error.message);
                });
        }, 10 * 60 * 1000); // 10 minutes - refresh more frequently for fresh servers
    } catch (error) {
        console.error('[JobIDs] Error initializing job ID cache:', error.message);
    }
} else {
    console.warn('[JobIDs] Job ID fetcher module not available - server hopping bypass disabled');
}

// Hourly cleanup to remove finds older than 1 hour (but keep last 10 minutes)
setInterval(() => {
    console.log('[Cleanup] Running hourly cleanup...');
    cleanupOldFinds();
}, 60 * 60 * 1000); // Every hour

// Run initial cleanup on startup
cleanupOldFinds();

// Error handler for uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[Fatal] Uncaught Exception:', error);
    console.error('[Fatal] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] 🚀 Pet Finder API Server running on port ${PORT}`);
    console.log(`[SERVER] 🔒 Security: Rate limiting enabled (5 req/10s)`);
    console.log(`[SERVER] 🔑 Security: API key authorization enabled`);
    console.log(`[SERVER] ✅ Security: Request validation enabled`);
    console.log(`[SERVER] 📝 All logging is server-side only (no client exposure)`);
    console.log(`[SERVER] 📋 Available endpoints:`);
    console.log(`[SERVER]   POST /api/pet-found - Receive pet finds (batched) [BOT KEY]`);
    console.log(`[SERVER]   GET  /api/finds - Get all finds [ADMIN KEY]`);
    console.log(`[SERVER]   GET  /api/finds/recent - Get recent finds [GUI KEY]`);
    console.log(`[SERVER]   GET  /api/finds/all - Get all finds (debug) [ADMIN KEY]`);
    console.log(`[SERVER]   DELETE /api/finds - Clear all finds [ADMIN KEY]`);
    console.log(`[SERVER]   GET  /api/health - Health check [PUBLIC]`);
    if (jobIdFetcher) {
        console.log(`[SERVER]   GET  /api/job-ids - Get cached job IDs [BOT KEY]`);
        console.log(`[SERVER]   GET  /api/job-ids/info - Get cache info [BOT KEY]`);
        console.log(`[SERVER]   POST /api/job-ids/refresh - Manually refresh cache [ADMIN KEY]`);
    } else {
        console.log(`[SERVER]   ⚠️  Job ID endpoints disabled (module not loaded)`);
    }
    console.log(`[SERVER] ✅ Server started successfully!`);
    console.log(`[SERVER] ⚠️  WARNING: Change default API keys in production!`);
});
