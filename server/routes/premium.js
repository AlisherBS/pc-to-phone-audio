// routes/premium.js - Premium activation with SQLite & PayPal Safety
const express = require('express');
const router = express.Router();

const { verifyJWT, generateToken } = require('../middleware/auth');
const { getRedisClient, logEvent, incrementMetric } = require('../utils/redis');
const { sanitizeInput } = require('../utils/helpers');
const { get, run } = require('../utils/database');
const logger = require('../utils/logger');
const { verifyWebhookSignature } = require('../utils/paypal');
const { PAYPAL_WEBHOOK_ID } = require('../config');

// Webhook Handler with product prefix check
router.post('/paypal/webhook', async (req, res) => {
    try {
        const isValid = await verifyWebhookSignature(req, PAYPAL_WEBHOOK_ID);
        if (!isValid) return res.status(400).send('Invalid signature');

        const event = req.body;
        logger.info({ eventType: event.event_type }, 'PayPal Webhook received');

        if (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED' || 
            event.event_type === 'PAYMENT.SALE.COMPLETED') {
            
            const subscriptionId = event.resource.id || event.resource.billing_agreement_id;
            let customId = event.resource.custom_id || event.resource.custom;

            // SAFETY CHECK: Only process if it belongs to Audio Streamer
            if (!customId || !customId.startsWith('audio_')) {
                logger.info({ customId }, 'Ignoring webhook from another product');
                return res.status(200).send('Ignored (not audio_ prefix)');
            }

            // Extract real userId
            const userId = customId.replace('audio_', '');
            const planId = event.resource.plan_id;

            // Calculate expiry based on plan
            const expiry = new Date();
            if (planId === 'P-9RL29779XW642161NNIB7YFY') {
                // 3 Months + 7 Days Trial
                expiry.setMonth(expiry.getMonth() + 3);
                expiry.setDate(expiry.getDate() + 7);
            } else if (planId === 'P-1MC841282P955512UNIB7YWI') {
                // 12 Months + 7 Days Trial
                expiry.setFullYear(expiry.getFullYear() + 1);
                expiry.setDate(expiry.getDate() + 7);
            } else if (planId === 'P-08X823186R9293227NIBRIEQ' || planId === 'P-95E851407P294905PNIBQDGA') {
                // 1 Month
                expiry.setMonth(expiry.getMonth() + 1);
                expiry.setDate(expiry.getDate() + 2); // Buffer
            } else {
                // Default 32 days if unknown plan
                expiry.setDate(expiry.getDate() + 32);
            }
            
            const expiryStr = expiry.toISOString();

            await run(
                'UPDATE users SET isPremium = 1, premiumExpiresAt = ?, subscriptionId = ? WHERE id = ?',
                [expiryStr, subscriptionId, userId]
            );

            await logEvent('paypal_premium_activated', { userId, subscriptionId });
            logger.info({ userId, subscriptionId }, 'Premium activated via SQLite');
        }

        res.status(200).send('OK');
    } catch (e) {
        logger.error({ err: e }, 'PayPal webhook error');
        res.status(500).send('Server error');
    }
});

// Promo Code Activation (SQLite)
router.post('/activate', verifyJWT, async (req, res) => {
    try {
        const { promoCode } = req.body;
        const { userId } = req.user;
        const redisClient = getRedisClient();

        const sanitizedPromo = sanitizeInput(promoCode, 20);
        const promoData = await redisClient.get(`promo:${sanitizedPromo}`);
        if (!promoData) return res.status(400).json({ error: 'Invalid promo code' });

        const promo = JSON.parse(promoData);
        if (promo.uses >= promo.maxUses) return res.status(400).json({ error: 'Promo code exhausted' });

        const expiry = new Date(Date.now() + promo.duration).toISOString();

        await run(
            'UPDATE users SET isPremium = 1, premiumExpiresAt = ? WHERE id = ?',
            [expiry, userId]
        );

        promo.uses++;
        await redisClient.set(`promo:${sanitizedPromo}`, JSON.stringify(promo));

        const user = await get('SELECT email FROM users WHERE id = ?', [userId]);
        const newToken = generateToken(userId, user.email, true);

        res.json({ success: true, token: newToken, expiresAt: expiry });
    } catch (e) {
        logger.error({ err: e }, 'Premium activation error');
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
