// utils/migrate.js - Migration script from Redis to SQLite
require('dotenv').config();
const { createRedisClient, getRedisClient, scanKeys } = require('./redis');
const { run, get } = require('./database');
const logger = require('./logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function migrate() {
    logger.info('Starting migration from Redis to SQLite...');

    try {
        await createRedisClient(REDIS_URL);
        const redisClient = getRedisClient();
        
        // Use scanKeys instead of keys() for better reliability
        const keys = await scanKeys('user:*');
        logger.info(`Found ${keys.length} users in Redis`);

        for (const key of keys) {
            const userDataStr = await redisClient.get(key);
            if (!userDataStr) continue;

            const user = JSON.parse(userDataStr);
            const email = user.email;
            if (!email) continue;
            
            // Check if user already exists in SQLite
            const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
            
            if (existing) {
                logger.info(`Updating existing user: ${email}`);
                await run(
                    'UPDATE users SET isPremium = ?, premiumExpiresAt = ?, subscriptionId = ? WHERE email = ?',
                    [user.isPremium ? 1 : 0, user.premiumExpiresAt, user.subscriptionId, email]
                );
            } else {
                logger.info(`Migrating new user: ${email}`);
                await run(
                    'INSERT INTO users (id, email, passwordHash, isPremium, premiumExpiresAt, subscriptionId, createdAt, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        user.userId || user.id, 
                        email, 
                        user.passwordHash || '', 
                        user.isPremium ? 1 : 0, 
                        user.premiumExpiresAt || null, 
                        user.subscriptionId || null, 
                        user.createdAt || new Date().toISOString(),
                        user.provider || 'local'
                    ]
                );
            }
        }
        logger.info('Migration completed successfully');
    } catch (e) {
        logger.error({ err: e }, 'Migration failed');
    }
}

if (require.main === module) {
    migrate().then(() => {
        logger.info('Process finished');
        process.exit(0);
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = migrate;
