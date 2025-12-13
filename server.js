const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Configuration from environment variables
const CONFIG = {
    PLACE_ID: parseInt(process.env.PLACE_ID, 10) || 109983668079237,
    MAX_JOB_IDS: parseInt(process.env.MAX_JOB_IDS || '3000', 10),
    PAGES_TO_FETCH: parseInt(process.env.PAGES_TO_FETCH || '100', 10),
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '100', 10),
    CONCURRENCY_LIMIT: parseInt(process.env.CONCURRENCY_LIMIT || '5', 10),
    MIN_PLAYERS: parseInt(process.env.MIN_PLAYERS || '0', 10),
    JOB_ID_MAX_AGE_MS: parseInt(process.env.JOB_ID_MAX_AGE_MS || '300000', 10), // 5 minutes
    MIN_MPS_THRESHOLD: parseInt(process.env.MIN_MPS_THRESHOLD || '10000000', 10),
    MAX_FINDS: parseInt(process.env.MAX_FINDS || '10000', 10),
    STORAGE_DURATION_HOURS: parseInt(process.env.STORAGE_DURATION_HOURS || '2', 10)
};

const API_KEY = process.env.BOT_API_KEY || 'sablujihub-bot';

// Authentication middleware
// Validates API key from X-API-Key header
function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
    if (apiKey === API_KEY) {
        return next();
    }
    return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized. Valid API key required.' 
    });
}

// Rate limiting middleware
// Prevents abuse by limiting requests per IP address
const rateLimitMap = new Map();

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const window = 60000; // 1 minute window
    const maxRequests = 100; // Max requests per window
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + window });
        return next();
    }
    
    const limit = rateLimitMap.get(ip);
    if (now > limit.resetTime) {
        // Window expired, reset
        limit.count = 1;
        limit.resetTime = now + window;
        return next();
    }
    
    if (limit.count >= maxRequests) {
        return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded',
            retryAfter: Math.ceil((limit.resetTime - now) / 1000)
        });
    }
    
    limit.count++;
    next();
}

// Clean up expired rate limit entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, limit] of rateLimitMap.entries()) {
        if (now > limit.resetTime) {
            rateLimitMap.delete(ip);
        }
    }
}, 60000); // Every minute

// Pet Find Storage Class
// Stores and manages pet find data with deduplication and automatic cleanup
class PetFindStorage {
    constructor() {
        this.finds = []; // Array of find objects (newest first)
        this.findMap = new Map(); // Deduplication map: key -> find object
    }
    
    // Add pet finds to storage with validation and deduplication
    // Returns statistics about the operation
    addFinds(findsData, accountName) {
        const results = { added: 0, skipped: 0, duplicates: 0, invalid: 0 };
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000); // 5 minute deduplication window
        
        for (const findData of findsData) {
            // Filter by MPS threshold (backend may have different threshold than user)
            const mps = typeof findData.mps === 'number' ? findData.mps : parseFloat(findData.mps) || 0;
            if (mps < CONFIG.MIN_MPS_THRESHOLD) {
                results.skipped++;
                continue;
            }
            
            // Validate required fields
            if (!findData.petName || typeof findData.petName !== 'string' || findData.petName.trim().length === 0) {
                results.invalid++;
                continue;
            }
            
            // Create unique key for deduplication
            // Format: petName_placeId_jobId_uniqueId
            const uniqueId = findData.uniqueId ? String(findData.uniqueId).trim() : "";
            const findKey = `${String(findData.petName).trim()}_${findData.placeId || 0}_${String(findData.jobId || "").trim()}_${uniqueId}`;
            
            // Check for duplicates within 5 minute window
            if (this.findMap.has(findKey)) {
                const existing = this.findMap.get(findKey);
                const existingTime = this.getTimestamp(existing);
                if (existingTime > fiveMinutesAgo) {
                    results.duplicates++;
                    continue;
                }
                // Duplicate is old, allow it (pet might have been found again)
            }
            
            // Convert timestamp (Lua os.time() returns seconds, JavaScript uses milliseconds)
            let timestamp = findData.timestamp || now;
            if (typeof timestamp === 'number' && timestamp < 10000000000) {
                // Timestamp is in seconds, convert to milliseconds
                timestamp = timestamp * 1000;
            }
            
            // Create find object with all required fields
            const find = {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                petName: String(findData.petName).trim(),
                generation: findData.generation ? String(findData.generation) : "N/A",
                mps: mps,
                rarity: findData.rarity ? String(findData.rarity) : "Unknown",
                mutation: findData.mutation ? String(findData.mutation) : "Normal",
                placeId: findData.placeId || 0,
                jobId: findData.jobId ? String(findData.jobId).trim() : "",
                accountName: findData.accountName ? String(findData.accountName).trim() : accountName,
                timestamp: timestamp,
                receivedAt: new Date().toISOString(),
                uniqueId: uniqueId,
                playerCount: findData.playerCount || 0,
                maxPlayers: findData.maxPlayers || 6
            };
            
            // Add to storage (newest first)
            this.finds.unshift(find);
            this.findMap.set(findKey, find);
            results.added++;
            
            // Maintain max size limit (remove oldest)
            if (this.finds.length > CONFIG.MAX_FINDS) {
                const removed = this.finds.pop();
                // Remove from map using the same key generation logic
                const removedKey = `${removed.petName}_${removed.placeId}_${removed.jobId}_${removed.uniqueId}`;
                this.findMap.delete(removedKey);
            }
        }
        
