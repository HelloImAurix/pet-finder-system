const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let jobIdFetcher = null;
const jobIdFetcherPath = path.join(__dirname, 'jobIdFetcher.js');
if (fs.existsSync(jobIdFetcherPath)) {
    try {
        jobIdFetcher = require('./jobIdFetcher');
    } catch (error) {
        console.error('[Servers] Failed to load job ID fetcher module:', error.message);
    }
}

const app = express();
const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_SERVICE_NAME;
const PORT = isRailway ? 3000 : (parseInt(process.env.PORT) || 3000);

const CONFIG = {
    MAX_FINDS: parseInt(process.env.MAX_FINDS || '10000', 10),
    STORAGE_DURATION_HOURS: parseInt(process.env.STORAGE_DURATION_HOURS || '2', 10),
    ALWAYS_SHOW_MINUTES: parseInt(process.env.ALWAYS_SHOW_MINUTES || '15', 10),
    MAX_BATCH_SIZE: parseInt(process.env.MAX_BATCH_SIZE || '500', 10),
    RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200', 10),
    CLEANUP_INTERVAL: parseInt(process.env.CLEANUP_INTERVAL || '300000', 10),
    MIN_MPS_THRESHOLD: parseInt(process.env.MIN_MPS_THRESHOLD || '10000000', 10)
};

const SECRET_KEYS = {
    BOT: process.env.BOT_SECRET_KEY || 'pYNF52c20F0w3Qsv',
    GUI: process.env.GUI_SECRET_KEY || '',
    ADMIN: process.env.ADMIN_SECRET_KEY || ''
};

const API_KEYS = {
    BOT: process.env.BOT_API_KEY || 'sablujihub-bot',
    GUI: process.env.GUI_API_KEY || 'sablujihub-gui',
    ADMIN: process.env.ADMIN_API_KEY || 'sablujihub-admin'
};

const ALLOWED_BOT_IDS = new Set();
if (process.env.BOT_USER_IDS) {
    process.env.BOT_USER_IDS.split(',').forEach(id => {
        const trimmed = id.trim();
        if (trimmed) ALLOWED_BOT_IDS.add(trimmed);
    });
}

function generateSignature(uid, secretKey) {
    if (!uid || !secretKey) return null;
    const message = String(uid);
    return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}

function verifySignature(uid, signature, secretKey) {
    if (!secretKey || !signature || !uid) return false;
    const expectedSig = generateSignature(uid, secretKey);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
}

function authenticate(requiredRole = 'BOT') {
    return (req, res, next) => {
        const body = req.body || {};
        const query = req.query || {};
        const headers = req.headers || {};
        
        let uid = body.uid || query.uid || headers['x-user-id'];
        let sig = body.sig || query.sig || headers['x-signature'];
        
        const authHeader = headers['authorization'];
        if (authHeader && !uid && !sig) {
            const parts = authHeader.split(' ');
            if (parts.length === 2 && parts[0] === 'Bearer') {
                try {
                    const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                    uid = decoded.uid;
                    sig = decoded.sig;
                } catch (e) {
                }
            }
        }
        
        if (uid) uid = String(uid).trim();
        if (sig) sig = String(sig).trim();
        
        if (uid && sig) {
            const secretKey = SECRET_KEYS[requiredRole];
            if (secretKey && verifySignature(uid, sig, secretKey)) {
                if (requiredRole === 'BOT' && ALLOWED_BOT_IDS.size > 0) {
                    if (!ALLOWED_BOT_IDS.has(uid)) {
                        return res.status(403).json({ 
                            success: false, 
                            error: 'Forbidden. User ID not authorized.' 
                        });
                    }
                }
                
                req.authenticatedUserId = uid;
                req.authenticatedRole = requiredRole;
                return next();
            }
        }
        
        const apiKey = headers['x-api-key'] || query.key;
        if (apiKey) {
            if (API_KEYS[requiredRole] && apiKey === API_KEYS[requiredRole]) {
                return next();
            }
        }
        
        return res.status(401).json({ 
            success: false, 
            error: 'Unauthorized. Valid signature or API key required.'
        });
    };
}

