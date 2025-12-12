const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const WebSocket = require('ws');

let compression, helmet;
try {
    compression = require('compression');
} catch (e) {
    console.warn('Compression package not installed. Install with: npm install compression');
}
try {
    helmet = require('helmet');
} catch (e) {
    console.warn('Helmet package not installed. Install with: npm install helmet');
}

const app = express();
const isRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_SERVICE_NAME;
const PORT = isRailway ? 3000 : (parseInt(process.env.PORT) || 3000);

if (helmet) {
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    }));
} else {
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        next();
    });
}

if (compression) {
    app.use(compression());
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const CONFIG = {
    MAX_FINDS: parseInt(process.env.MAX_FINDS || '10000', 10),
    STORAGE_DURATION_HOURS: parseInt(process.env.STORAGE_DURATION_HOURS || '2', 10),
    ALWAYS_SHOW_MINUTES: parseInt(process.env.ALWAYS_SHOW_MINUTES || '15', 10),
    MAX_BATCH_SIZE: parseInt(process.env.MAX_BATCH_SIZE || '500', 10),
    RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200', 10),
    CLEANUP_INTERVAL: parseInt(process.env.CLEANUP_INTERVAL || '300000', 10),
    MIN_MPS_THRESHOLD: parseInt(process.env.MIN_MPS_THRESHOLD || '10000000', 10),
    PLACE_ID: parseInt(process.env.PLACE_ID, 10) || 109983668079237,
    MAX_JOB_IDS: parseInt(process.env.MAX_JOB_IDS || '3000', 10),
    PAGES_TO_FETCH: parseInt(process.env.PAGES_TO_FETCH || '300', 10),
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '100', 10),
    CONCURRENCY_LIMIT: parseInt(process.env.CONCURRENCY_LIMIT || '8', 10),
    MIN_PLAYERS: parseInt(process.env.MIN_PLAYERS || '0', 10),
    JOB_ID_MAX_AGE_MS: parseInt(process.env.JOB_ID_MAX_AGE_MS || '300000', 10),
    CACHE_CLEANUP_MAX_AGE_MS: parseInt(process.env.CACHE_CLEANUP_MAX_AGE_MS || '3600000', 10),
    BLACKLIST_CLEANUP_AGE_MS: parseInt(process.env.BLACKLIST_CLEANUP_AGE_MS || '86400000', 10)
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
        
        // Check X-API-Key header first (used by Lua scripts)
        const apiKey = headers['x-api-key'] || headers['X-API-Key'] || query.key;
        if (apiKey) {
            if (API_KEYS[requiredRole] && apiKey === API_KEYS[requiredRole]) {
                req.authenticatedUserId = headers['x-user-id'] || body.accountName || 'unknown';
                req.authenticatedRole = requiredRole;
                return next();
            }
        }
        
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

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Signature', 'X-Timestamp', 'X-User-Id']
}));

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = duration > 1000 ? 'WARN' : duration > 500 ? 'INFO' : 'DEBUG';
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        console.log(`${logLevel} ${req.method} ${req.path} - ${res.statusCode} (${duration}ms) [${ip}]`);
    });
    next();
});


function validatePetFind(find) {
    const errors = [];
    
    if (!find.petName || typeof find.petName !== 'string' || find.petName.trim().length === 0) {
        errors.push('petName is required and must be a non-empty string');
    }
    
    if (typeof find.mps !== 'number' || isNaN(find.mps) || find.mps < 0) {
        errors.push('mps must be a valid non-negative number');
    }
    
    if (find.placeId && (typeof find.placeId !== 'number' || find.placeId <= 0)) {
        errors.push('placeId must be a valid positive number');
    }
    
    if (find.jobId && (typeof find.jobId !== 'string' && typeof find.jobId !== 'number')) {
        errors.push('jobId must be a string or number');
    }
    
    // Normalize petName length
    if (find.petName) {
        find.petName = String(find.petName).trim().substring(0, 200);
    }
    
    // Normalize optional fields from Lua scripts
    if (find.generation !== undefined) {
        find.generation = String(find.generation || 'N/A');
    }
    if (find.rarity !== undefined) {
        find.rarity = String(find.rarity || 'Unknown');
    }
    if (find.uniqueId !== undefined) {
        find.uniqueId = String(find.uniqueId || '');
    }
    if (find.timestamp !== undefined) {
        // Convert Lua os.time() (seconds) to milliseconds if needed
        if (typeof find.timestamp === 'number' && find.timestamp < 10000000000) {
            find.timestamp = find.timestamp * 1000;
        }
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

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
            console.log(`Cleaned ${toRemove.length} old finds (${this.finds.length} remaining)`);
        }
        
        if (this.finds.length > CONFIG.MAX_FINDS) {
            const excess = this.finds.length - CONFIG.MAX_FINDS;
            const toRemove = this.finds.slice(CONFIG.MAX_FINDS);
            this.finds = this.finds.slice(0, CONFIG.MAX_FINDS);
            for (const find of toRemove) {
                this.findMap.delete(find.id);
                this.removeFromIndexes(find);
            }
            console.log(`Trimmed ${excess} excess finds (max: ${CONFIG.MAX_FINDS})`);
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
            const mps = typeof findData.mps === 'number' ? findData.mps : parseFloat(findData.mps) || 0;
            if (mps < CONFIG.MIN_MPS_THRESHOLD) {
                results.skipped++;
                continue;
            }
            
            if (!findData.petName || typeof findData.petName !== 'string' || findData.petName.trim().length === 0) {
                results.invalid++;
                continue;
            }
            
            const uniqueId = findData.uniqueId ? String(findData.uniqueId).trim() : "";
            const findKey = `${String(findData.petName).trim()}_${findData.placeId || 0}_${String(findData.jobId || "").trim()}_${uniqueId}`;
            
            if (findKeys.has(findKey)) {
                results.duplicates++;
                continue;
            }
            
            if (this.findMap.has(findKey)) {
                const existingFind = this.findMap.get(findKey);
                const existingTime = this.getFindTimestamp(existingFind);
                if (existingTime > fiveMinutesAgo) {
                    results.duplicates++;
                    continue;
                }
            }
            
            findKeys.add(findKey);
            
            // Handle timestamp conversion (Lua os.time() returns seconds, we need milliseconds)
            let timestamp = findData.timestamp || Date.now();
            if (typeof timestamp === 'number' && timestamp < 10000000000) {
                // Likely in seconds, convert to milliseconds
                timestamp = timestamp * 1000;
            }
            
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
                timestamp: timestamp,
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
        
        setImmediate(() => {
            this.cleanup();
        });
        
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
                byMPS: 'on-demand',
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

const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const USED_IDS_FILE = path.join(__dirname, 'used_job_ids.json');

class BinaryHeap {
    constructor(compareFn) {
        this.heap = [];
        this.compare = compareFn || ((a, b) => a - b);
    }
    
    insert(item) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }
    
    extract() {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) return this.heap.pop();
        
        const root = this.heap[0];
        this.heap[0] = this.heap.pop();
        this.bubbleDown(0);
        return root;
    }
    
    bubbleUp(index) {
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.compare(this.heap[index], this.heap[parent]) >= 0) break;
            [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
            index = parent;
        }
    }
    
    bubbleDown(index) {
        while (true) {
            let smallest = index;
            const left = 2 * index + 1;
            const right = 2 * index + 2;
            
            if (left < this.heap.length && 
                this.compare(this.heap[left], this.heap[smallest]) < 0) {
                smallest = left;
            }
            
            if (right < this.heap.length && 
                this.compare(this.heap[right], this.heap[smallest]) < 0) {
                smallest = right;
            }
            
            if (smallest === index) break;
            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }
    
    size() { return this.heap.length; }
    isEmpty() { return this.heap.length === 0; }
    peek() { return this.heap.length > 0 ? this.heap[0] : null; }
}

