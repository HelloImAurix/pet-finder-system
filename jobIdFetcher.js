const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACE_ID = parseInt(process.env.PLACE_ID, 10) || 109983668079237;
const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const MAX_JOB_IDS = parseInt(process.env.MAX_JOB_IDS || '1000', 10);
const PAGES_TO_FETCH = parseInt(process.env.PAGES_TO_FETCH || '100', 10); // Fetch many pages to find servers with 7/8 or less
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_BETWEEN_REQUESTS || '6000', 10); // 6 seconds between requests to avoid Roblox rate limits (conservative)
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '1', 10);
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '6', 10); // Exclude full servers (7+ players, max is usually 6)
const JOB_ID_MAX_AGE_MS = parseInt(process.env.JOB_ID_MAX_AGE_MS || '600000', 10); // 10 minutes - Roblox servers expire after inactivity
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
                const originalLength = jobIdCache.jobIds.length;
                cleanCache(); // Clean cache on load to remove any invalid entries
                if (originalLength !== jobIdCache.jobIds.length) {
                    console.log(`[Cache] Cleaned ${originalLength - jobIdCache.jobIds.length} invalid entries on load`);
                }
                console.log(`[Cache] Loaded ${jobIdCache.jobIds.length} job IDs from cache`);
                return true;
            } else {
                console.warn('[Cache] Cache file has invalid structure, resetting...');
                jobIdCache = {
                    jobIds: [],
                    lastUpdated: null,
                    placeId: PLACE_ID,
                    totalFetched: 0
                };
            }
        }
    } catch (error) {
        console.warn('[Cache] Failed to load cache:', error.message);
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
    // Remove any invalid entries, expired job IDs, and full servers
    // Handle both old format (strings) and new format (objects with timestamps)
    if (Array.isArray(jobIdCache.jobIds)) {
        const originalLength = jobIdCache.jobIds.length;
        const now = Date.now();
        const maxAge = JOB_ID_MAX_AGE_MS;
        let expiredCount = 0;
        let fullCount = 0;
        
        jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
            // Check validity
            if (typeof item === 'string' || typeof item === 'number') {
                // Old format - keep for backward compatibility, but consider them potentially stale
                return item !== null && item !== undefined && item !== '';
            }
            if (typeof item === 'object' && item !== null) {
                // New format - check validity and expiration
                if (!item.id || item.id === null || item.id === undefined || item.id === '') {
                    return false;
                }
                // Check if expired
                const age = now - (item.timestamp || 0);
                if (age >= maxAge) {
                    expiredCount++;
                    return false; // Expired
                }
                // CRITICAL: Remove full servers (players >= maxPlayers)
                // This ensures we never serve full servers even if they somehow got cached
                const players = item.players || 0;
                const maxPlayers = item.maxPlayers || 8;
                if (players >= maxPlayers) {
                    fullCount++;
                    return false; // Full server
                }
                return true; // Valid, not expired, and has available slots
            }
            return false;
        });
        
        const removedCount = originalLength - jobIdCache.jobIds.length;
        if (removedCount > 0) {
            const details = [];
            if (expiredCount > 0) details.push(`${expiredCount} expired`);
            if (fullCount > 0) details.push(`${fullCount} full`);
            const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
            console.log(`[Cache] Cleaned ${removedCount} invalid/expired/full entries from cache${detailStr}`);
        }
    }
}

