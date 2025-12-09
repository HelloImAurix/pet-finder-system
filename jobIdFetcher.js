const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACE_ID = parseInt(process.env.PLACE_ID, 10) || 109983668079237;
const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const USED_IDS_FILE = path.join(__dirname, 'used_job_ids.json');
const MAX_JOB_IDS = parseInt(process.env.MAX_JOB_IDS || '2000', 10);
const PAGES_TO_FETCH = parseInt(process.env.PAGES_TO_FETCH || '200', 10);
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_BETWEEN_REQUESTS || '2000', 10);
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '1', 10);
const JOB_ID_MAX_AGE_MS = parseInt(process.env.JOB_ID_MAX_AGE_MS || '180000', 10);
const CACHE_CLEANUP_MAX_AGE_MS = parseInt(process.env.CACHE_CLEANUP_MAX_AGE_MS || '600000', 10);

// Server data structure: Map<jobId, serverData>
const serverMap = new Map();
// Used job IDs: Set<jobId> - persistent blacklist
const usedJobIds = new Set();
// Cache metadata
let cacheMetadata = {
    lastUpdated: null,
    placeId: PLACE_ID,
    totalFetched: 0
};

let isSaving = false;
let pendingSave = false;

// Load used job IDs from persistent storage
function loadUsedIds() {
    try {
        if (fs.existsSync(USED_IDS_FILE)) {
            const data = fs.readFileSync(USED_IDS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                parsed.forEach(id => {
                    if (id && typeof id === 'string') {
                        usedJobIds.add(id.trim());
                    }
                });
                console.log(`[Cache] Loaded ${usedJobIds.size} used job IDs from blacklist`);
            }
        }
    } catch (error) {
        console.error('[Cache] Failed to load used IDs:', error.message);
    }
}

// Save used job IDs to persistent storage
function saveUsedIds() {
    try {
        const idsArray = Array.from(usedJobIds);
        fs.writeFileSync(USED_IDS_FILE, JSON.stringify(idsArray, null, 2));
    } catch (error) {
        console.error('[Cache] Failed to save used IDs:', error.message);
    }
}

// Load cache from file
function loadCache() {
    try {
        // Load used IDs first so we can filter them out
        loadUsedIds();
        
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            const parsed = JSON.parse(data);
            
            if (parsed && parsed.servers && Array.isArray(parsed.servers)) {
                serverMap.clear();
                let loaded = 0;
                let skippedUsed = 0;
                
                for (const server of parsed.servers) {
                    if (!server || !server.id) continue;
                    const jobId = String(server.id).trim();
                    if (!jobId) continue;
                    
                    // Skip if already blacklisted
                    if (usedJobIds.has(jobId)) {
                        skippedUsed++;
                        continue;
                    }
                    
                    serverMap.set(jobId, {
                        id: jobId,
                        timestamp: server.timestamp || Date.now(),
                        players: server.players || 0,
                        maxPlayers: server.maxPlayers || 8,
                        priority: server.priority || 0
                    });
                    loaded++;
                }
                
                if (parsed.metadata) {
                    cacheMetadata = { ...cacheMetadata, ...parsed.metadata };
                }
                
                const skippedTotal = parsed.servers.length - loaded;
                if (skippedUsed > 0) {
                    console.log(`[Cache] Loaded ${loaded} servers (skipped ${skippedTotal} used/invalid, ${skippedUsed} blacklisted)`);
                } else {
                    console.log(`[Cache] Loaded ${loaded} servers (skipped ${skippedTotal} invalid)`);
                }
                
                // Save cache immediately to remove blacklisted IDs from file
                if (skippedUsed > 0) {
                    saveCache(false);
                }
                
                return true;
            }
        }
    } catch (error) {
        console.error('[Cache] Failed to load cache:', error.message);
    }
    return false;
}