class PriorityQueue {
    constructor() {
        this.items = [];
    }
    
    enqueue(item, priority) {
        this.items.push({item, priority});
        this.items.sort((a, b) => b.priority - a.priority);
    }
    
    dequeue() {
        return this.items.shift()?.item;
    }
    
    isEmpty() {
        return this.items.length === 0;
    }
    
    size() {
        return this.items.length;
    }
}

class HyperJobManager {
    constructor() {
        this.serverMap = new Map();
        this.usedJobIds = new Map();
        this.prefetchQueue = [];
        this.wsConnections = new Map();
        this.jobQueue = new PriorityQueue();
        this.freshJobs = new Map();
        this.readyJobs = new Map();
        this.priorityHeap = new BinaryHeap((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            if (a.players !== b.players) return b.players - a.players;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
        this.heapDirty = false;
        this.lastCleanupTime = Date.now();
        this.cleanupBatchSize = 100;
        
        this.cacheMetadata = {
            lastUpdated: null,
            placeId: CONFIG.PLACE_ID,
            totalFetched: 0,
            fetchCount: 0,
            lastFetchDuration: 0
        };
        
        this.state = {
            isSaving: false,
            pendingSave: false,
            isFetching: false,
            lastFetchTime: 0,
            consecutiveErrors: 0,
            totalRequests: 0,
            totalErrors: 0,
            rateLimitHits: 0
        };
        
        this.stats = {
            totalFetched: 0,
            totalAdded: 0,
            totalRemoved: 0,
            totalBlacklisted: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
        
        this.loadCacheFromFile();
    }
    
    isValidServer(server, excludeSet, now) {
        if (!server || !server.id) return false;
        
        const serverId = String(server.id).trim();
        const serverIdLower = serverId.toLowerCase();
        
        if (excludeSet && excludeSet.has(serverIdLower)) return false;
        if (this.usedJobIds.has(serverId) || this.usedJobIds.has(serverId)) return false;
        
        now = now || Date.now();
        const age = now - (server.timestamp || 0);
        if (age > CONFIG.JOB_ID_MAX_AGE_MS) return false;
        
        const players = server.players || 0;
        const maxPlayers = server.maxPlayers || 8;
        if (players >= maxPlayers || players < 0) return false;
        
        return true;
    }
    
    rebuildHeap() {
        this.priorityHeap = new BinaryHeap((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            if (a.players !== b.players) return b.players - a.players;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
        
        for (const [jobId, server] of this.serverMap.entries()) {
            if (this.isValidServer(server, new Set())) {
                this.priorityHeap.insert(server);
            }
        }
        
        this.heapDirty = false;
    }
    
    cleanCacheIncremental(batchSize) {
        batchSize = batchSize || this.cleanupBatchSize;
        const now = Date.now();
        let processed = 0;
        const toRemove = [];
        
        for (const [jobId, server] of this.serverMap.entries()) {
            if (processed >= batchSize) break;
            
            if (!this.isValidServer(server, new Set(), now)) {
                toRemove.push(jobId);
            }
            processed++;
        }
        
        for (const jobId of toRemove) {
            this.serverMap.delete(jobId);
        }
        
        this.heapDirty = true;
        
        if (this.serverMap.size > processed) {
            setImmediate(() => this.cleanCacheIncremental(batchSize));
        } else {
            this.lastCleanupTime = now;
        }
    }
    
    async loadCacheFromFile() {
        try {
            if (fs.existsSync(USED_IDS_FILE)) {
                const data = await fs.promises.readFile(USED_IDS_FILE, 'utf8');
                const parsed = JSON.parse(data);
                
                if (Array.isArray(parsed)) {
                    const now = Date.now();
                    let loaded = 0;
                    let expired = 0;
                    
                    for (const item of parsed) {
                        if (typeof item === 'string') {
                            this.usedJobIds.set(item.trim(), now);
                            loaded++;
                        } else if (item && typeof item === 'object' && item.id) {
                            const age = now - (item.timestamp || 0);
                            if (age < CONFIG.BLACKLIST_CLEANUP_AGE_MS) {
                                this.usedJobIds.set(String(item.id).trim(), item.timestamp || now);
                                loaded++;
                            } else {
                                expired++;
                            }
                        }
                    }
                    
                    console.log(`Loaded ${loaded} used job IDs from blacklist${expired > 0 ? ` (${expired} expired)` : ''}`);
                }
            }
            
            if (fs.existsSync(CACHE_FILE)) {
                const data = await fs.promises.readFile(CACHE_FILE, 'utf8');
                const parsed = JSON.parse(data);
                
                if (parsed && parsed.servers && Array.isArray(parsed.servers)) {
                    this.serverMap.clear();
                    let loaded = 0;
                    let skippedUsed = 0;
                    let skippedInvalid = 0;
                    const now = Date.now();
                    
                    for (const server of parsed.servers) {
                        if (!server || !server.id) {
                            skippedInvalid++;
                            continue;
                        }
                        
                        const jobId = String(server.id).trim();
                        if (!jobId) {
                            skippedInvalid++;
                            continue;
                        }
                        
                        if (this.usedJobIds.has(jobId)) {
                            skippedUsed++;
                            continue;
                        }
                        
                        const age = now - (server.timestamp || 0);
                        if (age > CONFIG.JOB_ID_MAX_AGE_MS) {
                            skippedInvalid++;
                            continue;
                        }
                        
                        this.serverMap.set(jobId, {
                            id: jobId,
                            timestamp: server.timestamp || now,
                            players: server.players || 0,
                            maxPlayers: server.maxPlayers || 8,
                            priority: server.priority || 0,
                            fetchCount: server.fetchCount || 0
                        });
                        loaded++;
                    }
                    
                    if (parsed.metadata) {
                        this.cacheMetadata = { ...this.cacheMetadata, ...parsed.metadata };
                    }
                    
                    console.log(`Loaded ${loaded} servers from cache (skipped ${skippedUsed} blacklisted, ${skippedInvalid} invalid/expired)`);
                    this.heapDirty = true;
                }
            }
        } catch (error) {
            console.error('Failed to load cache from file:', error.message);
        }
    }
    
    async saveCacheToFile(shouldClean = false) {
        if (this.state.isSaving) {
            this.state.pendingSave = true;
            return false;
        }
        
        try {
            this.state.isSaving = true;
            this.state.pendingSave = false;
            
            if (shouldClean) {
                this.cleanCache();
            }
            
            const idsToRemove = [];
            for (const [mapId, server] of this.serverMap.entries()) {
                if (!server || !server.id) {
                    idsToRemove.push(mapId);
                    continue;
                }
                
                const serverId = String(server.id).trim();
                if (this.usedJobIds.has(serverId) || this.usedJobIds.has(mapId)) {
                    idsToRemove.push(mapId);
                }
            }
            
            for (const id of idsToRemove) {
                this.serverMap.delete(id);
            }
            
            const serversArray = Array.from(this.serverMap.values());
            this.cacheMetadata.lastUpdated = new Date().toISOString();
            this.cacheMetadata.totalFetched = serversArray.length;
            
            const cacheData = {
                servers: serversArray,
                metadata: this.cacheMetadata
            };
            
            await fs.promises.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
            
            const now = Date.now();
            const idsArray = Array.from(this.usedJobIds.entries()).map(([id, timestamp]) => ({
                id: id,
                timestamp: timestamp || now
            }));
            await fs.promises.writeFile(USED_IDS_FILE, JSON.stringify(idsArray, null, 2));
            
            this.state.isSaving = false;
            if (this.state.pendingSave) {
                setImmediate(() => this.saveCacheToFile(false));
            }
            return true;
        } catch (error) {
            console.error('Failed to save cache:', error.message);
            this.state.isSaving = false;
            if (this.state.pendingSave) {
                setImmediate(() => this.saveCacheToFile(false));
            }
            return false;
        }
    }
    
    cleanCache() {
        this.cleanCacheIncremental(this.serverMap.size);
        this.heapDirty = true;
    }
    
    cleanupBlacklist() {
        const now = Date.now();
        let removed = 0;
        
        for (const [id, timestamp] of this.usedJobIds.entries()) {
            const age = now - (timestamp || 0);
            if (age > CONFIG.BLACKLIST_CLEANUP_AGE_MS) {
                this.usedJobIds.delete(id);
                removed++;
            }
        }
        
        if (removed > 0) {
            console.log(`Cleaned ${removed} expired blacklist entries`);
            this.saveCacheToFile();
        }
    }
    
    markAsUsed(jobIds) {
        if (!Array.isArray(jobIds) || jobIds.length === 0) return 0;
        
        const now = Date.now();
        let added = 0;
        let removed = 0;
        
        for (const jobId of jobIds) {
            const id = String(jobId).trim();
            if (!id) continue;
            
            const wasNew = !this.usedJobIds.has(id);
            if (wasNew) {
                this.usedJobIds.set(id, now);
                added++;
            }
            
            const idsToRemove = [];
            for (const [mapId, server] of this.serverMap.entries()) {
                if (!server || !server.id) continue;
                
                const serverId = String(server.id).trim();
                if (mapId === id || serverId === id || 
                    mapId.toLowerCase() === id.toLowerCase() || 
                    serverId.toLowerCase() === id.toLowerCase()) {
                    idsToRemove.push(mapId);
                }
            }
            
            for (const mapId of idsToRemove) {
                this.serverMap.delete(mapId);
                removed++;
            }
        }
        
        if (added > 0 || removed > 0) {
            this.stats.totalBlacklisted += added;
            this.stats.totalRemoved += removed;
            this.saveCacheToFile();
        }
        
        return added;
    }
    
    makeRequest(url, retryCount = 0) {
        return new Promise((resolve, reject) => {
            this.state.totalRequests++;
            
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
                        this.state.rateLimitHits++;
                        reject(new Error(`HTTP 429: Rate limited`));
                    } else {
                        this.state.totalErrors++;
                        reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                    }
                });
            });
            
            request.setTimeout(25000, () => {
                request.destroy();
                this.state.totalErrors++;
                reject(new Error('Request timeout after 25 seconds'));
            });
            
            request.on('error', (error) => {
                this.state.totalErrors++;
                reject(new Error(`Request failed: ${error.message}`));
            });
        });
    }
    
