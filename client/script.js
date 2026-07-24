// CONFIGURATION
const USE_SSL = window.location.protocol === 'https:';
const BACKEND_HOST = window.location.host;

const API_BASE_URL = `${window.location.protocol}//${window.location.host}/api`;
const WS_BASE_URL = `${USE_SSL ? 'wss' : 'ws'}://${window.location.host}/ws`;

// ICE Servers provided by the backend signaling server
let serverIceServers = [
    { urls: 'stun:stun.l.google.com:19302' } // Default fallback
];

// Translations loaded from JSON files
const translations = { en: {}, ru: {} };

async function loadTranslations() {
    try {
        const [en, ru] = await Promise.all([
            fetch('/locales/en.json').then(r => r.json()),
            fetch('/locales/ru.json').then(r => r.json())
        ]);
        translations.en = en;
        translations.ru = ru;
    } catch (e) {
        console.error('Failed to load translations:', e);
    }
}

// Load translations immediately
loadTranslations().then(() => applyTranslations());

let currentLang = localStorage.getItem('lang') || detectLanguage();

function detectLanguage() {
    const navLang = navigator.language || navigator.userLanguage;
    if (navLang.startsWith('ru')) return 'ru';
    return 'en';
}

let ws = null;
let localRoomId = null;
let pc = null;
let peerConnections = new Map();
let localStream = null;
let audioElement = null;
let authToken = localStorage.getItem('authToken');
let isPremium = localStorage.getItem('isPremium') === 'true';
let userId = localStorage.getItem('userId');

document.addEventListener('DOMContentLoaded', () => {
    updateUserBadge();
    if (authToken) fetchUserStatus();
});
let iceQueue = new Map();
let remoteDescriptionSet = new Map();
let audioContext = null;
let analyser = null;
let animationFrame = null;
let audioUnlocked = false;
let debugInterval = null;
let lastBytesReceived = 0;
let sessionCountdownInterval = null;
let sessionExpiredByServer = false;

// Buffer Stats and Control
let lastTimestamp = 0;
let lastSenderBytesSent = 0;
let lastSenderTimestamp = 0;
let gainNode = null;
let audioDestination = null;
let jitterBufferTargetValue = 0;

window.addEventListener('load', () => {
    const langSelector = document.getElementById('langSwitcher');
    if (langSelector) {
        langSelector.value = currentLang;
    }
    applyTranslations();

    // Sync UI if changed by auto-detection
    if (!localStorage.getItem('lang')) {
        localStorage.setItem('lang', currentLang);
    }

    if (!localStorage.getItem('cookieConsent')) {
        const consent = document.getElementById('cookieConsent');
        if (consent) consent.classList.add('show');
    } else if (localStorage.getItem('cookieConsent') === 'accepted') {
        if (typeof gtag === 'function') {
            gtag('consent', 'update', {
                'analytics_storage': 'granted',
                'ad_storage': 'granted'
            });
        }
    }

    if (authToken) {
        verifyToken();
    }

    // UI Listeners for Premium Room Options
    const customRoomIdCb = document.getElementById('customRoomIdCb');
    const customRoomIdGroup = document.getElementById('customRoomIdGroup');
    if (customRoomIdCb && customRoomIdGroup) {
        customRoomIdCb.onchange = () => {
            customRoomIdGroup.style.display = customRoomIdCb.checked ? 'block' : 'none';
        };
    }

    const params = new URLSearchParams(location.search);
    const roomId = params.get('room');

    // Prevent search engines from indexing dynamic room URLs
    if (roomId || window.location.search.includes('room=')) {
        let metaRobots = document.querySelector('meta[name="robots"]');
        if (metaRobots) {
            metaRobots.setAttribute('content', 'noindex, nofollow');
        } else {
            metaRobots = document.createElement('meta');
            metaRobots.name = 'robots';
            metaRobots.content = 'noindex, nofollow';
            document.head.appendChild(metaRobots);
        }
    }

    if (roomId) {
        const roomInp = document.getElementById('roomInput');
        if (roomInp) roomInp.value = roomId;
        const receiverTab = document.querySelectorAll('.tab-btn')[1];
        if (receiverTab) receiverTab.click();
        showNotification('Room ID loaded from link');
    }


});



// MOBILE AUDIO FIX - Unlock audio on user interaction
function enableAudio() {
    // Ensure AudioContext exists before using it
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Create silent buffer to wake up Safari's audio engine
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);

    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }

    if (audioElement) {
        audioElement.play().then(() => {
            audioUnlocked = true;
            document.getElementById('playOverlay').classList.remove('show');
            const manualBtn = document.getElementById('btnManualAudio');
            if (manualBtn) manualBtn.style.display = 'none';
            showNotification('Audio enabled!');
        }).catch(e => {
            console.error('Audio play error:', e);
            // Some versions of Safari need srcObject to be set after the first play attempt
            audioElement.play();
        });
    }
}

function changeLang() {
    const langSelector = document.getElementById('langSwitcher');
    if (langSelector) {
        currentLang = langSelector.value;
        localStorage.setItem('lang', currentLang);
        applyTranslations();
    }
}

function applyTranslations() {
    const t = translations[currentLang];
    document.documentElement.lang = currentLang;

    // Update Title & Meta Description
    if (t.page_title) document.title = t.page_title;
    if (t.meta_desc) {
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute('content', t.meta_desc);
    }

    // Update Text Content
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            // Check if we need to set innerHTML (for keys with HTML tags)
            if (['step_1', 'step_2', 'step_3'].includes(key)) {
                el.innerHTML = t[key];
            } else {
                el.textContent = t[key];
            }
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key]) el.placeholder = t[key];
    });
}

function acceptCookies() {
    localStorage.setItem('cookieConsent', 'accepted');
    document.getElementById('cookieConsent').classList.remove('show');

    if (typeof gtag === 'function') {
        gtag('consent', 'update', {
            'analytics_storage': 'granted',
            'ad_storage': 'granted'
        });
        gtag('event', 'cookie_consent', { consent_given: true });
    }
}

function rejectCookies() {
    localStorage.setItem('cookieConsent', 'rejected');
    document.getElementById('cookieConsent').classList.remove('show');

    if (typeof gtag === 'function') {
        gtag('event', 'cookie_consent', { consent_given: false });
    }
}

// Accordion
function toggleAccordion(header) {
    header.classList.toggle('active');
    const content = header.nextElementSibling;
    content.classList.toggle('active');
}

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(`${tab}-tab`).classList.add('active');
    });
});

// Auth
function showAuthModal() {
    if (authToken) {
        if (confirm(currentLang === 'en' ? 'Logout?' : 'Выйти из аккаунта?')) {
            localStorage.removeItem('authToken');
            authToken = null;
            isPremium = false;
            updateUserBadge();
            showNotification(currentLang === 'en' ? 'Logged out' : 'Вы вышли');
        }
    } else {
        document.getElementById('authModal').classList.add('show');
    }
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('show');
}

