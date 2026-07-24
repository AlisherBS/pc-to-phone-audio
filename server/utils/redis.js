// utils/redis.js - Redis client and helpers
const redis = require('redis');
const logger = require('./logger');

let redisClient;

async function createRedisClient(url) {
    redisClient = redis.createClient({ url });

    redisClient.on('error', (err) => logger.error({ err }, 'Redis error'));
    redisClient.on('connect', () => logger.info('Redis connected'));

    await redisClient.connect();
    await redisClient.ping(); // Verify connection
    return redisClient;
}

function getRedisClient() {
    return redisClient;
}

// Room operations
async function saveRoomToRedis(roomId, roomData) {
    try {
        await redisClient.setEx(
            `room:${roomId}`,
            3600,
            JSON.stringify(roomData)
        );
    } catch (e) {
        logger.error({ err: e, roomId }, 'Redis save room error');
    }
}

async function getRoomFromRedis(roomId) {
    try {
        const data = await redisClient.get(`room:${roomId}`);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        logger.error({ err: e, roomId }, 'Redis get room error');
        return null;
    }
}

async function deleteRoomFromRedis(roomId) {
    try {
        await redisClient.del(`room:${roomId}`);
    } catch (e) {
        logger.error({ err: e, roomId }, 'Redis delete room error');
    }
}

// Metrics
async function incrementMetric(metric) {
    try {
        await redisClient.incr(`metric:${metric}`);
    } catch (e) {
        logger.error({ err: e, metric }, 'Metric increment error');
    }
}

// Event log
async function logEvent(event, data) {
    try {
        const log = {
            timestamp: new Date().toISOString(),
            event,
            data
        };
        await redisClient.lPush('events', JSON.stringify(log));
        await redisClient.lTrim('events', 0, 999);
    } catch (e) {
        logger.error({ err: e, event }, 'Event log error');
    }
}

// SCAN-based key search (replaces redis.keys())
async function scanKeys(pattern) {
    const keys = [];
    let cursor = 0;
    do {
        const result = await redisClient.scan(cursor, {
            MATCH: pattern,
            COUNT: 100
        });
        cursor = result.cursor;
        keys.push(...result.keys);
    } while (cursor !== 0);
    return keys;
}

module.exports = {
    createRedisClient,
    getRedisClient,
    saveRoomToRedis,
    getRoomFromRedis,
    deleteRoomFromRedis,
    incrementMetric,
    logEvent,
    scanKeys
};
