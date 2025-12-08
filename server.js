const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

console.log('[Startup] Server starting...');

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
const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_SERVICE_NAME;
const PORT = isRailway ? 3000 : (parseInt(process.env.PORT) || 3000);

console.log('[Startup] Port:', PORT, '| Railway:', isRailway);

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

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Root endpoint - respond quickly for Railway health checks
app.get('/', (req, res) => {
    res.json({ 
        message: 'Pet Finder API Server',
        status: 'running',
        endpoints: {
            'GET /health': 'Health check',
            'POST /api/pet-found': 'Receive pet finds from bots',
            'GET /api/job-ids': 'Get cached job IDs for server hopping',
            'GET /api/job-ids/info': 'Get cache info'
        }
    });
});

const API_KEYS = {
    BOT: process.env.BOT_API_KEY || 'sablujihub-bot',
    GUI: process.env.GUI_API_KEY || 'sablujihub-gui',
    ADMIN: process.env.ADMIN_API_KEY || 'sablujihub-admin'
};

// Server status check cache - stores recent checks to avoid too many API calls
const serverStatusCache = new Map();
const SERVER_CHECK_CACHE_MS = 30 * 1000; // Cache check results for 30 seconds (reduced for freshness)
const PLACE_ID = parseInt(process.env.PLACE_ID, 10) || 109983668079237;

// Blacklist for used servers - prevents sending same servers
const serverBlacklist = new Map(); // Map of jobId -> timestamp
const BLACKLIST_DURATION_MS = 5 * 60 * 1000; // Blacklist for 5 minutes