        // Cleanup old finds periodically
        this.cleanup();
        
        return results;
    }
    
    // Get timestamp from find object (handles different timestamp formats)
    getTimestamp(find) {
        if (find.receivedAt) {
            return new Date(find.receivedAt).getTime();
        }
        if (find.timestamp) {
            const ts = typeof find.timestamp === 'number' ? find.timestamp : parseInt(find.timestamp);
            return ts < 10000000000 ? ts * 1000 : ts; // Convert seconds to milliseconds if needed
        }
        return Date.now();
    }
    
    // Clean up old finds based on storage duration
    cleanup() {
        const now = Date.now();
        const cutoff = now - (CONFIG.STORAGE_DURATION_HOURS * 60 * 60 * 1000);
        
        const toRemove = [];
        for (const find of this.finds) {
            if (this.getTimestamp(find) <= cutoff) {
                toRemove.push(find);
            }
        }
        
        // Remove old finds
        for (const find of toRemove) {
            const index = this.finds.indexOf(find);
            if (index > -1) {
                this.finds.splice(index, 1);
            }
            // Remove from map
            const findKey = `${find.petName}_${find.placeId}_${find.jobId}_${find.uniqueId}`;
            this.findMap.delete(findKey);
        }
        
        if (toRemove.length > 0) {
            console.log(`[PetStorage] Cleaned ${toRemove.length} old finds (${this.finds.length} remaining)`);
        }
    }
    
    // Get storage statistics
    getStats() {
        const oneHourAgo = Date.now() - 3600000;
        return {
            total: this.finds.length,
            recent: this.finds.filter(f => this.getTimestamp(f) > oneHourAgo).length
        };
    }
}

const petFindStorage = new PetFindStorage();

// Auto cleanup every 5 minutes
setInterval(() => {
    petFindStorage.cleanup();
}, 300000);

// Job Manager Class
// Manages server job IDs: fetching, caching, and atomic distribution
class JobManager {
    constructor() {
        this.serverMap = new Map(); // jobId (normalized) -> { id, players, maxPlayers, timestamp, priority }
        this.usedJobIds = new Map(); // jobId (normalized) -> timestamp
        this.pendingJobIds = new Map(); // jobId (normalized) -> timestamp (when added to pending)
        this.isFetching = false;
        this.lastFetchTime = 0;
        this.lock = false; // Simple lock for atomic operations
    }
    
    // Normalize job ID to lowercase string for consistent storage/lookup
    normalizeJobId(jobId) {
        return String(jobId).trim().toLowerCase();
    }
    
