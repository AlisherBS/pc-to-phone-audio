// utils/createAdmin.js
const bcrypt = require('bcrypt');
const { run, get } = require('./database');
const logger = require('./logger');

async function createAdmin(username, password) {
    try {
        // Check if admin exists
        const existing = await get('SELECT id FROM admins WHERE username = ?', [username]);
        if (existing) {
            console.log(`Admin ${username} already exists.`);
            return;
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const createdAt = new Date().toISOString();

        await run(
            'INSERT INTO admins (username, passwordHash, createdAt) VALUES (?, ?, ?)',
            [username, passwordHash, createdAt]
        );

        console.log(`✅ Admin account created successfully: ${username}`);
    } catch (err) {
        console.error('Error creating admin account:', err);
    } finally {
        process.exit();
    }
}

// Get arguments from command line
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node createAdmin.js <username> <password>');
    process.exit(1);
}

createAdmin(args[0], args[1]);