async function sendAuthCode() {
    const email = document.getElementById('authEmail').value;

    if (!email) {
        showNotification(currentLang === 'en' ? 'Enter email first' : 'Сначала введите email');
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await res.json();

        if (!res.ok) {
            showNotification('Error: ' + data.error);
            return;
        }

        showNotification(currentLang === 'en' ? 'Code sent! Check your email.' : 'Код отправлен! Проверьте почту.');

        // Show code input and switch button
        document.getElementById('codeGroup').style.display = 'block';
        document.getElementById('btnAuthSendCode').style.display = 'none';
        document.getElementById('btnAuthRegister').style.display = 'inline-block';
        document.getElementById('btnAuthLogin').style.display = 'none';

    } catch (e) {
        console.error('Send code error:', e);
        showNotification(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения');
    }
}

async function handleAuth(type) {
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const code = document.getElementById('authCode') ? document.getElementById('authCode').value : null;

    if (!email || !password) {
        showNotification(currentLang === 'en' ? 'Fill all fields' : 'Заполните все поля');
        return;
    }

    if (type === 'register' && !code) {
        showNotification(currentLang === 'en' ? 'Enter verification code' : 'Введите код подтверждения');
        return;
    }

    try {
        const body = { email, password };
        if (type === 'register') body.code = code;

        const res = await fetch(`${API_BASE_URL}/auth/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
            showNotification('Error: ' + data.error);
            return;
        }

        finalizeAuth(data);

        // Reset UI if registered
        if (type === 'register') {
            document.getElementById('codeGroup').style.display = 'none';
            document.getElementById('btnAuthSendCode').style.display = 'inline-block';
            document.getElementById('btnAuthRegister').style.display = 'none';
            document.getElementById('btnAuthLogin').style.display = 'inline-block';
            if (document.getElementById('authCode')) document.getElementById('authCode').value = '';
            document.getElementById('authPassword').value = '';
        }

    } catch (e) {
        console.error('Auth error:', e);
        showNotification(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения');
    }
}

function finalizeAuth(data) {
    authToken = data.token;
    isPremium = data.isPremium;
    userId = data.userId;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('isPremium', isPremium);
    if (data.email) localStorage.setItem('userEmail', data.email);
    if (userId) localStorage.setItem('userId', userId);

    updateUserBadge();
    closeAuthModal();
    
    // Refresh premium modal if it's open to show plans after login
    if (document.getElementById('premiumModal').classList.contains('show')) {
        showPremiumModal();
    }
    
    showNotification(currentLang === 'en' ? (isPremium ? 'Premium Login successful!' : 'Logged in!') : (isPremium ? 'Доступ к Премиум получен!' : 'Вход выполнен!'));

    if (typeof gtag === 'function') gtag('event', 'login_success', { user_id: userId, premium: isPremium });
}

// Google Auth Callback
window.onload = function () {
    if (typeof google !== 'undefined') {
        google.accounts.id.initialize({
            client_id: "YOUR_GOOGLE_CLIENT_ID",
            callback: handleGoogleCredentialResponse
        });
        google.accounts.id.renderButton(
            document.getElementById("googleSignInBtn"),
            { theme: "outline", size: "large", text: "continue_with" }
        );
    }

    // Apple Auth Initialization (Hidden for now)
    /*
    if (typeof AppleID !== 'undefined') {
        AppleID.auth.init({
            clientId: 'YOUR_APPLE_CLIENT_ID', // TODO: REPLACE
            scope: 'email',
            redirectURI: window.location.origin,
            usePopup: true
        });

        document.getElementById('appleid-signin').addEventListener('click', async () => {
            try {
                const data = await AppleID.auth.signIn();
                await handleAppleCredentialResponse(data);
            } catch (error) {
                console.error("Apple Sign-In error:", error);
                // User may have cancelled or config is bad
            }
        });
    }
    */
};

async function handleGoogleCredentialResponse(response) {
    // response.credential is a JWT
    try {
        const res = await fetch(`${API_BASE_URL}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: response.credential })
        });
        const data = await res.json();

        if (!res.ok) {
            showNotification('Google auth failed: ' + data.error);
            return;
        }
        finalizeAuth(data);
    } catch (e) {
        console.error('Google auth error:', e);
        showNotification(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения');
    }
}

async function handleAppleCredentialResponse(response) {
    // response.authorization.id_token
    const token = response.authorization && response.authorization.id_token;
    if (!token) return;
    try {
        const res = await fetch(`${API_BASE_URL}/auth/apple`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();

        if (!res.ok) {
            showNotification('Apple auth failed: ' + data.error);
            return;
        }
        finalizeAuth(data);
    } catch (e) {
        console.error('Apple auth error:', e);
        showNotification(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения');
    }
}

function verifyToken() {
    if (ws && authToken) {
        ws.send(JSON.stringify({ type: 'auth', token: authToken }));
    }
}

function updateUserBadge() {
    const badge = document.getElementById('userBadge');
    if (authToken) {
        const email = localStorage.getItem('userEmail');
        badge.textContent = email ? (email.length > 15 ? email.substring(0, 12) + '...' : email) : 'Account';
        badge.className = 'user-badge' + (isPremium ? ' premium-badge' : '');
        badge.style.cursor = 'pointer';
        badge.onclick = showProfileModal;

        document.getElementById('premiumUpsell').style.display = isPremium ? 'none' : 'block';
        document.getElementById('premiumOptions').style.display = isPremium ? 'block' : 'none';
        document.getElementById('maxReceivers').textContent = isPremium ? '4' : '1';
        if (isPremium) loadPermanentRooms(); // Silent load to populate dropdowns
    } else {
        badge.textContent = 'Login';
        badge.className = 'user-badge';
        badge.style.cursor = 'pointer';
        badge.onclick = showAuthModal;
    }
}

async function fetchUserStatus() {
    if (!authToken) return;
    try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
            const data = await res.json();
            isPremium = data.isPremium;
            localStorage.setItem('isPremium', isPremium);
            if (data.email) localStorage.setItem('userEmail', data.email);
            if (data.premiumExpiresAt) localStorage.setItem('premiumExpiresAt', data.premiumExpiresAt);
            updateUserBadge();
        } else if (res.status === 401) {
            // Token invalid or expired, logout to force refresh
            console.warn('Auth token invalid, logging out...');
            logout();
        }
    } catch (e) {
        console.error('Fetch status error:', e);
    }
}

