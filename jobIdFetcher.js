const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACE_ID = parseInt(process.env.PLACE_ID, 10) || 109983668079237;
const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const USED_IDS_FILE = path.join(__dirname, 'used_job_ids.json');
const MAX_JOB_IDS = parseInt(process.env.MAX_JOB_IDS || '3000', 10);
const PAGES_TO_FETCH = parseInt(process.env.PAGES_TO_FETCH || '300', 10);
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_BETWEEN_REQUESTS || '1500', 10);
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '0', 10);
const JOB_ID_MAX_AGE_MS = parseInt(process.env.JOB_ID_MAX_AGE_MS || '300000', 10);
const CACHE_CLEANUP_MAX_AGE_MS = parseInt(process.env.CACHE_CLEANUP_MAX_AGE_MS || '3600000', 10);
const BLACKLIST_CLEANUP_AGE_MS = parseInt(process.env.BLACKLIST_CLEANUP_AGE_MS || '86400000', 10);

class JobIdFetcher {
    constructor() {
        this.serverMap = new Map();
        this.usedJobIds = new Map();
        this.cacheMetadata = {
            lastUpdated: null,
            placeId: PLACE_ID,
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
    }
    
    loadUsedIds() {
        try {
            if (fs.existsSync(USED_IDS_FILE)) {
                const data = fs.readFileSync(USED_IDS_FILE, 'utf8');
                const parsed = JSON.parse(data);
                
                if (Array.isArray(parsed)) {
                    const now = Date.now();
                    let loaded = 0;
                    let expired = 0;
                    
                    parsed.forEach(item => {
                        if (typeof item === 'string') {
                            this.usedJobIds.set(item.trim(), now);
                            loaded++;
                        } else if (item && typeof item === 'object' && item.id) {
                            const age = now - (item.timestamp || 0);
                            if (age < BLACKLIST_CLEANUP_AGE_MS) {
                                this.usedJobIds.set(String(item.id).trim(), item.timestamp || now);
                                loaded++;
                            } else {
                                expired++;
                            }
                        }
                    });
                    
                    console.log(`[Cache] Loaded ${loaded} used job IDs from blacklist${expired > 0 ? ` (${expired} expired)` : ''}`);
                }
            }
        } catch (error) {
            console.error('[Cache] Failed to load used IDs:', error.message);
        }
    }
    
    saveUsedIds() {
        try {
            const now = Date.now();
            const idsArray = Array.from(this.usedJobIds.entries()).map(([id, timestamp]) => ({
                id: id,
                timestamp: timestamp || now
            }));
            fs.writeFileSync(USED_IDS_FILE, JSON.stringify(idsArray, null, 2));
        } catch (error) {
            console.error('[Cache] Failed to save used IDs:', error.message);
        }
    }
    
    cleanupBlacklist() {
        const now = Date.now();
        let removed = 0;
        
        for (const [id, timestamp] of this.usedJobIds.entries()) {
            const age = now - (timestamp || 0);
            if (age > BLACKLIST_CLEANUP_AGE_MS) {
                this.usedJobIds.delete(id);
                removed++;
            }
        }
        
        if (removed > 0) {
            console.log(`[Cache] Cleaned ${removed} expired blacklist entries`);
            this.saveUsedIds();
        }
    }
    
    loadCache() {
        try {
            this.loadUsedIds();
            
            if (fs.existsSync(CACHE_FILE)) {
                const data = fs.readFileSync(CACHE_FILE, 'utf8');
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
                        if (age > JOB_ID_MAX_AGE_MS) {
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
                    
                    console.log(`[Cache] Loaded ${loaded} servers (skipped ${skippedUsed} blacklisted, ${skippedInvalid} invalid/expired)`);
                    
                    if (skippedUsed > 0) {
                        this.saveCache(false);
                    }
                    
                    return true;
                }
            }
        } catch (error) {
            console.error('[Cache] Failed to load cache:', error.message);
        }
        return false;
    }
    
    saveCache(shouldClean = false) {
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
            
            if (idsToRemove.length > 0) {
                console.log(`[Cache] Removed ${idsToRemove.length} blacklisted server(s) before saving`);
            }
            
            const serversArray = Array.from(this.serverMap.values());
            this.cacheMetadata.lastUpdated = new Date().toISOString();
            this.cacheMetadata.totalFetched = serversArray.length;
            
            const cacheData = {
                servers: serversArray,
                metadata: this.cacheMetadata
            };
            
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
            console.log(`[Cache] Saved ${serversArray.length} servers to cache`);
            
            this.state.isSaving = false;
            if (this.state.pendingSave) {
                setImmediate(() => this.saveCache(false));
            }
            return true;
        } catch (error) {
            console.error('[Cache] Failed to save cache:', error.message);
            this.state.isSaving = false;
            if (this.state.pendingSave) {
                setImmediate(() => this.saveCache(false));
            }
            return false;
        }
    }
    
