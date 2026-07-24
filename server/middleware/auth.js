// middleware/auth.js - Authentication middleware
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

// Admin authentication via JWT only
function verifyAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded.isAdmin) {
            return res.status(403).json({ error: 'Forbidden: admin access required' });
        }
        req.admin = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired admin token' });
    }
}

// JWT authentication via Authorization: Bearer <token>
function verifyJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Generate JWT token
function generateToken(userId, email, isPremium) {
    return jwt.sign(
        { userId, email, isPremium, isAdmin: false },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
}

// Generate Admin JWT token
function generateAdminToken(adminId, username) {
    return jwt.sign(
        { adminId, username, isAdmin: true },
        JWT_SECRET,
        { expiresIn: '24h' } // Admin tokens shorter for security
    );
}

// Verify token (for WebSocket auth)
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

module.exports = {
    verifyAdmin,
    verifyJWT,
    generateToken,
    generateAdminToken,
    verifyToken
};
