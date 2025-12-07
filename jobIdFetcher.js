const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACE_ID = 109983668079237;
const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const MAX_JOB_IDS = 5000;
const PAGES_TO_FETCH = 50;
const DELAY_BETWEEN_REQUESTS = 5000;
const MIN_PLAYERS = 1;
const MAX_PLAYERS = 5; // Exclude full servers (6+ players)
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
    if (Array.isArray(jobIdCache.jobIds)) {
        const originalLength = jobIdCache.jobIds.length;
        jobIdCache.jobIds = jobIdCache.jobIds.filter(id => {
            // Keep only valid job IDs (non-null, non-undefined, string or number)
            return id !== null && id !== undefined && id !== '';
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
        https.get(url, (res) => {
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
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

async function fetchPage(cursor = null) {
    let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Asc&limit=100`;
    if (cursor) {
        url += `&cursor=${cursor}`;
    }
    
    try {
        const data = await makeRequest(url);
        return data;
    } catch (error) {
        console.error(`[Fetch] Error fetching page:`, error.message);
        return null;
    }
}

async function fetchBulkJobIds() {
    console.log(`[Fetch] Starting bulk fetch for place ID: ${PLACE_ID}`);
    console.log(`[Fetch] Target: ${MAX_JOB_IDS} job IDs, fetching up to ${PAGES_TO_FETCH} pages`);
    console.log(`[Fetch] Filtering: Only servers with ${MIN_PLAYERS}-${MAX_PLAYERS} players (excluding full servers)`);
    console.log(`[Fetch] Filtering: Excluding VIP servers and private servers`);
    console.log(`[Fetch] This will refresh the entire cache with fresh servers`);
    
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
        const data = await fetchPage(cursor);
        
        if (!data || !data.data || data.data.length === 0) {
            console.log(`[Fetch] No more data available`);
            break;
        }
        
        let pageAdded = 0;
        let pageFiltered = 0;
        for (const server of data.data) {
            totalScanned++;
            const jobId = server.id;
            const players = server.playing || 0;
            const maxPlayers = server.maxPlayers || 6;
            const isVipServer = server.vipServerId !== null && server.vipServerId !== undefined;
            const isPrivateServer = server.accessCode !== null && server.accessCode !== undefined;
            
            // Filter criteria:
            // 1. Must have at least MIN_PLAYERS
            // 2. Must have less than MAX_PLAYERS (not full)
            // 3. Must not be a VIP server
            // 4. Must not be a private server (with access code)
            // 5. Must not already be in cache
            if (players >= MIN_PLAYERS && 
                players <= MAX_PLAYERS && 
                !isVipServer && 
                !isPrivateServer && 
                !existingJobIds.has(jobId) && 
                jobIdCache.jobIds.length < MAX_JOB_IDS) {
                jobIdCache.jobIds.push(jobId);
                existingJobIds.add(jobId);
                pageAdded++;
                totalAdded++;
            } else {
                pageFiltered++;
                totalFiltered++;
            }
        }
        
        pagesFetched++;
        console.log(`[Fetch] Page ${pagesFetched}: Added ${pageAdded} new job IDs, Filtered ${pageFiltered} (Full/Private/VIP) (Total: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS}, Scanned: ${totalScanned})`);
        
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
    console.log(`[Fetch] Servers filtered (Full/Private/VIP): ${totalFiltered}`);
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
            return jobIdCache.jobIds || [];
        } catch (error) {
            console.error('[Cache] Error getting job IDs:', error.message);
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