function showProfileModal() {
    if (!authToken) {
        showAuthModal();
        return;
    }

    const email = localStorage.getItem('userEmail') || '-';
    const premiumExpiresAt = localStorage.getItem('premiumExpiresAt');

    document.getElementById('profileEmail').textContent = email;
    document.getElementById('profileStatus').textContent = isPremium ? (currentLang === 'en' ? 'Premium (Active)' : 'Premium (Активен)') : (currentLang === 'en' ? 'Free Plan' : 'Бесплатный');
    document.getElementById('profileStatus').style.color = isPremium ? '#ffd700' : 'var(--fg-dim)';
    
    const expiryContainer = document.getElementById('premiumExpiryContainer');
    const upgradeBtn = document.getElementById('btnProfilePremium');
    const roomsSection = document.getElementById('profileRoomsSection');

    if (isPremium) {
        if (premiumExpiresAt) {
            expiryContainer.style.display = 'block';
            document.getElementById('profileExpiry').textContent = new Date(premiumExpiresAt).toLocaleDateString();
        } else {
            expiryContainer.style.display = 'none';
        }
        if (upgradeBtn) upgradeBtn.style.display = 'none';
        if (roomsSection) {
            roomsSection.style.display = 'block';
            loadPermanentRooms();
        }
    } else {
        expiryContainer.style.display = 'none';
        if (upgradeBtn) upgradeBtn.style.display = 'block';
        if (roomsSection) roomsSection.style.display = 'none';
    }

    document.getElementById('profileModal').classList.add('show');
}

// User Permanent Rooms Management logic
async function loadPermanentRooms() {
    const container = document.getElementById('roomsListContainer');
    if (!container) return;
    container.innerHTML = `<div style="text-align: center; color: var(--fg-dim); font-size: 0.9rem; padding: 10px;">${currentLang === 'en' ? 'Loading rooms...' : 'Загрузка комнат...'}</div>`;

    try {
        const res = await fetch(`${API_BASE_URL}/rooms`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!res.ok) {
            container.innerHTML = `<div style="color: #ff4444; font-size: 0.9rem; padding: 10px;">${currentLang === 'en' ? 'Failed to load rooms' : 'Ошибка загрузки комнат'}</div>`;
            return;
        }

        const rooms = await res.json();
        updatePermanentRoomsUI(rooms);
    } catch (e) {
        console.error('Load rooms error:', e);
        if (container) container.innerHTML = `<div style="color: #ff4444; font-size: 0.9rem; padding: 10px;">Connection error</div>`;
    }
}

function updatePermanentRoomsUI(rooms) {
    // 1. Update Profile Modal List
    const container = document.getElementById('roomsListContainer');
    if (container) {
        if (!rooms || rooms.length === 0) {
            container.innerHTML = `<div style="text-align: center; color: var(--fg-dim); font-size: 0.9rem; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 8px;">${currentLang === 'en' ? 'No permanent rooms created yet.' : 'У вас пока нет постоянных комнат.'}</div>`;
        } else {
            let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
            rooms.forEach(r => {
                html += `
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 12px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px;">
                        <div>
                            <div style="font-weight: 700; color: #fff; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                                ${escapeHtml(r.displayName)}
                                <span style="font-family: monospace; background: rgba(255,215,0,0.1); color: #ffd700; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;">ID: ${escapeHtml(r.roomId)}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: var(--fg-dim); margin-top: 4px;">
                                ${r.hasPassword ? '<span style="color: #ffbb33;">Protected by password</span>' : '<span style="color: #00C851;">Public access</span>'}
                            </div>
                        </div>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            <button class="btn-primary" onclick="startBroadcastFromRoom('${escapeHtml(r.roomId)}')" style="padding: 5px 10px; font-size: 0.8rem; border-radius: 4px; width: auto;" title="Start Broadcast">
                                ${currentLang === 'en' ? 'Broadcast' : 'В эфир'}
                            </button>
                            <button class="btn-secondary" onclick="copyRoomLink('${escapeHtml(r.roomId)}')" style="padding: 5px 10px; font-size: 0.8rem; border-radius: 4px; width: auto;" title="Copy Invite Link">
                                ${currentLang === 'en' ? 'Link' : 'Ссылка'}
                            </button>
                            <button class="btn-secondary" onclick="openEditRoom('${r.id}', '${escapeHtml(r.roomId)}', '${escapeHtml(r.displayName)}')" style="padding: 5px 10px; font-size: 0.8rem; border-radius: 4px; width: auto;" title="Edit">
                                ${currentLang === 'en' ? 'Edit' : 'Изменить'}
                            </button>
                            <button class="btn-secondary" onclick="deletePermanentRoom('${r.id}', '${escapeHtml(r.roomId)}')" style="padding: 5px 10px; font-size: 0.8rem; border-radius: 4px; width: auto; background: rgba(255,68,68,0.1); color: #ff4444; border-color: rgba(255,68,68,0.2);" title="Delete">
                                ${currentLang === 'en' ? 'Delete' : 'Удалить'}
                            </button>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        }
    }

    // 2. Update Broadcast Dropdown
    const select = document.getElementById('customRoomId');
    if (select) {
        if (!rooms || rooms.length === 0) {
            select.innerHTML = `<option value="">${currentLang === 'en' ? '-- No rooms found --' : '-- Комнаты не найдены --'}</option>`;
        } else {
            let html = '';
            rooms.forEach(r => {
                html += `<option value="${escapeHtml(r.roomId)}">${escapeHtml(r.displayName || r.roomId)}</option>`;
            });
            select.innerHTML = html;
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function openCreateRoomForm() {
    const idField = document.getElementById('newRoomId');
    const nameField = document.getElementById('newRoomName');
    const passField = document.getElementById('newRoomPassword');
    const formContainer = document.getElementById('createRoomForm');
    
    if (idField) idField.value = '';
    if (nameField) nameField.value = '';
    if (passField) passField.value = '';
    if (formContainer) formContainer.style.display = 'block';
}

async function submitCreateRoom() {
    const idField = document.getElementById('newRoomId');
    const nameField = document.getElementById('newRoomName');
    const passField = document.getElementById('newRoomPassword');
    
    const roomId = idField ? idField.value.trim().toUpperCase() : '';
    const displayName = nameField ? nameField.value.trim() : '';
    const password = passField ? passField.value : '';

    if (!roomId || !/^[A-Z0-9]+$/.test(roomId) || roomId.length > 12) {
        showNotification(currentLang === 'en' ? 'Room ID must be letters/numbers, up to 12 chars' : 'ID должен содержать только буквы/цифры, до 12 символов');
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/rooms`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ roomId, displayName, password })
        });

        const data = await res.json();
        if (!res.ok) {
            showNotification('Error: ' + (data.error || 'Server error'));
            return;
        }

        showNotification(currentLang === 'en' ? 'Permanent room created!' : 'Постоянная комната создана!');
        const formContainer = document.getElementById('createRoomForm');
        if (formContainer) formContainer.style.display = 'none';
        loadPermanentRooms();
    } catch (e) {
        console.error('Create room error:', e);
        showNotification(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения');
    }
}

function openEditRoom(id, roomId, displayName) {
    const dbIdField = document.getElementById('editRoomDbId');
    const codeField = document.getElementById('editRoomCode');
    const nameField = document.getElementById('editRoomName');
    const passField = document.getElementById('editRoomPassword');
    const cbField = document.getElementById('clearRoomPassword');
    const modalEl = document.getElementById('editRoomModal');
    
    if (dbIdField) dbIdField.value = id;
    if (codeField) codeField.value = roomId;
    if (nameField) nameField.value = displayName;
    if (passField) passField.value = '';
    if (cbField) cbField.checked = false;
    if (modalEl) modalEl.classList.add('show');
}