    cleanCache() {
        const now = Date.now();
        let fullCount = 0;
        let invalidCount = 0;
        let expiredCount = 0;
        
        for (const [jobId, server] of this.serverMap.entries()) {
            if (!server || !server.id) {
                this.serverMap.delete(jobId);
                invalidCount++;
                continue;
            }
            
            if (this.usedJobIds.has(server.id) || this.usedJobIds.has(jobId)) {
                this.serverMap.delete(jobId);
                invalidCount++;
                continue;
            }
            
            const age = now - (server.timestamp || 0);
            if (age > JOB_ID_MAX_AGE_MS) {
                this.serverMap.delete(jobId);
                expiredCount++;
                continue;
            }
            
            const players = server.players || 0;
            const maxPlayers = server.maxPlayers || 8;
            if (players >= maxPlayers || players < 0 || players > maxPlayers) {
                this.serverMap.delete(jobId);
                fullCount++;
                continue;
            }
        }
        
        if (fullCount > 0 || invalidCount > 0 || expiredCount > 0) {
            console.log(`[Cache] Cleaned: ${fullCount} full, ${invalidCount} invalid, ${expiredCount} expired servers removed`);
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
            this.saveUsedIds();
            this.stats.totalBlacklisted += added;
            this.stats.totalRemoved += removed;
            console.log(`[Cache] Marked ${added} job ID(s) as used (removed ${removed} from cache, total blacklisted: ${this.usedJobIds.size})`);
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
        let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=${sortOrder}&limit=100&excludeFullGames=true`;
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
                    const backoffDelay = Math.min(15000 * Math.pow(2, retryCount), 120000);
                    console.log(`[Fetch] Rate limited, waiting ${backoffDelay}ms before retry ${retryCount + 1}/5`);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    return this.fetchPage(cursor, retryCount + 1, sortOrder);
                }
            }
            
            if (error.message.includes('timeout') && retryCount < 3) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.fetchPage(cursor, retryCount + 1, sortOrder);
            }
            
            if (retryCount < 2 && !error.message.includes('429')) {
                await new Promise(resolve => setTimeout(resolve, 2000));
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
            console.log('[Fetch] Already fetching, skipping...');
            return { total: this.serverMap.size, added: 0, scanned: 0 };
        }
        
        const startTime = Date.now();
        this.state.isFetching = true;
        this.state.lastFetchTime = startTime;
        
        console.log(`[Fetch] Starting bulk fetch: target ${MAX_JOB_IDS} servers, up to ${PAGES_TO_FETCH} pages`);
        
        let pagesFetched = 0;
        let totalAdded = 0;
        let totalScanned = 0;
        let lastSaveCount = 0;
        
        for (const [jobId, server] of this.serverMap.entries()) {
            if (this.usedJobIds.has(jobId)) {
                this.serverMap.delete(jobId);
            }
        }
        
        console.log(`[Fetch] Starting with ${this.serverMap.size} cached servers`);
        
        let cursor = null;
        let consecutiveEmptyPages = 0;
        let consecutiveErrors = 0;
        
        while (pagesFetched < PAGES_TO_FETCH && this.serverMap.size < MAX_JOB_IDS) {
            if (pagesFetched > 0) {
                const delay = this.serverMap.size < 500 ? 1000 : 
                             (pagesFetched % 5 === 0 ? DELAY_BETWEEN_REQUESTS : 1200);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            const sortOrder = pagesFetched % 10 < 7 ? 'Desc' : 'Asc';
            const data = await this.fetchPage(cursor, 0, sortOrder);
            
            if (!data || !data.data || data.data.length === 0) {
                consecutiveEmptyPages++;
                consecutiveErrors++;
                cursor = data && data.nextPageCursor ? data.nextPageCursor : null;
                
                if (!cursor || consecutiveEmptyPages >= 5 || consecutiveErrors >= 10) {
                    console.log(`[Fetch] Stopping: empty pages=${consecutiveEmptyPages}, errors=${consecutiveErrors}`);
                    break;
                }
                pagesFetched++;
                continue;
            }
            
            consecutiveEmptyPages = 0;
            consecutiveErrors = 0;
            
            let pageAdded = 0;
            const now = Date.now();
            
            for (const server of data.data) {
                totalScanned++;
                const jobId = server.id;
                const players = server.playing || 0;
                const maxPlayers = server.maxPlayers || 6;
                
                if (!jobId || this.usedJobIds.has(jobId) || this.serverMap.has(jobId)) {
                    continue;
                }
                
                if (players < MIN_PLAYERS) {
                    continue;
                }
                
                const isPrivateServer = (server.accessCode !== null && server.accessCode !== undefined) ||
                                       (server.PrivateServerId !== null && server.PrivateServerId !== undefined) ||
                                       (server.privateServerId !== null && server.privateServerId !== undefined);
                
                if (isPrivateServer || players >= maxPlayers || players < 0) {
                    continue;
                }
                
                const priority = this.calculatePriority(players, maxPlayers);
                
                const existingServer = this.serverMap.get(jobId);
                if (existingServer) {
                    existingServer.players = players;
                    existingServer.maxPlayers = maxPlayers;
                    existingServer.priority = priority;
                    existingServer.timestamp = now;
                    existingServer.fetchCount = (existingServer.fetchCount || 0) + 1;
                } else {
                    this.serverMap.set(jobId, {
                        id: jobId,
                        timestamp: now,
                        players: players,
                        maxPlayers: maxPlayers,
                        priority: priority,
                        fetchCount: 1
                    });
                    pageAdded++;
                    totalAdded++;
                }
            }
            
            pagesFetched++;
            
            if (pageAdded > 0 || pagesFetched % 10 === 0) {
                console.log(`[Fetch] Page ${pagesFetched}: +${pageAdded} servers (total: ${this.serverMap.size}/${MAX_JOB_IDS})`);
            }
            
            if (this.serverMap.size - lastSaveCount >= 150) {
                this.saveCache(false);
                lastSaveCount = this.serverMap.size;
            }
            
            cursor = data.nextPageCursor;
            
            if (!cursor || (this.serverMap.size >= MAX_JOB_IDS && pagesFetched >= 50)) {
                break;
            }
            
            if (pageAdded === 0 && this.serverMap.size >= 500 && pagesFetched >= 30) {
                console.log(`[Fetch] Stopping early - cache has ${this.serverMap.size} servers and no new servers found`);
                break;
            }
        }
        
        const duration = Date.now() - startTime;
        this.cacheMetadata.totalFetched = this.serverMap.size;
        this.cacheMetadata.fetchCount = (this.cacheMetadata.fetchCount || 0) + 1;
        this.cacheMetadata.lastFetchDuration = duration;
        
        this.stats.totalFetched += totalScanned;
        this.stats.totalAdded += totalAdded;
        
        console.log(`[Fetch] Complete: ${this.serverMap.size}/${MAX_JOB_IDS} servers cached (added ${totalAdded}, scanned ${totalScanned}) in ${duration}ms`);
        
        this.state.isFetching = false;
        
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
        
        const blacklistedToRemove = [];
        for (const [mapId, server] of this.serverMap.entries()) {
            if (!server || !server.id) {
                blacklistedToRemove.push(mapId);
                continue;
            }
            
            if (this.usedJobIds.has(server.id) || this.usedJobIds.has(mapId)) {
                blacklistedToRemove.push(mapId);
            }
        }
        
        for (const id of blacklistedToRemove) {
            this.serverMap.delete(id);
        }
        
        const validServers = [];
        const now = Date.now();
        
        for (const [jobId, server] of this.serverMap.entries()) {
            if (!server || !server.id) continue;
            
            const serverId = String(server.id).trim();
            const serverIdLower = serverId.toLowerCase();
            
            if (excludeSet.has(serverIdLower) || this.usedJobIds.has(serverId) || this.usedJobIds.has(jobId)) {
                continue;
            }
            
            const age = now - (server.timestamp || 0);
            if (age > JOB_ID_MAX_AGE_MS) {
                continue;
            }
            
            const players = server.players || 0;
            const maxPlayers = server.maxPlayers || 8;
            if (players >= maxPlayers || players < 0) {
                continue;
            }
            
            validServers.push(server);
        }
        
        validServers.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            if (a.players !== b.players) {
                return b.players - a.players;
            }
            return (b.timestamp || 0) - (a.timestamp || 0);
        });
        
        this.stats.cacheHits++;
        
        return validServers.slice(0, limit).map(server => ({
            id: server.id,
            players: server.players,
            maxPlayers: server.maxPlayers,
            timestamp: server.timestamp,
            priority: server.priority
        }));
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
}

const jobIdFetcher = new JobIdFetcher();

jobIdFetcher.loadUsedIds();
jobIdFetcher.loadCache();

setInterval(() => {
    jobIdFetcher.cleanupBlacklist();
}, 3600000);

if (require.main === module) {
    (async () => {
        const result = await jobIdFetcher.fetchBulkJobIds();
        if (!jobIdFetcher.saveCache()) {
            console.error('[Error] Failed to save cache!');
            process.exit(1);
        }
    })().catch(error => {
        console.error('[Fatal Error]', error);
        process.exit(1);
    });
}

module.exports = jobIdFetcher;