function saveCache() {
    try {
        cleanCache(); // Clean before saving
        jobIdCache.lastUpdated = new Date().toISOString();
        fs.writeFileSync(CACHE_FILE, JSON.stringify(jobIdCache, null, 2));
        console.log(`[Cache] Saved ${jobIdCache.jobIds.length} job IDs to cache`);
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
                    // Rate limited - return null to trigger retry logic
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

async function fetchPage(cursor = null, retryCount = 0) {
    // CRITICAL: excludeFullGames=true tells Roblox API to exclude full servers at the API level
    // We also filter client-side as a backup (defensive programming)
    let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Desc&limit=100&excludeFullGames=true`;
    if (cursor) {
        url += `&cursor=${cursor}`;
    }
    
    try {
        const data = await makeRequest(url);
        return data;
    } catch (error) {
        // Handle rate limiting (429) with exponential backoff
        if (error.message.includes('429') || error.message.includes('Rate limited')) {
            if (retryCount < 3) {
                const backoffDelay = Math.min(10000 * Math.pow(2, retryCount), 60000); // Max 60 seconds
                console.log(`[Fetch] Rate limited, waiting ${backoffDelay/1000}s before retry (${retryCount + 1}/3)...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                return fetchPage(cursor, retryCount + 1);
            } else {
                console.error(`[Fetch] Rate limited after ${retryCount + 1} retries, giving up`);
                return null;
            }
        }
        // Handle timeout errors
        if (error.message.includes('timeout')) {
            if (retryCount < 2) {
                console.log(`[Fetch] Timeout, retrying (${retryCount + 1}/2)...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return fetchPage(cursor, retryCount + 1);
            }
        }
        console.error(`[Fetch] Error fetching page:`, error.message);
        return null;
    }
}

async function fetchBulkJobIds() {
    console.log(`[Fetch] Starting bulk fetch for place ID: ${PLACE_ID}`);
    console.log(`[Fetch] Target: ${MAX_JOB_IDS} FRESHEST job IDs, fetching up to ${PAGES_TO_FETCH} pages`);
    console.log(`[Fetch] Delay between requests: ${DELAY_BETWEEN_REQUESTS}ms (to avoid rate limiting)`);
    console.log(`[Fetch] Estimated max time: ${Math.ceil((PAGES_TO_FETCH * DELAY_BETWEEN_REQUESTS) / 60000)} minutes`);
    console.log(`[Fetch] Sort Order: Desc (newest servers first)`);
    console.log(`[Fetch] Using excludeFullGames=true parameter to exclude full servers at API level`);
    console.log(`[Fetch] Filtering: Only caching servers with 7/8 or less players (players < maxPlayers)`);
    console.log(`[Fetch] Filtering: Excluding private servers (VIP check removed - public list only)`);
    console.log(`[Fetch] Only servers with available slots (7/8 or less) will be cached`);
    console.log(`[Fetch] Incremental caching: Will save cache every 100 servers for immediate availability`);
    
    // Clean expired entries first, then keep non-expired ones
    const now = Date.now();
    const maxAge = JOB_ID_MAX_AGE_MS;
    const beforeCleanup = jobIdCache.jobIds.length;
    const existingValidIds = new Set();
    
    // Filter out expired entries and build a map of valid existing servers
    const validExistingServers = jobIdCache.jobIds.filter(item => {
        if (typeof item === 'string' || typeof item === 'number') {
            // Old format - keep but mark as potentially stale
            const id = String(item);
            if (existingValidIds.has(id)) return false;
            existingValidIds.add(id);
            return true;
        }
        if (typeof item === 'object' && item !== null && item.id) {
            const age = now - (item.timestamp || 0);
            if (age >= maxAge) {
                return false; // Expired
            }
            const id = String(item.id);
            if (existingValidIds.has(id)) return false; // Duplicate
            existingValidIds.add(id);
            return true; // Valid and not expired
        }
        return false; // Invalid format
    });
    
    const expiredCount = beforeCleanup - validExistingServers.length;
    if (expiredCount > 0) {
        console.log(`[Fetch] Removed ${expiredCount} expired/stale servers from cache`);
    }
    console.log(`[Fetch] Keeping ${validExistingServers.length} valid non-expired servers`);
    
    // Start with valid existing servers, then add new ones
    jobIdCache.jobIds = [...validExistingServers];
    const existingJobIds = new Set(existingValidIds); // Track all IDs (existing + new) to avoid duplicates
    let cursor = null;
    let pagesFetched = 0;
    let totalAdded = 0;
    let totalScanned = 0;
    let totalFiltered = 0;
    let lastSaveCount = 0; // Track when we last saved
    
    // Stop fetching if we have enough servers OR if we've checked enough pages
    // Note: Roblox API doesn't support filtering by player count, so we fetch all and filter client-side
    while (pagesFetched < PAGES_TO_FETCH && jobIdCache.jobIds.length < MAX_JOB_IDS) {
        // Yield to event loop every iteration to keep server responsive
        await new Promise(resolve => setImmediate(resolve));
        
        if (pagesFetched > 0) {
            // Respect rate limits - wait between requests to avoid 429 errors
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
        }
        
        console.log(`[Fetch] Fetching page ${pagesFetched + 1}/${PAGES_TO_FETCH}...`);
        let data;
        try {
            data = await fetchPage(cursor, 0);
        } catch (error) {
            console.error(`[Fetch] Error on page ${pagesFetched + 1}:`, error.message);
            // If rate limited, wait longer before continuing
            if (error.message.includes('429') || error.message.includes('Too many requests')) {
                console.log(`[Fetch] Rate limited, waiting 30 seconds before continuing...`);
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
            // Continue to next page instead of breaking
            pagesFetched++;
            continue;
        }
        
        if (!data || !data.data || data.data.length === 0) {
            console.log(`[Fetch] No more data available from API`);
            break;
        }
        
        let pageAdded = 0;
        let pageFiltered = 0;
        let filterStats = { full: 0, private: 0, invalid: 0, duplicate: 0, tooMany: 0, lowPlayers: 0 };
        
        for (const server of data.data) {
            totalScanned++;
            const jobId = server.id;
            const players = server.playing || 0;
            const maxPlayers = server.maxPlayers || 6;
            
            // Filter private servers - check multiple indicators to catch all types:
            // - accessCode: Private servers that require an access code to join
            // - PrivateServerId: Private server identifier (capitalized property)
            // - privateServerId: Private server identifier (camelCase property)
            const isPrivateServer = (server.accessCode !== null && server.accessCode !== undefined) ||
                                   (server.PrivateServerId !== null && server.PrivateServerId !== undefined) ||
                                   (server.privateServerId !== null && server.privateServerId !== undefined);
            
            if (!jobId) {
                filterStats.invalid++;
                pageFiltered++;
                continue;
            }
            if (existingJobIds.has(jobId)) {
                filterStats.duplicate++;
                pageFiltered++;
                continue;
            }
            if (jobIdCache.jobIds.length >= MAX_JOB_IDS) {
                filterStats.tooMany++;
                pageFiltered++;
                continue;
            }
            // Allow empty servers (players === 0) - they might have slots available
            // Only filter if players < MIN_PLAYERS AND players > 0 (empty servers are allowed)
            if (players > 0 && players < MIN_PLAYERS) {
                filterStats.lowPlayers++;
                pageFiltered++;
                continue;
            }
            // CRITICAL: Exclude full servers - only allow servers with available slots
            // Players must be strictly less than maxPlayers (7/8 allowed, 8/8 rejected)
            // This is a backup check in case excludeFullGames=true API parameter fails
            if (players >= maxPlayers) {
                filterStats.full++;
                pageFiltered++;
                continue;
            }
            
            if (isPrivateServer) {
                filterStats.private++;
                pageFiltered++;
                continue;
            }
            
            // Server passed all filters - FINAL CHECK: ensure not full
            // Double-check that server is not full (defensive programming in case API parameter fails)
            // Only allow servers with players < maxPlayers (7/8 or less, not 8/8)
            // Allow empty servers (players === 0) as they have slots available
            if (jobId && 
                players < maxPlayers &&  // CRITICAL: Only allow servers with available slots (players < maxPlayers)
                (players === 0 || players >= MIN_PLAYERS) &&  // Allow empty servers or servers with min players
                !isPrivateServer && 
                !existingJobIds.has(jobId) && 
                jobIdCache.jobIds.length < MAX_JOB_IDS) {
                // Store with timestamp for freshness tracking
                jobIdCache.jobIds.push({
                    id: jobId,
                    timestamp: Date.now(),
                    players: players,
                    maxPlayers: maxPlayers
                });
                existingJobIds.add(jobId);
                pageAdded++;
                totalAdded++;
            } else {
                pageFiltered++;
                totalFiltered++;
            }
        }
        
        pagesFetched++;
        const filterDetails = [];
        if (filterStats.full > 0) filterDetails.push(`${filterStats.full} full`);
        if (filterStats.private > 0) filterDetails.push(`${filterStats.private} private`);
        if (filterStats.lowPlayers > 0) filterDetails.push(`${filterStats.lowPlayers} low players`);
        if (filterStats.duplicate > 0) filterDetails.push(`${filterStats.duplicate} duplicate`);
        if (filterStats.invalid > 0) filterDetails.push(`${filterStats.invalid} invalid`);
        if (filterStats.tooMany > 0) filterDetails.push(`${filterStats.tooMany} cache full`);
        
        const filterSummary = filterDetails.length > 0 ? filterDetails.join(', ') : 'none';
        console.log(`[Fetch] Page ${pagesFetched}: Added ${pageAdded} new job IDs (7/8 or less players), Filtered ${pageFiltered} (${filterSummary}) (Total: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS}, Scanned: ${totalScanned})`);
        
        // Incremental cache save: Save every 100 servers so API can serve them immediately
        // Use async write to avoid blocking the fetch process
        const currentCount = jobIdCache.jobIds.length;
        if (currentCount - lastSaveCount >= 100) {
            // Save asynchronously to avoid blocking - but wait for it to complete
            await new Promise((resolve) => {
                setImmediate(() => {
                    try {
                        jobIdCache.lastUpdated = new Date().toISOString();
                        jobIdCache.totalFetched = currentCount;
                        fs.writeFileSync(CACHE_FILE, JSON.stringify(jobIdCache, null, 2));
                        console.log(`[Fetch] 💾 Incremental save: Saved ${currentCount} servers to cache (available for API)`);
                    } catch (saveError) {
                        console.warn(`[Fetch] Failed to save cache incrementally: ${saveError.message}`);
                    }
                    resolve();
                });
            });
            lastSaveCount = currentCount;
        }
        
        // Yield to event loop after processing each page to keep server responsive
        await new Promise(resolve => setImmediate(resolve));
        
        // Stop early if we have enough servers with 7/8 or less players
        if (jobIdCache.jobIds.length >= MAX_JOB_IDS) {
            console.log(`[Fetch] ✅ Reached target of ${MAX_JOB_IDS} servers with 7/8 or less players, stopping fetch early`);
            break;
        }
        
        // Reset filter stats for next page
        filterStats = { full: 0, private: 0, invalid: 0, duplicate: 0, tooMany: 0, lowPlayers: 0 };
        
        cursor = data.nextPageCursor;
        if (!cursor) {
            console.log(`[Fetch] No more pages available`);
            break;
        }
    }
    
    // Sort all servers by timestamp (newest first) and limit to MAX_JOB_IDS
    const beforeSort = jobIdCache.jobIds.length;
    jobIdCache.jobIds.sort((a, b) => {
        const tsA = typeof a === 'object' && a !== null ? (a.timestamp || 0) : Date.now();
        const tsB = typeof b === 'object' && b !== null ? (b.timestamp || 0) : Date.now();
        return tsB - tsA; // Newest first
    });
    
    // Limit to MAX_JOB_IDS, keeping only the freshest
    if (jobIdCache.jobIds.length > MAX_JOB_IDS) {
        const removed = jobIdCache.jobIds.length - MAX_JOB_IDS;
        jobIdCache.jobIds = jobIdCache.jobIds.slice(0, MAX_JOB_IDS);
        console.log(`[Fetch] Limited cache to ${MAX_JOB_IDS} freshest servers (removed ${removed} older entries)`);
    }
    
    // Final cleanup: Remove any expired entries one more time (in case any slipped through)
    const finalBeforeCleanup = jobIdCache.jobIds.length;
    jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
        if (typeof item === 'string' || typeof item === 'number') return true;
        if (typeof item === 'object' && item !== null && item.id) {
            const age = Date.now() - (item.timestamp || 0);
            return age < maxAge;
        }
        return false;
    });
    const finalExpiredRemoved = finalBeforeCleanup - jobIdCache.jobIds.length;
    if (finalExpiredRemoved > 0) {
        console.log(`[Fetch] Final cleanup: Removed ${finalExpiredRemoved} expired entries`);
    }
    
    jobIdCache.totalFetched = jobIdCache.jobIds.length;
    const keptFromOld = validExistingServers.length;
    console.log(`[Fetch] Bulk fetch complete!`);
    console.log(`[Fetch] Total job IDs cached: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS}`);
    console.log(`[Fetch] Kept from old cache: ${keptFromOld} (removed ${expiredCount} expired)`);
    console.log(`[Fetch] Fresh servers added: ${totalAdded}`);
    console.log(`[Fetch] Servers filtered (Full/Private): ${totalFiltered}`);
    console.log(`[Fetch] Total servers scanned: ${totalScanned}`);
    console.log(`[Fetch] Pages fetched: ${pagesFetched}`);
    
    if (jobIdCache.jobIds.length === 0) {
        console.log(`[Fetch] ⚠️  WARNING: No servers found with 7/8 or less players after scanning ${totalScanned} servers across ${pagesFetched} pages`);
        console.log(`[Fetch] All servers appear to be full (8/8). The game may be at capacity.`);
        console.log(`[Fetch] Note: Roblox API doesn't support filtering by player count - we must fetch and filter client-side`);
    } else if (jobIdCache.jobIds.length < MAX_JOB_IDS) {
        console.log(`[Fetch] ⚠️  Warning: Only cached ${jobIdCache.jobIds.length} job IDs, target was ${MAX_JOB_IDS}`);
        console.log(`[Fetch] Consider increasing PAGES_TO_FETCH (currently ${PAGES_TO_FETCH}) if you need more servers`);
    } else {
        console.log(`[Fetch] ✅ Success: Cache refreshed with ${MAX_JOB_IDS} freshest job IDs!`);
    }
    
    return {
        total: jobIdCache.jobIds.length,
        added: totalAdded,
        filtered: totalFiltered,
        scanned: totalScanned
    };
}

