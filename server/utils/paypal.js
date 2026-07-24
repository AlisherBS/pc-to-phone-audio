// utils/paypal.js - PayPal REST API integration
const axios = require('axios');
const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = require('../config');
const logger = require('./logger');

const PAYPAL_API = PAYPAL_MODE === 'live' 
    ? 'https://api-m.paypal.com' 
    : 'https://api-m.sandbox.paypal.com';

/**
 * Get PayPal OAuth Access Token
 */
async function getAccessToken() {
    try {
        const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
        const response = await axios({
            url: `${PAYPAL_API}/v1/oauth2/token`,
            method: 'post',
            data: 'grant_type=client_credentials',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        return response.data.access_token;
    } catch (err) {
        logger.error({ err: err.response ? err.response.data : err.message }, 'PayPal Auth Error');
        throw new Error('Failed to authenticate with PayPal');
    }
}

/**
 * Verify PayPal Webhook Signature
 */
async function verifyWebhookSignature(req, webhookId) {
    try {
        const accessToken = await getAccessToken();
        const response = await axios({
            url: `${PAYPAL_API}/v1/notifications/verify-webhook-signature`,
            method: 'post',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            data: {
                auth_algo: req.headers['paypal-auth-algo'],
                cert_url: req.headers['paypal-cert-url'],
                transmission_id: req.headers['paypal-transmission-id'],
                transmission_sig: req.headers['paypal-transmission-sig'],
                transmission_time: req.headers['paypal-transmission-time'],
                webhook_id: webhookId,
                webhook_event: req.body
            }
        });
        return response.data.verification_status === 'SUCCESS';
    } catch (err) {
        logger.error({ err: err.response ? err.response.data : err.message }, 'PayPal Webhook Verification Error');
        return false;
    }
}

module.exports = {
    getAccessToken,
    verifyWebhookSignature,
    PAYPAL_API
};