async function submitEditRoom() {
    const dbIdField = document.getElementById('editRoomDbId');
    const nameField = document.getElementById('editRoomName');
    const passField = document.getElementById('editRoomPassword');
    const cbField = document.getElementById('clearRoomPassword');
    
    const id = dbIdField ? dbIdField.value : '';
    const displayName = nameField ? nameField.value.trim() : '';
    const password = passField ? passField.value : '';
    const clearPassword = cbField ? cbField.checked : false;

    let payload = { displayName };
    if (password) {
        payload.password = password;
    } else if (clearPassword) {
        payload.password = '';
    }

    try {
        const res = await fetch(`${API_BASE_URL}/rooms/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            showNotification('Error: ' + (data.error || 'Server error'));
            return;
        }

        showNotification(currentLang === 'en' ? 'Room updated!' : 'Настройки комнаты обновлены!');
        closeModal('editRoomModal');
        loadPermanentRooms();
    } catch (e) {
        console.error('Edit room error:', e);
        showNotification(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения');
    }
}

async function deletePermanentRoom(id, roomId) {
    if (!confirm(currentLang === 'en' ? `Delete permanent room ${roomId}?` : `Удалить постоянную комнату ${roomId}?`)) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/rooms/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showNotification('Error: ' + (data.error || 'Server error'));
            return;
        }

        showNotification(currentLang === 'en' ? 'Room deleted' : 'Комната удалена');
        loadPermanentRooms();
    } catch (e) {
        console.error('Delete room error:', e);
        showNotification(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения');
    }
}

function startBroadcastFromRoom(roomId) {
    closeModal('profileModal');
    
    // Switch to Broadcast tab
    const broadcastBtn = document.querySelector('.tab-btn[data-tab="sender"]');
    if (broadcastBtn) broadcastBtn.click();
    
    // Set custom room id checkbox and value
    const customCb = document.getElementById('customRoomIdCb');
    const customInputGroup = document.getElementById('customRoomIdGroup');
    const customInput = document.getElementById('customRoomId');
    
    if (customCb && customInputGroup && customInput) {
        customCb.checked = true;
        customInputGroup.style.display = 'block';
        customInput.value = roomId;
    }

    showNotification(currentLang === 'en' ? `Selected room ${roomId}. Set password below if needed.` : `Выбрана комната ${roomId}. Укажите пароль ниже при необходимости.`);
}

function copyRoomLink(roomId) {
    const url = window.location.origin + window.location.pathname + '?room=' + encodeURIComponent(roomId);
    navigator.clipboard.writeText(url).then(() => {
        showNotification(currentLang === 'en' ? 'Invite link copied!' : 'Ссылка-приглашение скопирована!');
    }).catch(() => {
        showNotification('Failed to copy link');
    });
}

function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('isPremium');
    localStorage.removeItem('premiumExpiresAt');
    window.location.reload();
}

// Premium
function showPremiumModal() {
    const isAuth = !!localStorage.getItem('authToken');
    const authSection = document.getElementById('premiumAuthSection');
    const plansSection = document.getElementById('premiumPlansSection');
    const promoSection = document.getElementById('premiumPromoSection');

    if (!isAuth) {
        if (authSection) authSection.style.display = 'block';
        if (plansSection) plansSection.style.display = 'none';
        if (promoSection) promoSection.style.display = 'none';

        // Render Google button in premium modal if not already rendered
        if (typeof google !== 'undefined' && document.getElementById("googleSignInBtnPremium")) {
            google.accounts.id.renderButton(
                document.getElementById("googleSignInBtnPremium"),
                { theme: "outline", size: "large", text: "continue_with" }
            );
        }
    } else {
        if (authSection) authSection.style.display = 'none';
        if (plansSection) plansSection.style.display = 'grid';
        if (promoSection) promoSection.style.display = 'block';
    }

    document.getElementById('premiumModal').classList.add('show');
}

function closePremiumModal() {
    document.getElementById('premiumModal').classList.remove('show');
}

async function activatePremium() {
    const promoCode = document.getElementById('promoCode').value.trim();

    if (!promoCode) {
        showNotification(currentLang === 'en' ? 'Enter promo code' : 'Введите промокод');
        return;
    }

    if (!authToken) {
        showNotification(currentLang === 'en' ? 'Please login first' : 'Сначала войдите в аккаунт');
        showAuthModal();
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/premium/activate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ promoCode })
        });

        const data = await res.json();

        if (!res.ok) {
            showNotification('Error: ' + data.error);
            return;
        }

        authToken = data.token;
        isPremium = true;
        localStorage.setItem('authToken', authToken);

        updateUserBadge();
        closePremiumModal();
        showNotification(currentLang === 'en' ? 'Premium activated!' : 'Premium активирован!');

        if (typeof gtag === 'function') gtag('event', 'premium_activation', { user_id: userId });

    } catch (e) {
        console.error('Premium activation error:', e);
        showNotification(currentLang === 'en' ? 'Activation error' : 'Ошибка активации');
    }
}

// WebSocket
function connectWS() {
    return new Promise((resolve, reject) => {
        const wsUrl = WS_BASE_URL;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            updateStatus(currentLang === 'en' ? 'Connected to server' : 'Подключено к серверу', 'connected');
            if (authToken) verifyToken();
            resolve();
        };

        ws.onmessage = async (msg) => {
            try {
                const data = JSON.parse(msg.data);
                console.log('Received:', data.type);

                switch (data.type) {
                    case 'auth-success':
                        isPremium = data.isPremium;
                        userId = data.userId;
                        updateUserBadge();
                        break;

                    case 'joined':
                        localRoomId = data.room;
                        if (data.iceServers) {
                            serverIceServers = data.iceServers;
                            console.log('ICE Servers updated from server');
                        }

                        // If we are a receiver, now is the time to init the PeerConnection
                        // because we now have the TURN credentials.
                        if (ws.role === 'receiver') {
                            initReceiverRTC();
                        }

                        if (data.receiverCount !== undefined) {
                            document.getElementById('receiverCount').textContent = data.receiverCount;
                        }
                        showNotification(currentLang === 'en' ? 'Room created!' : 'Комната создана!');
                        break;

                    case 'peer-connected':
                        if (data.receiverCount !== undefined) {
                            document.getElementById('receiverCount').textContent = data.receiverCount;
                        }
                        showNotification(currentLang === 'en' ? 'Participant connected!' : 'Участник подключился!');
                        updateStatus(currentLang === 'en' ? 'Participant connected' : 'Участник подключен', 'connected');
                        if (data.clientId) createPeerConnection(data.clientId);
                        break;

                    case 'peer-disconnected':
                        if (data.receiverCount !== undefined) {
                            document.getElementById('receiverCount').textContent = data.receiverCount;
                        }
                        showNotification(currentLang === 'en' ? 'Participant disconnected' : 'Участник отключился');
                        updateStatus(currentLang === 'en' ? 'Participant disconnected' : 'Участник отключился', 'disconnected');
                        if (data.clientId) {
                            const pcToClose = peerConnections.get(data.clientId);
                            if (pcToClose) {
                                pcToClose.close();
                                peerConnections.delete(data.clientId);
                                iceQueue.delete(data.clientId);
                                remoteDescriptionSet.delete(data.clientId);
                            }
                        }
                        break;

                    case 'offer':
                        await handleOffer(data.offer, data.from);
                        break;

                    case 'answer':
                        await handleAnswer(data.answer, data.from);
                        break;

                    case 'ice-candidate':
                        await handleIceCandidate(data.candidate, data.from);
                        break;

                    case 'error':
                        if (data.message === 'Password required' || data.message === 'Incorrect password') {
                            const passInp = document.getElementById('receiverPassword');
                            if (passInp) {
                                passInp.style.display = 'block';
                                passInp.focus();
                            }
                            // Re-enable join button
                            const startBtn = document.getElementById('btnStartReceiver');
                            if (startBtn) {
                                startBtn.disabled = false;
                                startBtn.style.display = 'block';
                            }
                            const stopBtn = document.getElementById('btnStopReceiver');
                            if (stopBtn) stopBtn.style.display = 'none';
                            
                            showNotification(currentLang === 'en' ? data.message : (data.message === 'Password required' ? 'Требуется пароль' : 'Неверный пароль'));
                        } else {
                            showNotification('Error: ' + data.message);
                        }
                        break;

                    case 'session-info':
                        handleSessionInfo(data);
                        break;

                    case 'session-expired':
                        handleSessionExpired();
                        break;
                }
            } catch (e) {
                console.error('Message handling error:', e);
            }
        };

        ws.onerror = (err) => {
            console.error('WebSocket error', err);
            updateStatus(currentLang === 'en' ? 'Connection error' : 'Ошибка соединения', 'disconnected');
            reject(err);
        };

        ws.onclose = () => {
            console.log('WebSocket closed');
            updateStatus(currentLang === 'en' ? 'Disconnected' : 'Отключено', 'disconnected');
            ws = null;
        };

        setTimeout(() => reject(new Error('Timeout')), 5000);
    });
}

// Sender
const startSenderBtn = document.getElementById('btnStartSender');
if (startSenderBtn) {
    startSenderBtn.onclick = async () => {
        // iOS Safari does not support getDisplayMedia (sending screen/audio)
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            showNotification(currentLang === 'ru'
                ? 'iOS не поддерживает стриминг экрана/аудио. Вы можете быть только Получателем.'
                : 'iOS does not support screen streaming. You can only be a Receiver.');
            return;
        }

        if (isPremium) {
            skipDonationAndStart();
            return;
        }

        // Show donation modal before starting
        document.getElementById('preBroadcastModal').classList.add('show');
    };
}

async function skipDonationAndStart() {
    document.getElementById('preBroadcastModal').classList.remove('show');
    
    try {
        startSenderBtn.disabled = true;
        if (!ws) await connectWS();
        await startAsSender();

        startSenderBtn.style.display = 'none';
        document.getElementById('btnStopSender').style.display = 'block';
        document.getElementById('senderInfo').style.display = 'block';

        showNotification(currentLang === 'en' ? 'Streaming started!' : 'Трансляция началась!');

        if (typeof gtag === 'function') gtag('event', 'start_streaming', { room_id: localRoomId, is_premium: isPremium });

        // debug stats
        if (debugInterval) clearInterval(debugInterval);
        debugInterval = setInterval(updateDebugStats, 1000);
    } catch (e) {
        console.error('Error:', e);
        showNotification('Error: ' + e.message);
        startSenderBtn.disabled = false;
    }
}

const stopSenderBtn = document.getElementById('btnStopSender');
if (stopSenderBtn) {
    stopSenderBtn.onclick = () => {
        stopStreaming();
        document.getElementById('btnStartSender').style.display = 'block';
        stopSenderBtn.style.display = 'none';
        document.getElementById('senderInfo').style.display = 'none';
        showNotification(currentLang === 'en' ? 'Streaming stopped' : 'Трансляция остановлена');
    };
}

async function startAsSender() {
    const password = isPremium ? document.getElementById('roomPassword').value : null;

    // Firefox-specific audio handling
    // We try to request system audio explicitly using standard and experimental constraints
    let stream;
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                systemAudio: 'include' // Hint to browser to include system audio
            }
        });
    } catch (err) {
        throw err;
    }

    // Check if we actually got audio tracks
    if (stream.getAudioTracks().length === 0) {
        // If no audio, do NOT throw an error immediately. 
        // Just warn the user. This matches official WebRTC samples behavior 
        // where it doesn't crash if you don't select audio.
        showNotification(currentLang === 'ru'
            ? 'Внимание: Аудио не выбрано. Вы транслируете без звука.'
            : 'Warning: No audio selected. Streaming silent.');
    }

    // CRITICAL FIX FOR FIREFOX: 
    // Do NOT stop the video track immediately. In some versions of Firefox, 
    // stopping the video track of a display stream might kill the entire stream or audio.
    // We will just NOT add the video track to the PeerConnection later.

    // const videoTrack = stream.getVideoTracks()[0];
    // if (videoTrack) videoTrack.stop(); 

    const audioTracks = stream.getAudioTracks();

    // If we have audio, use it. If not, we still proceed (maybe it's a silent stream test?)
    // But visualizer needs a track, so we create a dummy if needed or handle it gracefully.
    if (audioTracks.length > 0) {
        localStream = new MediaStream(audioTracks);
        setupAudioVisualizer(localStream, 'visualizer');
    } else {
        // Create a silent dummy stream so logic doesn't break
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        localStream = dest.stream;
    }

    // Store the original full stream so we can stop it later properly
    localStream.fullDisplayStream = stream;

    const customIdCb = document.getElementById('customRoomIdCb');
    const customIdInput = document.getElementById('customRoomId');
    
    let roomId;
    if (isPremium && customIdCb && customIdCb.checked && customIdInput && customIdInput.value.trim()) {
        roomId = customIdInput.value.trim().toUpperCase();
    } else {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    
    localRoomId = roomId;

    document.getElementById('roomIdDisplay').textContent = roomId;
    generateQRCode(roomId);

    // Start Debug Stats for Sender
    if (debugInterval) clearInterval(debugInterval);
    debugInterval = setInterval(updateDebugStats, 1000);

    ws.send(JSON.stringify({ type: 'join', room: roomId, role: 'sender', password }));
}

// Receiver
const startReceiverBtn = document.getElementById('btnStartReceiver');
if (startReceiverBtn) {
    startReceiverBtn.onclick = async () => {
        try {
            // Initialize AudioContext during a real user gesture so it doesn't get suspended!
            if (!window.AudioContext && !window.webkitAudioContext) {
                console.warn('Web Audio API not supported');
            } else {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
            }

            const room = document.getElementById('roomInput').value.trim().toUpperCase();
            if (!room) {
                showNotification(currentLang === 'en' ? 'Enter Room ID' : 'Введите ID комнаты');
                return;
            }

            startReceiverBtn.disabled = true;
            if (!ws) await connectWS();
            ws.role = 'receiver'; // Set role early for the handler
            await requestJoinAsReceiver(room);

            startReceiverBtn.style.display = 'none';
            document.getElementById('btnStopReceiver').style.display = 'block';
            document.getElementById('receiverInfo').style.display = 'block';

            showNotification(currentLang === 'en' ? 'Connecting...' : 'Подключение...');

            if (typeof gtag === 'function') gtag('event', 'join_room', { room_id: room });
        } catch (e) {
            console.error('Error:', e);
            showNotification('Error: ' + e.message);
            startReceiverBtn.disabled = false;
        }
    };
}

const stopReceiverBtn = document.getElementById('btnStopReceiver');
if (stopReceiverBtn) {
    stopReceiverBtn.onclick = () => {
        stopStreaming();
        document.getElementById('btnStartReceiver').style.display = 'block';
        stopReceiverBtn.style.display = 'none';
        document.getElementById('receiverInfo').style.display = 'none';

        // Re-enable start button
        document.getElementById('btnStartReceiver').disabled = false;

        showNotification(currentLang === 'en' ? 'Disconnected' : 'Отключено');
    };
}

async function requestJoinAsReceiver(roomId) {
    const password = document.getElementById('receiverPassword').value;
    localRoomId = roomId;
    ws.send(JSON.stringify({ type: 'join', room: roomId, role: 'receiver', password }));
}

function initReceiverRTC() {
    console.log('Initializing Receiver WebRTC with servers:', serverIceServers);
    iceQueue = new Map();
    remoteDescriptionSet = new Map();

    pc = new RTCPeerConnection({
        iceServers: serverIceServers,
        sdpSemantics: 'unified-plan'
    });

    pc.ontrack = (event) => {
        console.log('Track received');
        if (!audioElement) {
            audioElement = document.createElement('audio');
            audioElement.autoplay = true;
            audioElement.playsInline = true; // Important for iOS
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);
        }

        audioElement.srcObject = event.streams[0];

        const debugTrack = document.getElementById('debugTrack');
        if (debugTrack) debugTrack.textContent = 'Recv';

        // Show play button on mobile/Safari
        // Improved Autoplay Handling
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        // On mobile, show overlay immediately as a precaution (autplay policies are strict)
        if (isMobile) {
            document.getElementById('playOverlay').classList.add('show');
        }

        audioElement.play().then(() => {
            // If autoplay actually worked (rare on mobile), hide the overlay
            document.getElementById('playOverlay').classList.remove('show');
            audioUnlocked = true;
        }).catch(e => {
            console.log('Autoplay blocked, showing overlay');
            document.getElementById('playOverlay').classList.add('show');
        }).finally(() => {
            // Always show manual button on mobile or if likely blocked, 
            // but here we just show it always if we are on receiver as a fallback
            const manualBtn = document.getElementById('btnManualAudio');
            if (manualBtn) manualBtn.style.display = 'block';
        });

        setupAudioVisualizer(event.streams[0], 'visualizerReceiver');
        updateStatus(currentLang === 'en' ? 'Playing audio' : 'Воспроизведение аудио', 'connected');
        showNotification(currentLang === 'en' ? 'Audio received!' : 'Аудио получено!');
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                room: localRoomId,
                candidate: event.candidate
            }));
        }
    };

    // Start Debug Stats
    if (debugInterval) clearInterval(debugInterval);
    debugInterval = setInterval(updateDebugStats, 1000);

    // Apply current buffer settings
    applyJitterBufferTarget();
}

// WebRTC Handlers
async function createPeerConnection(targetClientId) {
    console.log('Creating PC for', targetClientId);
    const pc = new RTCPeerConnection({
        iceServers: serverIceServers,
        sdpSemantics: 'unified-plan'
    });

    peerConnections.set(targetClientId, pc);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
        if (event.candidate) {
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

    ws.send(JSON.stringify({ type: 'offer', room: localRoomId, target: targetClientId, offer }));
}

async function handleOffer(offer, from) {
    if (!pc) return; // Receiver-side PC

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    remoteDescriptionSet.set(from, true);

    const queue = iceQueue.get(from) || [];
    while (queue.length > 0) {
        const candidate = queue.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({ type: 'answer', room: localRoomId, answer }));
}

async function handleAnswer(answer, from) {
    const senderPc = peerConnections.get(from);
    if (!senderPc) return;

    await senderPc.setRemoteDescription(new RTCSessionDescription(answer));
    remoteDescriptionSet.set(from, true);

    const queue = iceQueue.get(from) || [];
    while (queue.length > 0) {
        const candidate = queue.shift();
        await senderPc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

async function handleIceCandidate(candidate, from) {
    const targetPc = pc || peerConnections.get(from);
    if (!targetPc) {
        if (!iceQueue.has(from)) iceQueue.set(from, []);
        iceQueue.get(from).push(candidate);
        return;
    }

    if (remoteDescriptionSet.get(from)) {
        await targetPc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
        if (!iceQueue.has(from)) iceQueue.set(from, []);
        iceQueue.get(from).push(candidate);
    }
}

// Audio Visualizer
function setupAudioVisualizer(stream, containerId) {
    if (!window.AudioContext && !window.webkitAudioContext) {
        console.error('Web Audio API not supported');
        return;
    }

    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    // Software volume for receivers (Fixes mobile volume slider issues)
    if (containerId === 'visualizerReceiver') {
        // REMOVED logic for Software GainNode + MediaStreamDestination.
        // Manipulating srcObject of the audio element with a Web API destination
        // completely breaks audio playback on iOS Safari. Hardware volume buttons
        // work perfectly on mobile, so software volume control here is unnecessary and harmful.
        setupMediaSession();
    }

    source.connect(analyser);
    analyser.fftSize = 64;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const bars = document.querySelectorAll(`#${containerId} .bar`);

    function animate() {
        animationFrame = requestAnimationFrame(animate);
        analyser.getByteFrequencyData(dataArray);

        bars.forEach((bar, i) => {
            const value = dataArray[i] || 0;
            const height = (value / 255) * 100;
            bar.style.height = height + '%';
        });
    }

    animate();
}

// QR Code
function generateQRCode(roomId) {
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';

    const url = `${location.protocol}//${location.host}?room=${roomId}`;

    if (typeof QRCode !== 'undefined') {
        new QRCode(qrContainer, {
            text: url,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }
}

// Copy Room ID
const copyRoomBtn = document.getElementById('btnCopyRoom');
if (copyRoomBtn) {
    copyRoomBtn.onclick = () => {
        const roomId = document.getElementById('roomIdDisplay').textContent;
        navigator.clipboard.writeText(roomId).then(() => {
            showNotification(currentLang === 'en' ? 'ID copied!' : 'ID скопирован!');
        });
    };
}

// Volume Control
const volumeSlider = document.getElementById('volumeSlider');
if (volumeSlider) {
    volumeSlider.oninput = (e) => {
        const volume = e.target.value / 100;
        document.getElementById('volumeValue').textContent = e.target.value;

        if (audioElement) {
            audioElement.volume = volume;
        }
        // Apply to software gain node (Fix for mobile)
        if (gainNode) {
            gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, 0.05);
        }
    };
}

// Jitter Buffer Control
const bufferSlider = document.getElementById('bufferSlider');
const bufferValueDisplay = document.getElementById('bufferValue');
if (bufferSlider && bufferValueDisplay) {
    bufferSlider.oninput = (e) => {
        const value = parseInt(e.target.value);
        bufferValueDisplay.textContent = value;
        jitterBufferTargetValue = value;
        applyJitterBufferTarget();
    };
}

function applyJitterBufferTarget() {
    if (!pc) return;
    const receivers = pc.getReceivers();
    receivers.forEach(receiver => {
        if (receiver.track && receiver.track.kind === 'audio') {
            if ('jitterBufferTarget' in receiver) {
                receiver.jitterBufferTarget = jitterBufferTargetValue;
                console.log(`Jitter buffer target set to ${jitterBufferTargetValue}ms`);
            }
        }
    });
}

// Stop Streaming
function stopStreaming() {


    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());

        // Also stop the full stream if we saved it (for the Firefox video track fix)
        if (localStream.fullDisplayStream) {
            localStream.fullDisplayStream.getTracks().forEach(t => t.stop());
        }

        localStream = null;
    }

    if (audioElement) {
        audioElement.pause();
        audioElement.srcObject = null;
        audioElement = null;
    }

    if (pc) {
        pc.close();
        pc = null;
    }

    peerConnections.forEach(pcToClose => pcToClose.close());
    peerConnections.clear();
    iceQueue.clear();
    remoteDescriptionSet.clear();

    if (ws) {
        ws.close();
        ws = null;
    }

    updateStatus(currentLang === 'en' ? 'Stopped' : 'Остановлено', 'disconnected');

    if (debugInterval) {
        clearInterval(debugInterval);
        debugInterval = null;
    }

    if (sessionCountdownInterval) {
        clearInterval(sessionCountdownInterval);
        sessionCountdownInterval = null;
    }

    // Hide countdown timer
    const timerEl = document.getElementById('sessionTimer');
    if (timerEl) timerEl.style.display = 'none';
}

// ===== FREE SESSION LIMIT =====

function handleSessionInfo(data) {
    console.log('Session info received:', data);
    if (data.isPremium) {
        // Premium user -- no timer needed
        const timerEl = document.getElementById('sessionTimer');
        if (timerEl) timerEl.style.display = 'none';
        return;
    }

    // Start countdown for free users
    startSessionCountdown(data.maxDuration);
}

function startSessionCountdown(durationMs) {
    const timerEl = document.getElementById('sessionTimer');
    if (!timerEl) return;

    timerEl.style.display = 'flex';
    let remaining = Math.floor(durationMs / 1000);

    function updateDisplay() {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const timerText = document.getElementById('sessionTimerText');
        if (timerText) {
            const t = translations[currentLang];
            timerText.textContent = (t.session_remaining || 'Free session: {time}').replace('{time}', timeStr);
        }

        // Change color when less than 3 minutes remain
        if (remaining <= 180) {
            timerEl.style.borderColor = '#ff4444';
            timerEl.style.background = 'rgba(255, 68, 68, 0.1)';
        }

        // Change color when less than 1 minute
        if (remaining <= 60) {
            timerEl.style.animation = 'pulse 1s infinite';
        }
    }

    updateDisplay();
    sessionCountdownInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(sessionCountdownInterval);
            sessionCountdownInterval = null;
            // Server will send session-expired, no need to do anything here
        }
        updateDisplay();
    }, 1000);
}

