// utils/helpers.js - Utility functions
const crypto = require('crypto');
const validator = require('validator');

function generateId(length = 8) {
    return crypto.randomBytes(length).toString('hex').substring(0, length).toUpperCase();
}

function generateRoomId() {
    return generateId(6);
}

// Sanitize user input
function sanitizeInput(input, maxLength = 255) {
    if (typeof input !== 'string') return '';
    return validator.escape(input.substring(0, maxLength).trim());
}

// Safe constant-time comparison that handles different buffer lengths
function safeCompare(a, b) {
    if (!a || !b) return false;

    // Trim to avoid whitespace issues from env vars or inputs
    const strA = String(a).trim();
    const strB = String(b).trim();

    let bufA = Buffer.from(strA);
    let bufB = Buffer.from(strB);

    // Make lengths equal to prevent crypto.timingSafeEqual throws, but track mismatch
    let lengthMismatch = bufA.length !== bufB.length;
    if (lengthMismatch) {
        bufB = Buffer.alloc(bufA.length);
    }

    const isMatched = crypto.timingSafeEqual(bufA, bufB);
    return isMatched && !lengthMismatch;
}

module.exports = {
    generateId,
    generateRoomId,
    sanitizeInput,
    safeCompare
};