// Function to make HTTP request (similar to jobIdFetcher)
function makeHttpRequest(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON: ${error.message}`));
                    }
                } else if (res.statusCode === 429) {
                    reject(new Error(`HTTP 429: Rate limited`));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });
        
        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout after 10 seconds'));
        });
        
        request.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });
    });
}

// Check if a specific server is still available (not full)
async function checkServerStatus(jobId, placeId = PLACE_ID) {
    const cacheKey = `${jobId}_${placeId}`;
    const now = Date.now();
    
    // Check cache first
    const cached = serverStatusCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < SERVER_CHECK_CACHE_MS) {
        return cached.status; // Return cached result
    }
    
    try {
        // Fetch servers and search for the specific jobId
        // We'll search through multiple pages if needed, but limit to avoid rate limits
        let cursor = null;
        let pagesChecked = 0;
        const maxPages = 3; // Limit to 3 pages to avoid rate limits
        
        while (pagesChecked < maxPages) {
            let url = `https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=Desc&limit=100&excludeFullGames=true`;
            if (cursor) {
                url += `&cursor=${cursor}`;
            }
            
            const data = await makeHttpRequest(url);
            
            if (!data || !data.data || data.data.length === 0) {
                break; // No more data
            }
            
            // Search for the specific server
            for (const server of data.data) {
                if (String(server.id) === String(jobId)) {
                    const players = server.playing || 0;
                    const maxPlayers = server.maxPlayers || 8;
                    const isFull = players >= maxPlayers;
                    
                    // Cache the result
                    const status = {
                        available: !isFull && players < maxPlayers,
                        players: players,
                        maxPlayers: maxPlayers,
                        timestamp: now
                    };
                    serverStatusCache.set(cacheKey, status);
                    
                    // Clean up old cache entries
                    if (serverStatusCache.size > 1000) {
                        for (const [key, value] of serverStatusCache.entries()) {
                            if (now - value.timestamp > SERVER_CHECK_CACHE_MS * 2) {
                                serverStatusCache.delete(key);
                            }
                        }
                    }
                    
                    return status;
                }
            }
            
            cursor = data.nextPageCursor;
            if (!cursor) {
                break; // No more pages
            }
            
            pagesChecked++;
            
            // No delay for speed - rely on rate limit handling
        }
        
        // Server not found in API response - might be full or closed
        // Cache as unavailable to avoid repeated checks
        const status = {
            available: false,
            players: 0,
            maxPlayers: 8,
            timestamp: now,
            notFound: true
        };
        serverStatusCache.set(cacheKey, status);
        return status;
        
    } catch (error) {
        console.warn(`[ServerCheck] Error checking server ${jobId}:`, error.message);
        // On error, return null to indicate check failed (don't cache errors)
        return null;
    }
}

// Batch check multiple servers (optimized for speed with parallel checks)
async function checkServerStatusBatch(servers, maxChecks = 15) {
    const toCheck = [];
    const now = Date.now();
    
    // Filter servers that should be checked - prioritize top servers
    for (const server of servers) {
        if (toCheck.length >= maxChecks) break;
        
        // Skip blacklisted servers
        if (serverBlacklist.has(server.id)) {
            const blacklistTime = serverBlacklist.get(server.id);
            if (now - blacklistTime < BLACKLIST_DURATION_MS) {
                continue; // Still blacklisted
            } else {
                serverBlacklist.delete(server.id); // Expired, remove from blacklist
            }
        }
        
        // Check all top servers for freshness and availability
        toCheck.push(server);
    }
    
    // Check servers in parallel batches for speed (3 at a time)
    const results = [];
    const batchSize = 3;
    
    for (let i = 0; i < toCheck.length; i += batchSize) {
        const batch = toCheck.slice(i, i + batchSize);
        const batchPromises = batch.map(server =>
            checkServerStatus(server.id, PLACE_ID)
                .then(status => ({ server, status }))
                .catch(error => ({ server, status: null, error: error.message }))
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Minimal delay between batches
        if (i + batchSize < toCheck.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    return results;
}

// Mark server as used (blacklist it)
function blacklistServer(jobId) {
    if (!jobId) return;
    const jobIdStr = String(jobId);
    serverBlacklist.set(jobIdStr, Date.now());
    
    // Clean up expired blacklist entries periodically
    const now = Date.now();
    for (const [id, timestamp] of serverBlacklist.entries()) {
        if (now - timestamp > BLACKLIST_DURATION_MS * 2) {
            serverBlacklist.delete(id);
        }
    }
}

// Remove server from cache
function removeServerFromCache(jobId) {
    if (!jobIdFetcher || !jobId) return;
    
    try {
        jobIdFetcher.loadCache();
        const jobIdStr = String(jobId);
        
        // Remove from cache if possible
        if (jobIdFetcher.removeJobId) {
            jobIdFetcher.removeJobId(jobIdStr);
        }
        
        // Blacklist it so it won't be returned in future requests
        blacklistServer(jobIdStr);
        
        console.log(`[Cache] Removed/blacklisted server: ${jobIdStr}`);
    } catch (error) {
        console.warn(`[Cache] Failed to remove server ${jobId}:`, error.message);
        // Still blacklist even if cache removal fails
        blacklistServer(String(jobId));
    }
}

function authorize(requiredKey) {
    return (req, res, next) => {
        const apiKey = req.headers['x-api-key'] 
            || req.headers['authorization']?.replace('Bearer ', '') 
            || req.query.key;
        
        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'Unauthorized. API key required.' });
        }
        
        if (!API_KEYS[requiredKey] || apiKey !== API_KEYS[requiredKey]) {
            return res.status(403).json({ success: false, error: 'Forbidden. Invalid API key.' });
        }
        
        next();
    };
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

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


app.get('/api/job-ids', authorize('BOT'), async (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.json({ 
                success: true,
                jobIds: [],
                servers: [],
                count: 0,
                totalAvailable: 0,
                cacheInfo: { count: 0, lastUpdated: null, placeId: 0 },
                message: 'Job ID fetcher module not available'
            });
        }
        
        const limit = parseInt(req.query.limit) || 1000;
        const exclude = req.query.exclude ? req.query.exclude.split(',') : [];
        
        jobIdFetcher.loadCache();
        const cacheInfo = jobIdFetcher.getCacheInfo();
        
        let servers = [];
        try {
            servers = jobIdFetcher.getFreshestServers(limit * 2) || [];
        } catch (error) {
            console.error('[Servers] Error getting servers:', error.message);
        }
        
        // Filter out excluded servers and full servers (players >= maxPlayers)
        const excludeSet = new Set(exclude);
        const now = Date.now();
        const METADATA_MAX_AGE_MS = 2 * 60 * 1000; // 2 minutes - consider metadata stale after this
        const METADATA_STALE_AGE_MS = 5 * 60 * 1000; // 5 minutes - very stale metadata
        
        servers = servers.filter(server => {
            if (excludeSet.has(server.id)) return false;
            
            const players = server.players || 0;
            const maxPlayers = server.maxPlayers || 8;
            const timestamp = server.timestamp || 0;
            const metadataAge = now - timestamp;
            
            // Safety check: ensure we have valid maxPlayers
            if (maxPlayers <= 0 || maxPlayers > 20) {
                return false; // Invalid maxPlayers
            }
            
            // Primary check: Filter out full servers (players >= maxPlayers)
            if (players >= maxPlayers) {
                return false;
            }
            
            // Safety margin: Exclude servers that are very close to full (within 1 slot)
            // Always exclude near-full servers to prevent "server is full" errors
            if (players >= (maxPlayers - 1)) {
                return false; // Too close to full - skip it
            }
            
            // Prefer servers with fresher metadata (less likely to be stale/full)
            // But don't exclude stale servers entirely - they might still be valid
            // Just mark them with lower priority
            server._metadataAge = metadataAge;
            server._isStale = metadataAge > METADATA_STALE_AGE_MS;
            
            // Extra safety: If metadata is stale (>2 minutes), be more conservative
            // Exclude servers with 6+ players if metadata is stale (they might be full now)
            if (metadataAge > METADATA_MAX_AGE_MS && players >= 6) {
                return false; // Stale metadata + high player count = likely full
            }
            
            return true;
        });
        
        // Sort by freshness and player count (prefer fresh servers with more slots available)
        servers.sort((a, b) => {
            // First priority: freshness (newer metadata first)
            if (a._metadataAge !== b._metadataAge) {
                return a._metadataAge - b._metadataAge;
            }
            // Second priority: more available slots (lower player count)
            const aAvailable = (a.maxPlayers || 8) - (a.players || 0);
            const bAvailable = (b.maxPlayers || 8) - (b.players || 0);
            if (aAvailable !== bAvailable) {
                return bAvailable - aAvailable; // More slots = better
            }
            // Third priority: lower player count
            return (a.players || 0) - (b.players || 0);
        });
        
        // Real-time server status check - verify ALL servers before returning
        // We need to ensure NO full servers are returned
        const serversToCheck = servers.slice(0, Math.min(limit * 2, 30)); // Check more to find non-full ones
        
        try {
            // Fast parallel checks with timeout - verify all servers
            const checkPromise = checkServerStatusBatch(serversToCheck, 30);
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve([]), 4000)); // 4s timeout for more checks
            const checkResults = await Promise.race([checkPromise, timeoutPromise]);
            
            if (Array.isArray(checkResults) && checkResults.length > 0) {
                // Update server availability based on real-time checks
                const checkedServers = new Map();
                for (const result of checkResults) {
                    if (result.status) {
                        checkedServers.set(result.server.id, result.status);
                    }
                }
                
                // Filter out blacklisted, full, or unavailable servers
                servers = servers.filter(server => {
                    // Check blacklist first
                    if (serverBlacklist.has(server.id)) {
                        const blacklistTime = serverBlacklist.get(server.id);
                        if (Date.now() - blacklistTime < BLACKLIST_DURATION_MS) {
                            return false; // Still blacklisted
                        } else {
                            serverBlacklist.delete(server.id); // Expired, remove
                        }
                    }
                    
                    const realTimeStatus = checkedServers.get(server.id);
                    
                    if (realTimeStatus) {
                        // Use real-time status if available
                        if (!realTimeStatus.available) {
                            return false; // Server is full or unavailable
                        }
                        
                        // Double-check: Even if marked available, verify it's not full or near-full
                        const realPlayers = realTimeStatus.players || 0;
                        const realMaxPlayers = realTimeStatus.maxPlayers || 8;
                        if (realPlayers >= realMaxPlayers || realPlayers >= (realMaxPlayers - 1)) {
                            return false; // Full or too close to full
                        }
                        
                        // Update server metadata with real-time data
                        server.players = realTimeStatus.players;
                        server.maxPlayers = realTimeStatus.maxPlayers;
                        server.timestamp = realTimeStatus.timestamp;
                        server._verified = true; // Mark as verified
                    } else {
                        // No real-time status - be conservative
                        // If metadata is stale, exclude servers with high player count
                        if (server._metadataAge && server._metadataAge > METADATA_MAX_AGE_MS) {
                            if ((server.players || 0) >= 6) {
                                return false; // Stale + high player count = risky
                            }
                        }
                    }
                    
                    return true;
                });
                
                // Re-sort after filtering (real-time verified servers get priority)
                servers.sort((a, b) => {
                    // Prioritize verified servers
                    if (a._verified !== b._verified) {
                        return (b._verified ? 1 : 0) - (a._verified ? 1 : 0);
                    }
                    // Then by freshness and available slots
                    if (a._metadataAge !== b._metadataAge) {
                        return a._metadataAge - b._metadataAge;
                    }
                    const aAvailable = (a.maxPlayers || 8) - (a.players || 0);
                    const bAvailable = (b.maxPlayers || 8) - (b.players || 0);
                    if (aAvailable !== bAvailable) {
                        return bAvailable - aAvailable;
                    }
                    return (a.players || 0) - (b.players || 0);
                });
            }
        } catch (error) {
            console.warn('[Servers] Error during real-time server checks:', error.message);
            // Continue with cached data if real-time check fails
        }
        
        // Final filter: remove blacklisted servers (use existing now variable)
        servers = servers.filter(server => {
            if (serverBlacklist.has(server.id)) {
                const blacklistTime = serverBlacklist.get(server.id);
                if (now - blacklistTime < BLACKLIST_DURATION_MS) {
                    return false; // Still blacklisted
                } else {
                    serverBlacklist.delete(server.id); // Expired, remove
                    return true;
                }
            }
            return true;
        });
        
        const limited = servers.slice(0, limit);
        
        // Background refresh if needed
        if (!isFetching && (cacheInfo.count < 100 || (cacheInfo.lastUpdated && (Date.now() - new Date(cacheInfo.lastUpdated).getTime()) > 300000))) {
            setImmediate(() => {
                if (isFetching) return;
                isFetching = true;
                jobIdFetcher.fetchBulkJobIds()
                    .then(result => {
                        jobIdFetcher.saveCache();
                        console.log(`[Servers] Refreshed: ${result.total} servers`);
                        isFetching = false;
                    })
                    .catch(error => {
                        console.error('[Servers] Refresh error:', error.message);
                        isFetching = false;
                    });
            });
        }
        
        res.json({
            success: true,
            jobIds: limited.map(s => s.id),
            servers: limited,
            count: limited.length,
            totalAvailable: servers.length,
            cacheInfo: cacheInfo
        });
    } catch (error) {
        console.error('[Servers] Error:', error.message);
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

// Endpoint to mark server as used (blacklist it)
app.post('/api/job-ids/used', authorize('BOT'), (req, res) => {
    try {
        const { jobId } = req.body;
        
        if (!jobId) {
            return res.status(400).json({ success: false, error: 'jobId is required' });
        }
        
        // Blacklist the server
        blacklistServer(jobId);
        
        // Remove from cache
        removeServerFromCache(jobId);
        
        res.json({
            success: true,
            message: `Server ${jobId} blacklisted`,
            blacklistedCount: serverBlacklist.size
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/job-ids/refresh', authorize('ADMIN'), (req, res) => {
    if (!jobIdFetcher) {
        return res.json({ success: false, message: 'Job ID fetcher not available' });
    }
    
    setImmediate(() => {
        if (isFetching) return;
        isFetching = true;
        jobIdFetcher.fetchBulkJobIds()
            .then(result => {
                jobIdFetcher.saveCache();
                console.log(`[Servers] Refreshed: ${result.total} servers`);
                isFetching = false;
            })
            .catch(error => {
                console.error('[Servers] Refresh error:', error.message);
                isFetching = false;
            });
    });
    
    res.json({ success: true, message: 'Refresh initiated' });
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled Rejection:', reason);
});

let server = null;

server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on port ${PORT}`);
    
    if (jobIdFetcher) {
        setImmediate(() => {
            jobIdFetcher.loadCache();
            const cacheInfo = jobIdFetcher.getCacheInfo();
            
            if (cacheInfo.count < 1000 && !isFetching) {
                isFetching = true;
                jobIdFetcher.fetchBulkJobIds()
                    .then(result => {
                        jobIdFetcher.saveCache();
                        console.log(`[Servers] Fetched ${result.total} servers`);
                        isFetching = false;
                    })
                    .catch(error => {
                        console.error('[Servers] Fetch error:', error.message);
                        isFetching = false;
                    });
            }
            
            // Auto-refresh every 5 minutes
            setInterval(() => {
                if (isFetching) return;
                isFetching = true;
                jobIdFetcher.fetchBulkJobIds()
                    .then(result => {
                        jobIdFetcher.saveCache();
                        console.log(`[Servers] Auto-refreshed: ${result.total} servers`);
                        isFetching = false;
                    })
                    .catch(error => {
                        console.error('[Servers] Auto-refresh error:', error.message);
                        isFetching = false;
                    });
            }, 5 * 60 * 1000);
        });
    }
});

server.on('error', (error) => {
    console.error('[Server] Error:', error.message);
    if (error.code === 'EADDRINUSE') {
        process.exit(1);
    }
});

process.on('SIGTERM', () => {
    if (server) server.close(() => process.exit(0));
    else process.exit(0);
});

process.on('SIGINT', () => {
    if (server) server.close(() => process.exit(0));
    else process.exit(0);
});