    // Make HTTP request to Roblox API with timeout and error handling
    makeRequest(url) {
        return new Promise((resolve, reject) => {
            const request = https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (error) {
                            reject(new Error(`Failed to parse JSON: ${error.message}`));
                        }
                    } else if (res.statusCode === 429) {
                        reject(new Error('Rate limited'));
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                });
            });
            
            // 25 second timeout
            request.setTimeout(25000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
            
            request.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });
        });
    }
    
    // Fetch a single page from Roblox API with retry logic
    async fetchPage(cursor = null, retryCount = 0) {
        let url = `https://games.roblox.com/v1/games/${CONFIG.PLACE_ID}/servers/Public?sortOrder=Desc&limit=100&excludeFullGames=true`;
        if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
        }
        
        try {
            return await this.makeRequest(url);
        } catch (error) {
            // Retry on rate limit with exponential backoff
            if (error.message.includes('429') && retryCount < 5) {
                const delay = Math.min(5000 * Math.pow(2, retryCount), 60000);
                console.log(`[JobManager] Rate limited, waiting ${delay}ms before retry ${retryCount + 1}/5`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.fetchPage(cursor, retryCount + 1);
            }
            // Retry on timeout
            if (error.message.includes('timeout') && retryCount < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.fetchPage(cursor, retryCount + 1);
            }
            return null;
        }
    }
    
    // Calculate priority based on player count (higher priority = better server)
    // Priority 5: Almost full (maxPlayers - 1)
    // Priority 4: Near full (maxPlayers - 2)
    // Priority 3: More than half full
    // Priority 2: Has players
    // Priority 1: Empty
    calculatePriority(players, maxPlayers) {
        if (players >= maxPlayers - 1) return 5;
        if (players >= maxPlayers - 2) return 4;
        if (players > maxPlayers * 0.5) return 3;
        if (players > 0) return 2;
        return 1;
    }
    
    // Fetch job IDs from Roblox API in bulk
    // Removes used servers from cache before fetching new ones
    async fetchBulkJobIds() {
        if (this.isFetching || this.serverMap.size >= CONFIG.MAX_JOB_IDS) {
            return { total: this.serverMap.size, added: 0 };
        }
        
        this.isFetching = true;
        const startTime = Date.now();
        let totalAdded = 0;
        let pagesFetched = 0;
        let cursor = null;
        
        // Remove used servers from cache before fetching
        for (const [jobId] of this.serverMap.entries()) {
            if (this.usedJobIds.has(jobId)) {
                this.serverMap.delete(jobId);
            }
        }
        
        // Fetch pages until limit reached or no more pages
        while (pagesFetched < CONFIG.PAGES_TO_FETCH && this.serverMap.size < CONFIG.MAX_JOB_IDS) {
            const data = await this.fetchPage(cursor);
            
            if (!data || !data.data || data.data.length === 0) {
                break;
            }
            
            const now = Date.now();
            for (const server of data.data) {
                const jobId = server.id;
                if (!jobId) continue;
                
                const normalizedId = this.normalizeJobId(jobId);
                
                // Skip if already used or already in cache
                if (this.usedJobIds.has(normalizedId) || this.serverMap.has(normalizedId)) {
                    continue;
                }
                
                const players = server.playing || 0;
                const maxPlayers = server.maxPlayers || 6;
                
                // Filter by player count
                if (players < CONFIG.MIN_PLAYERS || players >= maxPlayers) {
                    continue;
                }
                
                // Skip private servers
                if (server.accessCode || server.PrivateServerId || server.privateServerId) {
                    continue;
                }
                
                const priority = this.calculatePriority(players, maxPlayers);
                
                // Store with normalized ID
                this.serverMap.set(normalizedId, {
                    id: jobId, // Keep original ID for response
                    timestamp: now,
                    players: players,
                    maxPlayers: maxPlayers,
                    priority: priority
                });
                
                totalAdded++;
            }
            
            cursor = data.nextPageCursor;
            pagesFetched++;
            
            // Delay between pages to avoid rate limiting
            if (cursor && pagesFetched < CONFIG.PAGES_TO_FETCH) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_REQUESTS));
            }
        }
        
        this.isFetching = false;
        this.lastFetchTime = Date.now();
        
        console.log(`[JobManager] Fetched ${totalAdded} new servers (total: ${this.serverMap.size})`);
        
        return { total: this.serverMap.size, added: totalAdded };
    }
    
    // Get next available job ID (ATOMIC operation)
    // Uses lock to prevent race conditions when multiple users request simultaneously
    // Returns null if no servers available or lock is held
    getNextJob(currentJobId, count = 1) {
        // Simple lock to prevent concurrent access
        if (this.lock) {
            return null; // Another request is processing, return null to retry
        }
        
        this.lock = true;
        try {
            // Clean old servers before selecting
            this.cleanOldServers();
            
            // Normalize current job ID for exclusion
            const excludeId = currentJobId ? this.normalizeJobId(currentJobId) : null;
            
            // Collect candidates (not current, not used, not pending, fresh)
            const candidates = [];
            const now = Date.now();
            
            for (const [normalizedId, server] of this.serverMap.entries()) {
                // Skip if excluded, used, or pending
                if (excludeId === normalizedId) continue;
                if (this.usedJobIds.has(normalizedId)) continue;
                if (this.pendingJobIds.has(normalizedId)) continue;
                
                // Validate server is still fresh (not too old)
                const age = now - (server.timestamp || 0);
                if (age > CONFIG.JOB_ID_MAX_AGE_MS) continue;
                
                candidates.push({
                    ...server,
                    jobId: server.id // Use original ID
                });
            }
            
            // Sort by priority (highest first), then by player count
            candidates.sort((a, b) => {
                if (a.priority !== b.priority) return b.priority - a.priority;
                return (b.players || 0) - (a.players || 0);
            });
            
            if (candidates.length === 0) {
                return null;
            }
            
            // Return requested count (for prefetching support)
            const results = candidates.slice(0, count);
            
            // ATOMIC: Mark as pending, remove from map, mark as used
            // This ensures no other request can get the same server
            for (const result of results) {
                const normalizedId = this.normalizeJobId(result.id || result.jobId);
                
                // Add to pending set (prevents other requests from getting it)
                this.pendingJobIds.set(normalizedId, now);
                
                // Remove from server map IMMEDIATELY
                this.serverMap.delete(normalizedId);
                
                // Mark as used (permanent record)
                this.usedJobIds.set(normalizedId, now);
            }
            
            // Clean up pending IDs after 10 seconds (in case request fails)
            // This prevents permanent lockout if a server is marked pending but never confirmed
            setTimeout(() => {
                const cleanupTime = Date.now();
                for (const [pendingId, pendingTime] of this.pendingJobIds.entries()) {
                    if (cleanupTime - pendingTime > 10000) {
                        this.pendingJobIds.delete(pendingId);
                    }
                }
            }, 10000);
            
            return count === 1 ? results[0] : results;
        } catch (error) {
            console.error('[JobManager] Error in getNextJob:', error);
            return null;
        } finally {
            // Always release lock, even on error
            this.lock = false;
        }
    }
    
    // Mark server(s) as visited/used (supports batch, idempotent)
    // Safe to call multiple times for the same server
    markVisited(jobIds) {
        if (!jobIds) return 0;
        
        const ids = Array.isArray(jobIds) ? jobIds : [jobIds];
        let marked = 0;
        const now = Date.now();
        
        for (const jobId of ids) {
            if (!jobId) continue;
            const normalizedId = this.normalizeJobId(jobId);
            
            // Mark as used (idempotent - safe to call multiple times)
            if (!this.usedJobIds.has(normalizedId)) {
                this.usedJobIds.set(normalizedId, now);
                marked++;
            }
            
            // Remove from server map if present
            if (this.serverMap.has(normalizedId)) {
                this.serverMap.delete(normalizedId);
            }
            
            // Remove from pending set
            this.pendingJobIds.delete(normalizedId);
        }
        
        return marked;
    }
    
    // Clean old servers from cache
    // Removes servers older than JOB_ID_MAX_AGE_MS
    // Also cleans old used IDs (kept longer to prevent reuse)
    cleanOldServers() {
        const now = Date.now();
        const maxAge = CONFIG.JOB_ID_MAX_AGE_MS;
        
        // Clean old servers from cache
        for (const [normalizedId, server] of this.serverMap.entries()) {
            if (now - server.timestamp > maxAge) {
                this.serverMap.delete(normalizedId);
            }
        }
        
        // Clean old used IDs (keep them longer to prevent reuse)
        for (const [normalizedId, timestamp] of this.usedJobIds.entries()) {
            if (now - timestamp > maxAge * 2) { // Keep used IDs for 2x max age
                this.usedJobIds.delete(normalizedId);
            }
        }
        
        // Clean old pending IDs (shouldn't be many, but clean just in case)
        for (const [normalizedId, timestamp] of this.pendingJobIds.entries()) {
            if (now - timestamp > 10000) { // Pending should be cleaned after 10 seconds
                this.pendingJobIds.delete(normalizedId);
            }
        }
    }
    
    // Get cache statistics
    getCacheInfo() {
        return {
            count: this.serverMap.size,
            usedCount: this.usedJobIds.size,
            pendingCount: this.pendingJobIds.size,
            isFetching: this.isFetching,
            lastFetchTime: this.lastFetchTime
        };
    }
}

