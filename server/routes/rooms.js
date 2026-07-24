// routes/rooms.js - Persistent rooms CRUD API for Premium Users
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const validator = require('validator');

const { verifyJWT } = require('../middleware/auth');
const { get, query, run } = require('../utils/database');
const { deleteRoomFromRedis } = require('../utils/redis');
const { sanitizeInput } = require('../utils/helpers');
const logger = require('../utils/logger');

// Middleware to ensure user is Premium
async function requirePremium(req, res, next) {
    try {
        const { userId } = req.user;
        const user = await get('SELECT isPremium, premiumExpiresAt FROM users WHERE id = ?', [userId]);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check expiry if set
        let isPremium = user.isPremium === 1;
        if (isPremium && user.premiumExpiresAt) {
            if (new Date(user.premiumExpiresAt) < new Date()) {
                isPremium = false;
                // Auto-downgrade expired user
                await run('UPDATE users SET isPremium = 0 WHERE id = ?', [userId]);
            }
        }

        if (!isPremium) {
            return res.status(403).json({ error: 'Premium subscription required to manage permanent rooms' });
        }

        next();
    } catch (e) {
        logger.error({ err: e }, 'Error checking premium status');
        res.status(500).json({ error: 'Server error' });
    }
}

// GET /api/rooms - Get all rooms for authenticated Premium user
router.get('/', verifyJWT, requirePremium, async (req, res) => {
    try {
        const { userId } = req.user;
        const rooms = await query(
            'SELECT id, roomId, displayName, password, createdAt FROM rooms WHERE userId = ? ORDER BY createdAt DESC',
            [userId]
        );
        
        // Strip sensitive actual password string, just indicate if protected
        const safeRooms = rooms.map(r => ({
            id: r.id,
            roomId: r.roomId,
            displayName: r.displayName || r.roomId,
            hasPassword: !!r.password,
            createdAt: r.createdAt
        }));

        res.json(safeRooms);
    } catch (e) {
        logger.error({ err: e }, 'Error fetching rooms');
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/rooms - Create a permanent room
router.post('/', verifyJWT, requirePremium, async (req, res) => {
    try {
        const { userId } = req.user;
        const { roomId, displayName, password } = req.body;

        const cleanRoomId = sanitizeInput(roomId, 12);
        const cleanDisplayName = displayName ? sanitizeInput(displayName, 50) : cleanRoomId;
        const cleanPassword = password ? sanitizeInput(password, 50) : null;

        if (!cleanRoomId || !validator.isAlphanumeric(cleanRoomId) || cleanRoomId.length > 12) {
            return res.status(400).json({ error: 'Room ID must be alphanumeric and up to 12 characters' });
        }

        // Check if roomId already exists in SQLite permanent rooms
        const existing = await get('SELECT id FROM rooms WHERE roomId = ?', [cleanRoomId]);
        if (existing) {
            return res.status(400).json({ error: 'Room ID is already taken' });
        }

        // Check total rooms limit per premium user (max 10 permanent rooms)
        const countRes = await get('SELECT COUNT(*) as count FROM rooms WHERE userId = ?', [userId]);
        if (countRes && countRes.count >= 10) {
            return res.status(400).json({ error: 'Maximum limit of 10 permanent rooms reached' });
        }

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        await run(
            'INSERT INTO rooms (id, roomId, displayName, password, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, cleanRoomId, cleanDisplayName, cleanPassword, userId, createdAt]
        );

        logger.info({ userId, roomId: cleanRoomId }, 'Permanent room created');

        res.status(201).json({
            id,
            roomId: cleanRoomId,
            displayName: cleanDisplayName,
            hasPassword: !!cleanPassword,
            createdAt
        });
    } catch (e) {
        logger.error({ err: e }, 'Error creating room');
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/rooms/:id - Update room settings
router.put('/:id', verifyJWT, requirePremium, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;
        const { displayName, password } = req.body;

        // Verify ownership
        const room = await get('SELECT roomId FROM rooms WHERE id = ? AND userId = ?', [id, userId]);
        if (!room) {
            return res.status(404).json({ error: 'Room not found or unauthorized' });
        }

        const cleanDisplayName = displayName ? sanitizeInput(displayName, 50) : room.roomId;
        const cleanPassword = password ? sanitizeInput(password, 50) : null;

        await run(
            'UPDATE rooms SET displayName = ?, password = ? WHERE id = ?',
            [cleanDisplayName, cleanPassword, id]
        );

        // Optionally evict active session from Redis to enforce new password immediately
        if (typeof deleteRoomFromRedis === 'function') {
            await deleteRoomFromRedis(room.roomId).catch(() => {});
        }

        logger.info({ userId, roomId: room.roomId }, 'Permanent room updated');

        res.json({
            id,
            roomId: room.roomId,
            displayName: cleanDisplayName,
            hasPassword: !!cleanPassword
        });
    } catch (e) {
        logger.error({ err: e }, 'Error updating room');
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/rooms/:id - Delete a room
router.delete('/:id', verifyJWT, requirePremium, async (req, res) => {
    try {
        const { userId } = req.user;
        const { id } = req.params;

        const room = await get('SELECT roomId FROM rooms WHERE id = ? AND userId = ?', [id, userId]);
        if (!room) {
            return res.status(404).json({ error: 'Room not found or unauthorized' });
        }

        await run('DELETE FROM rooms WHERE id = ?', [id]);

        if (typeof deleteRoomFromRedis === 'function') {
            await deleteRoomFromRedis(room.roomId).catch(() => {});
        }

        logger.info({ userId, roomId: room.roomId }, 'Permanent room deleted');

        res.json({ success: true });
    } catch (e) {
        logger.error({ err: e }, 'Error deleting room');
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