function handleSessionExpired() {
    sessionExpiredByServer = true;

    // Stop all streaming
    stopStreaming();

    // Reset UI buttons
    const startSender = document.getElementById('btnStartSender');
    const stopSender = document.getElementById('btnStopSender');
    const senderInfo = document.getElementById('senderInfo');
    const startReceiver = document.getElementById('btnStartReceiver');
    const stopReceiver = document.getElementById('btnStopReceiver');
    const receiverInfo = document.getElementById('receiverInfo');

    if (startSender) { startSender.style.display = 'block'; startSender.disabled = false; }
    if (stopSender) stopSender.style.display = 'none';
    if (senderInfo) senderInfo.style.display = 'none';
    if (startReceiver) { startReceiver.style.display = 'block'; startReceiver.disabled = false; }
    if (stopReceiver) stopReceiver.style.display = 'none';
    if (receiverInfo) receiverInfo.style.display = 'none';

    // Show the session expired modal
    const modal = document.getElementById('sessionExpiredModal');
    if (modal) modal.classList.add('show');

    if (typeof gtag === 'function') gtag('event', 'free_session_expired');
}

function closeSessionExpiredModal() {
    const modal = document.getElementById('sessionExpiredModal');
    if (modal) modal.classList.remove('show');
    sessionExpiredByServer = false;
}

