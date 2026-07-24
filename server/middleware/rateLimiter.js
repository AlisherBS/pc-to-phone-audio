// middleware/rateLimiter.js - Rate limiting configuration
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500, // Increased for active usage
    message: 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, // Increased for testing phase
    message: 'Too many login attempts',
    standardHeaders: true,
    legacyHeaders: false
});

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Too many admin requests' },
    standardHeaders: true,
    legacyHeaders: false
});

const adminAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // Strict limit for admin login
    message: { error: 'Too many admin login attempts. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    apiLimiter,
    authLimiter,
    adminLimiter,
    adminAuthLimiter
};
