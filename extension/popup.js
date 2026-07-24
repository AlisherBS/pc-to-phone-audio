// popup.js - UI Controller

// DOM Elements
const startView = document.getElementById('startView');
const streamingView = document.getElementById('streamingView');
const statusBar = document.getElementById('statusBar');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const roomIdDisplay = document.getElementById('roomId');
const receiverCountEl = document.getElementById('receiverCount');
const qrcodeDiv = document.getElementById('qrcode');
const bars = document.querySelectorAll('#visualizer .bar');

let qrCodeObj = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Load saved server URL
    chrome.storage.local.get(['serverUrl'], (result) => {
        if (result.serverUrl) {
            document.getElementById('serverUrl').value = result.serverUrl;
        }
    });

    // Get current state from background
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
        if (response && response.isStreaming) {
            showStreamingView(response.roomId, response.receiverCount, response.tabTitle);
        }
    });
});

// Listen for updates from background/offscreen
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'stateUpdate') {
        const { isStreaming, roomId, receiverCount, tabTitle } = message.data;
        if (isStreaming) {
            showStreamingView(roomId, receiverCount, tabTitle);
        } else {
            showStartView();
        }
    } else if (message.type === 'audioLevels') {
        updateVisualizer(message.data);
    }
});

// Start streaming
btnStart.addEventListener('click', async () => {
    try {
        btnStart.disabled = true;
        updateStatus('Capturing...', 'streaming');

        const serverUrl = document.getElementById('serverUrl').value;
        const password = null; // Removed check

        // Save server URL
        chrome.storage.local.set({ serverUrl });

        // Tells background to get stream ID from ACTIVE tab and start offscreen
        chrome.runtime.sendMessage({
            action: 'getStreamId',
            serverUrl: serverUrl,
            password: password
        }, (response) => {
            if (response.error) {
                updateStatus('Error: ' + response.error, 'disconnected');
                btnStart.disabled = false;
            } else {
                // Background started process, wait for state update or success
                if (response.success) {
                    showStreamingView(response.roomId, 0, response.tabTitle);
                }
            }
        });

    } catch (err) {
        console.error('Start error:', err);
        updateStatus('Error: ' + err.message, 'disconnected');
        btnStart.disabled = false;
    }
});

// Stop streaming
btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopStreaming' }, () => {
        showStartView();
    });
});

// Copy room ID
roomIdDisplay.addEventListener('click', () => {
    const roomId = roomIdDisplay.textContent;
    if (roomId && roomId !== '------') {
        navigator.clipboard.writeText(roomId).then(() => {
            const original = roomIdDisplay.textContent;
            roomIdDisplay.textContent = 'COPIED!';
            setTimeout(() => {
                roomIdDisplay.textContent = original;
            }, 1000);
        });
    }
});

// UI Helpers
function updateStatus(text, type) {
    statusBar.textContent = text;
    statusBar.className = 'status ' + type;
}

function showStreamingView(roomId, receivers, tabTitle) {
    startView.classList.add('hidden');
    streamingView.classList.remove('hidden');

    roomIdDisplay.textContent = roomId || '------';
    receiverCountEl.textContent = receivers || 0;

    // Update tab title
    const titleEl = document.getElementById('tabTitle');
    if (titleEl) {
        titleEl.textContent = tabTitle || 'Unknown Tab';
        titleEl.title = tabTitle || '';
    }

    updateStatus('Streaming Active', 'streaming');

    // Generate QR Code
    if (roomId) {
        qrcodeDiv.innerHTML = '';
        try {
            const httpBase = serverUrl.replace(/^ws/, 'http').replace(/\/ws\/?$/, '');
            qr.addData(`${httpBase}/?room=${roomId}`);
            qr.make();
            qrcodeDiv.innerHTML = qr.createSvgTag({ scalable: true });

            // Allow SVG to scale
            const svg = qrcodeDiv.querySelector('svg');
            if (svg) {
                svg.style.width = '100%';
                svg.style.height = '100%';
            }
        } catch (e) {
            console.error('QR Generate error:', e);
            qrcodeDiv.innerHTML = '<span style="color:red;font-size:12px">QR Error: ' + e.message + '</span>';
        }
    }
}

function showStartView() {
    streamingView.classList.add('hidden');
    startView.classList.remove('hidden');
    btnStart.disabled = false;
    receiverCountEl.textContent = '0';
    roomIdDisplay.textContent = '------';
    updateStatus('Not connected', 'disconnected');
    qrcodeDiv.innerHTML = '';
    qrCodeObj = null;

    // Reset visualizer
    bars.forEach(bar => bar.style.height = '3%');
}

function updateVisualizer(dataArray) {
    // dataArray is array of byte values (0-255)
    // Map them to the 16 bars

    if (!dataArray || dataArray.length === 0) return;

    const step = Math.floor(dataArray.length / bars.length);

    bars.forEach((bar, i) => {
        const index = i * step;
        const value = dataArray[index] || 0;
        const height = (value / 255) * 100;
        bar.style.height = Math.max(3, height) + '%';
    });
}