function reconnectAfterExpiry() {
    closeSessionExpiredModal();
    showNotification(currentLang === 'en' ? 'You can start a new session' : (currentLang === 'ru' ? 'Вы можете начать новую сессию' : '您可以开始新的会话'));
}

// Debug Stats
async function updateDebugStats() {
    console.log('Updating debug stats... PC existence:', !!pc);
    // Receiver Logic
    if (pc) {
        try {
            const stats = await pc.getStats();
            let packetsReceived = 0;
            let packetsLost = 0;
            let connectionType = 'N/A';
            let jitter = 0;
            let bufferDelay = 0;
            let rtt = 0;

            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    const remoteCandidate = stats.get(report.remoteCandidateId);
                    if (remoteCandidate) {
                        connectionType = remoteCandidate.candidateType === 'relay' ? 'Relay' : 'P2P';
                    }
                    rtt = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0;
                }
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                    const now = report.timestamp;
                    const bytes = report.bytesReceived;

                    if (lastTimestamp && lastBytesReceived) {
                        bitrate = ((bytes - lastBytesReceived) * 8) / (now - lastTimestamp);
                    }

                    lastBytesReceived = bytes;
                    lastTimestamp = now;

                    packetsReceived = report.packetsReceived;
                    packetsLost = report.packetsLost;
                    jitter = report.jitter ? report.jitter * 1000 : 0;

                    if (report.jitterBufferDelay && report.jitterBufferEmittedCount) {
                        bufferDelay = (report.jitterBufferDelay / report.jitterBufferEmittedCount) * 1000;
                    }
                }
            });

            // Update Receiver UI
            const debugConnection = document.getElementById('debugConnection');
            const debugIce = document.getElementById('debugIce');
            const debugBitrate = document.getElementById('debugBitrate');
            const debugPackets = document.getElementById('debugPackets');
            const debugLoss = document.getElementById('debugLoss');
            const debugType = document.getElementById('debugType');
            const debugRTT = document.getElementById('debugRTT');
            const debugJitter = document.getElementById('debugJitter');
            const debugBuffer = document.getElementById('debugBuffer');

            if (debugConnection) debugConnection.textContent = pc.connectionState;
            if (debugIce) debugIce.textContent = pc.iceConnectionState;
            if (debugBitrate) debugBitrate.textContent = Math.round(bitrate) + ' kbps';
            if (debugType) {
                debugType.textContent = connectionType;
                debugType.style.color = connectionType === 'Relay' ? 'var(--primary)' : '#4CAF50';

                const relayNote = document.getElementById('debugRelayNote');
                if (relayNote) {
                    if (connectionType === 'Relay') {
                        relayNote.textContent = translations[currentLang].debug_relay_note;
                        relayNote.style.display = 'block';
                    } else {
                        relayNote.style.display = 'none';
                    }
                }
            }
            if (debugRTT) debugRTT.textContent = Math.round(rtt) + ' ms';
            if (debugJitter) debugJitter.textContent = jitter.toFixed(1) + ' ms';
            if (debugBuffer) debugBuffer.textContent = Math.round(bufferDelay) + ' ms';
            if (debugPackets) debugPackets.textContent = packetsReceived;
            if (debugLoss) debugLoss.textContent = packetsLost + ' (pkt)';

        } catch (e) {
            console.error('Receiver stats error:', e);
        }
    }

    // Sender Logic
    if (peerConnections.size > 0 || ws?.role === 'sender') {
        try {
            let totalBytesSent = 0;
            let totalPacketsSent = 0;
            const now = performance.now();

            const statsPromises = [];
            const peerIds = Array.from(peerConnections.keys());
            peerIds.forEach(id => statsPromises.push(peerConnections.get(id).getStats()));

            const results = await Promise.all(statsPromises);
            let peersHTML = '';

            results.forEach((stats, index) => {
                const peerId = peerIds[index];
                const pc = peerConnections.get(peerId);
                let peerBitrate = 0;
                let peerType = 'P2P';

                stats.forEach(report => {
                    if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                        totalBytesSent += report.bytesSent;
                        totalPacketsSent += report.packetsSent;
                        // For individual bitrate we'd need per-peer tracking.
                        // Simplified: just show connection state and type for now
                    }
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        const remoteCandidate = stats.get(report.remoteCandidateId);
                        if (remoteCandidate) {
                            peerType = remoteCandidate.candidateType === 'relay' ? 'Relay' : 'P2P';
                        }
                    }
                });

                peersHTML += `<div>Peer [${peerId.substring(0, 4)}]: ${pc.iceConnectionState} (${peerType})</div>`;
            });

            let totalBitrate = 0;
            if (lastSenderTimestamp && lastSenderBytesSent) {
                totalBitrate = ((totalBytesSent - lastSenderBytesSent) * 8) / (now - lastSenderTimestamp) * 1000;
            }

            lastSenderBytesSent = totalBytesSent;
            lastSenderTimestamp = now;

            // Update Sender UI
            const debugSenderPeers = document.getElementById('debugSenderPeers');
            const debugSenderBitrate = document.getElementById('debugSenderBitrate');
            const debugSenderPackets = document.getElementById('debugSenderPackets');
            const senderDebugStats = document.getElementById('senderDebugStats');

            if (debugSenderPeers) debugSenderPeers.textContent = peerConnections.size;
            if (debugSenderBitrate) debugSenderBitrate.textContent = Math.round(totalBitrate) + ' kbps';
            if (debugSenderPackets) debugSenderPackets.textContent = totalPacketsSent;

            // Append per-peer info if container exists
            if (senderDebugStats) {
                // Keep the original stats but append peer list
                const baseInfo = `
                    <div>${translations[currentLang].debug_peers}: <span>${peerConnections.size}</span></div>
                    <div>${translations[currentLang].debug_total_bitrate}: <span>${Math.round(totalBitrate)} kbps</span></div>
                    <div>${translations[currentLang].debug_total_packets}: <span>${totalPacketsSent}</span></div>
                    <div style="margin-top:5px; border-top:1px solid rgba(255,255,255,0.1); padding-top:5px;">
                        ${peersHTML}
                    </div>
                `;
                senderDebugStats.innerHTML = baseInfo;
            }

        } catch (e) {
            console.error('Sender stats error:', e);
        }
    }
}

