const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACE_ID = parseInt(process.env.PLACE_ID, 10) || 109983668079237;
const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const MAX_JOB_IDS = parseInt(process.env.MAX_JOB_IDS || '2000', 10);
const PAGES_TO_FETCH = parseInt(process.env.PAGES_TO_FETCH || '200', 10);
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_BETWEEN_REQUESTS || '2000', 10);
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '1', 10);
const JOB_ID_MAX_AGE_MS = parseInt(process.env.JOB_ID_MAX_AGE_MS || '180000', 10);
const CACHE_CLEANUP_MAX_AGE_MS = parseInt(process.env.CACHE_CLEANUP_MAX_AGE_MS || '600000', 10);
let jobIdCache = {
    jobIds: [],
    lastUpdated: null,
    placeId: PLACE_ID,
    totalFetched: 0
};

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (parsed && Array.isArray(parsed.jobIds)) {
                jobIdCache = parsed;
                console.log(`[Cache] Loaded ${jobIdCache.jobIds.length} servers`);
                return true;
            } else {
                jobIdCache = {
                    jobIds: [],
                    lastUpdated: null,
                    placeId: PLACE_ID,
                    totalFetched: 0
                };
            }
        }
    } catch (error) {
        console.error('[Cache] Failed to load cache:', error.message);
        jobIdCache = {
            jobIds: [],
            lastUpdated: null,
            placeId: PLACE_ID,
            totalFetched: 0
        };
    }
    return false;
}

function cleanCache() {
    if (Array.isArray(jobIdCache.jobIds)) {
        const originalLength = jobIdCache.jobIds.length;
        const now = Date.now();
        let expiredCount = 0;
        let fullCount = 0;
        let invalidCount = 0;
        
        jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
            if (typeof item === 'string' || typeof item === 'number') {
                if (item === null || item === undefined || item === '' || String(item).trim() === '') {
                    invalidCount++;
                    return false;
                }
                return true;
            }
            if (typeof item === 'object' && item !== null) {
                if (!item.id || item.id === null || item.id === undefined || String(item.id).trim() === '') {
                    invalidCount++;
                    return false;
                }
                const timestamp = item.timestamp;
                if (timestamp === undefined || timestamp === null) {
                    invalidCount++;
                    return false;
                }
                if (typeof timestamp === 'number' && (isNaN(timestamp) || timestamp <= 0)) {
                    invalidCount++;
                    return false;
                }
                const age = now - (timestamp || 0);
                if (age >= CACHE_CLEANUP_MAX_AGE_MS) {
                    expiredCount++;
                    return false;
                }
                const players = item.players || 0;
                const maxPlayers = item.maxPlayers || 8;
                if (players >= maxPlayers) {
                    fullCount++;
                    return false;
                }
                if (players < 0 || players > maxPlayers) {
                    invalidCount++;
                    return false;
                }
                
                return true;
            }
            invalidCount++;
            return false;
        });
        
        if (expiredCount > 0 || fullCount > 0 || invalidCount > 0) {
            console.log(`[Cache] Cleaned: ${expiredCount} expired, ${fullCount} full, ${invalidCount} invalid servers removed`);
        }
    }
}

function saveCache(shouldClean) {
    try {
        if (shouldClean) {
            cleanCache();
        }
        jobIdCache.lastUpdated = new Date().toISOString();
        fs.writeFileSync(CACHE_FILE, JSON.stringify(jobIdCache, null, 2));
        console.log(`[Cache] Saved ${jobIdCache.jobIds.length} servers to cache`);
        return true;
    } catch (error) {
        console.error('[Cache] Failed to save cache:', error.message);
        return false;
    }
}

function makeRequest(url) {
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
        
        request.setTimeout(20000, () => {
            request.destroy();
            reject(new Error('Request timeout after 20 seconds'));
        });
        
        request.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });
    });
}

