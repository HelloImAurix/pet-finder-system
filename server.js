const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
    PLACE_ID: parseInt(process.env.PLACE_ID, 10) || 109983668079237,
    MAX_JOB_IDS: parseInt(process.env.MAX_JOB_IDS || '3000', 10),
    PAGES_TO_FETCH: parseInt(process.env.PAGES_TO_FETCH || '100', 10),
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '100', 10),
    MIN_PLAYERS: parseInt(process.env.MIN_PLAYERS || '0', 10),
    JOB_ID_MAX_AGE_MS: parseInt(process.env.JOB_ID_MAX_AGE_MS || '300000', 10),
    MAX_FINDS: parseInt(process.env.MAX_FINDS || '10000', 10),
    STORAGE_DURATION_HOURS: parseInt(process.env.STORAGE_DURATION_HOURS || '2', 10),
    FULL_REFRESH_INTERVAL_MS: 600000,
    AUTO_REFRESH_INTERVAL_MS: 120000,
    CLEANUP_INTERVAL_MS: 60000,
    PENDING_TIMEOUT_MS: 10000,
    VISITED_EXPIRY_MS: 30 * 60 * 1000
};

const API_KEY = process.env.BOT_API_KEY || 'sablujihub-bot';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
    if (apiKey !== API_KEY) {
        return res.status(401).json({ 
            success: false, 
            error: 'Unauthorized. Valid API key required.',
            message: 'Please provide a valid X-API-Key header'
        });
    }
    next();
}

class RateLimiter {
    constructor() {
        this.requests = new Map();
    }

    check(ip) {
        const now = Date.now();
        const window = 60000;
        const maxRequests = 100;
        const record = this.requests.get(ip);
        
        if (!record || now > record.resetTime) {
            this.requests.set(ip, { count: 1, resetTime: now + window });
            return { allowed: true };
        }

        if (record.count >= maxRequests) {
            return { 
                allowed: false, 
                retryAfter: Math.ceil((record.resetTime - now) / 1000) 
            };
        }

        record.count++;
        return { allowed: true };
    }

    cleanup() {
        const now = Date.now();
        for (const [ip, record] of this.requests.entries()) {
            if (now > record.resetTime) {
                this.requests.delete(ip);
            }
        }
    }
}

const rateLimiter = new RateLimiter();

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const result = rateLimiter.check(ip);
    
    if (!result.allowed) {
        return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded',
            retryAfter: result.retryAfter
        });
    }
    
    next();
}

setInterval(() => rateLimiter.cleanup(), 60000);

class PetFindStorage {
    constructor() {
        this.finds = [];
        this.findMap = new Map();
    }

    addFinds(findsData, accountName) {
        const results = { added: 0, skipped: 0, duplicates: 0, invalid: 0 };
        const now = Date.now();
        const dedupWindow = 5 * 60 * 1000;
        const finds = Array.isArray(findsData) ? findsData : [findsData];

        for (const findData of finds) {
            if (!this.isValidFind(findData)) {
                results.invalid++;
                continue;
            }

            const key = this.createFindKey(findData);

            if (this.isDuplicate(key, now, dedupWindow)) {
                results.duplicates++;
                continue;
            }

            const find = this.createFindObject(findData, accountName, now);
            this.finds.unshift(find);
            this.findMap.set(key, find);
            results.added++;

            if (this.finds.length > CONFIG.MAX_FINDS) {
                const removed = this.finds.pop();
                const removedKey = this.createFindKey(removed);
                this.findMap.delete(removedKey);
            }
        }

        this.cleanup();
        return results;
    }

    isValidFind(findData) {
        return findData && 
               findData.petName && 
               typeof findData.petName === 'string' && 
               findData.petName.trim().length > 0;
    }

    createFindKey(findData) {
        const petName = String(findData.petName || '').trim();
        const placeId = findData.placeId || 0;
        const jobId = String(findData.jobId || '').trim();
        const uniqueId = String(findData.uniqueId || '').trim();
        return `${petName}_${placeId}_${jobId}_${uniqueId}`;
    }

    isDuplicate(key, now, dedupWindow) {
        if (!this.findMap.has(key)) {
            return false;
        }
        const existing = this.findMap.get(key);
        const existingTime = this.getTimestamp(existing);
        return (now - existingTime) < dedupWindow;
    }

