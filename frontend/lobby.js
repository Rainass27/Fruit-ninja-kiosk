let roomId = '';
let playerCount = 1;
let socket;
let playersJoined = [];

// Parse Room ID from URL or generate a new one
const urlParams = new URLSearchParams(window.location.search);
const urlRoom = urlParams.get('room');
if (urlRoom) {
  roomId = urlRoom.toUpperCase();
} else {
  roomId = Math.random().toString(36).substr(2, 4).toUpperCase();
  const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + roomId;
  window.history.pushState({ path: newUrl }, '', newUrl);
}

const FRONTEND_URL = window.location.origin;
const BACKEND_URL = "https://fruit-ninja-kiosk-production.up.railway.app";

// Connect to Socket.IO
socket = io(BACKEND_URL, { transports: ['websocket'] });

socket.on('connect', () => {
  console.log("Scanner connected to Socket.IO server");
  socket.emit('create-room', roomId);
  // Sync initial player count mode on connect
  socket.emit('set-lobby-mode', { roomId, playerCount });
});

// Auto-redirect to the gameplay canvas on game start
socket.on('game-started', () => {
  window.location.href = `/game?room=${roomId}`;
});

// Immediately render the QR code for Vercel
updateQR(FRONTEND_URL);

function updateQR(baseUrl) {
  const controllerURL = `${baseUrl}/controller?room=${roomId}`;
  document.getElementById('connect-link').innerText = controllerURL;
  
  // Clear previous QR code
  document.getElementById('qr-code').innerHTML = '';
  
  // Generate QR Code
  new QRCode(document.getElementById("qr-code"), {
    text: controllerURL,
    width: 180,
    height: 180,
    colorDark : "#08080c",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });
}

// Receive room players and queue updates from server
socket.on('lobby-update', (data) => {
  playersJoined = data.players;
  const queueLength = data.queueLength;
  
  // Update Player count selector if synced from server
  if (data.playerCount && data.playerCount !== playerCount) {
    playerCount = data.playerCount;
    document.getElementById('mode-1player').classList.toggle('active', playerCount === 1);
    document.getElementById('mode-2player').classList.toggle('active', playerCount === 2);
  }

  // Update lobby roster UI
  const listEl = document.getElementById('player-lobby-list');
  if (listEl) {
    listEl.innerHTML = '';
    if (playersJoined.length === 0) {
      listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; width: 100%;">No players joined yet.</div>';
    } else {
      playersJoined.forEach(p => {
        const slotColor = p.slot === 1 ? 'var(--primary-neon)' : 'var(--accent-neon)';
        const readyStatusText = p.ready ? 'READY' : 'NOT READY';
        const readyColor = p.ready ? 'var(--success-neon)' : 'var(--accent-neon)';
        
        listEl.innerHTML += `
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--glass-border);">
            <span style="font-weight: 600; color: ${slotColor};">Player ${p.slot}: ${p.name}</span>
            <span style="font-size: 0.8rem; color: ${readyColor}; text-transform: uppercase; font-weight: 600;">${readyStatusText}</span>
          </div>
        `;
      });
    }
  }

  // Update queue UI
  const queueInfo = document.getElementById('lobby-queue-info');
  const queueCount = document.getElementById('queue-count-val');
  if (queueInfo && queueCount) {
    if (queueLength > 0) {
      queueCount.innerText = queueLength;
      queueInfo.style.display = 'block';
    } else {
      queueInfo.style.display = 'none';
    }
  }

  // Toggle Start Game button on the Kiosk display based on player presence
  const startBtn = document.getElementById('open-game-btn');
  if (startBtn) {
    if (playersJoined.length > 0) {
      startBtn.style.display = 'block';
    } else {
      startBtn.style.display = 'none';
    }
  }
});

// Configures dynamic player headcount (1 or 2 player mode)
function setPlayerCount(count) {
  playerCount = count;
  document.getElementById('mode-1player').classList.toggle('active', count === 1);
  document.getElementById('mode-2player').classList.toggle('active', count === 2);
  
  socket.emit('set-lobby-mode', { roomId, playerCount: count });

  // Prevent laptop screen from sleeping
  requestWakeLock();
}

// Laptop Screen Wake Lock implementation
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock activated on Laptop lobby.');
      
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          requestWakeLock();
        }
      });
    }
  } catch (err) {
    console.warn('Wake Lock request failed:', err);
  }
}

// Redirects or opens game screen in a new window
function openGameWindow() {
  window.open(`/game?room=${roomId}`, '_blank');
}

// Emits start game request directly from Kiosk display touchscreen click
function clickStartGame() {
  if (roomId && socket.connected) {
    console.log("Start Game clicked on Kiosk touchscreen. Emitting request...");
    socket.emit('start-game-request', { roomId });
  }
}
