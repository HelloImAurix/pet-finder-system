const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

let jobIdFetcher = null;
const jobIdFetcherPath = path.join(__dirname, 'jobIdFetcher.js');
if (fs.existsSync(jobIdFetcherPath)) {
    try {
        jobIdFetcher = require('./jobIdFetcher');
    } catch (error) {
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEYS = {
    BOT: process.env.BOT_API_KEY || 'sablujihub-bot',
    GUI: process.env.GUI_API_KEY || 'sablujihub-gui',
    ADMIN: process.env.ADMIN_API_KEY || 'sablujihub-admin'
};

const requestLogs = new Map();

function logRequest(ip, endpoint, method) {
    console.log(`[Request] ${method} ${endpoint} from ${ip}`);
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
        const apiKey = req.headers['x-api-key'] 
            || req.headers['authorization']?.replace('Bearer ', '') 
            || req.query.key;
        
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
        
        if (!apiKey) {
            logRequest(ip, req.path, req.method);
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized. API key required.' 
            });
        }
        
        if (!API_KEYS[requiredKey] || apiKey !== API_KEYS[requiredKey]) {
            logRequest(ip, req.path, req.method);
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
const STORAGE_DURATION_HOURS = 1;
const ALWAYS_SHOW_MINUTES = 10;
function getFindTimestamp(find) {
    if (find.receivedAt) {
        return new Date(find.receivedAt).getTime();
    }
    if (find.timestamp) {
        const ts = typeof find.timestamp === 'number' ? find.timestamp : parseInt(find.timestamp);
        return ts < 10000000000 ? ts * 1000 : ts;
    }
    return Date.now();
}
function cleanupOldFinds() {
    const now = Date.now();
    const oneHourAgo = now - (STORAGE_DURATION_HOURS * 60 * 60 * 1000);
    
    const beforeCleanup = petFinds.length;
    
    petFinds = petFinds.filter(find => {
        const findTime = getFindTimestamp(find);
        return findTime > oneHourAgo;
    });
    
    const afterCleanup = petFinds.length;
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
            // Allow full servers; only skip if clearly invalid (negative or absurd)
            if (playerCount < 0 || playerCount > 50) {
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
        
        cleanupOldFinds();
        
        if (petFinds.length > MAX_FINDS) {
            petFinds = petFinds.slice(0, MAX_FINDS);
        }
        
        if (addedCount > 0) {
            console.log(`[Pets] ${addedCount} pet(s) sent from ${accountName}`);
        }
        
        res.status(200).json({ 
            success: true, 
            message: `Received ${addedCount} pet find(s)`,
            received: addedCount 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds', authorize('ADMIN'), (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 500);
        const finds = petFinds.slice(0, limit);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds/recent', authorize('GUI'), rateLimit, (req, res) => {
    try {
        const now = Date.now();
        const oneHourAgo = now - (STORAGE_DURATION_HOURS * 60 * 60 * 1000);
        const tenMinutesAgo = now - (ALWAYS_SHOW_MINUTES * 60 * 1000);
        const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
        
        const hourFinds = petFinds.filter(find => {
            const findTime = getFindTimestamp(find);
            return findTime > oneHourAgo;
        });
        
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
        
        last10Minutes.sort((a, b) => getFindTimestamp(b) - getFindTimestamp(a));
        olderButWithinHour.sort((a, b) => getFindTimestamp(b) - getFindTimestamp(a));
        
        const combined = [...last10Minutes, ...olderButWithinHour].slice(0, limit);
        
        res.json({ 
            success: true, 
            finds: combined, 
            total: combined.length,
            last10Minutes: last10Minutes.length,
            lastHour: hourFinds.length
        });
    } catch (error) {
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

app.get('/api/finds/all', authorize('ADMIN'), (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
        const finds = petFinds.slice(0, limit);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


app.get('/api/job-ids', authorize('BOT'), (req, res) => {
    try {
        if (!jobIdFetcher) {
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
        
        const limit = parseInt(req.query.limit) || 1000;
        const exclude = req.query.exclude ? req.query.exclude.split(',') : [];
        
        try {
            jobIdFetcher.loadCache();
        } catch (cacheError) {
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to load job ID cache',
                details: cacheError.message
            });
        }
        
        let jobIds = [];
        try {
            // Use freshest servers if available, otherwise fall back to regular getJobIds
            if (typeof jobIdFetcher.getFreshestJobIds === 'function') {
                jobIds = jobIdFetcher.getFreshestJobIds(limit * 2); // Get more to filter
            } else {
                jobIds = jobIdFetcher.getJobIds();
            }
            if (!Array.isArray(jobIds)) {
                jobIds = [];
            }
        } catch (getError) {
            jobIds = [];
        }
        
        if (jobIds.length === 0) {
            console.log('[Servers] Cache is empty, triggering immediate fetch...');
            jobIdFetcher.fetchBulkJobIds()
                .then(result => {
                    jobIdFetcher.saveCache();
                    console.log(`[Servers] ✅ Fetched ${result.total} servers in background`);
                    console.log(`[Servers] Added: ${result.added}, Filtered: ${result.filtered}, Scanned: ${result.scanned}`);
                })
                .catch(fetchError => {
                    console.error('[Servers] ❌ Background fetch error:', fetchError.message);
                    console.error('[Servers] Stack:', fetchError.stack);
                });
            
            return res.json({
                success: true,
                jobIds: [],
                count: 0,
                totalAvailable: 0,
                cacheInfo: jobIdFetcher.getCacheInfo(),
                message: 'Cache is empty, fetching in background. Please retry in a few seconds.'
            });
        }
        
        const excludeSet = new Set(exclude);
        jobIds = jobIds.filter(id => !excludeSet.has(id.toString()));
        
        if (jobIds.length === 0) {
            return res.json({
                success: true,
                jobIds: [],
                count: 0,
                totalAvailable: 0,
                cacheInfo: jobIdFetcher.getCacheInfo(),
                message: 'All job IDs were excluded or cache is empty'
            });
        }
        
        const shuffled = jobIds.sort(() => Math.random() - 0.5);
        const result = shuffled.slice(0, limit);
        
        res.json({
            success: true,
            jobIds: result,
            count: result.length,
            totalAvailable: jobIds.length,
            cacheInfo: jobIdFetcher.getCacheInfo(),
            message: `Returned ${result.length} of ${jobIds.length} available fresh servers`
        });
    } catch (error) {
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
        
        jobIdFetcher.fetchBulkJobIds()
            .then(result => {
                jobIdFetcher.saveCache();
                console.log(`[Servers] Fetched ${result.total} servers`);
                res.json({
                    success: true,
                    message: 'Cache refreshed successfully',
                    ...result
                });
            })
            .catch(error => {
                res.status(500).json({ success: false, error: error.message });
            });
    } catch (error) {
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

if (jobIdFetcher) {
    try {
        console.log('[Servers] Loading cache...');
        jobIdFetcher.loadCache();
        const cacheInfo = jobIdFetcher.getCacheInfo();
        console.log(`[Servers] Cache loaded: ${cacheInfo.count} servers`);
        
        // Always fetch on startup if cache is empty or low
        if (cacheInfo.count < 1000) {
            console.log(`[Servers] Cache has ${cacheInfo.count} servers, fetching fresh servers...`);
            // Use async IIFE to wait for initial fetch
            (async () => {
                try {
                    const result = await jobIdFetcher.fetchBulkJobIds();
                    jobIdFetcher.saveCache();
                    console.log(`[Servers] ✅ Fetched ${result.total} servers successfully`);
                    console.log(`[Servers] Added: ${result.added}, Filtered: ${result.filtered}, Scanned: ${result.scanned}`);
                } catch (error) {
                    console.error('[Servers] ❌ Initial fetch error:', error.message);
                    console.error('[Servers] Stack:', error.stack);
                    // Retry after 10 seconds
                    setTimeout(async () => {
                        try {
                            console.log('[Servers] Retrying fetch after error...');
                            const result = await jobIdFetcher.fetchBulkJobIds();
                            jobIdFetcher.saveCache();
                            console.log(`[Servers] ✅ Retry successful: ${result.total} servers`);
                        } catch (retryError) {
                            console.error('[Servers] ❌ Retry failed:', retryError.message);
                        }
                    }, 10000);
                }
            })();
        } else {
            console.log(`[Servers] Cache has ${cacheInfo.count} servers, skipping initial fetch`);
        }
        
        // Auto-refresh every 5 minutes
        setInterval(() => {
            console.log('[Servers] Auto-refreshing cache...');
            jobIdFetcher.fetchBulkJobIds()
                .then(result => {
                    jobIdFetcher.saveCache();
                    console.log(`[Servers] ✅ Refreshed ${result.total} fresh servers`);
                    console.log(`[Servers] Added: ${result.added}, Filtered: ${result.filtered}, Scanned: ${result.scanned}`);
                })
                .catch(error => {
                    console.error('[Servers] ❌ Auto-refresh error:', error.message);
                    console.error('[Servers] Stack:', error.stack);
                });
        }, 5 * 60 * 1000);
    } catch (error) {
        console.error('[Servers] ❌ Initialization error:', error.message);
        console.error('[Servers] Stack:', error.stack);
    }
} else {
    console.warn('[Servers] ⚠️ jobIdFetcher module not available');
}

setInterval(() => {
    cleanupOldFinds();
}, 60 * 60 * 1000);

cleanupOldFinds();

app.listen(PORT, '0.0.0.0', () => {
});
