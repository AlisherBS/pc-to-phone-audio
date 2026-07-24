// offscreen.js - Handles persistent audio streaming

let ws = null;
let peerConnections = new Map(); // Map of clientId -> RTCPeerConnection
let iceQueue = new Map(); // Map of clientId -> candidate[]
let remoteDescriptionSet = new Map(); // Map of clientId -> boolean
let receiverCount = 0;
let isStreaming = false;
let currentTabTitle = '';
let localStream = null;
let audioContext = null;
let analyser = null;
let localRoomId = null;
let roomPassword = null;

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open
});

async function handleMessage(request, sender, sendResponse) {
    if (request.action === 'initStream') {
        try {
            if (isStreaming) stopStreaming(); // Ensure clean start
            currentTabTitle = request.tabTitle || 'Unknown Tab';
            await startStreaming(request.streamId, request.serverUrl, request.password);
            sendResponse({ success: true, roomId: localRoomId, tabTitle: currentTabTitle });
        } catch (err) {
            console.error('Start error:', err);
            sendResponse({ error: err.message });
        }
    } else if (request.action === 'stopStreaming') {
        stopStreaming();
        sendResponse({ success: true });
    } else if (request.action === 'getState') {
        sendResponse({
            isStreaming: isStreaming,
            roomId: localRoomId,
            receiverCount: receiverCount,
            tabTitle: currentTabTitle
        });
    }
}

async function startStreaming(streamId, serverUrl, password) {
    roomPassword = password;
    // MediaStream - Requesting video is often required for 'tab' capture to work reliably
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId
            }
        },
        video: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId
            }
        }
    });

    // Keep video track to ensure capture stays alive, but only send audio
    localStream = stream;

    // Setup Audio Context for Visualizer data (sent to popup)
    setupAudioAnalysis(stream);

    // WebSocket
    await connectWebSocket(serverUrl);

    // WebRTC
    await setupWebRTC(password);

    isStreaming = true;

    // Monitor stream ended (tab closed)
    stream.getAudioTracks()[0].onended = () => {
        stopStreaming();
    };
}

function stopStreaming() {
    isStreaming = false;
    localRoomId = null;
    receiverCount = 0;

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    iceQueue.clear();
    remoteDescriptionSet.clear();

    if (ws) {
        ws.close();
        ws = null;
    }

    iceQueue = new Map();
    remoteDescriptionSet = new Map();

    // Close offscreen document to save resources? 
    // Usually managed by background.js, but we can't self-destruct easily.
}

function connectWebSocket(url) {
    return new Promise((resolve, reject) => {
        ws = new WebSocket(url);

        const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
        }, 10000);

        ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleSignalingData(data);
            } catch (err) { }
        };

        ws.onerror = (err) => {
            clearTimeout(timeout);
            reject(err);
        };

        ws.onclose = () => {
            if (isStreaming) stopStreaming();
        };
    });
}

async function handleSignalingData(data) {
    switch (data.type) {
        case 'joined':
            localRoomId = data.room;
            if (data.receiverCount !== undefined) receiverCount = data.receiverCount;
            broadcastState();
            break;
        case 'peer-connected':
            if (data.receiverCount !== undefined) {
                receiverCount = data.receiverCount;
                broadcastState();
            }
            if (data.clientId) {
                createPeerConnection(data.clientId, roomPassword);
            }
            break;
        case 'peer-disconnected':
            if (data.receiverCount !== undefined) {
                receiverCount = data.receiverCount;
                broadcastState();
            }
            if (data.clientId) {
                const pc = peerConnections.get(data.clientId);
                if (pc) {
                    pc.close();
                    peerConnections.delete(data.clientId);
                    iceQueue.delete(data.clientId);
                    remoteDescriptionSet.delete(data.clientId);
                }
            }
            break;
        case 'answer':
            const pc = peerConnections.get(data.from);
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                remoteDescriptionSet.set(data.from, true);
                const queue = iceQueue.get(data.from) || [];
                while (queue.length > 0) {
                    await pc.addIceCandidate(new RTCIceCandidate(queue.shift()));
                }
            }
            break;
        case 'ice-candidate':
            if (data.from && data.candidate) {
                const pc = peerConnections.get(data.from);
                if (pc) {
                    if (remoteDescriptionSet.get(data.from)) {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } else {
                        if (!iceQueue.has(data.from)) iceQueue.set(data.from, []);
                        iceQueue.get(data.from).push(data.candidate);
                    }
                }
            }
            break;
    }
}

async function setupWebRTC(password) {
    peerConnections.clear();
    iceQueue.clear();
    remoteDescriptionSet.clear();

    localRoomId = generateRoomId();

    ws.send(JSON.stringify({
        type: 'join',
        room: localRoomId,
        role: 'sender',
        password: roomPassword
    }));
}

async function createPeerConnection(targetClientId, password) {
    console.log('Creating PC for', targetClientId);

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnections.set(targetClientId, pc);

    localStream.getAudioTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                room: localRoomId,
                target: targetClientId,
                candidate: event.candidate
            }));
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: 'offer',
        room: localRoomId,
        target: targetClientId,
        offer: offer
    }));
}

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Audio Analysis for Visualizer
function setupAudioAnalysis(stream) {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 64; // Small size for performance

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    setInterval(() => {
        if (!isStreaming) return;

        analyser.getByteFrequencyData(dataArray);

        // Calculate simplified data (average volume) or send small array
        // We can send this via runtime message to popup
        // Only if popup is open (we can't know easily, but we can try sending)

        try {
            chrome.runtime.sendMessage({
                type: 'audioLevels',
                data: Array.from(dataArray)
            });
        } catch (e) {
            // Popup closed, expected error
        }
    }, 100);
}

function broadcastState() {
    try {
        chrome.runtime.sendMessage({
            type: 'stateUpdate',
            data: {
                isStreaming,
                roomId: localRoomId,
                receiverCount,
                tabTitle: currentTabTitle
            }
        });
    } catch (e) { }
}