async function fetchPage(cursor = null, retryCount = 0, sortOrder = 'Desc') {
    let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=${sortOrder}&limit=100&excludeFullGames=true`;
    if (cursor) {
        url += `&cursor=${cursor}`;
    }
    
    try {
        const data = await makeRequest(url);
        return data;
    } catch (error) {
        if (error.message.includes('429') || error.message.includes('Rate limited')) {
            if (retryCount < 3) {
                const backoffDelay = Math.min(10000 * Math.pow(2, retryCount), 60000);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                return fetchPage(cursor, retryCount + 1);
            } else {
                return null;
            }
        }
        if (error.message.includes('timeout')) {
            if (retryCount < 2) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return fetchPage(cursor, retryCount + 1);
            }
        }
        return null;
    }
}

async function fetchBulkJobIds() {
    console.log(`[Fetch] Starting bulk fetch: target ${MAX_JOB_IDS} servers, up to ${PAGES_TO_FETCH} pages`);
    
    const now = Date.now();
    const maxAge = JOB_ID_MAX_AGE_MS;
    const beforeCleanup = jobIdCache.jobIds.length;
    const existingValidIds = new Set();
    
    const validExistingServers = jobIdCache.jobIds.filter(item => {
        let id;
        if (typeof item === 'string' || typeof item === 'number') {
            id = String(item);
        } else if (typeof item === 'object' && item !== null && item.id) {
            const age = now - (item.timestamp || 0);
            if (age >= maxAge) return false;
            id = String(item.id);
        } else {
            return false;
        }
        if (existingValidIds.has(id)) return false;
        existingValidIds.add(id);
        return true;
    });
    
    const expiredCount = beforeCleanup - validExistingServers.length;
    if (expiredCount > 0) {
        console.log(`[Fetch] Removed ${expiredCount} expired servers from cache`);
    }
    console.log(`[Fetch] Starting with ${validExistingServers.length} valid cached servers`);
    jobIdCache.jobIds = [...validExistingServers];
    const existingJobIds = new Set(existingValidIds);
    let cursor = null;
    let pagesFetched = 0;
    let totalAdded = 0;
    let totalScanned = 0;
    let totalFiltered = 0;
    let lastSaveCount = 0;
    
    while (pagesFetched < PAGES_TO_FETCH && jobIdCache.jobIds.length < MAX_JOB_IDS) {
        if (pagesFetched > 0) {
            const delay = pagesFetched % 3 === 0 ? DELAY_BETWEEN_REQUESTS : 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        let data;
        try {
            const sortOrder = pagesFetched % 10 < 7 ? 'Desc' : 'Asc';
            data = await fetchPage(cursor, 0, sortOrder);
        } catch (error) {
            if (error.message.includes('429') || error.message.includes('Too many requests')) {
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
            pagesFetched++;
            continue;
        }
        
        if (!data || !data.data || data.data.length === 0) {
            cursor = data && data.nextPageCursor ? data.nextPageCursor : null;
            if (!cursor) break;
            pagesFetched++;
            continue;
        }
        
        let pageAdded = 0;
        let pageFiltered = 0;
        let filterStats = { full: 0, private: 0, invalid: 0, duplicate: 0, tooMany: 0, lowPlayers: 0 };
        
        for (const server of data.data) {
            totalScanned++;
            const jobId = server.id;
            const players = server.playing || 0;
            const maxPlayers = server.maxPlayers || 6;
            
            const isPrivateServer = (server.accessCode !== null && server.accessCode !== undefined) ||
                                   (server.PrivateServerId !== null && server.PrivateServerId !== undefined) ||
                                   (server.privateServerId !== null && server.privateServerId !== undefined);
            
            if (!jobId || existingJobIds.has(jobId) || jobIdCache.jobIds.length >= MAX_JOB_IDS) {
                if (!jobId) filterStats.invalid++;
                else if (existingJobIds.has(jobId)) filterStats.duplicate++;
                else filterStats.tooMany++;
                pageFiltered++;
                continue;
            }
            
            if (players >= maxPlayers || isPrivateServer || (players > 0 && players < MIN_PLAYERS)) {
                if (players >= maxPlayers) filterStats.full++;
                else if (isPrivateServer) filterStats.private++;
                else filterStats.lowPlayers++;
                pageFiltered++;
                continue;
            }
            
            if (players < maxPlayers && players >= 0 && (players === 0 || players >= MIN_PLAYERS) && !isPrivateServer) {
                const isAlmostFull = players >= (maxPlayers - 1) && players < maxPlayers;
                const isNearFull = players >= (maxPlayers - 2) && players < (maxPlayers - 1);
                const priority = isAlmostFull ? 3 : (isNearFull ? 2 : (players > 0 ? 1 : 0));
                
                jobIdCache.jobIds.push({
                    id: jobId,
                    timestamp: Date.now(),
                    players: players,
                    maxPlayers: maxPlayers,
                    priority: priority
                });
                existingJobIds.add(jobId);
                pageAdded++;
                totalAdded++;
            }
        }
        
        pagesFetched++;
        
        if (pagesFetched % 10 === 0 || pageAdded > 0) {
            const filterDetails = [];
            if (filterStats.full > 0) filterDetails.push(`${filterStats.full} full`);
            if (filterStats.private > 0) filterDetails.push(`${filterStats.private} private`);
            if (filterStats.duplicate > 0) filterDetails.push(`${filterStats.duplicate} duplicate`);
            const filterSummary = filterDetails.length > 0 ? ` (filtered: ${filterDetails.join(', ')})` : '';
            console.log(`[Fetch] Page ${pagesFetched}: +${pageAdded} servers (total: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS})${filterSummary}`);
        }
        
        const currentCount = jobIdCache.jobIds.length;
        if (currentCount - lastSaveCount >= 100) {
            console.log(`[Cache] Saving cache: ${currentCount} servers (incremental save every 100)`);
            try {
                jobIdCache.lastUpdated = new Date().toISOString();
                jobIdCache.totalFetched = currentCount;
                fs.writeFileSync(CACHE_FILE, JSON.stringify(jobIdCache, null, 2));
                console.log(`[Cache] Saved ${currentCount} servers to cache`);
                lastSaveCount = currentCount;
            } catch (saveError) {
                console.error(`[Cache] Failed to save cache incrementally: ${saveError.message}`);
            }
        }
        
        cursor = data.nextPageCursor;
        
        if (!cursor) {
            break;
        }
        
        if (jobIdCache.jobIds.length >= MAX_JOB_IDS && pagesFetched >= 50) {
            break;
        }
        
        filterStats = { full: 0, private: 0, invalid: 0, duplicate: 0, tooMany: 0, lowPlayers: 0 };
    }
    
    jobIdCache.jobIds.sort((a, b) => {
        const aObj = typeof a === 'object' && a !== null ? a : null;
        const bObj = typeof b === 'object' && b !== null ? b : null;
        const aPriority = aObj ? (aObj.priority || 0) : 0;
        const bPriority = bObj ? (bObj.priority || 0) : 0;
        if (aPriority !== bPriority) return bPriority - aPriority;
        
        const aPlayers = aObj ? (aObj.players || 0) : 0;
        const bPlayers = bObj ? (bObj.players || 0) : 0;
        if (aPlayers !== bPlayers) return bPlayers - aPlayers;
        
        const tsA = aObj ? (aObj.timestamp || 0) : Date.now();
        const tsB = bObj ? (bObj.timestamp || 0) : Date.now();
        return tsB - tsA;
    });
    
    if (jobIdCache.jobIds.length > MAX_JOB_IDS) {
        jobIdCache.jobIds = jobIdCache.jobIds.slice(0, MAX_JOB_IDS);
    }
    
    jobIdCache.totalFetched = jobIdCache.jobIds.length;
    
    const keptFromOld = validExistingServers.length;
    console.log(`[Fetch] Complete: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS} servers cached (kept ${keptFromOld}, added ${totalAdded}, scanned ${totalScanned})`);
    
    return {
        total: jobIdCache.jobIds.length,
        added: totalAdded,
        filtered: totalFiltered,
        scanned: totalScanned
    };
}

async function main() {
    loadCache();
    
    const result = await fetchBulkJobIds();
    
    if (!saveCache()) {
        console.error('[Error] Failed to save cache!');
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('[Fatal Error]', error);
        process.exit(1);
    });
}

module.exports = {
    fetchBulkJobIds,
    loadCache,
    saveCache,
    cleanCache,
    getJobIds: () => {
        try {
            const ids = jobIdCache.jobIds || [];
            return ids.map(item => {
                if (typeof item === 'string' || typeof item === 'number') return item;
                if (typeof item === 'object' && item !== null && item.id) return item.id;
                return item;
            });
        } catch (error) {
            console.error('[Cache] Error getting job IDs:', error.message);
            return [];
        }
    },
    getFreshestJobIds: (limit = 1000) => {
        try {
            const ids = jobIdCache.jobIds || [];
            const now = Date.now();
            const maxAge = JOB_ID_MAX_AGE_MS;
            
            const sorted = ids
                .filter(item => {
                    if (typeof item === 'string' || typeof item === 'number') {
                        return true;
                    }
                    if (typeof item === 'object' && item !== null && item.id) {
                        const age = now - (item.timestamp || 0);
                        return age < maxAge;
                    }
                    return false;
                })
                .sort((a, b) => {
                    const tsA = typeof a === 'object' ? (a.timestamp || 0) : Date.now();
                    const tsB = typeof b === 'object' ? (b.timestamp || 0) : Date.now();
                    return tsB - tsA;
                })
                .slice(0, limit)
                .map(item => typeof item === 'object' ? item.id : item);
            
            const beforeCleanup = jobIdCache.jobIds.length;
            jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
                if (typeof item === 'string' || typeof item === 'number') return true;
                if (typeof item === 'object' && item !== null) {
                    const age = now - (item.timestamp || 0);
                    return age < maxAge;
                }
                return false;
            });
            
            
            return sorted;
        } catch (error) {
            console.error('[Cache] Error getting freshest job IDs:', error.message);
            return [];
        }
    },
    getFreshestServers: (limit = 2000) => {
        try {
            const ids = jobIdCache.jobIds || [];
            const now = Date.now();
            const maxAge = JOB_ID_MAX_AGE_MS;
            
            const valid = ids.filter(item => {
                if (typeof item === 'string' || typeof item === 'number') return true;
                if (typeof item !== 'object' || !item || !item.id) return false;
                
                const age = now - (item.timestamp || 0);
                if (age >= maxAge) return false;
                
                const players = item.players || 0;
                const maxPlayers = item.maxPlayers || 8;
                if (players >= maxPlayers || players < 0 || players > maxPlayers) return false;
                
                const isAlmostFull = players >= (maxPlayers - 1) && players < maxPlayers;
                const isNearFull = players >= (maxPlayers - 2) && players < (maxPlayers - 1);
                if (isAlmostFull && age > 60000) return false;
                if (isNearFull && age > 90000) return false;
                if (age > 180000) return false;
                
                return true;
            });
            
            const sorted = valid
                .sort((a, b) => {
                    const aObj = typeof a === 'object' && a !== null ? a : null;
                    const bObj = typeof b === 'object' && b !== null ? b : null;
                    const aPriority = aObj ? (aObj.priority || 0) : 0;
                    const bPriority = bObj ? (bObj.priority || 0) : 0;
                    if (aPriority !== bPriority) return bPriority - aPriority;
                    
                    const aPlayers = aObj ? (aObj.players || 0) : 0;
                    const bPlayers = bObj ? (bObj.players || 0) : 0;
                    const aMaxPlayers = aObj ? (aObj.maxPlayers || 8) : 8;
                    const bMaxPlayers = bObj ? (bObj.maxPlayers || 8) : 8;
                    
                    const aAlmostFull = aPlayers >= (aMaxPlayers - 1) && aPlayers < aMaxPlayers;
                    const bAlmostFull = bPlayers >= (bMaxPlayers - 1) && bPlayers < bMaxPlayers;
                    const aNearFull = aPlayers >= (aMaxPlayers - 2) && aPlayers < (aMaxPlayers - 1);
                    const bNearFull = bPlayers >= (bMaxPlayers - 2) && bPlayers < (bMaxPlayers - 1);
                    
                    if (aAlmostFull && !bAlmostFull) return -1;
                    if (!aAlmostFull && bAlmostFull) return 1;
                    if (aNearFull && !bNearFull && !bAlmostFull) return -1;
                    if (!aNearFull && bNearFull && !aAlmostFull) return 1;
                    if (aPlayers !== bPlayers) return bPlayers - aPlayers;
                    
                    const tsA = aObj ? (aObj.timestamp || 0) : Date.now();
                    const tsB = bObj ? (bObj.timestamp || 0) : Date.now();
                    return (now - tsA) - (now - tsB);
                })
                .slice(0, limit)
                .map(item => {
                    if (typeof item === 'object' && item !== null) {
                        const players = item.players || 0;
                        const maxPlayers = item.maxPlayers || 8;
                        return {
                            id: item.id.toString(),
                            players: players,
                            maxPlayers: maxPlayers,
                            timestamp: item.timestamp || Date.now(),
                            isAlmostFull: players >= (maxPlayers - 1) && players < maxPlayers,
                            isNearFull: players >= (maxPlayers - 2) && players < (maxPlayers - 1),
                            priority: item.priority || (players >= (maxPlayers - 1) ? 3 : (players >= (maxPlayers - 2) ? 2 : (players > 0 ? 1 : 0)))
                        };
                    }
                    return {
                        id: item.toString(),
                        players: 0,
                        maxPlayers: 8,
                        timestamp: Date.now(),
                        isAlmostFull: false
                    };
                });
            
            jobIdCache.jobIds = valid;
            if (sorted.length > 0) {
                console.log(`[Cache] getFreshestServers: Returning ${sorted.length} servers (first 5: ${sorted.slice(0, 5).map(s => s.id).join(', ')})`);
            }
            return sorted;
        } catch (error) {
            console.error('[Cache] Error getting freshest servers:', error.message);
            return [];
        }
    },
    getCacheInfo: () => {
        try {
            return {
                count: (jobIdCache.jobIds || []).length,
                lastUpdated: jobIdCache.lastUpdated || null,
                placeId: jobIdCache.placeId || PLACE_ID
            };
        } catch (error) {
            console.error('[Cache] Error getting cache info:', error.message);
            return {
                count: 0,
                lastUpdated: null,
                placeId: PLACE_ID
            };
        }
    },
    removeVisitedServers: (visitedIds) => {
        try {
            if (!Array.isArray(visitedIds) || visitedIds.length === 0) return 0;
            const visitedSet = new Set(visitedIds.map(id => String(id)));
            const beforeCount = jobIdCache.jobIds.length;
            
            jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
                const itemId = typeof item === 'object' && item !== null ? String(item.id) : String(item);
                return !visitedSet.has(itemId);
            });
            
            const removed = beforeCount - jobIdCache.jobIds.length;
            if (removed > 0) {
                console.log(`[Cache] Removed ${removed} visited server(s) from cache`);
            }
            return removed;
        } catch (error) {
            console.error('[Cache] Error removing visited servers:', error.message);
            return 0;
        }
    },
    markServerAsFull: (serverId) => {
        try {
            if (!serverId) return false;
            const serverIdStr = String(serverId);
            const beforeCount = jobIdCache.jobIds.length;
            
            jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
                const itemId = typeof item === 'object' && item !== null ? String(item.id) : String(item);
                if (itemId === serverIdStr) {
                    const players = typeof item === 'object' && item !== null ? (item.players || 0) : 0;
                    const maxPlayers = typeof item === 'object' && item !== null ? (item.maxPlayers || 8) : 8;
                    if (players >= maxPlayers) {
                        return false;
                    }
                }
                return true;
            });
            
            return beforeCount !== jobIdCache.jobIds.length;
        } catch (error) {
            console.error('[Cache] Error marking server as full:', error.message);
            return false;
        }
    }
};
