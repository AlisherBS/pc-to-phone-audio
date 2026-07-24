// config.js - Centralized configuration
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 8080;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// TURN Server
const TURN_URL = process.env.TURN_URL;
const TURNS_URL = process.env.TURNS_URL;
const TURN_SECRET = process.env.TURN_SECRET;

/**
 * Generate temporary TURN credentials (RFC 5766 TURN REST API)
 * Credentials expire after `ttl` seconds.
 * Username = expiryTimestamp:randomId
 * Password = HMAC-SHA1(secret, username) base64-encoded
 */
function generateTurnCredentials(ttl = 86400) {
    const expiryTimestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiryTimestamp}:audiostreamer`;
    const hmac = crypto.createHmac('sha1', TURN_SECRET);
    hmac.update(username);
    const password = hmac.digest('base64');

    return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: [TURN_URL, TURNS_URL],
            username: username,
            credential: password
        }
    ];
}

const MAX_CONNECTIONS_PER_IP = 10;

module.exports = {
    JWT_SECRET,
    ADMIN_PASSWORD,
    PORT,
    REDIS_URL,
    generateTurnCredentials,
    MAX_CONNECTIONS_PER_IP,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_SECRET: process.env.PAYPAL_SECRET,
    PAYPAL_MODE: process.env.PAYPAL_MODE || 'sandbox',
    PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID
};