    createFindObject(findData, accountName, now) {
        let timestamp = findData.timestamp || now;
        if (typeof timestamp === 'number' && timestamp < 10000000000) {
            timestamp *= 1000;
        }

        return {
            id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            petName: String(findData.petName).trim(),
            generation: String(findData.generation || 'N/A'),
            mps: parseFloat(findData.mps) || 0,
            rarity: String(findData.rarity || 'Unknown'),
            mutation: String(findData.mutation || 'Normal'),
            placeId: findData.placeId || 0,
            jobId: String(findData.jobId || '').trim(),
            accountName: String(findData.accountName || accountName || 'unknown').trim(),
            timestamp: timestamp,
            receivedAt: new Date().toISOString(),
            uniqueId: String(findData.uniqueId || '').trim(),
            playerCount: parseInt(findData.playerCount) || 0,
            maxPlayers: parseInt(findData.maxPlayers) || 6
        };
    }

    getTimestamp(find) {
        if (find.receivedAt) {
            return new Date(find.receivedAt).getTime();
        }
        if (find.timestamp) {
            const ts = typeof find.timestamp === 'number' ? find.timestamp : parseInt(find.timestamp);
            return ts < 10000000000 ? ts * 1000 : ts;
        }
        return Date.now();
    }

    cleanup() {
        const now = Date.now();
        const cutoff = now - (CONFIG.STORAGE_DURATION_HOURS * 60 * 60 * 1000);
        const initialLength = this.finds.length;
        
        this.finds = this.finds.filter(find => {
            const timestamp = this.getTimestamp(find);
            if (timestamp <= cutoff) {
                const key = this.createFindKey(find);
                this.findMap.delete(key);
                return false;
            }
            return true;
        });

        const removed = initialLength - this.finds.length;
        if (removed > 0) {
            console.log(`[PetStorage] Cleaned ${removed} old finds (${this.finds.length} remaining)`);
        }
    }

    getStats() {
        const oneHourAgo = Date.now() - 3600000;
        return {
            total: this.finds.length,
            recent: this.finds.filter(f => this.getTimestamp(f) > oneHourAgo).length
        };
    }

    getFinds(options = {}) {
        let results = [...this.finds];
        
        if (options.minMps) {
            results = results.filter(f => f.mps >= options.minMps);
        }
        
        if (options.petName) {
            const searchName = options.petName.toLowerCase().trim();
            results = results.filter(f => f.petName.toLowerCase().includes(searchName));
        }
        
        if (options.since) {
            const sinceTime = typeof options.since === 'number' 
                ? (options.since < 10000000000 ? options.since * 1000 : options.since)
                : new Date(options.since).getTime();
            results = results.filter(f => this.getTimestamp(f) >= sinceTime);
        }
        
        results.sort((a, b) => this.getTimestamp(b) - this.getTimestamp(a));
        
        const limit = Math.min(options.limit || 100, 500);
        return results.slice(0, limit);
    }
}

const petFindStorage = new PetFindStorage();

class JobManager {
    constructor() {
        this.availableServers = new Map();
        this.visitedJobIds = new Map();
        this.reservedJobIds = new Map();
        this.isFetching = false;
        this.lastFetchTime = 0;
        this.distributionLock = false;
    }

    normalizeJobId(jobId) {
        return String(jobId).trim().toLowerCase();
    }

    isServerVisited(normalizedId) {
        if (!this.visitedJobIds.has(normalizedId)) {
            return false;
        }
        const visitedTime = this.visitedJobIds.get(normalizedId);
        const now = Date.now();
        const age = now - visitedTime;
        if (age > CONFIG.VISITED_EXPIRY_MS) {
            this.visitedJobIds.delete(normalizedId);
            return false;
        }
        return true;
    }

    isServerReserved(normalizedId) {
        return this.reservedJobIds.has(normalizedId);
    }

    isServerAvailable(normalizedId) {
        return !this.isServerVisited(normalizedId) && 
               !this.isServerReserved(normalizedId) && 
               this.availableServers.has(normalizedId);
    }

