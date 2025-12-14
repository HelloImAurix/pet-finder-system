/**
 * Pet Finder API Server
 * 
 * Backend API server for managing Roblox server distribution and pet find storage.
 * Provides endpoints for Lua scripts to request servers and submit pet finds.
 * 
 * Core Functionality:
 * - Server Distribution: Fetches available Roblox servers and distributes unique job IDs
 * - Visited Tracking: Marks servers as visited to prevent duplicate distribution
 * - Pet Find Storage: Stores and retrieves pet find data from frontend scripts
 * - Rate Limiting: Prevents API abuse with IP-based rate limiting
 * 
 * Workflow:
 * 1. Frontend requests server → getNextJob() returns unique server and marks as reserved
 * 2. Frontend runs script → markVisited() permanently blacklists server for 30 minutes
 * 3. Backend fetches servers → Skips all visited servers, only adds unvisited ones
 * 4. After 30 minutes → Visited servers expire and become available again
 * 
 * @author Luji Hub
 * @version 1.0.0
 */

const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();

// Railway sets PORT automatically - use it or default to 3000
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Server Configuration
 * 
 * All configuration values can be overridden via environment variables.
 * Defaults are optimized for production use.
 */
const CONFIG = {
    // Roblox game place ID to fetch servers from
    PLACE_ID: parseInt(process.env.PLACE_ID, 10) || 109983668079237,
    
    // Maximum number of server job IDs to cache in memory
    MAX_JOB_IDS: parseInt(process.env.MAX_JOB_IDS || '3000', 10),
    
    // Number of API pages to fetch when refreshing server list (increased for faster population)
    PAGES_TO_FETCH: parseInt(process.env.PAGES_TO_FETCH || '200', 10),
    
    // Delay between API requests to avoid rate limiting (milliseconds) - reduced for faster fetching
    DELAY_BETWEEN_REQUESTS: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '50', 10),
    
    // Minimum player count required for a server to be considered valid
    MIN_PLAYERS: parseInt(process.env.MIN_PLAYERS || '0', 10),
    
    // Maximum age of cached server data before it's considered stale (60 seconds - very aggressive for fresh servers)
    JOB_ID_MAX_AGE_MS: parseInt(process.env.JOB_ID_MAX_AGE_MS || '60000', 10),
    
    // Maximum number of pet finds to store in memory
    MAX_FINDS: parseInt(process.env.MAX_FINDS || '10000', 10),
    
    // How long to keep pet finds before cleanup (hours)
    STORAGE_DURATION_HOURS: parseInt(process.env.STORAGE_DURATION_HOURS || '2', 10),
    
    // Full cache refresh interval (10 minutes)
    FULL_REFRESH_INTERVAL_MS: 600000,
    
    // Auto-refresh when cache is low (2 minutes)
    AUTO_REFRESH_INTERVAL_MS: 120000,
    
    // Periodic cleanup interval (1 minute)
    CLEANUP_INTERVAL_MS: 60000,
    
    // Full server check interval (15 seconds - very frequent for immediate removal)
    FULL_SERVER_CHECK_INTERVAL_MS: 15000,
    
    // Number of servers to check per batch for full server verification (increased for better coverage)
    FULL_SERVER_CHECK_BATCH_SIZE: 200,
    
    // Timeout for reserved servers before releasing back to pool (10 seconds)
    PENDING_TIMEOUT_MS: 10000,
    
    // Time before visited servers expire and become available again (30 minutes)
    VISITED_EXPIRY_MS: 30 * 60 * 1000
};

const API_KEY = process.env.BOT_API_KEY || 'sablujihub-bot';

// Middleware setup
app.use(cors());
app.use(express.json({ limit: '10mb' }));

/**
 * Authentication Middleware
 * 
 * Validates API key from request headers.
 * Required for all protected endpoints.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
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

/**
 * Rate Limiter Class
 * 
 * Implements IP-based rate limiting to prevent API abuse.
 * Uses a sliding window approach: 100 requests per minute per IP.
 * 
 * @class RateLimiter
 */
class RateLimiter {
    constructor() {
        // Map of IP addresses to their request records
        // Structure: { count: number, resetTime: timestamp }
        this.requests = new Map();
    }

    /**
     * Check if a request from an IP is allowed
     * 
     * @param {string} ip - Client IP address
     * @returns {{allowed: boolean, retryAfter?: number}} - Request status
     */
    check(ip) {
        const now = Date.now();
        const window = 60000; // 1 minute window
        const maxRequests = 100; // Maximum requests per window
        
        const record = this.requests.get(ip);
        
        // New IP or window expired - start fresh
        if (!record || now > record.resetTime) {
            this.requests.set(ip, { count: 1, resetTime: now + window });
            return { allowed: true };
        }

        // Rate limit exceeded
        if (record.count >= maxRequests) {
            return { 
                allowed: false, 
                retryAfter: Math.ceil((record.resetTime - now) / 1000) 
            };
        }

        // Increment counter
        record.count++;
        return { allowed: true };
    }