    async fetchPage(cursor = null, retryCount = 0, sortOrder = 'Desc') {
        let url = `https://games.roblox.com/v1/games/${CONFIG.PLACE_ID}/servers/Public?sortOrder=${sortOrder}&limit=100&excludeFullGames=true`;
        if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
        }
        
        try {
            const data = await this.makeRequest(url);
            this.state.consecutiveErrors = 0;
            return data;
        } catch (error) {
            this.state.consecutiveErrors++;
            
            if (error.message.includes('429') || error.message.includes('Rate limited')) {
                if (retryCount < 5) {
                    const backoffDelay = Math.min(5000 * Math.pow(2, retryCount), 60000);
                    console.log(`Rate limited, waiting ${backoffDelay}ms before retry ${retryCount + 1}/5`);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    return this.fetchPage(cursor, retryCount + 1, sortOrder);
                }
            }
            
            if (error.message.includes('timeout') && retryCount < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.fetchPage(cursor, retryCount + 1, sortOrder);
            }
            
            if (retryCount < 2 && !error.message.includes('429')) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.fetchPage(cursor, retryCount + 1, sortOrder);
            }
            
            return null;
        }
    }
    
    calculatePriority(players, maxPlayers) {
        if (players >= maxPlayers - 1 && players < maxPlayers) {
            return 5;
        } else if (players >= maxPlayers - 2 && players < maxPlayers - 1) {
            return 4;
        } else if (players > maxPlayers * 0.5) {
            return 3;
        } else if (players > 0) {
            return 2;
        } else {
            return 1;
        }
    }
    
    async fetchBulkJobIds() {
        if (this.state.isFetching) {
            return { total: this.serverMap.size, added: 0, scanned: 0 };
        }
        
        const startTime = Date.now();
        this.state.isFetching = true;
        this.state.lastFetchTime = startTime;
        
        let pagesFetched = 0;
        let totalAdded = 0;
        let totalScanned = 0;
        
        for (const [jobId, server] of this.serverMap.entries()) {
            if (this.usedJobIds.has(jobId)) {
                this.serverMap.delete(jobId);
            }
        }
        
        const requestQueue = [];
        for (let i = 0; i < Math.min(CONFIG.PAGES_TO_FETCH, 100); i++) {
            requestQueue.push({
                cursor: null,
                sortOrder: i % 10 < 7 ? 'Desc' : 'Asc',
                page: i
            });
        }
        
        const processQueue = async () => {
            const workers = [];
            let queueIndex = 0;
            let consecutiveEmptyPages = 0;
            
            const worker = async () => {
                while (queueIndex < requestQueue.length && this.serverMap.size < CONFIG.MAX_JOB_IDS) {
                    const request = requestQueue[queueIndex++];
                    if (!request) break;
                    
                    try {
                        const data = await this.fetchPage(request.cursor, 0, request.sortOrder);
                        
                        if (!data || !data.data || data.data.length === 0) {
                            consecutiveEmptyPages++;
                            if (consecutiveEmptyPages >= 5) {
                                break;
                            }
                            continue;
                        }
                        
                        consecutiveEmptyPages = 0;
                        
                        let pageAdded = 0;
                        const now = Date.now();
                        const seenIds = new Set();
                        
                        for (const server of data.data) {
                            totalScanned++;
                            const jobId = server.id;
                            
                            if (seenIds.has(jobId)) continue;
                            seenIds.add(jobId);
                            
                            if (!jobId || this.usedJobIds.has(jobId) || this.serverMap.has(jobId)) {
                                continue;
                            }
                            
                            const players = server.playing || 0;
                            const maxPlayers = server.maxPlayers || 6;
                            
                            if (players < CONFIG.MIN_PLAYERS) continue;
                            
                            const isPrivateServer = (server.accessCode !== null && server.accessCode !== undefined) ||
                                                   (server.PrivateServerId !== null && server.PrivateServerId !== undefined) ||
                                                   (server.privateServerId !== null && server.privateServerId !== undefined);
                            
                            if (isPrivateServer || players >= maxPlayers || players < 0) {
                                continue;
                            }
                            
                            const priority = this.calculatePriority(players, maxPlayers);
                            
                            const server = {
                                id: jobId,
                                timestamp: now,
                                players: players,
                                maxPlayers: maxPlayers,
                                priority: priority,
                                fetchCount: 1
                            };
                            this.serverMap.set(jobId, server);
                            this.priorityHeap.insert(server);
                            pageAdded++;
                            totalAdded++;
                        }
                        
                        pagesFetched++;
                        
                        if (data.nextPageCursor && queueIndex < requestQueue.length) {
                            requestQueue[queueIndex].cursor = data.nextPageCursor;
                        }
                    } catch (error) {
                        console.error(`Worker error: ${error.message}`);
                    }
                }
            };
            
            for (let i = 0; i < CONFIG.CONCURRENCY_LIMIT; i++) {
                workers.push(worker());
            }
            
            await Promise.all(workers);
        };
        
        await processQueue();
        
        const duration = Date.now() - startTime;
        this.cacheMetadata.totalFetched = this.serverMap.size;
        this.cacheMetadata.fetchCount = (this.cacheMetadata.fetchCount || 0) + 1;
        this.cacheMetadata.lastFetchDuration = duration;
        
        this.stats.totalFetched += totalScanned;
        this.stats.totalAdded += totalAdded;
        
        this.state.isFetching = false;
        
        setImmediate(() => {
            this.saveCacheToFile(false);
        });
        
        if (this.serverMap.size < CONFIG.MAX_JOB_IDS * 0.8) {
            setImmediate(() => {
                if (!this.state.isFetching) {
                    this.fetchBulkJobIds().catch(err => {
                        console.error('Background prefetch error:', err.message);
                    });
                }
            });
        }
        
        return {
            total: this.serverMap.size,
            added: totalAdded,
            scanned: totalScanned,
            duration: duration
        };
    }
    
    getFreshestServers(limit = 50, excludeIds = []) {
        const excludeSet = new Set();
        for (const id of excludeIds) {
            if (id) {
                excludeSet.add(String(id).trim().toLowerCase());
            }
        }
        
        if (this.heapDirty || this.priorityHeap.isEmpty()) {
            this.rebuildHeap();
        }
        
        const results = [];
        const tempHeap = new BinaryHeap(this.priorityHeap.compare);
        const now = Date.now();
        
        while (!this.priorityHeap.isEmpty() && results.length < limit) {
            const server = this.priorityHeap.extract();
            
            if (!this.isValidServer(server, excludeSet, now)) {
                continue;
            }
            
            results.push(server);
            tempHeap.insert(server);
        }
        
        while (!tempHeap.isEmpty()) {
            this.priorityHeap.insert(tempHeap.extract());
        }
        
        if (Date.now() - this.lastCleanupTime > 30000) {
            setImmediate(() => this.cleanCacheIncremental());
        }
        
        this.stats.cacheHits++;
        
        return results.map(server => ({
            id: server.id,
            players: server.players,
            maxPlayers: server.maxPlayers,
            timestamp: server.timestamp,
            priority: server.priority
        }));
    }
    
    getNextJob(currentJobId) {
        const excludeList = currentJobId ? [currentJobId] : [];
        const servers = this.getFreshestServers(1, excludeList);
        
        if (servers.length > 0) {
            const job = servers[0];
            // Mark as used immediately (will be removed from cache)
            this.markAsUsed([job.id]);
            return job;
        }
        
        // If no servers available, try to get any valid server (fallback)
        if (this.serverMap.size > 0) {
            const now = Date.now();
            for (const [jobId, server] of this.serverMap.entries()) {
                if (this.isValidServer(server, new Set(excludeList), now)) {
                    this.markAsUsed([jobId]);
                    return {
                        id: server.id,
                        players: server.players,
                        maxPlayers: server.maxPlayers,
                        timestamp: server.timestamp,
                        priority: server.priority
                    };
                }
            }
        }
        
        return null;
    }
    
    markVisited(jobId) {
        const jobIdStr = String(jobId).trim();
        if (!jobIdStr) return;
        
        const now = Date.now();
        this.usedJobIds.set(jobIdStr, now);
        
        // Remove from server map immediately
        if (this.serverMap.has(jobIdStr)) {
            this.serverMap.delete(jobIdStr);
            this.heapDirty = true;
        }
        
        // Also check case-insensitive matches
        for (const [mapId, server] of this.serverMap.entries()) {
            if (String(server.id).trim().toLowerCase() === jobIdStr.toLowerCase()) {
                this.serverMap.delete(mapId);
                this.heapDirty = true;
                break;
            }
        }
    }
    
    getPrefetchedJobs(count = 10, excludeIds = []) {
        return this.getFreshestServers(count, excludeIds);
    }
    
    broadcastJob(job) {
        if (!job || !job.id) return;
        
        const message = JSON.stringify({
            type: 'NEW_JOB',
            jobId: job.id,
            players: job.players || 0,
            maxPlayers: job.maxPlayers || 6,
            timestamp: job.timestamp || Date.now(),
            priority: job.priority || 0
        });
        
        let sent = 0;
        let failed = 0;
        
        this.wsConnections.forEach((ws, userId) => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                    sent++;
                } catch (error) {
                    failed++;
                    // Remove dead connections
                    if (error.code === 'ECONNRESET' || error.code === 'EPIPE') {
                        this.wsConnections.delete(userId);
                    }
                }
            } else {
                // Remove closed connections
                this.wsConnections.delete(userId);
            }
        });
        
        if (failed > 0) {
            console.warn(`[WebSocket] Broadcast: ${sent} sent, ${failed} failed`);
        }
    }
    
    getCacheInfo() {
        return {
            count: this.serverMap.size,
            lastUpdated: this.cacheMetadata.lastUpdated,
            placeId: this.cacheMetadata.placeId,
            usedCount: this.usedJobIds.size,
            fetchCount: this.cacheMetadata.fetchCount || 0,
            lastFetchDuration: this.cacheMetadata.lastFetchDuration || 0,
            isFetching: this.state.isFetching,
            stats: {
                ...this.stats,
                totalRequests: this.state.totalRequests,
                totalErrors: this.state.totalErrors,
                rateLimitHits: this.state.rateLimitHits
            }
        };
    }
    
    loadCache() {
        return this.loadCacheFromFile();
    }
    
    saveCache(shouldClean) {
        return this.saveCacheToFile(shouldClean);
    }
}

