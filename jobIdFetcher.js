const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACE_ID = parseInt(process.env.PLACE_ID, 10) || 109983668079237;
const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const MAX_JOB_IDS = parseInt(process.env.MAX_JOB_IDS || '1000', 10);
const PAGES_TO_FETCH = parseInt(process.env.PAGES_TO_FETCH || '15', 10);
const DELAY_BETWEEN_REQUESTS = parseInt(process.env.DELAY_BETWEEN_REQUESTS || '5000', 10); // Increased to 5 seconds to avoid rate limits
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '1', 10);
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '6', 10); // Exclude full servers (7+ players, max is usually 6)
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
    // Remove any invalid entries and ensure we only have valid job IDs
    // Handle both old format (strings) and new format (objects with timestamps)
    if (Array.isArray(jobIdCache.jobIds)) {
        const originalLength = jobIdCache.jobIds.length;
        jobIdCache.jobIds = jobIdCache.jobIds.filter(item => {
            if (typeof item === 'string' || typeof item === 'number') {
                return item !== null && item !== undefined && item !== '';
            }
            if (typeof item === 'object' && item !== null) {
                return item.id !== null && item.id !== undefined && item.id !== '';
            }
            return false;
        });
        if (originalLength !== jobIdCache.jobIds.length) {
            console.log(`[Cache] Cleaned ${originalLength - jobIdCache.jobIds.length} invalid entries from cache`);
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
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });
        
        // Add timeout (30 seconds)
        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Request timeout after 30 seconds'));
        });
        
        request.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });
    });
}

