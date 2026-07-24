// server.js - Application bootstrap
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { PORT } = require('./config');
const logger = require('./utils/logger');
const { createRedisClient } = require('./utils/redis');
const { apiLimiter, authLimiter, adminLimiter, adminAuthLimiter } = require('./middleware/rateLimiter');
const { setupWebSocket } = require('./websocket/handler');

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const premiumRoutes = require('./routes/premium');
const roomsRoutes = require('./routes/rooms');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ===== Security =====
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://www.googletagmanager.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "ws:", "https://www.google-analytics.com"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1mb' }));

// Static files
const publicPath = path.join(__dirname, process.env.CLIENT_DIR || '../client');
app.use(express.static(publicPath));

// ===== Rate Limiting =====
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/auth/admin/login', adminAuthLimiter);
app.use('/api/admin/', adminLimiter);

// ===== Routes =====
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/rooms', roomsRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// ===== WebSocket =====
setupWebSocket(wss);

// ===== Start =====
async function start() {
    try {
        await createRedisClient(process.env.REDIS_URL || 'redis://localhost:6379');
        logger.info('Redis connected and verified');

        server.listen(PORT, '0.0.0.0', () => {
            logger.info({ port: PORT }, 'WebRTC server running');
            logger.info('Security features: enabled');
            logger.info('Rate limiting: enabled');
            logger.info('Trust proxy: enabled');
        });
    } catch (err) {
        logger.fatal({ err }, 'Failed to start server');
        process.exit(1);
    }
}

start();