    async makeRequest(url) {
        return new Promise((resolve, reject) => {
            const request = https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (error) {
                            reject(new Error(`JSON parse error: ${error.message}`));
                        }
                    } else if (res.statusCode === 429) {
                        reject(new Error('Rate limited'));
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                });
            });

            request.setTimeout(25000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });

            request.on('error', error => {
                reject(new Error(`Request failed: ${error.message}`));
            });
        });
    }

    async fetchPage(cursor = null, retryCount = 0) {
        let url = `https://games.roblox.com/v1/games/${CONFIG.PLACE_ID}/servers/Public?sortOrder=Desc&limit=100&excludeFullGames=true`;
        if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
        }

        try {
            return await this.makeRequest(url);
        } catch (error) {
            if (error.message.includes('429') && retryCount < 5) {
                const delay = Math.min(5000 * Math.pow(2, retryCount), 60000);
                console.log(`[JobManager] Rate limited, retrying in ${delay}ms (${retryCount + 1}/5)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.fetchPage(cursor, retryCount + 1);
            }
            if (error.message.includes('timeout') && retryCount < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.fetchPage(cursor, retryCount + 1);
            }
            return null;
        }
    }

    calculatePriority(players, maxPlayers) {
        if (players >= maxPlayers - 1) return 5;
        if (players >= maxPlayers - 2) return 4;
        if (players > maxPlayers * 0.5) return 3;
        if (players > 0) return 2;
        return 1;
    }

    isValidServer(server) {
        if (!server.id) return false;
        
        const players = server.playing || 0;
        const maxPlayers = server.maxPlayers || 6;
        
        if (players < CONFIG.MIN_PLAYERS || players >= maxPlayers) {
            return false;
        }
        
        if (server.accessCode || server.PrivateServerId || server.privateServerId) {
            return false;
        }
        
        return true;
    }

    async fetchBulkJobIds(forceRefresh = false) {
        if (this.isFetching) {
            return { total: this.availableServers.size, added: 0 };
        }

        if (forceRefresh) {
            console.log('[JobManager] Force refresh: Clearing available servers cache...');
            this.availableServers.clear();
        } else if (this.availableServers.size >= CONFIG.MAX_JOB_IDS) {
            return { total: this.availableServers.size, added: 0 };
        }

        this.isFetching = true;
        let totalAdded = 0;
        let totalSkipped = 0;
        let pagesFetched = 0;
        let cursor = null;

        this.removeVisitedServersFromPool();

        try {
            while (pagesFetched < CONFIG.PAGES_TO_FETCH && this.availableServers.size < CONFIG.MAX_JOB_IDS) {
                const data = await this.fetchPage(cursor);
                
                if (!data?.data?.length) {
                    break;
                }

                const now = Date.now();

                for (const server of data.data) {
                    if (!this.isValidServer(server)) {
                        continue;
                    }

                    const jobId = server.id;
                    const normalizedId = this.normalizeJobId(jobId);

                    if (this.isServerVisited(normalizedId)) {
                        totalSkipped++;
                        continue;
                    }

                    if (this.availableServers.has(normalizedId)) {
                        continue;
                    }

                    const players = server.playing || 0;
                    const maxPlayers = server.maxPlayers || 6;

                    this.availableServers.set(normalizedId, {
                        id: jobId,
                        timestamp: now,
                        players: players,
                        maxPlayers: maxPlayers,
                        priority: this.calculatePriority(players, maxPlayers)
                    });

                    totalAdded++;
                }

                cursor = data.nextPageCursor;
                pagesFetched++;

                if (cursor && pagesFetched < CONFIG.PAGES_TO_FETCH) {
                    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_REQUESTS));
                }
            }
        } finally {
            this.isFetching = false;
            this.lastFetchTime = Date.now();
        }

        console.log(`[JobManager] Fetched ${totalAdded} new servers, skipped ${totalSkipped} visited servers (total available: ${this.availableServers.size})`);
        return { total: this.availableServers.size, added: totalAdded };
    }

    removeVisitedServersFromPool() {
        let removed = 0;
        for (const [normalizedId] of this.availableServers.entries()) {
            if (this.isServerVisited(normalizedId)) {
                this.availableServers.delete(normalizedId);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[JobManager] Removed ${removed} visited servers from available pool`);
        }
    }

    getNextJob(currentJobId, count = 1) {
        if (this.distributionLock) {
            return null;
        }

        this.distributionLock = true;
        try {
            this.cleanOldServers();

            const excludeId = currentJobId ? this.normalizeJobId(currentJobId) : null;
            const now = Date.now();
            const candidates = [];

            for (const [normalizedId, server] of this.availableServers.entries()) {
                if (excludeId === normalizedId) continue;
                if (this.isServerVisited(normalizedId)) continue;
                if (this.isServerReserved(normalizedId)) continue;

                const age = now - (server.timestamp || 0);
                if (age > CONFIG.JOB_ID_MAX_AGE_MS) continue;

                candidates.push({
                    ...server,
                    jobId: server.id,
                    normalizedId: normalizedId
                });
            }

            if (candidates.length === 0) {
                return null;
            }

            candidates.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                return (b.players || 0) - (a.players || 0);
            });

            const results = candidates.slice(0, count);

            for (const result of results) {
                const normalizedId = result.normalizedId || this.normalizeJobId(result.id || result.jobId);
                
                this.availableServers.delete(normalizedId);
                this.reservedJobIds.set(normalizedId, now);
            }

            console.log(`[JobManager] Distributed ${results.length} server(s) to frontend (${this.availableServers.size} remaining)`);

            return count === 1 ? results[0] : results;
        } catch (error) {
            console.error('[JobManager] Error in getNextJob:', error);
            return null;
        } finally {
            this.distributionLock = false;
        }
    }

    markVisited(jobIds) {
        if (!jobIds) return 0;

        const ids = Array.isArray(jobIds) ? jobIds : [jobIds];
        let newlyMarked = 0;
        const now = Date.now();

        for (const jobId of ids) {
            if (!jobId) continue;
            const normalizedId = this.normalizeJobId(jobId);

            if (this.isServerVisited(normalizedId)) {
                continue;
            }

            this.visitedJobIds.set(normalizedId, now);
            this.availableServers.delete(normalizedId);
            this.reservedJobIds.delete(normalizedId);
            newlyMarked++;
        }

        if (newlyMarked > 0) {
            console.log(`[JobManager] Marked ${newlyMarked} server(s) as visited - will expire in 30 minutes (${this.visitedJobIds.size} total visited)`);
        }

        return newlyMarked;
    }

    cleanOldServers() {
        const now = Date.now();
        const maxAge = CONFIG.JOB_ID_MAX_AGE_MS;
        let removedOld = 0;

        for (const [normalizedId, server] of this.availableServers.entries()) {
            if (now - server.timestamp > maxAge) {
                this.availableServers.delete(normalizedId);
                removedOld++;
            }
        }

        if (removedOld > 0) {
            console.log(`[JobManager] Cleaned ${removedOld} expired servers from available pool`);
        }
    }

    cleanupReservedServers() {
        const now = Date.now();
        let expired = 0;

        for (const [normalizedId, timestamp] of this.reservedJobIds.entries()) {
            if (now - timestamp > CONFIG.PENDING_TIMEOUT_MS) {
                this.reservedJobIds.delete(normalizedId);
                expired++;
            }
        }

        if (expired > 0) {
            console.log(`[JobManager] Released ${expired} expired reserved servers back to pool`);
        }

        return expired;
    }

    cleanupExpiredVisitedServers() {
        const now = Date.now();
        let expired = 0;

        for (const [normalizedId, visitedTime] of this.visitedJobIds.entries()) {
            const age = now - visitedTime;
            if (age > CONFIG.VISITED_EXPIRY_MS) {
                this.visitedJobIds.delete(normalizedId);
                expired++;
            }
        }

        if (expired > 0) {
            console.log(`[JobManager] Removed ${expired} expired visited servers from blacklist (now available for reuse)`);
        }

        return expired;
    }

    getCacheInfo() {
        return {
            available: this.availableServers.size,
            visited: this.visitedJobIds.size,
            reserved: this.reservedJobIds.size,
            isFetching: this.isFetching,
            lastFetchTime: this.lastFetchTime
        };
    }
}

