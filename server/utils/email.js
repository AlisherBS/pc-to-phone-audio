const nodemailer = require('nodemailer');
const logger = require('./logger');

const smtpOptions = {
    host: process.env.SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
};

const transporter = nodemailer.createTransport(smtpOptions);

const sendVerificationCode = async (toEmail, code) => {
    try {
        const mailOptions = {
            from: process.env.EMAIL_FROM || '"Audio Streamer" <no-reply@lanc.kz>',
            to: toEmail,
            subject: 'Your Audio Streamer Verification Code',
            text: `Your verification code is: ${code}. It is valid for 10 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>Audio Streamer Registration</h2>
                    <p>Thank you for registering! Please use the verification code below to complete your sign-up and unlock lifetime premium.</p>
                    <div style="background-color: #f4f4f4; padding: 15px; text-align: center; border-radius: 5px; font-size: 24px; letter-spacing: 5px; font-weight: bold; margin: 20px 0;">
                        ${code}
                    </div>
                    <p>This code will expire in 10 minutes.</p>
                    <p>If you did not request this code, please ignore this email.</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info({ messageId: info.messageId, email: toEmail }, 'Verification email sent');
        return true;
    } catch (error) {
        logger.error({ err: error, email: toEmail }, 'Error sending verification email');
        return false;
    }
};

module.exports = {
    sendVerificationCode
};