const jobManager = new HyperJobManager();

setInterval(() => {
    jobManager.saveCacheToFile(false);
}, 300000);

setInterval(() => {
    jobManager.cleanupBlacklist();
}, 3600000);

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        finds: petFindStorage.finds.length,
        stats: petFindStorage.getStats()
    });
});

app.get('/health/ready', (req, res) => {
    const isReady = jobManager && petFindStorage && jobManager.serverMap.size > 0;
    res.status(isReady ? 200 : 503).json({
        status: isReady ? 'ready' : 'not ready',
        timestamp: new Date().toISOString(),
        jobCacheSize: jobManager ? jobManager.serverMap.size : 0,
        storageSize: petFindStorage ? petFindStorage.finds.length : 0
    });
});

app.get('/health/live', (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.set({
        'Cache-Control': 'public, max-age=300'
    });
    res.json({ 
        message: 'Pet Finder API Server',
        status: 'running',
        version: '5.0',
        authentication: 'Signature-based (HMAC-SHA256)',
        endpoints: {
            'GET /health': 'Basic health check',
            'GET /health/ready': 'Readiness check',
            'GET /health/live': 'Liveness check',
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

function validateBatch(finds) {
    if (!Array.isArray(finds) || finds.length === 0) {
        return {valid: false, errors: ['Invalid request. Expected "finds" array or single find object.']};
    }
    
    if (finds.length > CONFIG.MAX_BATCH_SIZE) {
        return {valid: false, errors: [`Too many finds in batch. Maximum ${CONFIG.MAX_BATCH_SIZE} per request.`]};
    }
    
    return {valid: true};
}

// Receive pet finds from bots (supports both user finds and secret logging)
app.post('/api/pet-found', rateLimit, authenticate('BOT'), (req, res) => {
    try {
        const body = req.body;
        const finds = body.finds || [body];
        
        // Validate batch structure
        const batchValidation = validateBatch(finds);
        if (!batchValidation.valid) {
            return res.status(400).json({ 
                success: false, 
                error: batchValidation.errors[0],
                code: 'INVALID_INPUT'
            });
        }
        
        if (finds.length > CONFIG.MAX_BATCH_SIZE) {
            return res.status(400).json({ 
                success: false, 
                error: `Too many finds in batch. Maximum ${CONFIG.MAX_BATCH_SIZE} per request.`,
                code: 'BATCH_TOO_LARGE',
                maxSize: CONFIG.MAX_BATCH_SIZE
            });
        }
        
        // Validate and filter finds
        const validationErrors = [];
        const validFinds = [];
        
        for (let i = 0; i < finds.length; i++) {
            const validation = validatePetFind(finds[i]);
            if (validation.valid) {
                const mps = typeof finds[i].mps === 'number' ? finds[i].mps : parseFloat(finds[i].mps) || 0;
                // Accept all finds >= MIN_MPS_THRESHOLD (10M/s for secret logging)
                if (mps >= CONFIG.MIN_MPS_THRESHOLD) {
                    validFinds.push(finds[i]);
                }
            } else {
                validationErrors.push({
                    index: i,
                    errors: validation.errors
                });
            }
        }
        
        // Return success even if some finds are invalid (partial success)
        const accountName = body.accountName || validFinds[0]?.accountName || req.authenticatedUserId || "Unknown";
        
        // Process finds asynchronously (non-blocking)
        setImmediate(() => {
            if (validFinds.length > 0) {
                const results = petFindStorage.addFinds(validFinds, accountName);
                // Log statistics
                if (results.added > 0) {
                    console.log(`[PetFound] Added ${results.added} finds from ${accountName} (skipped: ${results.skipped}, duplicates: ${results.duplicates})`);
                }
            }
        });
        
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Request-ID': crypto.randomBytes(8).toString('hex')
        });
        
        // Return success with details
        res.status(200).json({ 
            success: true, 
            message: `Received ${validFinds.length} valid pet find(s)`,
            added: validFinds.length,
            skipped: finds.length - validFinds.length,
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined
        });
    } catch (error) {
        console.error('/pet-found error:', error);
        
        const errorResponse = {
            success: false,
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
            code: 'INTERNAL_ERROR',
            timestamp: new Date().toISOString()
        };
        
        res.status(500).json(errorResponse);
    }
});

// Get recent finds (supports filtering by MPS, time, sorting)
app.get('/api/finds/recent', rateLimit, authenticate('GUI'), (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 2000);
        const since = req.query.since ? Math.max(parseInt(req.query.since), 0) : null;
        const minMPS = Math.max(parseInt(req.query.minMPS) || 0, 0);
        const sortBy = ['timestamp', 'mps', 'name'].includes(req.query.sortBy) ? req.query.sortBy : 'timestamp';
        
        const result = petFindStorage.getRecentFinds(limit, since, minMPS, sortBy);
        
        res.set({
            'Cache-Control': 'private, max-age=10', // 10 second cache
            'ETag': crypto.createHash('md5').update(JSON.stringify(result)).digest('hex'),
            'X-Request-ID': crypto.randomBytes(8).toString('hex'),
            'X-Total-Finds': petFindStorage.finds.length
        });
        
        res.json({ 
            success: true, 
            ...result
        });
    } catch (error) {
        console.error('/finds/recent error:', error);
        res.status(500).json({ 
            success: false, 
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
            code: 'INTERNAL_ERROR',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/finds/stats', rateLimit, authenticate('GUI'), (req, res) => {
    try {
        const stats = petFindStorage.getStats();
        
        res.set({
            'Cache-Control': 'private, max-age=30', // 30 second cache
            'ETag': crypto.createHash('md5').update(JSON.stringify(stats)).digest('hex'),
            'X-Request-ID': crypto.randomBytes(8).toString('hex')
        });
        
        res.json({ 
            success: true, 
            stats: stats
        });
    } catch (error) {
        console.error('/finds/stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
            code: 'INTERNAL_ERROR',
            timestamp: new Date().toISOString()
        });
    }
});

// Get next server for hopping (supports pre-fetching)
app.get('/api/server/next', rateLimit, authenticate('BOT'), (req, res) => {
    try {
        const currentJobId = req.query.currentJobId ? String(req.query.currentJobId).trim() : null;
        
        // Get next job (excludes current if provided)
        const nextJob = jobManager.getNextJob(currentJobId);
        
        if (!nextJob) {
            // Trigger background refresh if cache is low
            if (!jobManager.state.isFetching && jobManager.serverMap.size < 100) {
                setImmediate(() => {
                    jobManager.fetchBulkJobIds().catch(err => {
                        if (!err.message.includes('429')) {
                            console.error('Background refresh error:', err.message);
                        }
                    });
                });
            }
            
            res.set({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Cache-Size': jobManager.serverMap.size,
                'X-Request-ID': crypto.randomBytes(8).toString('hex')
            });
            
            return res.status(503).json({
                success: false,
                error: 'No servers available',
                message: 'Cache is empty or refreshing. Please try again in a moment.',
                retryAfter: 5,
                cacheSize: jobManager.serverMap.size,
                isFetching: jobManager.state.isFetching
            });
        }
        
        // Pre-fetch more jobs in background if cache is getting low
        if (jobManager.serverMap.size < CONFIG.MAX_JOB_IDS * 0.3 && !jobManager.state.isFetching) {
            setImmediate(() => {
                jobManager.fetchBulkJobIds().catch(() => {});
            });
        }
        
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Cache-Size': jobManager.serverMap.size,
            'X-Request-ID': crypto.randomBytes(8).toString('hex')
        });
        
        // Return response in format expected by Lua scripts
        res.status(200).json({
            success: true,
            jobId: nextJob.id,
            players: nextJob.players || 0,
            maxPlayers: nextJob.maxPlayers || 6,
            timestamp: nextJob.timestamp || Date.now(),
            priority: nextJob.priority || 0
        });
    } catch (error) {
        console.error('/server/next error:', error);
        res.status(500).json({ 
            success: false, 
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
            code: 'INTERNAL_ERROR',
            timestamp: new Date().toISOString()
        });
    }
});

// Mark server(s) as visited (fire-and-forget, non-blocking, supports batch)
app.post('/api/server/visited', rateLimit, authenticate('BOT'), (req, res) => {
    try {
        const { jobId, jobIds } = req.body;
        
        // Support both single jobId and batch jobIds
        let jobIdsToMark = [];
        if (jobIds && Array.isArray(jobIds)) {
            jobIdsToMark = jobIds;
        } else if (jobId) {
            jobIdsToMark = [jobId];
        } else {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid or missing jobId/jobIds',
                code: 'INVALID_INPUT'
            });
        }
        
        // Validate and normalize job IDs
        const validJobIds = [];
        for (const id of jobIdsToMark) {
            if (!id || (typeof id !== 'string' && typeof id !== 'number')) continue;
            const jobIdStr = String(id).trim();
            if (jobIdStr && jobIdStr !== 'null' && jobIdStr !== 'undefined' && jobIdStr !== '') {
                validJobIds.push(jobIdStr);
            }
        }
        
        if (validJobIds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No valid job IDs provided',
                code: 'INVALID_INPUT'
            });
        }
        
        // Mark as visited (non-blocking, fire-and-forget)
        setImmediate(() => {
            for (const id of validJobIds) {
                jobManager.markVisited(id);
            }
            jobManager.markAsUsed(validJobIds);
        });
        
        // Return immediately (fire-and-forget pattern)
        res.set({
            'Cache-Control': 'no-cache',
            'X-Request-ID': crypto.randomBytes(8).toString('hex')
        });
        
        res.status(200).json({ 
            success: true, 
            message: `Marked ${validJobIds.length} server(s) as visited`,
            marked: validJobIds.length,
            jobIds: validJobIds
        });
    } catch (error) {
        console.error('/server/visited error:', error);
        res.status(500).json({ 
            success: false, 
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
            code: 'INTERNAL_ERROR',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/job-ids/info', (req, res) => {
    try {
        const cacheInfo = jobManager.getCacheInfo();
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
        const cacheInfo = jobManager.getCacheInfo();
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
    setImmediate(() => {
        if (jobManager.state.isFetching) return;
        jobManager.state.isFetching = true;
        jobManager.fetchBulkJobIds()
            .then(result => {
                jobManager.saveCacheToFile(true);
                console.log(`Manual refresh: ${result.total} servers available`);
                jobManager.state.isFetching = false;
            })
            .catch(error => {
                console.error('Manual refresh error:', error.message);
                jobManager.state.isFetching = false;
            });
    });
    
    res.json({ success: true, message: 'Refresh initiated' });
});

setImmediate(() => {
    jobManager.cleanCache();
    jobManager.saveCacheToFile();
    
    const cacheInfo = jobManager.getCacheInfo();
    if (cacheInfo.count < 500 && !jobManager.state.isFetching) {
        jobManager.state.isFetching = true;
        jobManager.fetchBulkJobIds()
            .then(result => {
                jobManager.saveCacheToFile(true);
                console.log(`Initial fetch: ${result.total} servers cached`);
                jobManager.state.isFetching = false;
            })
            .catch(error => {
                console.error('Initial fetch error:', error.message);
                jobManager.state.isFetching = false;
            });
    }
});

// Auto-refresh job cache when it gets low
setInterval(() => {
    if (jobManager.state.isFetching) return;
    
    const cacheInfo = jobManager.getCacheInfo();
    const cacheAge = cacheInfo.lastUpdated ? (Date.now() - new Date(cacheInfo.lastUpdated).getTime()) : Infinity;
    const cacheThreshold = CONFIG.MAX_JOB_IDS * 0.3; // Refresh when below 30% capacity
    
    if (cacheInfo.count < cacheThreshold || cacheAge > 120000) { // 2 minutes
        jobManager.state.isFetching = true;
        jobManager.fetchBulkJobIds()
            .then(result => {
                jobManager.saveCacheToFile(true);
                console.log(`[AutoRefresh] ${result.total} servers available (added: ${result.added}, scanned: ${result.scanned})`);
                jobManager.state.isFetching = false;
            })
            .catch(error => {
                if (error.message && !error.message.includes('429')) {
                    console.error('[AutoRefresh] Error:', error.message);
                }
                jobManager.state.isFetching = false;
            });
    }
}, 30000); // Check every 30 seconds

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
    console.error(error.stack);
    if (process.env.NODE_ENV === 'production') {
    } else {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (server) {
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    }
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    if (server) {
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    }
});

let server = null;

function startServer() {
    try {
        server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`Listening on port ${PORT}`);
            console.log(`Authentication: Signature-based (HMAC-SHA256)`);
            console.log(`Max finds: ${CONFIG.MAX_FINDS}, Storage duration: ${CONFIG.STORAGE_DURATION_HOURS}h`);
            if (ALLOWED_BOT_IDS.size > 0) {
                console.log(`Bot whitelist: ${ALLOWED_BOT_IDS.size} user IDs`);
            }
        });

        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use.`);
                process.exit(1);
            } else {
                console.error('Error:', error.message);
                process.exit(1);
            }
        });
        
        const wss = new WebSocket.Server({ server });
        
        wss.on('connection', (ws, req) => {
            let userId = 'anonymous';
            try {
                const url = new URL(req.url, `http://${req.headers.host}`);
                userId = url.searchParams.get('userId') || req.headers['x-user-id'] || req.headers['X-User-Id'] || 'anonymous';
            } catch (e) {
                // Fallback: try to extract userId from URL string directly
                const urlMatch = req.url.match(/[?&]userId=([^&]+)/);
                if (urlMatch) {
                    userId = decodeURIComponent(urlMatch[1]);
                } else {
                    userId = req.headers['x-user-id'] || req.headers['X-User-Id'] || 'anonymous';
                }
            }
            
            const connectionMeta = {
                userId: userId,
                connectedAt: Date.now(),
                lastPing: Date.now(),
                messageCount: 0
            };
            
            jobManager.wsConnections.set(userId, ws);
            console.log(`Client connected: ${userId} (total: ${jobManager.wsConnections.size})`);
            
            // Send initial batch of jobs on connection
            const initialJobs = jobManager.getFreshestServers(10, []);
            if (initialJobs.length > 0) {
                try {
                    const message = JSON.stringify({
                        type: 'JOBS_BATCH',
                        jobs: initialJobs.map(job => ({
                            id: job.id,
                            players: job.players,
                            maxPlayers: job.maxPlayers,
                            timestamp: job.timestamp,
                            priority: job.priority
                        })),
                        timestamp: Date.now()
                    });
                    ws.send(message);
                    connectionMeta.messageCount++;
                } catch (error) {
                    console.error(`Failed to send initial jobs to ${userId}:`, error.message);
                }
            }
            
            const heartbeatInterval = setInterval(() => {
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.ping();
                        connectionMeta.lastPing = Date.now();
                    } else {
                        clearInterval(heartbeatInterval);
                    }
                } catch (error) {
                    clearInterval(heartbeatInterval);
                }
            }, 30000);
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    connectionMeta.messageCount++;
                    
                    if (data.type === 'PING') {
                        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
                    } else if (data.type === 'PONG') {
                        connectionMeta.lastPing = Date.now();
                    } else if (data.type === 'REQUEST_JOBS') {
                        const count = Math.min(Math.max(parseInt(data.count) || 10, 1), 50);
                        const currentJobId = data.currentJobId ? String(data.currentJobId).trim() : null;
                        const excludeList = currentJobId ? [currentJobId] : [];
                        const jobs = jobManager.getFreshestServers(count, excludeList);
                        
                        ws.send(JSON.stringify({
                            type: 'JOBS_BATCH',
                            jobs: jobs.map(job => ({
                                id: job.id,
                                players: job.players,
                                maxPlayers: job.maxPlayers,
                                timestamp: job.timestamp,
                                priority: job.priority
                            })),
                            timestamp: Date.now()
                        }));
                        
                        // Trigger background refresh if cache is low
                        if (jobManager.serverMap.size < CONFIG.MAX_JOB_IDS * 0.3 && !jobManager.state.isFetching) {
                            setImmediate(() => {
                                jobManager.fetchBulkJobIds().catch(() => {});
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Message handling error for ${userId}:`, error.message);
                    try {
                        ws.send(JSON.stringify({
                            type: 'ERROR',
                            error: 'Invalid message format',
                            timestamp: Date.now()
                        }));
                    } catch (e) {
                    }
                }
            });
            
            ws.on('pong', () => {
                connectionMeta.lastPing = Date.now();
            });
            
            ws.on('close', (code, reason) => {
                clearInterval(heartbeatInterval);
                jobManager.wsConnections.delete(userId);
                const duration = Date.now() - connectionMeta.connectedAt;
                console.log(`Client disconnected: ${userId} (code: ${code}, duration: ${Math.round(duration/1000)}s, messages: ${connectionMeta.messageCount})`);
            });
            
            ws.on('error', (error) => {
                clearInterval(heartbeatInterval);
                console.error(`Error for ${userId}:`, error.message);
                jobManager.wsConnections.delete(userId);
            });
        });
        
        wss.on('error', (error) => {
            console.error('Server error:', error.message);
        });
        
        // Wrap fetchBulkJobIds to broadcast new jobs via WebSocket
        const originalFetchBulk = jobManager.fetchBulkJobIds.bind(jobManager);
        jobManager.fetchBulkJobIds = async function(...args) {
            const result = await originalFetchBulk(...args);
            
            // Broadcast new jobs to WebSocket clients when cache is refreshed
            if (result.added > 0 && jobManager.wsConnections.size > 0) {
                const newJobs = jobManager.getFreshestServers(Math.min(10, result.added), []);
                for (const job of newJobs) {
                    jobManager.broadcastJob({
                        id: job.id,
                        players: job.players,
                        maxPlayers: job.maxPlayers,
                        timestamp: job.timestamp,
                        priority: job.priority
                    });
                }
            }
            
            return result;
        };
        
        console.log(`Server initialized on port ${PORT}`);
    } catch (error) {
        console.error('Failed to start:', error.message);
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