const jobManager = new JobManager();

setImmediate(() => {
    if (jobManager.availableServers.size < 500) {
        jobManager.fetchBulkJobIds().catch(err => {
            console.error('[JobManager] Initial fetch error:', err.message);
        });
    }
});

setInterval(() => {
    if (!jobManager.isFetching && jobManager.availableServers.size < CONFIG.MAX_JOB_IDS * 0.3) {
        jobManager.fetchBulkJobIds().catch(err => {
            console.error('[JobManager] Auto-refresh error:', err.message);
        });
    }
}, CONFIG.AUTO_REFRESH_INTERVAL_MS);

setInterval(() => {
    if (!jobManager.isFetching) {
        console.log('[JobManager] Starting full cache refresh...');
        jobManager.fetchBulkJobIds(true).then(result => {
            console.log(`[JobManager] Full refresh complete: ${result.added} servers added (total available: ${result.total})`);
        }).catch(err => {
            console.error('[JobManager] Full refresh error:', err.message);
        });
    }
}, CONFIG.FULL_REFRESH_INTERVAL_MS);

setInterval(() => {
    jobManager.cleanOldServers();
    jobManager.cleanupReservedServers();
    jobManager.cleanupExpiredVisitedServers();
    petFindStorage.cleanup();
}, CONFIG.CLEANUP_INTERVAL_MS);

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        cache: jobManager.getCacheInfo(),
        storage: petFindStorage.getStats()
    });
});

