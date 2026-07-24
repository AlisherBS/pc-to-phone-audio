// routes/auth.js - Authentication routes with SQLite
const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const router = express.Router();

const { generateToken, generateAdminToken, verifyJWT } = require('../middleware/auth');
const { getRedisClient, logEvent, incrementMetric } = require('../utils/redis');
const { generateId, sanitizeInput } = require('../utils/helpers');
const { get, run } = require('../utils/database');
const logger = require('../utils/logger');

let sendVerificationCode;
let OAuth2Client;

try {
    const emailModule = require('../utils/email');
    sendVerificationCode = emailModule.sendVerificationCode;
} catch (e) {
    logger.warn('Nodemailer not installed, email sending disabled');
}

try {
    const { OAuth2Client: OAuth2 } = require('google-auth-library');
    OAuth2Client = OAuth2;
} catch (e) {
    logger.warn('google-auth-library not installed, google auth disabled');
}

// Send Verification Code (Still using Redis for temp codes)
router.post('/send-code', async (req, res) => {
    try {
        let { email } = req.body;
        const redisClient = getRedisClient();
        email = sanitizeInput(email, 100);

        if (!validator.isEmail(email)) {
            return res.status(400).json({ error: 'Invalid email' });
        }

        const user = await get('SELECT id FROM users WHERE email = ?', [email]);
        if (user) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await redisClient.setEx(`verification:${email}`, 600, code);

        if (sendVerificationCode) {
            await sendVerificationCode(email, code);
        } else {
            logger.info({ email }, 'Email sending disabled, verification code generated (not logged)');
        }

        res.json({ message: 'Verification code sent' });
    } catch (e) {
        logger.error({ err: e }, 'Send code error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Register
router.post('/register', async (req, res) => {
    try {
        let { email, password, code } = req.body;
        const redisClient = getRedisClient();
        email = sanitizeInput(email, 100);

        const storedCode = await redisClient.get(`verification:${email}`);
        if (!storedCode || storedCode !== code) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }

        const userId = generateId(16);
        const passwordHash = await bcrypt.hash(password, 12);
        const createdAt = new Date().toISOString();

        await run(
            'INSERT INTO users (id, email, passwordHash, createdAt) VALUES (?, ?, ?, ?)',
            [userId, email, passwordHash, createdAt]
        );

        await redisClient.del(`verification:${email}`);
        const token = generateToken(userId, email, false);
        
        res.json({ token, userId, email, isPremium: false });
    } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'User already exists' });
        }
        logger.error({ err: e }, 'Register error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        email = sanitizeInput(email, 100);

        const user = await get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user.id, user.email, user.isPremium === 1);
        res.json({
            token,
            userId: user.id,
            email: user.email,
            isPremium: user.isPremium === 1
        });
    } catch (e) {
        logger.error({ err: e }, 'Login error');
        res.status(500).json({ error: 'Server error' });
    }
});

// Google Auth
router.post('/google', async (req, res) => {
    try {
        const { token } = req.body;
        if (!OAuth2Client) return res.status(500).json({ error: 'Google Auth disabled' });

        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        await handleSocialLogin(payload.email, res);
    } catch (e) {
        logger.error({ err: e }, 'Google auth error');
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Status / Profile
router.get('/me', verifyJWT, async (req, res) => {
    try {
        const { userId } = req.user;
        const user = await get('SELECT id, email, isPremium, premiumExpiresAt FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        res.json({
            userId: user.id,
            email: user.email,
            isPremium: user.isPremium === 1,
            premiumExpiresAt: user.premiumExpiresAt
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

async function handleSocialLogin(email, res) {
    let user = await get('SELECT * FROM users WHERE email = ?', [email]);
    
    if (!user) {
        const userId = generateId(16);
        const createdAt = new Date().toISOString();
        await run(
            'INSERT INTO users (id, email, provider, createdAt) VALUES (?, ?, ?, ?)',
            [userId, email, 'google', createdAt]
        );
        user = { id: userId, email, isPremium: 0 };
    }

    const token = generateToken(user.id, user.email, user.isPremium === 1);
    res.json({
        token,
        userId: user.id, // Explicitly send userId
        email: user.email,
        isPremium: user.isPremium === 1
    });
}

// Admin Login
router.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const admin = await get('SELECT * FROM admins WHERE username = ?', [username]);
        if (!admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValid = await bcrypt.compare(password, admin.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateAdminToken(admin.id, admin.username);
        res.json({ token, username: admin.username });
    } catch (err) {
        logger.error({ err }, 'Admin login error');
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