// Save cache to file
function saveCache(shouldClean = false) {
    if (isSaving) {
        pendingSave = true;
        return false;
    }
    
    try {
        isSaving = true;
        pendingSave = false;
        
        if (shouldClean) {
            cleanCache();
        }
        
        // Remove used job IDs from cache before saving
        // Check both exact match and normalized versions
        const idsToRemove = [];
        for (const [mapId, server] of serverMap.entries()) {
            const mapIdStr = String(mapId).trim().toLowerCase();
            const serverIdStr = server && server.id ? String(server.id).trim().toLowerCase() : mapIdStr;
            
            for (const usedId of usedJobIds) {
                const usedIdStr = String(usedId).trim().toLowerCase();
                if (mapIdStr === usedIdStr || serverIdStr === usedIdStr) {
                    idsToRemove.push(mapId);
                    break;
                }
            }
        }
        
        for (const id of idsToRemove) {
            serverMap.delete(id);
        }
        
        if (idsToRemove.length > 0) {
            console.log(`[Cache] Removed ${idsToRemove.length} blacklisted server(s) before saving`);
        }
        
        const serversArray = Array.from(serverMap.values());
        cacheMetadata.lastUpdated = new Date().toISOString();
        cacheMetadata.totalFetched = serversArray.length;
        
        const cacheData = {
            servers: serversArray,
            metadata: cacheMetadata
        };
        
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
        console.log(`[Cache] Saved ${serversArray.length} servers to cache`);
        
        isSaving = false;
        if (pendingSave) {
            setImmediate(() => saveCache(false));
        }
        return true;
    } catch (error) {
        console.error('[Cache] Failed to save cache:', error.message);
        isSaving = false;
        if (pendingSave) {
            setImmediate(() => saveCache(false));
        }
        return false;
    }
}

// Clean cache: remove expired, full, and invalid servers
function cleanCache() {
    const now = Date.now();
    let expiredCount = 0;
    let fullCount = 0;
    let invalidCount = 0;
    
    for (const [jobId, server] of serverMap.entries()) {
        if (!server || !server.id || usedJobIds.has(jobId)) {
            serverMap.delete(jobId);
            invalidCount++;
            continue;
        }
        
        const age = now - (server.timestamp || 0);
        if (age >= CACHE_CLEANUP_MAX_AGE_MS) {
            serverMap.delete(jobId);
            expiredCount++;
            continue;
        }
        
        const players = server.players || 0;
        const maxPlayers = server.maxPlayers || 8;
        if (players >= maxPlayers || players < 0 || players > maxPlayers) {
            serverMap.delete(jobId);
            fullCount++;
            continue;
        }
    }
    
    if (expiredCount > 0 || fullCount > 0 || invalidCount > 0) {
        console.log(`[Cache] Cleaned: ${expiredCount} expired, ${fullCount} full, ${invalidCount} invalid servers removed`);
    }
}

// Mark job IDs as used (add to blacklist)
function markAsUsed(jobIds) {
    if (!Array.isArray(jobIds) || jobIds.length === 0) return 0;
    
    let added = 0;
    let removed = 0;
    for (const jobId of jobIds) {
        const id = String(jobId).trim();
        if (!id) continue;
        
        console.log(`[Cache] markAsUsed: Processing job ID: ${id}`);
        const idNormalized = id.toLowerCase();
        const wasNew = !usedJobIds.has(id);
        if (wasNew) {
            usedJobIds.add(id);
            added++;
            console.log(`[Cache] markAsUsed: Added ${id} to blacklist (new)`);
        } else {
            console.log(`[Cache] markAsUsed: ${id} already in blacklist`);
        }
        
        // Remove from serverMap (check both exact match and case-insensitive)
        // Need to iterate through serverMap to find case-insensitive matches
        const idsToRemove = [];
        for (const [mapId, server] of serverMap.entries()) {
            const mapIdStr = String(mapId).trim().toLowerCase();
            const serverIdStr = server && server.id ? String(server.id).trim().toLowerCase() : mapIdStr;
            
            if (mapIdStr === idNormalized || serverIdStr === idNormalized || mapId === id || (server && server.id === id)) {
                idsToRemove.push(mapId);
                console.log(`[Cache] markAsUsed: Found matching server in cache - mapId: ${mapId}, server.id: ${server ? server.id : 'N/A'}`);
            }
        }
        
        for (const mapId of idsToRemove) {
            serverMap.delete(mapId);
            removed++;
            console.log(`[Cache] markAsUsed: Removed ${mapId} from cache`);
        }
        
        if (idsToRemove.length === 0) {
            console.log(`[Cache] markAsUsed: Job ID ${id} not found in cache (cache size: ${serverMap.size})`);
        }
    }
    
    if (added > 0 || removed > 0) {
        saveUsedIds();
        if (added > 0) {
            console.log(`[Cache] Marked ${added} job ID(s) as used (removed ${removed} from cache, total blacklisted: ${usedJobIds.size})`);
        } else if (removed > 0) {
            console.log(`[Cache] Removed ${removed} already-blacklisted job ID(s) from cache (total blacklisted: ${usedJobIds.size})`);
        }
    }
    
    return added;
}

// Make HTTP request
function makeRequest(url) {
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

// Fetch a single page of servers
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
                return fetchPage(cursor, retryCount + 1, sortOrder);
            }
        }
        if (error.message.includes('timeout') && retryCount < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return fetchPage(cursor, retryCount + 1, sortOrder);
        }
        return null;
    }
}

