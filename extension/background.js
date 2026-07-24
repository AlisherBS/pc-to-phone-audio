// background.js - Service Worker

let offscreenCreating = null; // Promise to handle race conditions

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender, sendResponse);
    return true; // Keep channel open
});

async function handleMessage(request, sender, sendResponse) {
    try {
        if (request.action === 'startStreaming') {
            await ensureOffscreenDocument();
            // Forward to offscreen
            chrome.runtime.sendMessage(request, sendResponse);
        }
        else if (request.action === 'stopStreaming') {
            // Forward to offscreen
            chrome.runtime.sendMessage(request, (response) => {
                sendResponse(response);
                // Close offscreen to clean up media capture state completely
                chrome.offscreen.closeDocument().catch(err => console.log('Offscreen close warn:', err));
                offscreenCreating = null; // Reset promise
            });
        }
        else if (request.action === 'getState') {
            // Check if offscreen exists first
            const contexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT']
            });

            if (contexts.length > 0) {
                chrome.runtime.sendMessage(request, sendResponse);
            } else {
                sendResponse({ isStreaming: false });
            }
        }
        else if (request.action === 'getStreamId') {
            // This is called from popup to get the streamId of the active tab
            // We need this because tabCapture.getMediaStreamId must be called in background or popup, 
            // but we want to pass it to offscreen.
            // Actually, popup can call it.
            // But wait, tabCapture.getMediaStreamId needs targetTabId.

            // Best flow:
            // 1. Popup calls background 'startStreaming'
            // 2. Background gets active tab, gets streamId
            // 3. Background ensures offscreen
            // 4. Background sends 'initStream' to offscreen with streamId

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                sendResponse({ error: 'No active tab' });
                return;
            }

            chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ error: chrome.runtime.lastError.message });
                    return;
                }

                // Get tab title
                const tabTitle = tab.title;

                try {
                    await ensureOffscreenDocument();
                } catch (e) {
                    console.error('Offscreen creation error:', e);
                    // Ignore if it already exists
                }

                // Send to offscreen
                chrome.runtime.sendMessage({
                    action: 'initStream',
                    streamId: streamId,
                    tabTitle: tabTitle,
                    serverUrl: request.serverUrl,
                    password: request.password
                }, (response) => {
                    sendResponse(response);
                });
            });
        }
    } catch (err) {
        console.error('Background error:', err);
        sendResponse({ error: err.message });
    }
}

async function ensureOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: ['offscreen.html']
    });

    if (existingContexts.length > 0) {
        return;
    }

    if (offscreenCreating) {
        await offscreenCreating;
    } else {
        offscreenCreating = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['USER_MEDIA'],
            justification: 'Streaming audio from tab requires access to WebRTC and DOM'
        });

        try {
            await offscreenCreating;
        } catch (e) {
            // Ignore error if document already exists
            if (!e.message.includes('Only a single offscreen document')) {
                throw e;
            }
        }
        offscreenCreating = null;
    }
}