// Helpers
function showNotification(message, duration = 8000) {
    const notif = document.getElementById('notification');
    if (notif) {
        notif.textContent = message;
        notif.classList.add('show');
        setTimeout(() => notif.classList.remove('show'), duration);
    }
}



function updateStatus(text, type = 'connecting') {
    const badge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');
    if (!badge || !statusText) return;

    badge.className = `status-badge ${type}`;
    const statuses = {
        en: {
            connected: 'Connected',
            disconnected: 'Disconnected',
            connecting: 'Connecting...'
        },
        ru: {
            connected: 'Подключено',
            disconnected: 'Отключено',
            connecting: 'Подключение...'
        }
    };
    const langObj = statuses[currentLang] || statuses.en;
    badge.textContent = langObj[type] || langObj.connecting;
    statusText.textContent = text;
}

window.addEventListener('beforeunload', stopStreaming);
if (typeof updateUserBadge === 'function') updateUserBadge();

// Visibility Change Handler to prevent AudioContext suspension
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
});

function setupMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Audio Streamer',
            artist: 'WebRTC Audio Streamer',
            album: localRoomId ? `Room: ${localRoomId}` : 'WebRTC Stream',
            artwork: [
                { src: '/og-image.png', sizes: '512x512', type: 'image/png' }
            ]
        });

        navigator.mediaSession.setActionHandler('play', () => {
            if (audioElement) audioElement.play();
            if (audioContext) audioContext.resume();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            if (audioElement) audioElement.pause();
        });
    }
}

// Global Modal Handlers
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Inject content based on current language
    if (modalId === 'privacyModal') {
        const content = document.getElementById('privacyContent');
        if (content) content.innerText = translations[currentLang].privacy_text;
    } else if (modalId === 'termsModal') {
        const content = document.getElementById('termsContent');
        if (content) content.innerText = translations[currentLang].terms_text;
    }

    modal.classList.add('show');
    document.body.style.overflow = 'hidden'; // Prevent scrolling
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = ''; // Re-enable scrolling
    }
}

// Close modals when clicking outside
window.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal')) {
        closeModal(event.target.id);
    }
});