// Fetch bulk job IDs from Roblox API
async function fetchBulkJobIds() {
    console.log(`[Fetch] Starting bulk fetch: target ${MAX_JOB_IDS} servers, up to ${PAGES_TO_FETCH} pages`);
    
    const now = Date.now();
    const maxAge = JOB_ID_MAX_AGE_MS;
    let pagesFetched = 0;
    let totalAdded = 0;
    let totalScanned = 0;
    let lastSaveCount = 0;
    
    // Clean expired servers first
    for (const [jobId, server] of serverMap.entries()) {
        const age = now - (server.timestamp || 0);
        if (age >= maxAge || usedJobIds.has(jobId)) {
            serverMap.delete(jobId);
        }
    }
    
    console.log(`[Fetch] Starting with ${serverMap.size} valid cached servers`);
    
    let cursor = null;
    while (pagesFetched < PAGES_TO_FETCH && serverMap.size < MAX_JOB_IDS) {
        if (pagesFetched > 0) {
            const delay = pagesFetched % 3 === 0 ? DELAY_BETWEEN_REQUESTS : 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const sortOrder = pagesFetched % 10 < 7 ? 'Desc' : 'Asc';
        const data = await fetchPage(cursor, 0, sortOrder);
        
        if (!data || !data.data || data.data.length === 0) {
            cursor = data && data.nextPageCursor ? data.nextPageCursor : null;
            if (!cursor) break;
            pagesFetched++;
            continue;
        }
        
        let pageAdded = 0;
        for (const server of data.data) {
            totalScanned++;
            const jobId = server.id;
            const players = server.playing || 0;
            const maxPlayers = server.maxPlayers || 6;
            
            if (!jobId || usedJobIds.has(jobId) || serverMap.has(jobId)) {
                continue;
            }
            
            const isPrivateServer = (server.accessCode !== null && server.accessCode !== undefined) ||
                                   (server.PrivateServerId !== null && server.PrivateServerId !== undefined) ||
                                   (server.privateServerId !== null && server.privateServerId !== undefined);
            
            if (players >= maxPlayers || isPrivateServer || (players > 0 && players < MIN_PLAYERS)) {
                continue;
            }
            
            if (players < maxPlayers && players >= 0 && (players === 0 || players >= MIN_PLAYERS) && !isPrivateServer) {
                const isAlmostFull = players >= (maxPlayers - 1) && players < maxPlayers;
                const isNearFull = players >= (maxPlayers - 2) && players < (maxPlayers - 1);
                const priority = isAlmostFull ? 3 : (isNearFull ? 2 : (players > 0 ? 1 : 0));
                
                serverMap.set(jobId, {
                    id: jobId,
                    timestamp: Date.now(),
                    players: players,
                    maxPlayers: maxPlayers,
                    priority: priority
                });
                pageAdded++;
                totalAdded++;
            }
        }
        
        pagesFetched++;
        
        if (pagesFetched % 10 === 0 || pageAdded > 0) {
            console.log(`[Fetch] Page ${pagesFetched}: +${pageAdded} servers (total: ${serverMap.size}/${MAX_JOB_IDS})`);
        }
        
        if (serverMap.size - lastSaveCount >= 100) {
            console.log(`[Cache] Saving cache: ${serverMap.size} servers (incremental save every 100)`);
            saveCache(false);
            lastSaveCount = serverMap.size;
        }
        
        cursor = data.nextPageCursor;
        if (!cursor || (serverMap.size >= MAX_JOB_IDS && pagesFetched >= 50)) {
            break;
        }
    }
    
    cacheMetadata.totalFetched = serverMap.size;
    console.log(`[Fetch] Complete: ${serverMap.size}/${MAX_JOB_IDS} servers cached (added ${totalAdded}, scanned ${totalScanned})`);
    
    return {
        total: serverMap.size,
        added: totalAdded,
        scanned: totalScanned
    };
}

// Get freshest servers (excluding used ones)
function getFreshestServers(limit = 2000, excludeIds = []) {
    const now = Date.now();
    // Use cache cleanup age (10 minutes) instead of job ID max age (3 minutes)
    // This is more lenient and allows servers to be used as long as they're in cache
    const maxValidAge = CACHE_CLEANUP_MAX_AGE_MS;
    
    // Normalize excludeIds to lowercase for comparison (temporary exclusion for this request)
    const excludeSet = new Set();
    for (const id of excludeIds) {
        if (id) {
            const normalized = String(id).trim().toLowerCase();
            excludeSet.add(normalized);
            console.log(`[Cache] getFreshestServers: Excluding job ID: ${id} (normalized: ${normalized})`);
        }
    }
    
    // Normalize all blacklisted IDs to lowercase for comparison (permanent exclusion)
    const normalizedBlacklist = new Set();
    for (const id of usedJobIds) {
        if (id) {
            normalizedBlacklist.add(String(id).trim().toLowerCase());
        }
    }
    
    if (excludeSet.size > 0) {
        console.log(`[Cache] getFreshestServers: Excluding ${excludeSet.size} job IDs from request, ${normalizedBlacklist.size} blacklisted`);
    }
    
    // Remove ONLY permanently blacklisted servers from serverMap (they should not be in cache)
    // DO NOT remove excluded servers - they should stay in cache, just filtered from response
    const blacklistedToRemove = [];
    for (const [mapId, server] of serverMap.entries()) {
        if (!server || !server.id) {
            blacklistedToRemove.push(mapId);
            continue;
        }
        
        const mapIdStr = String(mapId).trim().toLowerCase();
        const serverIdStr = String(server.id).trim().toLowerCase();
        
        // Only remove permanently blacklisted servers, NOT temporarily excluded ones
        if (normalizedBlacklist.has(mapIdStr) || normalizedBlacklist.has(serverIdStr)) {
            blacklistedToRemove.push(mapId);
        }
    }
    
    // Remove only blacklisted servers from map (excluded servers stay in cache)
    for (const id of blacklistedToRemove) {
        serverMap.delete(id);
    }
    
    if (blacklistedToRemove.length > 0) {
        console.log(`[Cache] getFreshestServers: Removed ${blacklistedToRemove.length} blacklisted servers from cache`);
    }
    
    // Combine excludeIds with usedJobIds for filtering (both normalized)
    // Note: excludeIds are temporary (just for this request), usedJobIds are permanent
    const allExcluded = new Set([...normalizedBlacklist, ...excludeSet]);
    
    const validServers = [];
    let filteredOutCount = 0;
    
    for (const [jobId, server] of serverMap.entries()) {
        if (!server || !server.id) {
            filteredOutCount++;
            continue;
        }
        
        const jobIdStr = String(jobId).trim().toLowerCase();
        const serverIdStr = String(server.id).trim().toLowerCase();
        const originalServerId = String(server.id).trim();
        
        // Filter out excluded servers (both blacklisted and request-excluded)
        // But DON'T remove them from cache - they're just filtered for this request
        let isExcluded = false;
        
        // First check: normalized comparison with allExcluded set
        if (allExcluded.has(jobIdStr) || allExcluded.has(serverIdStr)) {
            if (excludeSet.has(jobIdStr) || excludeSet.has(serverIdStr)) {
                // This is a temporarily excluded server - just filter it, don't remove from cache
                console.log(`[Cache] getFreshestServers: Filtering excluded server (normalized match): ${originalServerId}`);
                filteredOutCount++;
                continue;
            } else {
                // This is a blacklisted server - should have been removed above, but filter it just in case
                filteredOutCount++;
                continue;
            }
        }
        
        // Second check: exact match with original IDs (case-sensitive)
        for (const excludeId of excludeIds) {
            const excludeIdStr = String(excludeId).trim();
            const excludeIdNormalized = excludeIdStr.toLowerCase();
            
            // Check all possible matches: original vs original, normalized vs normalized, and cross-comparisons
            if (originalServerId === excludeIdStr || 
                originalServerId.toLowerCase() === excludeIdNormalized ||
                jobIdStr === excludeIdNormalized || 
                serverIdStr === excludeIdNormalized ||
                String(jobId).trim() === excludeIdStr ||
                String(jobId).trim().toLowerCase() === excludeIdNormalized) {
                // Filter it out but keep it in cache
                console.log(`[Cache] getFreshestServers: Filtering excluded server (exact match): ${originalServerId} (excludeId: ${excludeIdStr})`);
                filteredOutCount++;
                isExcluded = true;
                break;
            }
        }
        
        if (isExcluded) {
            continue;
        }
        
        const age = now - (server.timestamp || 0);
        
        // Use a more lenient age check - servers can be up to 10 minutes old
        // The cache cleanup removes servers older than 10 minutes, so anything in cache is still valid
        if (age >= maxValidAge) {
            filteredOutCount++;
            continue;
        }
        
        const players = server.players || 0;
        const maxPlayers = server.maxPlayers || 8;
        if (players >= maxPlayers || players < 0 || players > maxPlayers) {
            filteredOutCount++;
            continue;
        }
        
        // More lenient age checks for almost-full servers
        // Almost full servers: allow up to 5 minutes old
        // Near full servers: allow up to 7 minutes old
        // Other servers: allow up to 10 minutes old (handled above)
        const isAlmostFull = players >= (maxPlayers - 1) && players < maxPlayers;
        const isNearFull = players >= (maxPlayers - 2) && players < (maxPlayers - 1);
        if (isAlmostFull && age > 300000) { // 5 minutes
            filteredOutCount++;
            continue;
        }
        if (isNearFull && age > 420000) { // 7 minutes
            filteredOutCount++;
            continue;
        }
        
        validServers.push(server);
    }
    
    // Sort by priority, then players, then age
    validServers.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        if (a.players !== b.players) return b.players - a.players;
        const aAge = now - (a.timestamp || 0);
        const bAge = now - (b.timestamp || 0);
        return aAge - bAge;
    });
    
    const result = validServers.slice(0, limit).map(server => ({
        id: server.id,
        players: server.players,
        maxPlayers: server.maxPlayers,
        timestamp: server.timestamp,
        isAlmostFull: server.players >= (server.maxPlayers - 1) && server.players < server.maxPlayers,
        isNearFull: server.players >= (server.maxPlayers - 2) && server.players < (server.maxPlayers - 1),
        priority: server.priority
    }));
    
    // Final verification: ensure no excluded IDs are in the result (they should be filtered out above)
    if (excludeSet.size > 0) {
        const excludedInResult = [];
        for (const server of result) {
            const serverId = String(server.id).trim();
            const normalized = serverId.toLowerCase();
            for (const excludeId of excludeIds) {
                const excludeIdStr = String(excludeId).trim();
                const excludeIdNormalized = excludeIdStr.toLowerCase();
                if (serverId === excludeIdStr || normalized === excludeIdNormalized) {
                    excludedInResult.push(serverId);
                    console.error(`[Cache] getFreshestServers: CRITICAL - Excluded ID ${serverId} found in result! This should not happen!`);
                }
            }
        }
        
        // Remove any excluded IDs that somehow got through (safety check)
        if (excludedInResult.length > 0) {
            result = result.filter(s => {
                const serverId = String(s.id).trim();
                const normalized = serverId.toLowerCase();
                for (const excludeId of excludeIds) {
                    const excludeIdStr = String(excludeId).trim();
                    const excludeIdNormalized = excludeIdStr.toLowerCase();
                    if (serverId === excludeIdStr || normalized === excludeIdNormalized) {
                        return false;
                    }
                }
                return true;
            });
            console.error(`[Cache] getFreshestServers: Removed ${excludedInResult.length} excluded IDs from result (safety check)!`);
        }
    }
    
    // Log with accurate counts and breakdown
    const requestExcluded = excludeSet.size;
    const totalBlacklisted = normalizedBlacklist.size;
    const totalInCache = serverMap.size;
    
    if (filteredOutCount > 0 && result.length === 0) {
        console.log(`[Cache] getFreshestServers: WARNING - All ${totalInCache} servers filtered out! (excluded ${requestExcluded}, blacklisted ${totalBlacklisted}, filtered ${filteredOutCount})`);
        console.log(`[Cache] getFreshestServers: Cache size: ${totalInCache}, Max age: ${CACHE_CLEANUP_MAX_AGE_MS}ms (${Math.floor(CACHE_CLEANUP_MAX_AGE_MS / 60000)} minutes)`);
    } else {
        console.log(`[Cache] getFreshestServers: Returning ${result.length} servers (excluded ${requestExcluded} from request, ${totalBlacklisted} blacklisted, ${filteredOutCount} filtered out, ${totalInCache} in cache) (first 5: ${result.slice(0, 5).map(s => s.id).join(', ')})`);
    }
    
    return result;
}

// Initialize: load used IDs and cache
loadUsedIds();
loadCache();

// Main function for standalone execution
async function main() {
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

// Module exports
module.exports = {
    fetchBulkJobIds,
    loadCache,
    saveCache,
    cleanCache,
    getFreshestServers,
    markAsUsed,
    getCacheInfo: () => ({
        count: serverMap.size,
        lastUpdated: cacheMetadata.lastUpdated,
        placeId: cacheMetadata.placeId,
        usedCount: usedJobIds.size
    }),
    removeVisitedServers: (visitedIds) => {
        return markAsUsed(visitedIds);
    },
    markServerAsFull: (serverId) => {
        const id = String(serverId).trim();
        if (id && serverMap.has(id)) {
            const server = serverMap.get(id);
            if (server && server.players >= server.maxPlayers) {
                serverMap.delete(id);
                return true;
            }
        }
        return false;
    }
};

