const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let petFinds = [];
const MAX_FINDS = 1000;

const rateLimitStore = new Map();

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const now = Date.now();
    
    if (!rateLimitStore.has(ip)) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + 10000 });
        return next();
    }
    
    const limit = rateLimitStore.get(ip);
    
    if (now > limit.resetTime) {
        limit.count = 1;
        limit.resetTime = now + 10000;
        return next();
    }
    
    if (limit.count >= 5) {
        return res.status(429).json({ 
            success: false, 
            error: 'Rate limit exceeded. Maximum 5 requests per 10 seconds.' 
        });
    }
    
    limit.count++;
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, limit] of rateLimitStore.entries()) {
        if (now > limit.resetTime + 60000) {
            rateLimitStore.delete(ip);
        }
    }
}, 60000);

app.post('/api/pet-found', rateLimit, (req, res) => {
    try {
        const body = req.body;
        const finds = body.finds || [body];
        
        if (!Array.isArray(finds) || finds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request. Expected "finds" array or single find object.' 
            });
        }
        
        const accountName = body.accountName || finds[0]?.accountName || "Unknown";
        let addedCount = 0;
        
        for (const findData of finds) {
            const find = {
                id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9),
                petName: findData.petName,
                generation: findData.generation,
                mps: findData.mps,
                rarity: findData.rarity || "Unknown",
                placeId: findData.placeId,
                jobId: findData.jobId,
                playerCount: findData.playerCount,
                maxPlayers: findData.maxPlayers || 6,
                accountName: findData.accountName || accountName,
                timestamp: findData.timestamp || Date.now(),
                receivedAt: new Date().toISOString()
            };
            
            petFinds.unshift(find);
            addedCount++;
        }
        
        if (petFinds.length > MAX_FINDS) {
            petFinds = petFinds.slice(0, MAX_FINDS);
        }
        
        console.log(`[API] Received batch of ${addedCount} pet finds from ${accountName}`);
        
        res.status(200).json({ 
            success: true, 
            message: `Received ${addedCount} pet find(s)`,
            received: addedCount 
        });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const finds = petFinds.slice(0, limit);
        res.json({ success: true, finds: finds, total: petFinds.length });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/finds/recent', rateLimit, (req, res) => {
    try {
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        const recent = petFinds.filter(find => {
            const findTime = new Date(find.receivedAt || find.timestamp * 1000).getTime();
            return findTime > tenMinutesAgo;
        });
        
        console.log(`[API] Total finds in storage: ${petFinds.length}, Recent (last 10min): ${recent.length}`);
        if (recent.length > 0) {
            console.log(`[API] First find - placeId: ${recent[0].placeId}, jobId: ${recent[0].jobId}, petName: ${recent[0].petName}`);
        } else if (petFinds.length > 0) {
            const oldestFind = petFinds[petFinds.length - 1];
            const oldestTime = new Date(oldestFind.receivedAt || oldestFind.timestamp * 1000).getTime();
            const ageMinutes = Math.floor((Date.now() - oldestTime) / (60 * 1000));
            console.log(`[API] All finds are older than 10 minutes. Oldest find is ${ageMinutes} minutes old.`);
        } else {
            console.log(`[API] No finds in storage at all. Waiting for bots to send data.`);
        }
        
        res.json({ success: true, finds: recent, total: recent.length });
    } catch (error) {
        console.error('[API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/finds', (req, res) => {
    petFinds = [];
    res.json({ success: true, message: 'All finds cleared' });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        status: 'running',
        totalFinds: petFinds.length,
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    res.json({ 
        message: 'Pet Finder API Server',
        endpoints: {
            'POST /api/pet-found': 'Receive pet finds from bots',
            'GET /api/finds': 'Get all finds',
            'GET /api/finds/recent': 'Get recent finds',
            'DELETE /api/finds': 'Clear all finds',
            'GET /api/health': 'Health check'
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Pet Finder API Server running on port ${PORT}`);
    console.log(`[API] Security: Rate limiting enabled (5 req/10s)`);
    console.log(`[API] Endpoints:`);
    console.log(`[API]   POST /api/pet-found - Receive pet finds (batched)`);
    console.log(`[API]   GET  /api/finds - Get all finds`);
    console.log(`[API]   GET  /api/finds/recent - Get recent finds (public)`);
    console.log(`[API]   DELETE /api/finds - Clear all finds`);
    console.log(`[API]   GET  /api/health - Health check`);
});