    /**
     * Cleanup expired rate limit records
     * Removes entries that have passed their reset time
     */
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

/**
 * Rate Limiting Middleware
 * 
 * Applies rate limiting to requests based on client IP.
 * Returns 429 status if rate limit is exceeded.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
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

// Cleanup expired rate limit records every minute
setInterval(() => rateLimiter.cleanup(), 60000);

/**
 * Pet Find Storage Class
 * 
 * Manages storage and retrieval of pet find data submitted by frontend scripts.
 * Implements deduplication, filtering, and automatic cleanup of old finds.
 * 
 * Features:
 * - Deduplication: Prevents duplicate finds within 5-minute window
 * - Filtering: Supports filtering by MPS, pet name, and timestamp
 * - Auto-cleanup: Removes finds older than configured duration
 * 
 * @class PetFindStorage
 */
class PetFindStorage {
    constructor() {
        // Array of all pet finds (newest first)
        this.finds = [];
        // Map for deduplication: key -> find object
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
            id: `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
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
        // Apply filters directly without copying array first
        let results = this.finds;
        
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
        
        // Sort by timestamp (most recent first)
        results.sort((a, b) => this.getTimestamp(b) - this.getTimestamp(a));
        
        // Apply limit
        const limit = Math.min(options.limit || 100, 500);
        return results.slice(0, limit);
    }
}

const petFindStorage = new PetFindStorage();

/**
 * Job Manager Class
 * 
 * Manages Roblox server distribution and tracking.
 * Ensures each user gets a unique, unvisited server.
 * 
 * Data Structures:
 * - availableServers: Map of normalizedId -> server data (available for distribution)
 * - visitedJobIds: Map of normalizedId -> timestamp (blacklisted for 30 minutes)
 * - reservedJobIds: Map of normalizedId -> timestamp (temporarily reserved during distribution)
 * 
 * Workflow:
 * 1. fetchBulkJobIds() - Fetches servers from Roblox API, skips visited ones
 * 2. getNextJob() - Atomically removes server from pool and marks as reserved
 * 3. markVisited() - Permanently blacklists server for 30 minutes
 * 4. After 30 minutes - Server expires from blacklist and becomes available again
 * 
 * @class JobManager
 */
class JobManager {
    constructor() {
        // Available servers ready for distribution (normalizedId -> server data)
        this.availableServers = new Map();
        
        // Visited servers blacklist (normalizedId -> timestamp)
        // Servers expire after 30 minutes and become available again
        this.visitedJobIds = new Map();
        
        // Temporarily reserved servers during distribution (normalizedId -> { timestamp, serverData })
        // Prevents duplicate distribution during concurrent requests
        // Stores server data so it can be restored if reservation expires
        this.reservedJobIds = new Map();
        
        // Fetching state flags
        this.isFetching = false;
        this.lastFetchTime = 0;
        this.distributionLock = false;
    }

    /**
     * Normalize job ID for consistent comparison
     * Converts to lowercase string and trims whitespace
     * 
     * @param {string} jobId - Raw job ID
     * @returns {string} - Normalized job ID
     */
    normalizeJobId(jobId) {
        return String(jobId).trim().toLowerCase();
    }

    /**
     * Check if a server has been visited (blacklisted)
     * Automatically removes expired entries (older than 30 minutes)
     * 
     * @param {string} normalizedId - Normalized job ID
     * @returns {boolean} - True if server is currently blacklisted
     */
    isServerVisited(normalizedId) {
        if (!this.visitedJobIds.has(normalizedId)) {
            return false;
        }
        const visitedTime = this.visitedJobIds.get(normalizedId);
        const now = Date.now();
        const age = now - visitedTime;
        
        // Auto-expire entries older than 30 minutes
        if (age > CONFIG.VISITED_EXPIRY_MS) {
            this.visitedJobIds.delete(normalizedId);
            return false;
        }
        return true;
    }

    /**
     * Check if a server is currently reserved (being distributed)
     * Fast check without cleanup - cleanup should be done separately
     * 
     * @param {string} normalizedId - Normalized job ID
     * @param {number} now - Current timestamp (optional, for performance)
     * @returns {boolean} - True if server is reserved
     */
    isServerReserved(normalizedId, now = null) {
        if (!this.reservedJobIds.has(normalizedId)) {
            return false;
        }
        const reserved = this.reservedJobIds.get(normalizedId);
        const timestamp = reserved.timestamp || reserved;
        const currentTime = now || Date.now();
        return (currentTime - timestamp) <= CONFIG.PENDING_TIMEOUT_MS;
    }

    /**
     * Check if a server is available for distribution
     * Server must be: not visited, not reserved, and in available pool
     * 
     * @param {string} normalizedId - Normalized job ID
     * @returns {boolean} - True if server is available
     */
    isServerAvailable(normalizedId) {
        return !this.isServerVisited(normalizedId) && 
               !this.isServerReserved(normalizedId) && 
               this.availableServers.has(normalizedId);
    }

    /**
     * Make HTTPS request to Roblox API
     * 
     * @param {string} url - Full URL to request
     * @returns {Promise<Object>} - Parsed JSON response
     * @throws {Error} - On request failure, timeout, or invalid response
     */
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

            // 25 second timeout
            request.setTimeout(25000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });

            request.on('error', error => {
                reject(new Error(`Request failed: ${error.message}`));
            });
        });
    }

    /**
     * Fetch a single page of servers from Roblox API
     * Implements exponential backoff retry for rate limits and timeouts
     * 
     * @param {string|null} cursor - Pagination cursor for next page
     * @param {number} retryCount - Current retry attempt (for exponential backoff)
     * @returns {Promise<Object|null>} - API response or null on failure
     */
    async fetchPage(cursor = null, retryCount = 0) {
        // Increased limit to 100 (max allowed by Roblox API) for more servers per page
        let url = `https://games.roblox.com/v1/games/${CONFIG.PLACE_ID}/servers/Public?sortOrder=Desc&limit=100&excludeFullGames=true`;
        if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
        }