async function main() {
    console.log('='.repeat(60));
    console.log('Roblox Job ID Bulk Fetcher');
    console.log('='.repeat(60));
    
    loadCache();
    
    const result = await fetchBulkJobIds();
    
    if (saveCache()) {
        console.log('\n[Success] Cache saved successfully!');
        console.log(`[Stats] Total job IDs: ${result.total}`);
        console.log(`[Stats] New job IDs: ${result.added}`);
        console.log(`[Stats] Servers scanned: ${result.scanned}`);
        console.log(`[Cache] File location: ${CACHE_FILE}`);
    } else {
        console.error('\n[Error] Failed to save cache!');
        process.exit(1);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Done! You can now use the cached job IDs in your Lua script.');
    console.log('='.repeat(60));
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
            // Convert to array of job IDs, handling both old format (strings) and new format (objects)
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
            
            // Filter out expired job IDs and sort by timestamp (newest first)
            const sorted = ids
                .filter(item => {
                    // Check if item is valid
                    if (typeof item === 'string' || typeof item === 'number') {
                        // Old format - assume it's still valid (no timestamp)
                        return true;
                    }
                    if (typeof item === 'object' && item !== null && item.id) {
                        // New format - check if expired
                        const age = now - (item.timestamp || 0);
                        return age < maxAge; // Only return if less than max age
                    }
                    return false;
                })
                .sort((a, b) => {
                    const tsA = typeof a === 'object' ? (a.timestamp || 0) : Date.now();
                    const tsB = typeof b === 'object' ? (b.timestamp || 0) : Date.now();
                    return tsB - tsA; // Newest first
                })
                .slice(0, limit)
                .map(item => typeof item === 'object' ? item.id : item);
            
            // Clean up expired entries from cache
            const beforeCleanup = jobIdCache.jobIds.length;
            jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
                if (typeof item === 'string' || typeof item === 'number') return true;
                if (typeof item === 'object' && item !== null) {
                    const age = now - (item.timestamp || 0);
                    return age < maxAge;
                }
                return false;
            });
            
            if (beforeCleanup !== jobIdCache.jobIds.length) {
                console.log(`[Cache] Cleaned ${beforeCleanup - jobIdCache.jobIds.length} expired job IDs`);
            }
            
            return sorted;
        } catch (error) {
            console.error('[Cache] Error getting freshest job IDs:', error.message);
            return [];
        }
    },
    getFreshestServers: (limit = 1000) => {
        try {
            const ids = jobIdCache.jobIds || [];
            const now = Date.now();
            const maxAge = JOB_ID_MAX_AGE_MS;
            
            // Filter out expired job IDs and full servers, return full server objects with metadata
            const sorted = ids
                .filter(item => {
                    // Check if item is valid and not expired
                    if (typeof item === 'string' || typeof item === 'number') {
                        // Old format - assume it's still valid (no timestamp, no player count)
                        return true;
                    }
                    if (typeof item === 'object' && item !== null && item.id) {
                        // New format - check if expired
                        const age = now - (item.timestamp || 0);
                        if (age >= maxAge) return false; // Expired
                        
                        // CRITICAL: Filter out full servers (players >= maxPlayers)
                        // This is a defensive check in case any full servers somehow got cached
                        const players = item.players || 0;
                        const maxPlayers = item.maxPlayers || 8;
                        if (players >= maxPlayers) return false; // Full server
                        
                        return true;
                    }
                    return false;
                })
                .sort((a, b) => {
                    const tsA = typeof a === 'object' ? (a.timestamp || 0) : Date.now();
                    const tsB = typeof b === 'object' ? (b.timestamp || 0) : Date.now();
                    return tsB - tsA; // Newest first
                })
                .slice(0, limit)
                .map(item => {
                    if (typeof item === 'object' && item !== null) {
                        return {
                            id: item.id.toString(),
                            players: item.players || 0,
                            maxPlayers: item.maxPlayers || 8,
                            timestamp: item.timestamp || Date.now()
                        };
                    } else {
                        return {
                            id: item.toString(),
                            players: 0,
                            maxPlayers: 8,
                            timestamp: Date.now()
                        };
                    }
                });
            
            // Clean up expired entries from cache
            const beforeCleanup = jobIdCache.jobIds.length;
            jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
                if (typeof item === 'string' || typeof item === 'number') return true;
                if (typeof item === 'object' && item !== null) {
                    const age = now - (item.timestamp || 0);
                    return age < maxAge;
                }
                return false;
            });
            
            if (beforeCleanup !== jobIdCache.jobIds.length) {
                console.log(`[Cache] Cleaned ${beforeCleanup - jobIdCache.jobIds.length} expired job IDs from getFreshestServers`);
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
    }
};
