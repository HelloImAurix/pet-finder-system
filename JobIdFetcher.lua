const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const PLACE_ID = 109983668079237; // Steal-a-Brainrot game ID
const CACHE_FILE = path.join(__dirname, 'jobIds_cache.json');
const MAX_JOB_IDS = 5000; // Maximum job IDs to store
const PAGES_TO_FETCH = 50; // Number of pages to fetch (100 servers per page = up to 5000 servers)
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds delay between API requests to avoid rate limits
const MIN_PLAYERS = 1; // Minimum players required for a server to be included

// Job ID cache structure
let jobIdCache = {
    jobIds: [],
    lastUpdated: null,
    placeId: PLACE_ID,
    totalFetched: 0
};

// Load existing cache if it exists
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            jobIdCache = JSON.parse(data);
            console.log(`[Cache] Loaded ${jobIdCache.jobIds.length} job IDs from cache`);
            return true;
        }
    } catch (error) {
        console.warn('[Cache] Failed to load cache:', error.message);
    }
    return false;
}

// Save cache to file
function saveCache() {
    try {
        jobIdCache.lastUpdated = new Date().toISOString();
        fs.writeFileSync(CACHE_FILE, JSON.stringify(jobIdCache, null, 2));
        console.log(`[Cache] Saved ${jobIdCache.jobIds.length} job IDs to cache`);
        return true;
    } catch (error) {
        console.error('[Cache] Failed to save cache:', error.message);
        return false;
    }
}

// Make HTTP request to Roblox API
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

// Fetch a single page of servers
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

// Fetch job IDs in bulk
async function fetchBulkJobIds() {
    console.log(`[Fetch] Starting bulk fetch for place ID: ${PLACE_ID}`);
    console.log(`[Fetch] Target: ${MAX_JOB_IDS} job IDs, fetching up to ${PAGES_TO_FETCH} pages`);
    
    const existingJobIds = new Set(jobIdCache.jobIds);
    let cursor = null;
    let pagesFetched = 0;
    let totalAdded = 0;
    let totalScanned = 0;
    
    while (pagesFetched < PAGES_TO_FETCH && jobIdCache.jobIds.length < MAX_JOB_IDS) {
        // Delay to avoid rate limits
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
        for (const server of data.data) {
            totalScanned++;
            const jobId = server.id;
            const players = server.playing || 0;
            
            // Only add if: has players, not already in cache, and not at max capacity
            if (players >= MIN_PLAYERS && !existingJobIds.has(jobId) && jobIdCache.jobIds.length < MAX_JOB_IDS) {
                jobIdCache.jobIds.push(jobId);
                existingJobIds.add(jobId);
                pageAdded++;
                totalAdded++;
            }
        }
        
        pagesFetched++;
        console.log(`[Fetch] Page ${pagesFetched}: Added ${pageAdded} new job IDs (Total: ${jobIdCache.jobIds.length}/${MAX_JOB_IDS}, Scanned: ${totalScanned})`);
        
        // Get next page cursor
        cursor = data.nextPageCursor;
        if (!cursor) {
            console.log(`[Fetch] No more pages available`);
            break;
        }
    }
    
    jobIdCache.totalFetched = jobIdCache.jobIds.length;
    console.log(`[Fetch] Bulk fetch complete!`);
    console.log(`[Fetch] Total job IDs cached: ${jobIdCache.jobIds.length}`);
    console.log(`[Fetch] New job IDs added: ${totalAdded}`);
    console.log(`[Fetch] Total servers scanned: ${totalScanned}`);
    
    return {
        total: jobIdCache.jobIds.length,
        added: totalAdded,
        scanned: totalScanned
    };
}

// Main function
async function main() {
    console.log('='.repeat(60));
    console.log('Roblox Job ID Bulk Fetcher');
    console.log('='.repeat(60));
    
    // Load existing cache
    loadCache();
    
    // Fetch new job IDs
    const result = await fetchBulkJobIds();
    
    // Save cache
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

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('[Fatal Error]', error);
        process.exit(1);
    });
}

// Export for use in other modules
module.exports = {
    fetchBulkJobIds,
    loadCache,
    saveCache,
    getJobIds: () => jobIdCache.jobIds,
    getCacheInfo: () => ({
        count: jobIdCache.jobIds.length,
        lastUpdated: jobIdCache.lastUpdated,
        placeId: jobIdCache.placeId
    })
};
