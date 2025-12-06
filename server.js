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

app.use(cors());
app.use(express.json());

let petFinds = [];
const MAX_FINDS = 1000;

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

app.post('/api/pet-found', rateLimit, (req, res) => {
    try {
        const body = req.body;
        const finds = body.finds || [body];
        
        if (!Array.isArray(finds) || finds.length === 0) {
            console.error('[API] Invalid request - no finds array');
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request. Expected "finds" array or single find object.' 
            });
        }
        
        const accountName = body.accountName || finds[0]?.accountName || "Unknown";
        let addedCount = 0;
        
        for (const findData of finds) {
            // Validate required fields
            if (!findData.petName) {
                console.warn('[API] Skipping find with missing petName:', findData);
                continue;
            }
            
            const find = {
                id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9),
                petName: findData.petName,
                generation: findData.generation || "N/A",
                mps: findData.mps || 0,
                rarity: findData.rarity || "Unknown",
                placeId: findData.placeId || 0,
                jobId: findData.jobId || "",
                playerCount: findData.playerCount || 0,
                maxPlayers: findData.maxPlayers || 6,
                accountName: findData.accountName || accountName,
                timestamp: findData.timestamp || Date.now(),
                receivedAt: new Date().toISOString()
            };
            
            petFinds.unshift(find);
            addedCount++;
        }
        
        if (petFinds.length > MAX_FINDS) {
            petFinds = petFinds.slice(0, MAX_FINDS);
        }
        
        console.log(`[API] Received batch of ${addedCount} pet finds from ${accountName}`);
        if (addedCount > 0) {
            console.log(`[API] Sample find - petName: ${petFinds[0].petName}, mps: ${petFinds[0].mps}, placeId: ${petFinds[0].placeId}, jobId: ${petFinds[0].jobId}`);
            console.log(`[API] Total finds in storage: ${petFinds.length}`);
        }
        
        res.status(200).json({ 
            success: true, 
            message: `Received ${addedCount} pet find(s)`,
            received: addedCount 
        });
    } catch (error) {
        console.error('[API] Error processing pet finds:', error);
        console.error('[API] Error stack:', error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const finds = petFinds.slice(0, limit);
        console.log(`[API] /api/finds requested - returning ${finds.length} finds (total: ${petFinds.length})`);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds/recent', rateLimit, (req, res) => {
    try {
        // Use receivedAt (when server received it) for filtering - more reliable
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        const recent = petFinds.filter(find => {
            if (find.receivedAt) {
                // receivedAt is ISO string - use this as it's set when server receives the data
                const findTime = new Date(find.receivedAt).getTime();
                return findTime > tenMinutesAgo;
            }
            // Fallback to timestamp if receivedAt is missing
            if (find.timestamp) {
                const ts = typeof find.timestamp === 'number' ? find.timestamp : parseInt(find.timestamp);
                const findTime = ts < 10000000000 ? ts * 1000 : ts;
                return findTime > tenMinutesAgo;
            }
            // If no timestamp at all, include it (shouldn't happen)
            return true;
        });
        
        console.log(`[API] /api/finds/recent - Total finds: ${petFinds.length}, Recent (last 10min): ${recent.length}`);
        if (recent.length > 0) {
            console.log(`[API] First find - petName: ${recent[0].petName}, mps: ${recent[0].mps}, placeId: ${recent[0].placeId}, jobId: ${recent[0].jobId}`);
        } else if (petFinds.length > 0) {
            const oldestFind = petFinds[petFinds.length - 1];
            let oldestTime = Date.now();
            if (oldestFind.receivedAt) {
                oldestTime = new Date(oldestFind.receivedAt).getTime();
            } else if (oldestFind.timestamp) {
                const ts = typeof oldestFind.timestamp === 'number' ? oldestFind.timestamp : parseInt(oldestFind.timestamp);
                oldestTime = ts < 10000000000 ? ts * 1000 : ts;
            }
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

app.delete('/api/finds', (req, res) => {
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
app.get('/api/finds/all', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const finds = petFinds.slice(0, limit);
        console.log(`[API] /api/finds/all - returning ${finds.length} finds (total: ${petFinds.length})`);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Job ID endpoints for server hopping
app.get('/api/job-ids', (req, res) => {
    try {
        if (!jobIdFetcher) {
            console.warn('[API] /api/job-ids requested but jobIdFetcher module not available');
            return res.status(503).json({ 
                success: false, 
                error: 'Job ID fetcher module not available' 
            });
        }
        
        const limit = parseInt(req.query.limit) || 100;
        const exclude = req.query.exclude ? req.query.exclude.split(',') : [];
        
        console.log(`[API] /api/job-ids requested - limit: ${limit}, exclude: ${exclude.length} IDs`);
        
        // Load cache
        jobIdFetcher.loadCache();
        let jobIds = jobIdFetcher.getJobIds();
        
        console.log(`[API] Loaded ${jobIds.length} job IDs from cache`);
        
        // Filter out excluded job IDs
        const excludeSet = new Set(exclude);
        jobIds = jobIds.filter(id => !excludeSet.has(id.toString()));
        
        console.log(`[API] After filtering: ${jobIds.length} job IDs available`);
        
        // Shuffle and limit
        const shuffled = jobIds.sort(() => Math.random() - 0.5);
        const result = shuffled.slice(0, limit);
        
        console.log(`[API] Returning ${result.length} job IDs to client`);
        
        res.json({
            success: true,
            jobIds: result,
            count: result.length,
            totalAvailable: jobIds.length,
            cacheInfo: jobIdFetcher.getCacheInfo()
        });
    } catch (error) {
        console.error('[API] Error fetching job IDs:', error);
        console.error('[API] Error stack:', error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/job-ids/info', (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.status(503).json({ 
                success: false, 
                error: 'Job ID fetcher module not available' 
            });
        }
        
        jobIdFetcher.loadCache();
        const cacheInfo = jobIdFetcher.getCacheInfo();
        res.json({
            success: true,
            ...cacheInfo
        });
    } catch (error) {
        console.error('[API] Error getting cache info:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/job-ids/refresh', (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.status(503).json({ 
                success: false, 
                error: 'Job ID fetcher module not available' 
            });
        }
        
        console.log('[API] Manual cache refresh requested');
        jobIdFetcher.fetchBulkJobIds()
            .then(result => {
                jobIdFetcher.saveCache();
                res.json({
                    success: true,
                    message: 'Cache refreshed successfully',
                    ...result
                });
            })
            .catch(error => {
                console.error('[API] Error refreshing cache:', error);
                res.status(500).json({ success: false, error: error.message });
            });
    } catch (error) {
        console.error('[API] Error:', error);
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

// Error handler for uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[Fatal] Uncaught Exception:', error);
    console.error('[Fatal] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Pet Finder API Server running on port ${PORT}`);
    console.log(`[API] Security: Rate limiting enabled (5 req/10s)`);
    console.log(`[API] Endpoints:`);
    console.log(`[API]   POST /api/pet-found - Receive pet finds (batched)`);
    console.log(`[API]   GET  /api/finds - Get all finds`);
    console.log(`[API]   GET  /api/finds/recent - Get recent finds (public)`);
    console.log(`[API]   GET  /api/finds/all - Get all finds (debug, no time filter)`);
    console.log(`[API]   DELETE /api/finds - Clear all finds`);
    console.log(`[API]   GET  /api/health - Health check`);
    if (jobIdFetcher) {
        console.log(`[API]   GET  /api/job-ids - Get cached job IDs (limit query param)`);
        console.log(`[API]   GET  /api/job-ids/info - Get cache info`);
        console.log(`[API]   POST /api/job-ids/refresh - Manually refresh cache`);
    } else {
        console.log(`[API]   Job ID endpoints disabled (module not loaded)`);
    }
    console.log(`[API] Server started successfully!`);
});