async function fetchPage(cursor = null, retryCount = 0) {
    let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Desc&limit=100`;
    if (cursor) {
        url += `&cursor=${cursor}`;
    }
    
    try {
        const data = await makeRequest(url);
        return data;
    } catch (error) {
        // Handle rate limiting (429) with exponential backoff
        if (error.message.includes('429') || error.message.includes('Too many requests')) {
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
        console.error(`[Fetch] Error fetching page:`, error.message);
        return null;
    }
}

async function fetchBulkJobIds() {
    console.log(`[Fetch] Starting bulk fetch for place ID: ${PLACE_ID}`);
    console.log(`[Fetch] Target: ${MAX_JOB_IDS} FRESHEST job IDs, fetching up to ${PAGES_TO_FETCH} pages`);
    console.log(`[Fetch] Sort Order: Desc (newest servers first)`);
    console.log(`[Fetch] Filtering: Only servers with ${MIN_PLAYERS}+ players and not full (players < maxPlayers)`);
    console.log(`[Fetch] Filtering: Excluding private servers (VIP check removed - public list only)`);
    console.log(`[Fetch] This will refresh the entire cache with the freshest servers`);
    
    jobIdCache.jobIds = [];
    const existingJobIds = new Set();
    let cursor = null;
    let pagesFetched = 0;
    let totalAdded = 0;
    let totalScanned = 0;
    let totalFiltered = 0;
    
    while (pagesFetched < PAGES_TO_FETCH && jobIdCache.jobIds.length < MAX_JOB_IDS) {
        if (pagesFetched > 0) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
        }
        
        console.log(`[Fetch] Fetching page ${pagesFetched + 1}...`);
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
            console.log(`[Fetch] No more data available`);
            break;
        }
        
        let pageAdded = 0;
        let pageFiltered = 0;
        let filterStats = { full: 0, private: 0, invalid: 0, duplicate: 0, tooMany: 0, lowPlayers: 0 };
        let sampleServers = []; // Store first 5 servers for debugging
        
        for (const server of data.data) {
            totalScanned++;
            const jobId = server.id;
            const players = server.playing || 0;
            const maxPlayers = server.maxPlayers || 6;
            
            // Debug: Store sample of first few servers from first page
            // Note: pagesFetched is 0 for first page, 1 for second page, etc.
            if (pagesFetched === 0 && totalScanned <= 5) {
                sampleServers.push({ 
                    jobId, 
                    players, 
                    maxPlayers, 
                    private: (server.accessCode !== null && server.accessCode !== undefined) ||
                            (server.PrivateServerId !== null && server.PrivateServerId !== undefined) ||
                            (server.privateServerId !== null && server.privateServerId !== undefined),
                    isFull: players >= maxPlayers
                });
            }
            
            // Note: VIP check removed - we're fetching from public servers list, so VIP servers shouldn't appear anyway
            
            // Filter private servers - check multiple indicators to catch all types:
            // - accessCode: Private servers that require an access code to join
            // - PrivateServerId: Private server identifier (capitalized property)
            // - privateServerId: Private server identifier (camelCase property)
            const isPrivateServer = (server.accessCode !== null && server.accessCode !== undefined) ||
                                   (server.PrivateServerId !== null && server.PrivateServerId !== undefined) ||
                                   (server.privateServerId !== null && server.privateServerId !== undefined);
            
            // Track why servers are filtered (for debugging)
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
            if (players < MIN_PLAYERS) {
                filterStats.lowPlayers++;
                pageFiltered++;
                continue;
            }
            // Exclude full servers: players >= maxPlayers means server is full
            // Debug: Log first few full servers to see what's happening
            if (players >= maxPlayers) {
                if (pagesFetched === 0 && totalScanned <= 3 && filterStats.full < 3) {
                    console.log(`[Fetch] DEBUG - Full server example: JobId: ${jobId?.toString().substring(0, 12)}..., Players: ${players}, MaxPlayers: ${maxPlayers}, IsFull: ${players >= maxPlayers}`);
                }
                filterStats.full++;
                pageFiltered++;
                continue;
            }
            // VIP check removed - public servers list shouldn't contain VIP servers
            if (isPrivateServer) {
                filterStats.private++;
                pageFiltered++;
                continue;
            }
            
            // Server passed all filters
            // Note: We check players < maxPlayers (not <= MAX_PLAYERS) to exclude full servers
            // VIP check removed - public servers list shouldn't contain VIP servers
            if (jobId && 
                players >= MIN_PLAYERS && 
                players < maxPlayers &&  // Exclude full servers (players < maxPlayers)
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
        console.log(`[Fetch] Page ${pagesFetched}: Added ${pageAdded} new job IDs, Filtered ${pageFiltered} (${filterSummary}) (Total: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS}, Scanned: ${totalScanned})`);
        
        // Debug: Log sample servers from first page
        // pagesFetched is incremented above, so after first page it will be 1
        if (pagesFetched === 1 && sampleServers.length > 0) {
            console.log(`[Fetch] DEBUG - Sample servers (first ${sampleServers.length}):`);
            sampleServers.forEach((s, i) => {
                const jobIdShort = s.jobId ? s.jobId.toString().substring(0, 12) + '...' : 'null';
                console.log(`[Fetch]   ${i+1}. JobId: ${jobIdShort}, Players: ${s.players}/${s.maxPlayers}, Full: ${s.isFull ? 'YES' : 'NO'}, Private: ${s.private ? 'YES' : 'NO'}`);
            });
        }
        
        // Reset filter stats for next page
        filterStats = { full: 0, private: 0, invalid: 0, duplicate: 0, tooMany: 0, lowPlayers: 0 };
        sampleServers = [];
        
        cursor = data.nextPageCursor;
        if (!cursor) {
            console.log(`[Fetch] No more pages available`);
            break;
        }
    }
    
    jobIdCache.totalFetched = jobIdCache.jobIds.length;
    console.log(`[Fetch] Bulk fetch complete!`);
    console.log(`[Fetch] Total job IDs cached: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS}`);
    console.log(`[Fetch] Fresh servers added: ${totalAdded}`);
    console.log(`[Fetch] Servers filtered (Full/Private): ${totalFiltered}`);
    console.log(`[Fetch] Total servers scanned: ${totalScanned}`);
    
    if (jobIdCache.jobIds.length < MAX_JOB_IDS) {
        console.log(`[Fetch] Warning: Only cached ${jobIdCache.jobIds.length} job IDs, target was ${MAX_JOB_IDS}`);
    } else {
        console.log(`[Fetch] Success: Cached full ${MAX_JOB_IDS} job IDs!`);
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
            // Sort by timestamp (newest first), then take limit
            const sorted = ids
                .filter(item => {
                    if (typeof item === 'string' || typeof item === 'number') return true;
                    if (typeof item === 'object' && item !== null && item.id) return true;
                    return false;
                })
                .sort((a, b) => {
                    const tsA = typeof a === 'object' ? (a.timestamp || 0) : Date.now();
                    const tsB = typeof b === 'object' ? (b.timestamp || 0) : Date.now();
                    return tsB - tsA; // Newest first
                })
                .slice(0, limit)
                .map(item => typeof item === 'object' ? item.id : item);
            return sorted;
        } catch (error) {
            console.error('[Cache] Error getting freshest job IDs:', error.message);
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