const rateLimitMap = new Map();

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + CONFIG.RATE_LIMIT_WINDOW });
        return next();
    }
    
    const limit = rateLimitMap.get(ip);
    
    if (now > limit.resetTime) {
        limit.count = 1;
        limit.resetTime = now + CONFIG.RATE_LIMIT_WINDOW;
        return next();
    }
    
    if (limit.count >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil((limit.resetTime - now) / 1000)
        });
    }
    
    limit.count++;
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, limit] of rateLimitMap.entries()) {
        if (now > limit.resetTime) {
            rateLimitMap.delete(ip);
        }
    }
}, CONFIG.RATE_LIMIT_WINDOW);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${req.method}] ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

class PetFindStorage {
    constructor() {
        this.finds = [];
        this.findMap = new Map();
        this.indexes = {
            byMPS: [],
            byTimestamp: [],
            byJobId: new Map(),
            byPlaceId: new Map(),
            byAccount: new Map(),
            byUniqueId: new Map()
        };
        this.stats = {
            totalReceived: 0,
            totalAdded: 0,
            totalSkipped: 0,
            totalDuplicates: 0,
            totalInvalid: 0,
            lastCleanup: Date.now()
        };
    }
    
    addToIndexes(find) {
        const mps = find.mps || 0;
        let inserted = false;
        for (let i = 0; i < this.indexes.byMPS.length; i++) {
            if (mps > (this.indexes.byMPS[i].mps || 0)) {
                this.indexes.byMPS.splice(i, 0, find);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            this.indexes.byMPS.push(find);
        }
        
        this.indexes.byTimestamp.unshift(find);
        
        const jobId = String(find.jobId || '').trim();
        if (jobId) {
            if (!this.indexes.byJobId.has(jobId)) {
                this.indexes.byJobId.set(jobId, []);
            }
            this.indexes.byJobId.get(jobId).push(find);
        }
        
        const placeId = find.placeId || 0;
        if (placeId > 0) {
            if (!this.indexes.byPlaceId.has(placeId)) {
                this.indexes.byPlaceId.set(placeId, []);
            }
            this.indexes.byPlaceId.get(placeId).push(find);
        }
        
        const account = String(find.accountName || 'Unknown').trim();
        if (!this.indexes.byAccount.has(account)) {
            this.indexes.byAccount.set(account, []);
        }
        this.indexes.byAccount.get(account).push(find);
        
        const uniqueId = String(find.uniqueId || '').trim();
        if (uniqueId) {
            if (!this.indexes.byUniqueId.has(uniqueId)) {
                this.indexes.byUniqueId.set(uniqueId, []);
            }
            this.indexes.byUniqueId.get(uniqueId).push(find);
        }
    }
    
    removeFromIndexes(find) {
        const mpsIndex = this.indexes.byMPS.indexOf(find);
        if (mpsIndex > -1) {
            this.indexes.byMPS.splice(mpsIndex, 1);
        }
        
        const tsIndex = this.indexes.byTimestamp.indexOf(find);
        if (tsIndex > -1) {
            this.indexes.byTimestamp.splice(tsIndex, 1);
        }
        
        const jobId = String(find.jobId || '').trim();
        if (jobId && this.indexes.byJobId.has(jobId)) {
            const jobFinds = this.indexes.byJobId.get(jobId);
            const index = jobFinds.indexOf(find);
            if (index > -1) {
                jobFinds.splice(index, 1);
                if (jobFinds.length === 0) {
                    this.indexes.byJobId.delete(jobId);
                }
            }
        }
        
        const placeId = find.placeId || 0;
        if (placeId > 0 && this.indexes.byPlaceId.has(placeId)) {
            const placeFinds = this.indexes.byPlaceId.get(placeId);
            const index = placeFinds.indexOf(find);
            if (index > -1) {
                placeFinds.splice(index, 1);
                if (placeFinds.length === 0) {
                    this.indexes.byPlaceId.delete(placeId);
                }
            }
        }
        
        const account = String(find.accountName || 'Unknown').trim();
        if (this.indexes.byAccount.has(account)) {
            const accountFinds = this.indexes.byAccount.get(account);
            const index = accountFinds.indexOf(find);
            if (index > -1) {
                accountFinds.splice(index, 1);
                if (accountFinds.length === 0) {
                    this.indexes.byAccount.delete(account);
                }
            }
        }
        
        const uniqueId = String(find.uniqueId || '').trim();
        if (uniqueId && this.indexes.byUniqueId.has(uniqueId)) {
            const uniqueFinds = this.indexes.byUniqueId.get(uniqueId);
            const index = uniqueFinds.indexOf(find);
            if (index > -1) {
                uniqueFinds.splice(index, 1);
                if (uniqueFinds.length === 0) {
                    this.indexes.byUniqueId.delete(uniqueId);
                }
            }
        }
    }
    
    getFindTimestamp(find) {
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
        
        const toRemove = [];
        for (const find of this.finds) {
            const findTime = this.getFindTimestamp(find);
            if (findTime <= cutoff) {
                toRemove.push(find);
            }
        }
        
        for (const find of toRemove) {
            const index = this.finds.indexOf(find);
            if (index > -1) {
                this.finds.splice(index, 1);
            }
            this.findMap.delete(find.id);
            this.removeFromIndexes(find);
        }
        
        if (toRemove.length > 0) {
            console.log(`[Storage] Cleaned ${toRemove.length} old finds (${this.finds.length} remaining)`);
        }
        
        if (this.finds.length > CONFIG.MAX_FINDS) {
            const excess = this.finds.length - CONFIG.MAX_FINDS;
            const toRemove = this.finds.slice(CONFIG.MAX_FINDS);
            this.finds = this.finds.slice(0, CONFIG.MAX_FINDS);
            for (const find of toRemove) {
                this.findMap.delete(find.id);
                this.removeFromIndexes(find);
            }
            console.log(`[Storage] Trimmed ${excess} excess finds (max: ${CONFIG.MAX_FINDS})`);
        }
        
        this.stats.lastCleanup = now;
    }
    
    addFinds(findsData, accountName) {
        const results = {
            added: 0,
            skipped: 0,
            invalid: 0,
            duplicates: 0
        };
        
        const findKeys = new Set();
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        
        for (const findData of findsData) {
            const validation = this.validateFind(findData);
            if (!validation.valid) {
                results.invalid++;
                continue;
            }
            
            const mps = typeof findData.mps === 'number' ? findData.mps : parseFloat(findData.mps) || 0;
            if (mps < CONFIG.MIN_MPS_THRESHOLD) {
                results.skipped++;
                continue;
            }
            
            const uniqueId = findData.uniqueId ? String(findData.uniqueId).trim() : "";
            const findKey = `${String(findData.petName).trim()}_${findData.placeId || 0}_${String(findData.jobId || "").trim()}_${uniqueId}`;
            
            if (findKeys.has(findKey)) {
                results.duplicates++;
                continue;
            }
            
            let isDuplicate = false;
            if (this.findMap.has(findKey)) {
                const existingFind = this.findMap.get(findKey);
                const existingTime = this.getFindTimestamp(existingFind);
                if (existingTime > fiveMinutesAgo) {
                    isDuplicate = true;
                }
            }
            
            if (isDuplicate) {
                results.duplicates++;
                continue;
            }
            
            findKeys.add(findKey);
            
            const find = {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                petName: String(findData.petName).trim(),
                generation: findData.generation ? String(findData.generation) : "N/A",
                mps: mps,
                rarity: findData.rarity ? String(findData.rarity) : "Unknown",
                placeId: findData.placeId || 0,
                jobId: findData.jobId ? String(findData.jobId).trim() : "",
                playerCount: findData.playerCount || 0,
                maxPlayers: findData.maxPlayers || 6,
                accountName: findData.accountName ? String(findData.accountName).trim() : accountName,
                timestamp: findData.timestamp || Date.now(),
                receivedAt: new Date().toISOString(),
                uniqueId: uniqueId
            };
            
            this.finds.unshift(find);
            this.findMap.set(findKey, find);
            this.addToIndexes(find);
            results.added++;
        }
        
        this.stats.totalReceived += findsData.length;
        this.stats.totalAdded += results.added;
        this.stats.totalSkipped += results.skipped;
        this.stats.totalDuplicates += results.duplicates;
        this.stats.totalInvalid += results.invalid;
        
        this.cleanup();
        
        return results;
    }
    
    validateFind(findData) {
        const errors = [];
        
        if (!findData.petName || typeof findData.petName !== 'string' || findData.petName.trim().length === 0) {
            errors.push('Invalid or missing petName');
        }
        
        if (findData.petName && findData.petName.length > 100) {
            errors.push('petName too long');
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
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
    
    getRecentFinds(limit = 500, since = null, minMPS = 0, sortBy = 'timestamp') {
        const now = Date.now();
        const oneHourAgo = now - (CONFIG.STORAGE_DURATION_HOURS * 60 * 60 * 1000);
        const tenMinutesAgo = now - (CONFIG.ALWAYS_SHOW_MINUTES * 60 * 1000);
        
        let hourFinds = this.indexes.byTimestamp.filter(find => {
            const findTime = this.getFindTimestamp(find);
            const isValid = findTime > oneHourAgo && (!since || findTime > since);
            const meetsMPS = (find.mps || 0) >= minMPS;
            return isValid && meetsMPS;
        });
        
        const last10Minutes = [];
        const olderButWithinHour = [];
        
        for (const find of hourFinds) {
            const findTime = this.getFindTimestamp(find);
            if (findTime > tenMinutesAgo) {
                last10Minutes.push(find);
            } else {
                olderButWithinHour.push(find);
            }
        }
        
        let combined = [...last10Minutes, ...olderButWithinHour];
        
        if (sortBy === 'mps') {
            combined.sort((a, b) => (b.mps || 0) - (a.mps || 0));
        } else if (sortBy === 'name') {
            combined.sort((a, b) => (a.petName || '').localeCompare(b.petName || ''));
        }
        
        combined = combined.slice(0, limit);
        
        return {
            finds: combined,
            total: combined.length,
            last10Minutes: last10Minutes.length,
            lastHour: hourFinds.length,
            timestamp: now
        };
    }
    
    getStats() {
        return {
            ...this.stats,
            currentFinds: this.finds.length,
            indexes: {
                byMPS: this.indexes.byMPS.length,
                byTimestamp: this.indexes.byTimestamp.length,
                byJobId: this.indexes.byJobId.size,
                byPlaceId: this.indexes.byPlaceId.size,
                byAccount: this.indexes.byAccount.size,
                byUniqueId: this.indexes.byUniqueId.size
            }
        };
    }
}

const petFindStorage = new PetFindStorage();

setInterval(() => {
    petFindStorage.cleanup();
}, CONFIG.CLEANUP_INTERVAL);

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        finds: petFindStorage.finds.length,
        stats: petFindStorage.getStats()
    });
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'Pet Finder API Server',
        status: 'running',
        version: '4.0',
        authentication: 'Signature-based (HMAC-SHA256)',
        endpoints: {
            'GET /health': 'Health check',
            'POST /api/pet-found': 'Receive pet finds from bots',
            'GET /api/finds/recent': 'Get recent pet finds',
            'GET /api/finds/stats': 'Get statistics',
            'GET /api/server/next': 'Get next available server for joining',
            'POST /api/server/visited': 'Mark server as visited',
            'GET /api/job-ids/info': 'Get cache info'
        },
        stats: petFindStorage.getStats()
    });
});

