// routes/admin.js - Admin routes with SQLite support
const express = require('express');
const router = express.Router();

const { verifyAdmin } = require('../middleware/auth');
const { getRedisClient, logEvent, scanKeys } = require('../utils/redis');
const { generateId } = require('../utils/helpers');
const { query, run, get } = require('../utils/database');
const logger = require('../utils/logger');

// All admin routes require admin authentication
router.use(verifyAdmin);

// Create promo code (Still in Redis)
router.post('/promo', async (req, res) => {
    try {
        const { duration, maxUses } = req.body;
        const redisClient = getRedisClient();

        const validDuration = parseInt(duration);
        if (!validDuration || validDuration < 1 || validDuration > 365 * 24 * 60 * 60 * 1000) {
            return res.status(400).json({ error: 'Invalid duration' });
        }

        const validMaxUses = parseInt(maxUses);
        if (!validMaxUses || validMaxUses < 1 || validMaxUses > 10000) {
            return res.status(400).json({ error: 'Invalid maxUses' });
        }

        const code = generateId(8);
        const promoData = {
            code,
            duration: validDuration,
            maxUses: validMaxUses,
            uses: 0,
            createdAt: new Date().toISOString()
        };

        await redisClient.set(`promo:${code}`, JSON.stringify(promoData));
        await logEvent('promo_created', { code, maxUses: validMaxUses });

        res.json({ code, ...promoData });
    } catch (e) {
        logger.error({ err: e }, 'Promo creation error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all promo codes
router.get('/promos', async (req, res) => {
    try {
        const redisClient = getRedisClient();
        const keys = await scanKeys('promo:*');
        const promos = [];

        for (const key of keys) {
            const data = await redisClient.get(key);
            if (data) {
                promos.push(JSON.parse(data));
            }
        }

        promos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ promos });
    } catch (e) {
        logger.error({ err: e }, 'Get promos error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Get analytics (Mixed Redis + SQLite)
router.get('/analytics', async (req, res) => {
    try {
        const redisClient = getRedisClient();

        // Get total users from SQLite
        const userCountResult = await get('SELECT COUNT(*) as total FROM users');
        const totalUsers = userCountResult.total;

        const totalConnections = await redisClient.get('metric:total_connections') || 0;
        const premiumActivations = await redisClient.get('metric:premium_activations') || 0;

        const roomKeys = await scanKeys('room:*');
        const activeRooms = roomKeys.length;

        const events = await redisClient.lRange('events', 0, 99);
        const recentEvents = events.map(e => {
            try {
                return JSON.parse(e);
            } catch (err) {
                return { event: 'parse_error', data: e };
            }
        });

        res.json({
            totalUsers: parseInt(totalUsers),
            totalConnections: parseInt(totalConnections),
            premiumActivations: parseInt(premiumActivations),
            activeRooms,
            recentEvents
        });
    } catch (e) {
        logger.error({ err: e }, 'Analytics error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all rooms (Redis)
router.get('/rooms', async (req, res) => {
    try {
        const redisClient = getRedisClient();
        const roomKeys = await scanKeys('room:*');
        const roomsData = [];

        for (const key of roomKeys) {
            const data = await redisClient.get(key);
            if (data) {
                const room = JSON.parse(data);
                delete room.password;
                roomsData.push({
                    id: key.replace('room:', ''),
                    ...room
                });
            }
        }

        res.json({ rooms: roomsData });
    } catch (e) {
        logger.error({ err: e }, 'Get rooms error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all users (SQLite)
router.get('/users', async (req, res) => {
    try {
        const users = await query('SELECT id, email, isPremium, premiumExpiresAt, subscriptionId, createdAt, provider FROM users ORDER BY createdAt DESC');
        
        // Map SQLite fields for frontend consistency
        const formattedUsers = users.map(u => ({
            ...u,
            userId: u.id, // Add userId for admin panel compatibility
            isPremium: u.isPremium === 1
        }));

        res.json({ users: formattedUsers });
    } catch (e) {
        logger.error({ err: e }, 'Get users error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Update user subscription (SQLite)
router.put('/users/:email/subscription', async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        const { isPremium, premiumExpiresAt, subscriptionId } = req.body;

        const user = await get('SELECT id FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const isPremiumVal = isPremium ? 1 : 0;
        
        await run(
            'UPDATE users SET isPremium = ?, premiumExpiresAt = ?, subscriptionId = ? WHERE email = ?',
            [isPremiumVal, premiumExpiresAt || null, subscriptionId || null, email]
        );

        await logEvent('admin_subscription_update', { email, isPremium, premiumExpiresAt });
        logger.info({ email, isPremium }, 'Admin updated user subscription in SQLite');

        res.json({ success: true });
    } catch (e) {
        logger.error({ err: e }, 'Update subscription error');
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