const jobManager = new JobManager();

// Auto-fetch job IDs on startup if cache is low
setImmediate(() => {
    if (jobManager.serverMap.size < 500) {
        jobManager.fetchBulkJobIds().catch(err => {
            console.error('[JobManager] Initial fetch error:', err.message);
        });
    }
});

// Auto-refresh when cache is low (every 2 minutes)
setInterval(() => {
    if (!jobManager.isFetching && jobManager.serverMap.size < CONFIG.MAX_JOB_IDS * 0.3) {
        jobManager.fetchBulkJobIds().catch(err => {
            console.error('[JobManager] Auto-refresh error:', err.message);
        });
    }
}, 120000);

// API Endpoints

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        cache: jobManager.getCacheInfo(),
        storage: petFindStorage.getStats()
    });
});

// Receive pet finds endpoint
// Accepts single find or array of finds
app.post('/api/pet-found', rateLimit, authenticate, (req, res) => {
    try {
        const body = req.body;
        const finds = body.finds || [body]; // Support both single and batch
        const accountName = body.accountName || req.headers['x-user-id'] || 'unknown';
        
        if (!Array.isArray(finds) || finds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request. Expected "finds" array or single find object.' 
            });
        }
        
        // Limit batch size to prevent abuse
        if (finds.length > 500) {
            return res.status(400).json({ 
                success: false, 
                error: 'Too many finds in batch. Maximum 500 per request.' 
            });
        }
        
        const results = petFindStorage.addFinds(finds, accountName);
        
        res.json({ 
            success: true, 
            message: `Received ${results.added} valid pet find(s)`,
            added: results.added,
            skipped: results.skipped,
            duplicates: results.duplicates,
            invalid: results.invalid
        });
    } catch (error) {
        console.error('[PetFound] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Get next server endpoint
// Supports prefetching with ?count=N parameter (max 10)
app.get('/api/server/next', rateLimit, authenticate, (req, res) => {
    try {
        const currentJobId = req.query.currentJobId ? String(req.query.currentJobId).trim() : null;
        const count = Math.min(Math.max(parseInt(req.query.count) || 1, 1), 10); // Limit to 1-10
        
        const result = jobManager.getNextJob(currentJobId, count);
        
        if (!result) {
            // Trigger background refresh if cache is low
            if (!jobManager.isFetching && jobManager.serverMap.size < 100) {
                setImmediate(() => {
                    jobManager.fetchBulkJobIds().catch(() => {});
                });
            }
            
            return res.status(503).json({
                success: false,
                error: 'No servers available',
                message: 'Cache is empty or refreshing. Please try again in a moment.',
                retryAfter: 5,
                cacheSize: jobManager.serverMap.size,
                isFetching: jobManager.isFetching
            });
        }
        
        // Pre-fetch more jobs in background if cache is getting low
        if (jobManager.serverMap.size < CONFIG.MAX_JOB_IDS * 0.3 && !jobManager.isFetching) {
            setImmediate(() => {
                jobManager.fetchBulkJobIds().catch(() => {});
            });
        }
        
        // Return single object or array based on count
        if (count === 1) {
            res.json({
                success: true,
                jobId: result.jobId || result.id, // Fixed: use jobId property
                players: result.players || 0,
                maxPlayers: result.maxPlayers || 6,
                timestamp: result.timestamp || Date.now(),
                priority: result.priority || 0
            });
        } else {
            res.json({
                success: true,
                jobs: result.map(job => ({
                    jobId: job.jobId || job.id, // Fixed: use jobId property
                    players: job.players || 0,
                    maxPlayers: job.maxPlayers || 6,
                    timestamp: job.timestamp || Date.now(),
                    priority: job.priority || 0
                })),
                count: result.length
            });
        }
    } catch (error) {
        console.error('[ServerNext] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Mark server(s) as visited endpoint
// Supports batch marking with jobIds array or single jobId
app.post('/api/server/visited', rateLimit, authenticate, (req, res) => {
    try {
        const { jobId, jobIds } = req.body;
        
        let jobIdsToMark = [];
        if (jobIds && Array.isArray(jobIds)) {
            jobIdsToMark = jobIds;
        } else if (jobId) {
            jobIdsToMark = [jobId];
        } else {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid or missing jobId/jobIds' 
            });
        }
        
        // Mark all at once (batch operation)
        const marked = jobManager.markVisited(jobIdsToMark);
        
        res.json({ 
            success: true, 
            message: `Marked ${marked} server(s) as visited`,
            marked: marked
        });
    } catch (error) {
        console.error('[ServerVisited] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`[Server] Started on port ${PORT}`);
    console.log(`[Server] Place ID: ${CONFIG.PLACE_ID}`);
    console.log(`[Server] API Key: ${API_KEY.substring(0, 10)}...`);
    console.log(`[Server] Max Job IDs: ${CONFIG.MAX_JOB_IDS}`);
    console.log(`[Server] Min MPS Threshold: ${CONFIG.MIN_MPS_THRESHOLD}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('[Server] Closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down gracefully...');
    server.close(() => {
        console.log('[Server] Closed');
        process.exit(0);
    });
});