        try {
            return await this.makeRequest(url);
        } catch (error) {
            // Exponential backoff for rate limits (max 5 retries, max delay 60s)
            if (error.message.includes('429') && retryCount < 5) {
                const delay = Math.min(5000 * Math.pow(2, retryCount), 60000);
                console.log(`[JobManager] Rate limited, retrying in ${delay}ms (${retryCount + 1}/5)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.fetchPage(cursor, retryCount + 1);
            }
            // Simple retry for timeouts (max 3 retries, 2s delay)
            if (error.message.includes('timeout') && retryCount < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.fetchPage(cursor, retryCount + 1);
            }
            return null;
        }
    }

    /**
     * Calculate priority score for server distribution
     * Higher priority = more players (closer to full)
     * 
     * Priority levels:
     * - 5: Almost full (maxPlayers - 1)
     * - 4: Near full (maxPlayers - 2)
     * - 3: More than half full
     * - 2: Has players
     * - 1: Empty
     * 
     * @param {number} players - Current player count
     * @param {number} maxPlayers - Maximum player capacity
     * @returns {number} - Priority score (1-5)
     */
    calculatePriority(players, maxPlayers) {
        if (players >= maxPlayers - 1) return 5;
        if (players >= maxPlayers - 2) return 4;
        if (players > maxPlayers * 0.5) return 3;
        if (players > 0) return 2;
        return 1;
    }

    /**
     * Validate if a server is acceptable for distribution
     * 
     * Requirements:
     * - Must have a valid job ID
     * - Player count must be within acceptable range
     * - Must not be a private server
     * 
     * @param {Object} server - Server object from Roblox API
     * @returns {boolean} - True if server is valid
     */
    isValidServer(server) {
        if (!server.id) return false;
        
        const players = server.playing || 0;
        const maxPlayers = server.maxPlayers || 6;
        
        // Filter by player count requirements
        // Exclude empty servers (if MIN_PLAYERS > 0) and full servers only
        if (players < CONFIG.MIN_PLAYERS || players >= maxPlayers) {
            return false;
        }
        
        // Reject private servers
        if (server.accessCode || server.PrivateServerId || server.privateServerId) {
            return false;
        }
        
        return true;
    }

    /**
     * Fetch bulk server job IDs from Roblox API
     * 
     * Fetches multiple pages of servers and adds them to the available pool.
     * Automatically skips visited servers to prevent re-distribution.
     * 
     * @param {boolean} forceRefresh - If true, clears cache before fetching
     * @returns {Promise<{total: number, added: number}>} - Fetch results
     */
    async fetchBulkJobIds(forceRefresh = false) {
        // Prevent concurrent fetches
        if (this.isFetching) {
            return { total: this.availableServers.size, added: 0 };
        }

        if (forceRefresh) {
            console.log('[JobManager] Force refresh: Clearing available servers cache...');
            this.availableServers.clear();
        } else if (this.availableServers.size >= CONFIG.MAX_JOB_IDS) {
            // Cache is full, no need to fetch
            return { total: this.availableServers.size, added: 0 };
        }

        this.isFetching = true;
        let totalAdded = 0;
        let totalSkipped = 0;
        let pagesFetched = 0;
        let cursor = null;

        // Remove any visited servers that might still be in the pool
        this.removeVisitedServersFromPool();

        try {
            // Fetch pages until we reach max or run out of pages
            while (pagesFetched < CONFIG.PAGES_TO_FETCH && this.availableServers.size < CONFIG.MAX_JOB_IDS) {
                const data = await this.fetchPage(cursor);
                
                if (!data?.data?.length) {
                    break;
                }

                const now = Date.now();

                // Process each server in the page (batch processing for efficiency)
                for (const server of data.data) {
                    if (!this.isValidServer(server)) {
                        continue;
                    }

                    const jobId = server.id;
                    const normalizedId = this.normalizeJobId(jobId);

                    // Skip visited servers (they're blacklisted)
                    if (this.isServerVisited(normalizedId)) {
                        totalSkipped++;
                        continue;
                    }

                    // Skip if already in pool
                    if (this.availableServers.has(normalizedId)) {
                        continue;
                    }
                    
                    // Skip if reserved (fast check)
                    if (this.isServerReserved(normalizedId, now)) {
                        continue;
                    }

                    const players = server.playing || 0;
                    const maxPlayers = server.maxPlayers || 6;

                    // Add to available pool
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

                // Reduced delay between pages for faster fetching
                // Only delay if we have more pages to fetch and haven't hit max
                if (cursor && pagesFetched < CONFIG.PAGES_TO_FETCH && this.availableServers.size < CONFIG.MAX_JOB_IDS) {
                    // Skip delay on first few pages for faster initial population
                    if (pagesFetched > 3) {
                        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_REQUESTS));
                    }
                }
            }
        } finally {
            this.isFetching = false;
            this.lastFetchTime = Date.now();
        }

        console.log(`[JobManager] Fetched ${totalAdded} new servers, skipped ${totalSkipped} visited servers (total available: ${this.availableServers.size})`);
        return { total: this.availableServers.size, added: totalAdded };
    }

    /**
     * Remove visited servers from available pool
     * 
     * Called before fetching to ensure visited servers aren't in the pool.
     * This is a safety check in case visited servers somehow remain in availableServers.
     * Optimized to batch deletions.
     */
    removeVisitedServersFromPool() {
        const now = Date.now();
        const visitedExpiry = CONFIG.VISITED_EXPIRY_MS;
        const toRemove = [];
        
        // Collect servers to remove in one pass
        for (const [normalizedId] of this.availableServers.entries()) {
            if (this.visitedJobIds.has(normalizedId)) {
                const visitedTime = this.visitedJobIds.get(normalizedId);
                if (now - visitedTime <= visitedExpiry) {
                    toRemove.push(normalizedId);
                }
            }
        }
        
        // Batch delete
        for (const normalizedId of toRemove) {
            this.availableServers.delete(normalizedId);
        }
        
        if (toRemove.length > 0) {
            console.log(`[JobManager] Removed ${toRemove.length} visited servers from available pool`);
        }
    }

    /**
     * Verify multiple servers at once via API (batch verification)
     * 
     * Efficiently checks multiple servers in a single API call.
     * Used right before distribution to prevent returning full servers.
     * 
     * @param {string[]} jobIds - Array of server job IDs to verify
     * @returns {Promise<Map<string, boolean>>} - Map of jobId -> isAvailable
     */
    async verifyServersAvailable(jobIds) {
        const result = new Map();
        if (!jobIds || jobIds.length === 0) {
            return result;
        }

        try {
            const data = await this.fetchPage(null, 0);
            if (!data?.data?.length) {
                // If API fails, mark all as unavailable (safer to reject than accept)
                for (const jobId of jobIds) {
                    result.set(jobId, false);
                }
                return result;
            }
            
            // Create a map of current server statuses
            const currentServerStatus = new Map();
            for (const server of data.data) {
                if (server.id) {
                    const players = server.playing || 0;
                    const maxPlayers = server.maxPlayers || 6;
                    const isAvailable = players < maxPlayers;
                    currentServerStatus.set(server.id, isAvailable);
                }
            }
            
            // Check each requested server
            for (const jobId of jobIds) {
                if (currentServerStatus.has(jobId)) {
                    result.set(jobId, currentServerStatus.get(jobId));
                } else {
                    // Server not found - likely stale, mark as unavailable
                    result.set(jobId, false);
                }
            }
        } catch (error) {
            // If verification fails, mark all as unavailable (safer to reject)
            for (const jobId of jobIds) {
                result.set(jobId, false);
            }
        }
        
        return result;
    }

    /**
     * Get next available server job ID(s) for distribution
     * 
     * Atomically removes servers from available pool and marks as reserved.
     * Verifies servers are not full right before distribution for immediate removal.
     * This ensures each server is only given to one user and is not full.
     * 
     * Process:
     * 1. Clean old/stale servers
     * 2. Filter candidates (exclude current, visited, reserved, stale)
     * 3. Use partial sort for efficiency (only sort top N candidates)
     * 4. Verify selected server(s) are not full via API (real-time check)
     * 5. Atomically remove from pool and mark as reserved
     * 
     * @param {string|null} currentJobId - Current server to exclude from results
     * @param {number} count - Number of servers to return (1-10)
     * @param {number} retryCount - Internal retry counter to prevent infinite recursion
     * @returns {Promise<Object|Object[]|null>} - Server object(s) or null if none available
     */
    async getNextJob(currentJobId, count = 1, retryCount = 0) {
        // Prevent concurrent distribution
        if (this.distributionLock) {
            return null;
        }

        this.distributionLock = true;
        try {
            // Clean up stale servers first
            this.cleanOldServers();

            const excludeId = currentJobId ? this.normalizeJobId(currentJobId) : null;
            const now = Date.now();
            const maxAge = CONFIG.JOB_ID_MAX_AGE_MS;
            const candidates = [];
            const visitedSet = new Set(); // Cache visited checks

            // Collect valid candidates with optimized checks
            for (const [normalizedId, server] of this.availableServers.entries()) {
                // Fast path: skip current server
                if (excludeId === normalizedId) continue;
                
                // Fast path: skip stale servers
                const age = now - (server.timestamp || 0);
                if (age > maxAge) continue;
                
                // Check visited (with caching to avoid repeated checks)
                if (visitedSet.has(normalizedId)) {
                    continue;
                }
                if (this.isServerVisited(normalizedId)) {
                    visitedSet.add(normalizedId);
                    continue;
                }
                visitedSet.add(normalizedId); // Cache negative result
                
                // Check reserved (fast check without cleanup)
                if (this.isServerReserved(normalizedId, now)) {
                    continue;
                }

                // Filter out full servers (safety check)
                // Exclude servers that are at max capacity
                if (server.players >= server.maxPlayers) {
                    continue;
                }
                
                // Additional safety: exclude servers that are old (more likely to be stale/full)
                // Servers older than 60 seconds are more likely to have incorrect player counts
                const serverAge = now - (server.timestamp || 0);
                if (serverAge > 60000) { // 60 seconds (very aggressive for fresh servers)
                    continue;
                }

                // Valid candidate - add with minimal object creation
                candidates.push({
                    id: server.id,
                    jobId: server.id,
                    players: server.players,
                    maxPlayers: server.maxPlayers,
                    timestamp: server.timestamp,
                    priority: server.priority,
                    normalizedId: normalizedId
                });
            }

            if (candidates.length === 0) {
                return null;
            }

            // Use partial sort: only sort if we need more than 1, or use efficient selection
            if (count === 1 && candidates.length > 1) {
                // Sort candidates by priority (best first)
                candidates.sort((a, b) => {
                    if (a.priority !== b.priority) {
                        return b.priority - a.priority;
                    }
                    return (b.players || 0) - (a.players || 0);
                });
                
                // Verify top 5 candidates at once (batch verification for efficiency)
                const topCandidates = candidates.slice(0, Math.min(5, candidates.length));
                const jobIdsToVerify = topCandidates.map(c => c.id);
                const verificationResults = await this.verifyServersAvailable(jobIdsToVerify);
                
                // Find first available server from verified candidates
                let best = null;
                for (const candidate of topCandidates) {
                    const isAvailable = verificationResults.get(candidate.id);
                    if (isAvailable === true) {
                        best = candidate;
                        break;
                    } else {
                        // Server is full or not found - remove from pool
                        const normalizedId = candidate.normalizedId;
                        this.availableServers.delete(normalizedId);
                        console.log(`[JobManager] Removed full/stale server ${candidate.id} from pool (real-time check)`);
                    }
                }
                
                if (!best) {
                    // All top candidates are full - try again with remaining candidates
                    if (retryCount < 2 && candidates.length > topCandidates.length) {
                        return this.getNextJob(currentJobId, count, retryCount + 1);
                    } else {
                        return null; // No available servers
                    }
                }
                
                const normalizedId = best.normalizedId;
                const serverData = this.availableServers.get(normalizedId);
                if (serverData) {
                    this.availableServers.delete(normalizedId);
                    this.reservedJobIds.set(normalizedId, {
                        timestamp: now,
                        serverData: serverData
                    });
                }
                console.log(`[JobManager] Distributed 1 server to frontend (${this.availableServers.size} remaining)`);
                return best;
            } else {
                // Sort by priority (higher priority first), then by player count
                candidates.sort((a, b) => {
                    if (a.priority !== b.priority) {
                        return b.priority - a.priority;
                    }
                    return (b.players || 0) - (a.players || 0);
                });

                // Verify top candidates in batch (more efficient)
                const topCandidates = candidates.slice(0, Math.min(count * 2, candidates.length));
                const jobIdsToVerify = topCandidates.map(c => c.id);
                const verificationMap = await this.verifyServersAvailable(jobIdsToVerify);

                // Collect available servers from verified candidates
                const verifiedResults = [];
                for (const candidate of topCandidates) {
                    if (verifiedResults.length >= count) break;
                    
                    const isAvailable = verificationMap.get(candidate.id);
                    if (isAvailable === true) {
                        verifiedResults.push(candidate);
                    } else {
                        // Server is full or not found - remove from pool
                        const normalizedId = candidate.normalizedId;
                        this.availableServers.delete(normalizedId);
                        console.log(`[JobManager] Removed full/stale server ${candidate.id} from pool (real-time check)`);
                    }
                }

                if (verifiedResults.length === 0) {
                    // All candidates became full - try again (max 2 retries)
                    if (retryCount < 2 && candidates.length > topCandidates.length) {
                        return this.getNextJob(currentJobId, count, retryCount + 1);
                    } else {
                        return null; // No available servers
                    }
                }

                // Atomically remove from pool and mark as reserved
                for (const result of verifiedResults) {
                    const normalizedId = result.normalizedId;
                    const serverData = this.availableServers.get(normalizedId);
                    if (serverData) {
                        this.availableServers.delete(normalizedId);
                        this.reservedJobIds.set(normalizedId, {
                            timestamp: now,
                            serverData: serverData
                        });
                    }
                }

                console.log(`[JobManager] Distributed ${verifiedResults.length} server(s) to frontend (${this.availableServers.size} remaining)`);
                return count === 1 ? verifiedResults[0] : verifiedResults;
            }
        } catch (error) {
            console.error('[JobManager] Error in getNextJob:', error);
            return null;
        } finally {
            this.distributionLock = false;
        }
    }

    /**
     * Mark server(s) as visited (blacklist for 30 minutes)
     * 
     * When a frontend script runs on a server, it calls this to mark it as visited.
     * The server is then blacklisted for 30 minutes to prevent duplicate distribution.
     * 
     * Process:
     * 1. Add to visitedJobIds with current timestamp
     * 2. Remove from availableServers (if still there)
     * 3. Remove from reservedJobIds (if still there)
     * 
     * After 30 minutes, the server automatically expires and becomes available again.
     * 
     * @param {string|string[]} jobIds - Single job ID or array of job IDs
     * @returns {number} - Number of servers newly marked as visited
     */
    markVisited(jobIds) {
        if (!jobIds) return 0;

        const ids = Array.isArray(jobIds) ? jobIds : [jobIds];
        let newlyMarked = 0;
        const now = Date.now();

        for (const jobId of ids) {
            if (!jobId) continue;
            const normalizedId = this.normalizeJobId(jobId);

            // Skip if already visited (avoid duplicate timestamps)
            if (this.isServerVisited(normalizedId)) {
                continue;
            }

            // Mark as visited with current timestamp (expires in 30 minutes)
            this.visitedJobIds.set(normalizedId, now);
            // Remove from available pool
            this.availableServers.delete(normalizedId);
            // Remove from reserved list
            this.reservedJobIds.delete(normalizedId);
            newlyMarked++;
        }

        if (newlyMarked > 0) {
            console.log(`[JobManager] Marked ${newlyMarked} server(s) as visited - will expire in 30 minutes (${this.visitedJobIds.size} total visited)`);
        }

        return newlyMarked;
    }

    /**
     * Clean up stale servers from available pool
     * 
     * Removes servers older than JOB_ID_MAX_AGE_MS (60 seconds).
     * Stale servers may have incorrect player counts or be unavailable.
     * Also removes servers that appear full based on cached data.
     */
    cleanOldServers() {
        const now = Date.now();
        const maxAge = CONFIG.JOB_ID_MAX_AGE_MS;
        let removedOld = 0;
        let removedFull = 0;

        for (const [normalizedId, server] of this.availableServers.entries()) {
            // Remove stale servers (older than max age)
            if (now - server.timestamp > maxAge) {
                this.availableServers.delete(normalizedId);
                removedOld++;
                continue;
            }
            
            // Also remove servers that appear full (safety check)
            // This catches servers that became full since being added to pool
            if (server.players >= server.maxPlayers) {
                this.availableServers.delete(normalizedId);
                removedFull++;
            }
        }

        if (removedOld > 0 || removedFull > 0) {
            console.log(`[JobManager] Cleaned ${removedOld} expired servers, ${removedFull} full servers from available pool`);
        }
    }

    /**
     * Clean up expired reserved servers
     * 
     * Releases servers that were reserved but never marked as visited.
     * This happens if a frontend request fails or times out.
     * Servers are released after PENDING_TIMEOUT_MS (10 seconds).
     * 
     * IMPORTANT: Instead of restoring to pool, expired reserved servers are marked as visited
     * (blacklisted for 30 minutes). This ensures that once a server is distributed, it stays
     * out of circulation for 30+ minutes, preventing rapid re-distribution.
     * 
     * @returns {number} - Number of servers released and blacklisted
     */
    cleanupReservedServers() {
        const now = Date.now();
        let expired = 0;
        let blacklisted = 0;

        for (const [normalizedId, reserved] of this.reservedJobIds.entries()) {
            // Support both old format (timestamp) and new format (object)
            const timestamp = reserved.timestamp || reserved;
            const age = now - timestamp;
            
            if (age > CONFIG.PENDING_TIMEOUT_MS) {
                this.reservedJobIds.delete(normalizedId);
                expired++;
                
                // Mark as visited (blacklist for 30 minutes) instead of restoring to pool
                // This ensures servers stay out of circulation for 30+ minutes once distributed
                if (!this.isServerVisited(normalizedId)) {
                    this.visitedJobIds.set(normalizedId, now);
                    // Remove from available pool if somehow still there
                    this.availableServers.delete(normalizedId);
                    blacklisted++;
                }
            }
        }

        if (expired > 0) {
            console.log(`[JobManager] Released ${expired} expired reserved servers (${blacklisted} blacklisted for 30 minutes)`);
        }

        return expired;
    }

    /**
     * Clean up expired visited servers from blacklist
     * 
     * Removes servers from blacklist after VISITED_EXPIRY_MS (30 minutes).
     * These servers become available for distribution again.
     * 
     * @returns {number} - Number of servers removed from blacklist
     */
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

    /**
     * Check and remove full servers from available pool
     * 
     * Periodically verifies servers in the pool by fetching current server list from Roblox API.
     * Removes servers that are now full to prevent "server full" errors.
     * 
     * Process:
     * 1. Sample a batch of servers from available pool
     * 2. Fetch current server list from Roblox API
     * 3. Check which servers are now full
     * 4. Remove full servers from pool
     * 
     * @returns {Promise<number>} - Number of full servers removed
     */
    async checkAndRemoveFullServers() {
        // Don't check if pool is empty or we're already fetching
        if (this.availableServers.size === 0 || this.isFetching) {
            return 0;
        }

        // Sample servers to check (limit batch size to avoid rate limits)
        const serversToCheck = [];
        const batchSize = Math.min(CONFIG.FULL_SERVER_CHECK_BATCH_SIZE, this.availableServers.size);
        let count = 0;

        for (const [normalizedId, server] of this.availableServers.entries()) {
            if (count >= batchSize) break;
            serversToCheck.push({ normalizedId, jobId: server.id });
            count++;
        }

        if (serversToCheck.length === 0) {
            return 0;
        }

        try {
            // Fetch current server list from Roblox API
            const data = await this.fetchPage(null, 0);
            
            if (!data?.data?.length) {
                return 0;
            }

            // Create a map of current server statuses (jobId -> isFull)
            const currentServerStatus = new Map();
            for (const server of data.data) {
                if (server.id) {
                    const players = server.playing || 0;
                    const maxPlayers = server.maxPlayers || 6;
                    const isFull = players >= maxPlayers;
                    currentServerStatus.set(server.id, isFull);
                }
            }

            // Check sampled servers and remove full ones
            const toRemove = [];
            for (const { normalizedId, jobId } of serversToCheck) {
                // Check if server is now full
                if (currentServerStatus.has(jobId)) {
                    const isFull = currentServerStatus.get(jobId);
                    if (isFull) {
                        toRemove.push(normalizedId);
                    } else {
                        // Server exists and is not full - update player count in cache
                        const serverData = this.availableServers.get(normalizedId);
                        if (serverData) {
                            const currentServer = data.data.find(s => s.id === jobId);
                            if (currentServer) {
                                serverData.players = currentServer.playing || 0;
                                serverData.maxPlayers = currentServer.maxPlayers || 6;
                                serverData.timestamp = Date.now(); // Refresh timestamp
                                // Re-check if it's now full after update
                                if (serverData.players >= serverData.maxPlayers) {
                                    toRemove.push(normalizedId);
                                }
                            }
                        }
                    }
                } else {
                    // Server not found in API response - might be stale, remove it
                    toRemove.push(normalizedId);
                }
            }

            // Batch remove full servers
            for (const normalizedId of toRemove) {
                this.availableServers.delete(normalizedId);
            }

            if (toRemove.length > 0) {
                console.log(`[JobManager] Removed ${toRemove.length} full/stale server(s) from available pool (checked ${serversToCheck.length} servers)`);
            }

            return toRemove.length;
        } catch (error) {
            // Don't log errors - this is a background task and failures are expected
            // (rate limits, network issues, etc.)
            return 0;
        }
    }

    /**
     * Get cache statistics for monitoring
     * 
     * @returns {Object} - Cache information object
     */
    getCacheInfo() {
        // Count only non-expired reserved servers (optimized)
        let activeReserved = 0;
        const now = Date.now();
        const timeout = CONFIG.PENDING_TIMEOUT_MS;
        
        // Fast iteration with early exit optimization
        for (const reserved of this.reservedJobIds.values()) {
            const timestamp = reserved.timestamp || reserved;
            if (now - timestamp <= timeout) {
                activeReserved++;
            }
        }
        
        return {
            available: this.availableServers.size,
            visited: this.visitedJobIds.size,
            reserved: activeReserved,
            isFetching: this.isFetching,
            lastFetchTime: this.lastFetchTime
        };
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

const jobManager = new JobManager();

// ============================================================================
// BACKGROUND TASKS
// ============================================================================

/**
 * Initial Server Fetch
 * 
 * Fetches servers on startup if cache is low (< 500 servers).
 * Ensures server pool is populated before first request.
 */
setImmediate(() => {
    if (jobManager.availableServers.size < 500) {
        jobManager.fetchBulkJobIds().catch(err => {
            console.error('[JobManager] Initial fetch error:', err.message);
        });
    }
});

/**
 * Auto-Refresh Task (runs every 1 minute)
 * 
 * Automatically fetches more servers when cache drops below 50% capacity.
 * More aggressive threshold and faster interval for faster job ID population.
 */
setInterval(() => {
    if (!jobManager.isFetching && jobManager.availableServers.size < CONFIG.MAX_JOB_IDS * 0.5) {
        jobManager.fetchBulkJobIds().catch(err => {
            console.error('[JobManager] Auto-refresh error:', err.message);
        });
    }
}, 60000); // 1 minute instead of 2

/**
 * Full Cache Refresh (runs every 10 minutes)
 * 
 * Performs a complete cache refresh by clearing and re-fetching all servers.
 * Ensures server data stays fresh and removes any stale entries.
 */
setInterval(() => {
    if (!jobManager.isFetching) {
        console.log('[JobManager] Starting full cache refresh...');
        jobManager.fetchBulkJobIds(true).then(result => {
            console.log(`[JobManager] Full refresh complete: ${result.added} servers added (total: ${result.total})`);
        }).catch(err => {
            console.error('[JobManager] Full refresh error:', err.message);
        });
    }
}, CONFIG.FULL_REFRESH_INTERVAL_MS);

/**
 * Periodic Cleanup Task (runs every 1 minute)
 * 
 * Performs maintenance tasks:
 * - Removes stale servers from available pool (also removes full servers)
 * - Releases expired reserved servers
 * - Removes expired visited servers from blacklist (30 min expiry)
 * - Cleans up old pet finds
 * - Checks and removes full servers (runs in parallel)
 */
setInterval(() => {
    jobManager.cleanOldServers(); // Now also removes full servers
    jobManager.cleanupReservedServers();
    jobManager.cleanupExpiredVisitedServers();
    petFindStorage.cleanup();
    
    // Also run full server check during cleanup (double-check)
    if (!jobManager.isFetching && jobManager.availableServers.size > 0) {
        jobManager.checkAndRemoveFullServers().catch(() => {});
    }
}, CONFIG.CLEANUP_INTERVAL_MS);

/**
 * Full Server Check Task (runs every 15 seconds)
 * 
 * Periodically checks servers in the available pool to verify they're not full.
 * Removes full servers immediately to prevent "server full" errors for frontend clients.
 * 
 * This runs asynchronously and doesn't block other operations.
 * Very frequent checks (15 seconds) ensure full servers are removed as soon as they fill up.
 */
setInterval(() => {
    if (!jobManager.isFetching && jobManager.availableServers.size > 0) {
        jobManager.checkAndRemoveFullServers().catch(() => {
            // Silently fail - this is a background maintenance task
        });
    }
}, CONFIG.FULL_SERVER_CHECK_INTERVAL_MS);

/**
 * GET /api/job-ids
 * Legacy endpoint - redirects to /api/server/next for backwards compatibility
 */
app.get('/api/job-ids', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint deprecated',
        message: 'Use /api/server/next instead',
        redirect: '/api/server/next'
    });
});

/**
 * GET /health
 * Health check endpoint for Railway monitoring (no authentication required)
 * 
 * Railway uses this endpoint to verify the service is running.
 * Returns server status, cache info, and storage stats.
 */
app.get('/health', (req, res) => {
    try {
        const cacheInfo = jobManager.getCacheInfo();
        const storageStats = petFindStorage.getStats();
        
        // Determine health status
        const isHealthy = cacheInfo.available > 0 || cacheInfo.isFetching;
        
        res.status(isHealthy ? 200 : 503).json({ 
            status: isHealthy ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            },
            cache: cacheInfo,
            storage: storageStats
        });
    } catch (error) {
        console.error('[Health] Error:', error);
        res.status(500).json({ 
            status: 'error', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/pet-found
 * Submit pet finds from frontend scripts
 * 
 * Accepts single find object or array of finds in body.
 * Supports batch submission (max 500 per request).
 * 
 * Headers:
 * - X-API-Key: Required (authentication)
 * - X-User-Id: Optional (account name)
 * 
 * Body:
 * - { finds: [...] } or single find object
 * - find object: { petName, mps, generation, rarity, mutation, placeId, jobId, ... }
 * 
 * Returns: { success, message, added, skipped, duplicates, invalid }
 */
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

/**
 * GET /api/server/next
 * Get next available server job ID(s) for distribution
 * 
 * Returns unique, unvisited server(s) to frontend scripts.
 * Server is atomically removed from pool and marked as reserved.
 * 
 * Query Parameters:
 * - currentJobId: Optional - Current server to exclude from results
 * - count: Optional (1-10, default: 1) - Number of servers to return
 * 
 * Headers:
 * - X-API-Key: Required (authentication)
 * 
 * Returns: { success, jobId, players, maxPlayers, timestamp, priority }
 * Or: { success, jobs: [...], count } for multiple servers
 * 
 * Status Codes:
 * - 200: Success
 * - 503: No servers available (cache empty/refreshing)
 */
app.get('/api/server/next', rateLimit, authenticate, async (req, res) => {
    try {
        const currentJobId = req.query.currentJobId ? String(req.query.currentJobId).trim() : null;
        const count = Math.min(Math.max(parseInt(req.query.count) || 1, 1), 10);

        const result = await jobManager.getNextJob(currentJobId, count);

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

/**
 * POST /api/server/visited
 * Mark server(s) as visited (blacklist for 30 minutes)
 * 
 * Called by frontend when script runs on a server.
 * Permanently blacklists server for 30 minutes to prevent duplicate distribution.
 * 
 * Body:
 * - { jobId: string } or { jobIds: string[] }
 * 
 * Headers:
 * - X-API-Key: Required (authentication)
 * 
 * Returns: { success, message, marked }
 */
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

/**
 * GET /api/pets
 * Retrieve stored pet finds with optional filtering
 * 
 * Query Parameters:
 * - minMps: Optional - Minimum MPS (Millions Per Second) threshold
 * - petName: Optional - Filter by pet name (partial match)
 * - since: Optional - Timestamp to filter finds after
 * - limit: Optional (default: 100, max: 500) - Number of results
 * 
 * Headers:
 * - X-API-Key: Required (authentication)
 * 
 * Returns: { success, count, total, recent, pets: [...] }
 */
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

// Start server - Railway requires binding to 0.0.0.0
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] ✓ Started successfully on port ${PORT}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[Server] Place ID: ${CONFIG.PLACE_ID}`);
    console.log(`[Server] API Key: ${API_KEY.substring(0, 10)}...`);
    console.log(`[Server] Max Job IDs: ${CONFIG.MAX_JOB_IDS}`);
    console.log(`[Server] Visited expiry: ${CONFIG.VISITED_EXPIRY_MS / 60000} minutes`);
    console.log(`[Server] Ready to accept connections`);
});

// Handle server errors gracefully
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use`);
        process.exit(1);
    } else {
        console.error('[Server] Error:', error);
    }
});

/**
 * Graceful shutdown handler
 * Railway sends SIGTERM when stopping containers - handle it gracefully
 * 
 * @param {string} signal - Termination signal (SIGTERM, SIGINT)
 */
function shutdown(signal) {
    console.log(`[Server] ${signal} received, shutting down gracefully...`);
    
    // Stop accepting new connections
    server.close(() => {
        console.log('[Server] HTTP server closed');
        
        // Clear all intervals to prevent hanging
        const highestIntervalId = setInterval(() => {}, 9999);
        for (let i = 0; i < highestIntervalId; i++) {
            clearInterval(i);
        }
        
        console.log('[Server] Cleanup complete, exiting...');
        process.exit(0);
    });
    
    // Force shutdown after 10 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

// Railway sends SIGTERM for graceful shutdowns
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Global error handlers - Railway will restart the container if needed
process.on('uncaughtException', (error) => {
    console.error('[UncaughtException]', error);
    console.error('[UncaughtException] Stack:', error.stack);
    // Don't exit - let Railway handle restarts if needed
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UnhandledRejection]', reason);
    if (reason instanceof Error) {
        console.error('[UnhandledRejection] Stack:', reason.stack);
    }
    // Don't exit - let Railway handle restarts if needed
});