app.post('/api/pet-found', rateLimit, authenticate('BOT'), (req, res) => {
    try {
        const body = req.body;
        const finds = body.finds || [body];
        
        if (!Array.isArray(finds) || finds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request. Expected "finds" array or single find object.' 
            });
        }
        
        if (finds.length > CONFIG.MAX_BATCH_SIZE) {
            return res.status(400).json({ 
                success: false, 
                error: `Too many finds in batch. Maximum ${CONFIG.MAX_BATCH_SIZE} per request.` 
            });
        }
        
        const accountName = body.accountName || finds[0]?.accountName || req.authenticatedUserId || "Unknown";
        const results = petFindStorage.addFinds(finds, accountName);
        
        console.log(`[API] Received ${finds.length} pet(s) from ${accountName} - Added: ${results.added}, Skipped: ${results.skipped}, Invalid: ${results.invalid}, Duplicates: ${results.duplicates}`);
        
        res.status(200).json({ 
            success: true, 
            message: `Received ${results.added} pet find(s)`,
            ...results
        });
    } catch (error) {
        console.error('[API] /pet-found error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds/recent', rateLimit, authenticate('GUI'), (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
        const since = req.query.since ? parseInt(req.query.since) : null;
        const minMPS = parseInt(req.query.minMPS) || 0;
        const sortBy = req.query.sortBy || 'timestamp';
        
        const result = petFindStorage.getRecentFinds(limit, since, minMPS, sortBy);
        
        res.json({ 
            success: true, 
            ...result
        });
    } catch (error) {
        console.error('[API] /finds/recent error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds/stats', rateLimit, authenticate('GUI'), (req, res) => {
    try {
        const stats = petFindStorage.getStats();
        res.json({ 
            success: true, 
            stats: stats
        });
    } catch (error) {
        console.error('[API] /finds/stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/server/next', rateLimit, authenticate('BOT'), (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.json({ 
                success: false,
                error: 'Job ID fetcher module not available'
            });
        }
        
        const currentJobId = req.query.currentJobId ? String(req.query.currentJobId).trim() : null;
        const excludeList = currentJobId ? [currentJobId] : [];
        const servers = jobIdFetcher.getFreshestServers(100, excludeList) || [];
        
        if (servers.length === 0) {
            if (!jobIdFetcher.isFetching) {
                setImmediate(() => {
                    jobIdFetcher.fetchBulkJobIds()
                        .then(() => {
                            jobIdFetcher.saveCache(true);
                        })
                        .catch(err => {
                            console.error('[API] Background refresh error:', err.message);
                        });
                });
            }
            
            return res.json({
                success: false,
                error: 'No servers available',
                message: 'Cache is empty or refreshing. Please try again in a moment.'
            });
        }
        
        const server = servers[0];
        
        console.log(`[API] /server/next: Returning server ${server.id} (excluded current: ${currentJobId || 'none'})`);
        
        res.json({
            success: true,
            jobId: server.id,
            players: server.players,
            maxPlayers: server.maxPlayers,
            timestamp: server.timestamp
        });
    } catch (error) {
        console.error('[API] /server/next error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/server/visited', rateLimit, authenticate('BOT'), (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.json({ success: false, error: 'Job ID fetcher module not available' });
        }
        
        const { jobId } = req.body;
        if (!jobId || typeof jobId !== 'string') {
            return res.status(400).json({ success: false, error: 'Invalid or missing jobId' });
        }
        
        const markedCount = jobIdFetcher.markAsUsed([jobId]);
        jobIdFetcher.saveCache(true);
        
        const cacheInfo = jobIdFetcher.getCacheInfo();
        console.log(`[API] /server/visited: Marked ${jobId} as visited (total blacklisted: ${cacheInfo.usedCount}, available: ${cacheInfo.count})`);
        
        res.json({ 
            success: true, 
            message: 'Server marked as visited',
            jobId: jobId
        });
    } catch (error) {
        console.error('[API] /server/visited error:', error);
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

app.get('/api/job-ids/stats', authenticate('ADMIN'), (req, res) => {
    try {
        if (!jobIdFetcher) {
            return res.json({ 
                success: false,
                error: 'Job ID fetcher module not available'
            });
        }
        
        const cacheInfo = jobIdFetcher.getCacheInfo();
        res.json({
            success: true,
            stats: cacheInfo.stats,
            cache: {
                count: cacheInfo.count,
                usedCount: cacheInfo.usedCount,
                lastUpdated: cacheInfo.lastUpdated
            },
            state: {
                isFetching: cacheInfo.isFetching,
                fetchCount: cacheInfo.fetchCount,
                lastFetchDuration: cacheInfo.lastFetchDuration
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds', authenticate('ADMIN'), (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
        const finds = petFindStorage.finds.slice(0, limit);
        res.json({ 
            success: true, 
            finds: finds, 
            total: petFindStorage.finds.length,
            stats: petFindStorage.getStats()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/finds', authenticate('ADMIN'), (req, res) => {
    petFindStorage.finds = [];
    petFindStorage.findMap.clear();
    petFindStorage.indexes.byMPS = [];
    petFindStorage.indexes.byTimestamp = [];
    petFindStorage.indexes.byJobId.clear();
    petFindStorage.indexes.byPlaceId.clear();
    petFindStorage.indexes.byAccount.clear();
    petFindStorage.indexes.byUniqueId.clear();
    res.json({ success: true, message: 'All finds cleared' });
});

app.post('/api/job-ids/refresh', authenticate('ADMIN'), (req, res) => {
    if (!jobIdFetcher) {
        return res.json({ success: false, message: 'Job ID fetcher not available' });
    }
    
    setImmediate(() => {
        if (jobIdFetcher.isFetching) return;
        jobIdFetcher.isFetching = true;
        jobIdFetcher.fetchBulkJobIds()
            .then(result => {
                jobIdFetcher.saveCache(true);
                console.log(`[API] Manual refresh: ${result.total} servers available`);
                jobIdFetcher.isFetching = false;
            })
            .catch(error => {
                console.error('[API] Manual refresh error:', error.message);
                jobIdFetcher.isFetching = false;
            });
    });
    
    res.json({ success: true, message: 'Refresh initiated' });
});

if (jobIdFetcher) {
    setImmediate(() => {
        jobIdFetcher.loadCache();
        jobIdFetcher.cleanCache();
        jobIdFetcher.saveCache();
        
        const cacheInfo = jobIdFetcher.getCacheInfo();
        if (cacheInfo.count < 500 && !jobIdFetcher.isFetching) {
            jobIdFetcher.isFetching = true;
            jobIdFetcher.fetchBulkJobIds()
                .then(result => {
                    jobIdFetcher.saveCache(true);
                    console.log(`[API] Initial fetch: ${result.total} servers cached`);
                    jobIdFetcher.isFetching = false;
                })
                .catch(error => {
                    console.error('[API] Initial fetch error:', error.message);
                    jobIdFetcher.isFetching = false;
                });
        }
    });
    
    setInterval(() => {
        if (jobIdFetcher.isFetching) return;
        const cacheInfo = jobIdFetcher.getCacheInfo();
        const cacheAge = cacheInfo.lastUpdated ? (Date.now() - new Date(cacheInfo.lastUpdated).getTime()) : Infinity;
        
        if (cacheInfo.count < 500 || cacheAge > 60000) {
            jobIdFetcher.isFetching = true;
            jobIdFetcher.fetchBulkJobIds()
                .then(result => {
                    jobIdFetcher.saveCache(true);
                    console.log(`[API] Auto-refresh: ${result.total} servers available`);
                    jobIdFetcher.isFetching = false;
                })
                .catch(error => {
                    if (error.message && !error.message.includes('429')) {
                        console.error('[API] Auto-refresh error:', error.message);
                    }
                    jobIdFetcher.isFetching = false;
                });
        }
    }, 30000);
}

process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught Exception:', error.message);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled Rejection:', reason);
});

let server = null;

function startServer() {
    try {
        server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`[Server] Listening on port ${PORT}`);
            console.log(`[Server] Authentication: Signature-based (HMAC-SHA256)`);
            console.log(`[Server] Max finds: ${CONFIG.MAX_FINDS}, Storage duration: ${CONFIG.STORAGE_DURATION_HOURS}h`);
            if (ALLOWED_BOT_IDS.size > 0) {
                console.log(`[Server] Bot whitelist: ${ALLOWED_BOT_IDS.size} user IDs`);
            }
        });

        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`[Server] Port ${PORT} is already in use.`);
                process.exit(1);
            } else {
                console.error('[Server] Error:', error.message);
                process.exit(1);
            }
        });
    } catch (error) {
        console.error('[Server] Failed to start:', error.message);
        process.exit(1);
    }
}

startServer();

process.on('SIGTERM', () => {
    if (server) server.close(() => process.exit(0));
    else process.exit(0);
});

process.on('SIGINT', () => {
    if (server) server.close(() => process.exit(0));
    else process.exit(0);
});