app.post('/api/pet-found', rateLimit, authenticate, (req, res) => {
    try {
        const body = req.body;
        const finds = body.finds || [body];
        const accountName = body.accountName || req.headers['x-user-id'] || req.headers['X-User-Id'] || 'unknown';

        if (!Array.isArray(finds) || finds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request. Expected "finds" array or single find object.' 
            });
        }

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

app.get('/api/server/next', rateLimit, authenticate, (req, res) => {
    try {
        const currentJobId = req.query.currentJobId ? String(req.query.currentJobId).trim() : null;
        const count = Math.min(Math.max(parseInt(req.query.count) || 1, 1), 10);

        const result = jobManager.getNextJob(currentJobId, count);

        if (!result) {
            if (!jobManager.isFetching && jobManager.availableServers.size < 100) {
                setImmediate(() => {
                    jobManager.fetchBulkJobIds().catch(() => {});
                });
            }

            return res.status(503).json({
                success: false,
                error: 'No servers available',
                message: 'Cache is empty or refreshing. Please try again in a moment.',
                retryAfter: 5,
                cacheSize: jobManager.availableServers.size,
                isFetching: jobManager.isFetching
            });
        }

        if (jobManager.availableServers.size < CONFIG.MAX_JOB_IDS * 0.3 && !jobManager.isFetching) {
            setImmediate(() => {
                jobManager.fetchBulkJobIds().catch(() => {});
            });
        }

        if (count === 1) {
            res.json({
                success: true,
                jobId: result.jobId || result.id,
                players: result.players || 0,
                maxPlayers: result.maxPlayers || 6,
                timestamp: result.timestamp || Date.now(),
                priority: result.priority || 0
            });
        } else {
            res.json({
                success: true,
                jobs: result.map(job => ({
                    jobId: job.jobId || job.id,
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

app.get('/api/pets', rateLimit, authenticate, (req, res) => {
    try {
        const options = {
            minMps: req.query.minMps ? parseFloat(req.query.minMps) : undefined,
            petName: req.query.petName || undefined,
            since: req.query.since ? parseInt(req.query.since) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit) : 100
        };

        const finds = petFindStorage.getFinds(options);
        const stats = petFindStorage.getStats();

        res.json({
            success: true,
            count: finds.length,
            total: stats.total,
            recent: stats.recent,
            pets: finds.map(find => ({
                id: find.id,
                petName: find.petName,
                generation: find.generation,
                mps: find.mps,
                rarity: find.rarity,
                mutation: find.mutation,
                placeId: find.placeId,
                jobId: find.jobId,
                accountName: find.accountName,
                timestamp: find.timestamp,
                receivedAt: find.receivedAt,
                uniqueId: find.uniqueId,
                playerCount: find.playerCount,
                maxPlayers: find.maxPlayers
            }))
        });
    } catch (error) {
        console.error('[PetsGet] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

const server = app.listen(PORT, () => {
    console.log(`[Server] Started on port ${PORT}`);
    console.log(`[Server] Place ID: ${CONFIG.PLACE_ID}`);
    console.log(`[Server] API Key: ${API_KEY.substring(0, 10)}...`);
    console.log(`[Server] Max Job IDs: ${CONFIG.MAX_JOB_IDS}`);
});

function shutdown(signal) {
    console.log(`[Server] ${signal} received, shutting down gracefully...`);
    server.close(() => {
        console.log('[Server] Closed');
        process.exit(0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

