const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

let jobIdFetcher = null;
let isFetching = false; // Track if a fetch is in progress
const jobIdFetcherPath = path.join(__dirname, 'jobIdFetcher.js');
if (fs.existsSync(jobIdFetcherPath)) {
    try {
        jobIdFetcher = require('./jobIdFetcher');
        console.log('[Servers] Job ID fetcher module loaded successfully');
    } catch (error) {
        console.error('[Servers] Failed to load job ID fetcher module:', error.message);
        console.error('[Servers] Server will continue but job ID caching will be disabled');
    }
} else {
    console.warn('[Servers] Job ID fetcher file not found at:', jobIdFetcherPath);
    console.warn('[Servers] Server will continue but job ID caching will be disabled');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Add request timeout middleware to prevent Railway timeouts
app.use((req, res, next) => {
    // Set a timeout for all requests (25 seconds - Railway has 30s timeout)
    req.setTimeout(25000, () => {
        if (!res.headersSent) {
            res.status(504).json({
                success: false,
                error: 'Request timeout',
                message: 'The request took too long to process'
            });
        }
    });
    
    // Ensure response is sent quickly - don't let long operations block
    const originalEnd = res.end;
    res.end = function(...args) {
        // Clear timeout when response is sent
        if (req.setTimeout) {
            req.setTimeout(0);
        }
        return originalEnd.apply(this, args);
    };
    
    next();
});

// Health check endpoint (no auth required, responds immediately)
// This should be super fast - no async operations
app.get('/health', (req, res) => {
    // Respond immediately without any async operations
    console.log('[Health] Health check requested from:', req.ip || 'unknown');
    const cacheInfo = jobIdFetcher ? (() => {
        try {
            return jobIdFetcher.getCacheInfo();
        } catch (e) {
            return { count: 0, lastUpdated: null, placeId: 0 };
        }
    })() : { count: 0, lastUpdated: null, placeId: 0 };
    
    res.json({ 
        status: 'ok',
        timestamp: Date.now(),
        isFetching: isFetching,
        cacheCount: cacheInfo.count || 0
    });
});

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

// Enhanced storage: Indexed by MPS and timestamp for fast queries
let petFinds = [];
const MAX_FINDS = 1000;
const STORAGE_DURATION_HOURS = 1;
const ALWAYS_SHOW_MINUTES = 10;

// Indexes for fast queries
const findIndexes = {
    byMPS: [], // Sorted by MPS descending
    byTimestamp: [], // Sorted by timestamp descending
    byJobId: new Map(), // Map of jobId -> finds[]
    byPlaceId: new Map() // Map of placeId -> finds[]
};

function addToIndexes(find) {
    // Add to MPS index (maintain sorted order)
    const mps = find.mps || 0;
    let inserted = false;
    for (let i = 0; i < findIndexes.byMPS.length; i++) {
        if (mps > (findIndexes.byMPS[i].mps || 0)) {
            findIndexes.byMPS.splice(i, 0, find);
            inserted = true;
            break;
        }
    }
    if (!inserted) {
        findIndexes.byMPS.push(find);
    }
    
    // Add to timestamp index (newest first)
    findIndexes.byTimestamp.unshift(find);
    
    // Add to jobId index
    const jobId = find.jobId || '';
    if (!findIndexes.byJobId.has(jobId)) {
        findIndexes.byJobId.set(jobId, []);
    }
    findIndexes.byJobId.get(jobId).push(find);
    
    // Add to placeId index
    const placeId = find.placeId || 0;
    if (!findIndexes.byPlaceId.has(placeId)) {
        findIndexes.byPlaceId.set(placeId, []);
    }
    findIndexes.byPlaceId.get(placeId).push(find);
}

function removeFromIndexes(find) {
    // Remove from MPS index
    const mpsIndex = findIndexes.byMPS.indexOf(find);
    if (mpsIndex > -1) {
        findIndexes.byMPS.splice(mpsIndex, 1);
    }
    
    // Remove from timestamp index
    const tsIndex = findIndexes.byTimestamp.indexOf(find);
    if (tsIndex > -1) {
        findIndexes.byTimestamp.splice(tsIndex, 1);
    }
    
    // Remove from jobId index
    const jobId = find.jobId || '';
    if (findIndexes.byJobId.has(jobId)) {
        const jobFinds = findIndexes.byJobId.get(jobId);
        const index = jobFinds.indexOf(find);
        if (index > -1) {
            jobFinds.splice(index, 1);
            if (jobFinds.length === 0) {
                findIndexes.byJobId.delete(jobId);
            }
        }
    }
    
    // Remove from placeId index
    const placeId = find.placeId || 0;
    if (findIndexes.byPlaceId.has(placeId)) {
        const placeFinds = findIndexes.byPlaceId.get(placeId);
        const index = placeFinds.indexOf(find);
        if (index > -1) {
            placeFinds.splice(index, 1);
            if (placeFinds.length === 0) {
                findIndexes.byPlaceId.delete(placeId);
            }
        }
    }
}
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
    const toRemove = [];
    
    // Find old finds
    for (const find of petFinds) {
        const findTime = getFindTimestamp(find);
        if (findTime <= oneHourAgo) {
            toRemove.push(find);
        }
    }
    
    // Remove from main array and indexes
    for (const find of toRemove) {
        const index = petFinds.indexOf(find);
        if (index > -1) {
            petFinds.splice(index, 1);
        }
        removeFromIndexes(find);
    }
    
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
        let duplicateCount = 0;
        
        // Deduplication: Track unique finds by petName + placeId + jobId + uniqueId
        const findKeys = new Set();
        
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
            const uniqueId = findData.uniqueId ? String(findData.uniqueId) : "";
            const findKey = `${String(findData.petName).trim()}_${findData.placeId || 0}_${findData.jobId || ""}_${uniqueId}`;
            
            // Check for duplicates (within last 5 minutes)
            const now = Date.now();
            const fiveMinutesAgo = now - (5 * 60 * 1000);
            let isDuplicate = false;
            
            if (findKeys.has(findKey)) {
                isDuplicate = true;
            } else {
                // Check existing finds for duplicates
                for (const existingFind of petFinds) {
                    const existingTime = getFindTimestamp(existingFind);
                    if (existingTime > fiveMinutesAgo) {
                        const existingKey = `${existingFind.petName}_${existingFind.placeId}_${existingFind.jobId}_${existingFind.uniqueId || ""}`;
                        if (existingKey === findKey) {
                            isDuplicate = true;
                            break;
                        }
                    }
                }
            }
            
            if (isDuplicate) {
                duplicateCount++;
                continue;
            }
            
            findKeys.add(findKey);
            
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
                receivedAt: new Date().toISOString(),
                uniqueId: uniqueId
            };
            
            petFinds.unshift(find);
            addToIndexes(find); // Add to indexes for fast queries
            addedCount++;
        }
        
        cleanupOldFinds();
        
        // Maintain MAX_FINDS limit, remove oldest from indexes too
        if (petFinds.length > MAX_FINDS) {
            const toRemove = petFinds.slice(MAX_FINDS);
            petFinds = petFinds.slice(0, MAX_FINDS);
            for (const find of toRemove) {
                removeFromIndexes(find);
            }
        }
        
        if (addedCount > 0) {
            console.log(`[Pets] ${addedCount} pet(s) sent from ${accountName}${duplicateCount > 0 ? ` (${duplicateCount} duplicates skipped)` : ''}`);
        }
        
        res.status(200).json({ 
            success: true, 
            message: `Received ${addedCount} pet find(s)`,
            received: addedCount,
            skipped: skippedCount,
            invalid: invalidCount,
            duplicates: duplicateCount
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
        const since = req.query.since ? parseInt(req.query.since) : null; // For incremental updates
        
        // Use indexed timestamp array for faster filtering (already sorted newest first)
        let hourFinds = findIndexes.byTimestamp.filter(find => {
            const findTime = getFindTimestamp(find);
            return findTime > oneHourAgo && (!since || findTime > since);
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
        
        // Already sorted by timestamp (newest first) from index, no need to sort again
        const combined = [...last10Minutes, ...olderButWithinHour].slice(0, limit);
        
        res.json({ 
            success: true, 
            finds: combined, 
            total: combined.length,
            last10Minutes: last10Minutes.length,
            lastHour: hourFinds.length,
            timestamp: now // Return current timestamp for incremental updates
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
    // CRITICAL: This endpoint must respond quickly - never block
    // Use try-catch to ensure we always send a response
    
    console.log('[API] /api/job-ids requested - limit:', req.query.limit, 'exclude:', req.query.exclude ? 'yes' : 'no');
    
    try {
        // CRITICAL: Respond immediately - never block on fetching
        // Always return cached data if available, fetch in background if needed
        
        if (!jobIdFetcher) {
            console.log('[API] /api/job-ids - jobIdFetcher not available');
            return res.json({ 
                success: true,
                jobIds: [],
                servers: [],
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
        
        // Load cache synchronously (fast operation) - wrap in try-catch
        let cacheInfo;
        try {
            jobIdFetcher.loadCache();
            cacheInfo = jobIdFetcher.getCacheInfo();
        } catch (cacheError) {
            console.error('[Servers] Cache load error:', cacheError.message);
            // Return safe defaults if cache load fails
            cacheInfo = { count: 0, lastUpdated: null, placeId: 0 };
        }
        
        const hasServers = cacheInfo && cacheInfo.count > 0;
        
        console.log('[API] /api/job-ids - Cache info:', JSON.stringify(cacheInfo));
        
        // Get servers with full metadata if available (expired servers are automatically filtered)
        let serversWithMetadata = [];
        try {
            if (typeof jobIdFetcher.getFreshestServers === 'function') {
                serversWithMetadata = jobIdFetcher.getFreshestServers(limit * 2);
                console.log('[API] /api/job-ids - Got', serversWithMetadata.length, 'servers from getFreshestServers');
            } else if (typeof jobIdFetcher.getFreshestJobIds === 'function') {
                // Fallback: Get job IDs (expired ones are filtered automatically)
                const jobIds = jobIdFetcher.getFreshestJobIds(limit * 2);
                const now = Date.now();
                serversWithMetadata = jobIds.map((id, index) => ({
                    id: id.toString(),
                    players: 0,
                    maxPlayers: 8,
                    timestamp: now - (index * 1000) // Approximate timestamp
                }));
            } else {
                const jobIds = jobIdFetcher.getJobIds();
                const now = Date.now();
                serversWithMetadata = jobIds.map((id, index) => ({
                    id: id.toString(),
                    players: 0,
                    maxPlayers: 8,
                    timestamp: now - (index * 1000) // Approximate timestamp
                }));
            }
        } catch (getError) {
            console.error('[Servers] Error getting servers:', getError.message);
            serversWithMetadata = [];
        }
        
        // Filter out excluded servers
        const excludeSet = new Set(exclude);
        serversWithMetadata = serversWithMetadata.filter(server => !excludeSet.has(server.id));
        
        // If we have servers, return them immediately (even if cache is being refreshed)
        if (serversWithMetadata.length > 0) {
            const totalAvailable = serversWithMetadata.length;
            const limited = serversWithMetadata.slice(0, limit);
            const jobIdsOnly = limited.map(s => s.id);
            
            console.log('[API] /api/job-ids - Returning', limited.length, 'servers (total available:', totalAvailable, ')');
            
            // Trigger background refresh if cache is low or stale, but don't wait for it
            // Use setImmediate to ensure response is sent first
            if (!isFetching && (cacheInfo.count < 100 || (cacheInfo.lastUpdated && (Date.now() - new Date(cacheInfo.lastUpdated).getTime()) > 300000))) {
                console.log('[API] /api/job-ids - Triggering background refresh');
                // Defer fetch to next tick so response can be sent first
                setImmediate(() => {
                    if (isFetching) return; // Double-check
                    isFetching = true;
                    console.log('[Servers] Cache is low/stale, triggering background refresh...');
                    // Fire and forget - don't block response
                    jobIdFetcher.fetchBulkJobIds()
                        .then(result => {
                            jobIdFetcher.saveCache();
                            console.log(`[Servers] ✅ Background refresh: ${result.total} servers`);
                            isFetching = false;
                        })
                        .catch(fetchError => {
                            console.error('[Servers] ❌ Background refresh error:', fetchError.message);
                            isFetching = false;
                        });
                });
            }
            
            return res.json({
                success: true,
                jobIds: jobIdsOnly, // Backward compatible: flat array
                servers: limited, // Enhanced: Full objects with metadata
                count: limited.length,
                totalAvailable: totalAvailable,
                cacheInfo: cacheInfo,
                hasMetadata: limited.length > 0 && (limited[0].players !== undefined || limited[0].timestamp !== undefined)
            });
        }
        
        // No servers available - trigger background fetch if not already fetching
        if (!hasServers && !isFetching) {
            console.log('[API] /api/job-ids - No servers in cache, triggering background fetch');
            // Defer fetch to next tick so response can be sent first
            setImmediate(() => {
                if (isFetching) return; // Double-check
                isFetching = true;
                console.log('[Servers] Cache is empty, triggering immediate background fetch...');
                // Fire and forget - respond immediately
                jobIdFetcher.fetchBulkJobIds()
                    .then(result => {
                        jobIdFetcher.saveCache();
                        console.log(`[Servers] ✅ Fetched ${result.total} servers in background`);
                        isFetching = false;
                    })
                    .catch(fetchError => {
                        console.error('[Servers] ❌ Background fetch error:', fetchError.message);
                        isFetching = false;
                    });
            });
        }
        
        // Return empty response immediately (don't wait for fetch)
        console.log('[API] /api/job-ids - Returning empty response (isFetching:', isFetching, ')');
        return res.json({
            success: true,
            jobIds: [],
            servers: [],
            count: 0,
            totalAvailable: 0,
            cacheInfo: cacheInfo,
            message: isFetching ? 'Cache is being fetched in background. Please retry in a few seconds.' : 'Cache is empty, fetching in background. Please retry in a few seconds.',
            isFetching: isFetching
        });
    } catch (error) {
        console.error('[Servers] Error in /api/job-ids:', error);
        console.error('[Servers] Stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            message: 'Internal server error while fetching job IDs'
        });
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
            // Use async IIFE to wait for initial fetch (but don't block server startup)
            (async () => {
                if (isFetching) {
                    console.log('[Servers] Fetch already in progress, skipping startup fetch');
                    return;
                }
                isFetching = true;
                try {
                    const result = await jobIdFetcher.fetchBulkJobIds();
                    jobIdFetcher.saveCache();
                    console.log(`[Servers] ✅ Fetched ${result.total} servers successfully`);
                    console.log(`[Servers] Added: ${result.added}, Filtered: ${result.filtered}, Scanned: ${result.scanned}`);
                    isFetching = false;
                } catch (error) {
                    console.error('[Servers] ❌ Initial fetch error:', error.message);
                    console.error('[Servers] Stack:', error.stack);
                    isFetching = false;
                    // Retry after 10 seconds
                    setTimeout(async () => {
                        if (isFetching) return;
                        isFetching = true;
                        try {
                            console.log('[Servers] Retrying fetch after error...');
                            const result = await jobIdFetcher.fetchBulkJobIds();
                            jobIdFetcher.saveCache();
                            console.log(`[Servers] ✅ Retry successful: ${result.total} servers`);
                            isFetching = false;
                        } catch (retryError) {
                            console.error('[Servers] ❌ Retry failed:', retryError.message);
                            isFetching = false;
                        }
                    }, 10000);
                }
            })();
        } else {
            console.log(`[Servers] Cache has ${cacheInfo.count} servers, skipping initial fetch`);
        }
        
        // Auto-refresh every 5 minutes (use setImmediate to avoid blocking)
        setInterval(() => {
            if (isFetching) {
                console.log('[Servers] Skipping auto-refresh - fetch already in progress');
                return;
            }
            // Defer to next tick to avoid blocking
            setImmediate(() => {
                if (isFetching) return; // Double-check
                isFetching = true;
                console.log('[Servers] Auto-refreshing cache...');
                jobIdFetcher.fetchBulkJobIds()
                    .then(result => {
                        jobIdFetcher.saveCache();
                        console.log(`[Servers] ✅ Refreshed ${result.total} fresh servers`);
                        console.log(`[Servers] Added: ${result.added}, Filtered: ${result.filtered}, Scanned: ${result.scanned}`);
                        isFetching = false;
                    })
                    .catch(error => {
                        console.error('[Servers] ❌ Auto-refresh error:', error.message);
                        console.error('[Servers] Stack:', error.stack);
                        isFetching = false;
                    });
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

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('[Server] ❌ Uncaught Exception:', error);
    console.error('[Server] Stack:', error.stack);
    // Don't exit - let the server try to continue
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] ❌ Unhandled Rejection at:', promise);
    console.error('[Server] Reason:', reason);
    // Don't exit - let the server try to continue
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log(`[Server] ✅ Pet Finder API Server running on port ${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
    console.log(`[Server] Job IDs endpoint: http://localhost:${PORT}/api/job-ids`);
    if (jobIdFetcher) {
        console.log(`[Server] Job ID caching: ENABLED`);
        try {
            jobIdFetcher.loadCache();
            const cacheInfo = jobIdFetcher.getCacheInfo();
            console.log(`[Server] Cache status: ${cacheInfo.count} servers cached`);
        } catch (e) {
            console.log(`[Server] Cache status: Error loading cache - ${e.message}`);
        }
    } else {
        console.log(`[Server] Job ID caching: DISABLED (module not available)`);
    }
    console.log('='.repeat(60));
});
