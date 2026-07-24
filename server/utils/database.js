// utils/database.js - SQLite database configuration using sqlite3 (v5.x for Node 18)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('./logger');
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/database.sqlite');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        logger.error('Could not connect to database', err);
    } else {
        logger.info('Connected to SQLite database (sqlite3 v5)');
        initializeTables();
    }
});

function initializeTables() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            passwordHash TEXT,
            isPremium INTEGER DEFAULT 0,
            premiumExpiresAt TEXT,
            subscriptionId TEXT,
            provider TEXT DEFAULT 'local',
            createdAt TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS metrics (
            key TEXT PRIMARY KEY,
            value INTEGER DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            passwordHash TEXT,
            createdAt TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            roomId TEXT UNIQUE,
            displayName TEXT,
            password TEXT,
            userId TEXT,
            createdAt TEXT,
            FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
        )`);
    });
}

// Helper functions
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
};

const get = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

module.exports = {
    db,
    query,
    run,
    get
};
