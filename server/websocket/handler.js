// websocket/handler.js - WebSocket connection and room logic
const WebSocket = require('ws');
const validator = require('validator');

const { generateTurnCredentials, MAX_CONNECTIONS_PER_IP } = require('../config');
const { verifyToken } = require('../middleware/auth');
const { getRoomFromRedis, saveRoomToRedis, deleteRoomFromRedis, incrementMetric, logEvent } = require('../utils/redis');
const { generateId, sanitizeInput } = require('../utils/helpers');
const { get } = require('../utils/database');
const logger = require('../utils/logger');

// Connection tracking per IP
const connectionsByIP = new Map();

function setupWebSocket(wss) {
    wss.on('connection', async (ws, req) => {
        const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

        // Rate limit connections per IP
        const currentConnections = connectionsByIP.get(clientIP) || 0;
        if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
            ws.close(1008, 'Too many connections');
            return;
        }
        connectionsByIP.set(clientIP, currentConnections + 1);

        logger.info({ clientIP }, 'New WebSocket connection');

        let currentRoom = null;
        let currentRole = null;
        let userId = null;
        let isPremium = false;
        const clientId = generateId();
        let sessionTimer = null;

        const FREE_SESSION_DURATION = 15 * 60 * 1000; // 15 minutes

        await incrementMetric('total_connections');

        // Message rate limiting
        let messageCount = 0;
        const messageInterval = setInterval(() => {
            messageCount = 0;
        }, 1000);

        ws.on('message', async (message) => {
            try {
                messageCount++;
                if (messageCount > 10) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Too many messages' }));
                    return;
                }

                if (message.length > 50000) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
                    return;
                }

                const data = JSON.parse(message);

                const validTypes = ['join', 'offer', 'answer', 'ice-candidate', 'auth', 'ping'];
                if (!validTypes.includes(data.type)) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message type' }));
                    return;
                }

                if (data.type === 'ping') return; // Keep-alive, no processing needed

                logger.info({ clientId, type: data.type }, 'WS message received');

                switch (data.type) {
                    case 'auth':
                        await handleAuth(data);
                        break;
                    case 'join':
                        await handleJoinRoom(data);
                        break;
                    case 'offer':
                        await handleOffer(data);
                        break;
                    case 'answer':
                        await handleAnswer(data);
                        break;
                    case 'ice-candidate':
                        await handleIceCandidate(data);
                        break;
                }
            } catch (e) {
                logger.error({ err: e, clientId }, 'Message handling error');
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
            }
        });

        ws.on('close', async () => {
            clearInterval(messageInterval);
            if (sessionTimer) clearTimeout(sessionTimer);
            connectionsByIP.set(clientIP, Math.max(0, (connectionsByIP.get(clientIP) || 1) - 1));
            await handleDisconnect();
        });

        // === Handlers ===

        async function handleAuth(data) {
            const decoded = verifyToken(data.token);
            if (decoded) {
                userId = decoded.userId;
                isPremium = decoded.isPremium;
                ws.send(JSON.stringify({
                    type: 'auth-success',
                    userId,
                    isPremium
                }));
            } else {
                ws.send(JSON.stringify({ type: 'auth-failed' }));
            }
        }

        async function handleJoinRoom(data) {
            try {
                const roomId = sanitizeInput(data.room, 12);
                const role = data.role;
                const password = data.password ? sanitizeInput(data.password, 50) : null;

                if (!roomId || !validator.isAlphanumeric(roomId) || roomId.length > 12) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid room ID' }));
                    return;
                }

                if (role !== 'sender' && role !== 'receiver') {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid role' }));
                    return;
                }

                currentRoom = roomId;
                currentRole = role;

                let room = await getRoomFromRedis(roomId);

                if (!room) {
                    // Check if this room exists as a persistent permanent room in SQLite
                    const persistentRoom = await get('SELECT userId, password FROM rooms WHERE roomId = ?', [roomId]);

                    if (role === 'receiver') {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: persistentRoom ? 'Room is currently offline (streamer not active)' : 'Room does not exist'
                        }));
                        await logEvent('join_failed', { roomId, role, reason: persistentRoom ? 'room_offline' : 'room_not_found' });
                        return;
                    }

                    // If role === 'sender'
                    // If the room exists in permanent rooms, ensure that the connecting sender owns it
                    if (persistentRoom) {
                        if (persistentRoom.userId !== userId) {
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'This permanent room ID belongs to another premium user'
                            }));
                            return;
                        }
                    }

                    room = {
                        id: roomId,
                        sender: null,
                        receivers: [],
                        password: persistentRoom ? persistentRoom.password : (password || null),
                        isPremium: persistentRoom ? true : isPremium,
                        maxReceivers: (persistentRoom || isPremium) ? 4 : 1,
                        isPersistent: !!persistentRoom,
                        createdAt: new Date().toISOString(),
                        createdBy: userId,
                        connectionHistory: []
                    };

                    await saveRoomToRedis(roomId, room);
                    await logEvent('room_created', { roomId, userId, isPremium: room.isPremium });
                }

                if (room.password && room.password !== password) {
                    if (!password) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Password required'
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Incorrect password'
                        }));
                    }
                    return;
                }

                if (role === 'receiver') {
                    if (room.receivers.length >= room.maxReceivers) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Room full (max ${room.maxReceivers} receivers)`
                        }));
                        return;
                    }

                    room.receivers.push(clientId);

                    if (room.sender) {
                        wss.clients.forEach(client => {
                            if (client.roomId === roomId && client.role === 'sender') {
                                client.send(JSON.stringify({
                                    type: 'peer-connected',
                                    clientId: clientId,
                                    receiverCount: room.receivers.length
                                }));
                            }
                        });
                    }

                    if (room.pendingOffer) {
                        ws.send(JSON.stringify({ type: 'offer', offer: room.pendingOffer }));
                    }
                } else {
                    room.sender = clientId;

                    room.receivers.forEach(receiverId => {
                        wss.clients.forEach(client => {
                            if (client.clientId === receiverId) {
                                client.send(JSON.stringify({ type: 'peer-connected' }));
                            }
                        });
                    });

                    // Start free-tier session timer (sender controls the room lifetime)
                    if (!room.isPremium) {
                        sessionTimer = setTimeout(async () => {
                            logger.info({ roomId, clientId }, 'Free session expired (15 min)');
                            await logEvent('free_session_expired', { roomId, userId });

                            // Notify ALL participants in this room
                            wss.clients.forEach(client => {
                                if (client.roomId === roomId) {
                                    try {
                                        client.send(JSON.stringify({
                                            type: 'session-expired',
                                            message: 'Free session limit reached (15 minutes)'
                                        }));
                                    } catch (e) { /* client may already be gone */ }
                                }
                            });

                            // Close the room after a short delay to let the message arrive
                            setTimeout(async () => {
                                wss.clients.forEach(client => {
                                    if (client.roomId === roomId) {
                                        client.close(4000, 'Session expired');
                                    }
                                });
                                await deleteRoomFromRedis(roomId);
                            }, 2000);
                        }, FREE_SESSION_DURATION);
                    }
                }

                ws.roomId = roomId;
                ws.role = role;
                ws.clientId = clientId;

                // Send remaining time info to the joining client (both sender and receiver)
                if (!room.isPremium) {
                    const elapsed = Date.now() - new Date(room.createdAt).getTime();
                    const remaining = Math.max(0, FREE_SESSION_DURATION - elapsed);
                    ws.send(JSON.stringify({
                        type: 'session-info',
                        maxDuration: remaining,
                        isPremium: false
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'session-info',
                        maxDuration: 0,
                        isPremium: true
                    }));
                }

                room.connectionHistory.push({
                    clientId,
                    role,
                    timestamp: new Date().toISOString()
                });

                await saveRoomToRedis(roomId, room);
                await logEvent('peer_joined', { roomId, role, clientId });

                ws.send(JSON.stringify({
                    type: 'joined',
                    room: roomId,
                    receiverCount: room.receivers.length,
                    iceServers: generateTurnCredentials()
                }));

            } catch (e) {
                logger.error({ err: e, clientId }, 'Join room error');
                ws.send(JSON.stringify({ type: 'error', message: 'Failed to join room' }));
            }
        }

        async function handleOffer(data) {
            const room = await getRoomFromRedis(data.room);
            if (!room) return;

            if (data.target) {
                wss.clients.forEach(client => {
                    if (client.clientId === data.target) {
                        client.send(JSON.stringify({ type: 'offer', offer: data.offer, from: clientId }));
                    }
                });
            } else if (room.receivers.length > 0) {
                room.receivers.forEach(receiverId => {
                    wss.clients.forEach(client => {
                        if (client.clientId === receiverId) {
                            client.send(JSON.stringify({ type: 'offer', offer: data.offer, from: clientId }));
                        }
                    });
                });
            } else {
                room.pendingOffer = data.offer;
                await saveRoomToRedis(data.room, room);
            }
        }

        async function handleAnswer(data) {
            wss.clients.forEach(client => {
                if (client.roomId === data.room && client.role === 'sender') {
                    client.send(JSON.stringify({ type: 'answer', answer: data.answer, from: clientId }));
                }
            });
        }

        async function handleIceCandidate(data) {
            const room = await getRoomFromRedis(data.room);
            if (!room) return;

            wss.clients.forEach(client => {
                if (client.roomId === data.room && client.clientId !== clientId) {
                    if (data.target && client.clientId !== data.target) return;

                    client.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: data.candidate,
                        from: clientId
                    }));
                }
            });
        }

        async function handleDisconnect() {
            if (!currentRoom) return;

            const room = await getRoomFromRedis(currentRoom);
            if (!room) return;

            if (currentRole === 'sender') {
                room.receivers.forEach(receiverId => {
                    wss.clients.forEach(client => {
                        if (client.clientId === receiverId) {
                            client.send(JSON.stringify({ type: 'peer-disconnected' }));
                        }
                    });
                });
                room.sender = null;
            } else if (currentRole === 'receiver') {
                room.receivers = room.receivers.filter(id => id !== clientId);

                wss.clients.forEach(client => {
                    if (client.roomId === currentRoom && client.role === 'sender') {
                        client.send(JSON.stringify({
                            type: 'peer-disconnected',
                            receiverCount: room.receivers.length
                        }));
                    }
                });
            }

            if (!room.sender && room.receivers.length === 0) {
                await deleteRoomFromRedis(currentRoom);
                await logEvent('room_deleted', { roomId: currentRoom });
            } else {
                await saveRoomToRedis(currentRoom, room);
            }

            await logEvent('peer_disconnected', { roomId: currentRoom, role: currentRole, clientId });
        }
    });

    // Cleanup connections map periodically
    setInterval(() => {
        for (const [ip, count] of connectionsByIP.entries()) {
            if (count === 0) {
                connectionsByIP.delete(ip);
            }
        }
    }, 60000);
}

module.exports = { setupWebSocket };
