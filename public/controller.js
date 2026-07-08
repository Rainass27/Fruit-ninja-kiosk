// Parse Room ID from URL
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');
const roomCodeTag = document.getElementById('room-code-tag');

if (roomId) {
  if (roomCodeTag) roomCodeTag.innerText = roomId.toUpperCase();
}

const socket = io({ transports: ['websocket'] });

// UI Screen Elements
const permissionScreen = document.getElementById('permission-screen');
const connStatusDot = document.getElementById('connection-status-dot');
const connStatusText = document.getElementById('connection-status-text');

// Diagnostics elements
const diagAccel = document.getElementById('diag-accel');
const diagPeak = document.getElementById('diag-peak');
const diagSwings = document.getElementById('diag-swings');
let swingCount = 0;

// Orientation state
let alpha = 0;
let beta = 0;
let gamma = 0;

// Acceleration state
let accMag = 0;
let isSwinging = false;
let swingCooldown = false;

// Gravity isolation low-pass variables
let gravityX = 0;
let gravityY = 0;
let gravityZ = 0;
const GRAVITY_ALPHA = 0.8;

const SWING_THRESHOLD = 5.0; // Slightly lowered to trigger swings more easily
const SWING_WINDOW_MS = 150; // window to hold active swing status
const SWING_COOLDOWN_MS = 250; // cooldown between registered slashes

// Client Multi-Player State
let myName = '';
let mySlot = null;

function showScreen(screenId) {
  const screens = [
    'room-entry-screen',
    'name-entry-screen',
    'lobby-screen',
    'queue-screen',
    'controller-screen',
    'game-over-screen'
  ];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === screenId) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });
}

// Connect Socket.IO
socket.on('connect', () => {
  if (roomId) {
    socket.emit('join-room', roomId);
    if (connStatusDot) connStatusDot.classList.add('connected');
    if (connStatusText) {
      connStatusText.innerText = "Connected";
      connStatusText.style.color = "var(--success-neon)";
    }
  }
});

socket.on('disconnect', () => {
  if (connStatusDot) connStatusDot.classList.remove('connected');
  if (connStatusText) {
    connStatusText.innerText = "Disconnected";
    connStatusText.style.color = "var(--accent-neon)";
  }
});

// Server notifies us which room we actually joined (supporting auto-routing)
socket.on('room-joined', (data) => {
  if (data.roomId) {
    console.log(`Successfully joined room: ${data.roomId} (requested: ${roomId})`);
    roomId = data.roomId;
    if (roomCodeTag) {
      roomCodeTag.innerText = roomId.toUpperCase();
    }
    const lobbyRoom = document.getElementById('lobby-room-code');
    if (lobbyRoom) {
      lobbyRoom.innerText = roomId.toUpperCase();
    }
  }
});

// Handle Lobby and Queuing enrollment results
socket.on('join-result', (data) => {
  const { status, slot, position, playerName, playerCount } = data;
  if (status === 'joined' || status === 'promoted') {
    mySlot = slot;
    const readyBtn = document.getElementById('btn-ready');
    if (readyBtn) {
      readyBtn.disabled = false;
      readyBtn.innerText = "Start Game";
    }
    const lobbyStatus = document.getElementById('lobby-status-text');
    if (lobbyStatus) {
      if (playerCount === 1) {
        lobbyStatus.innerText = `Welcome, ${playerName}! You are Player ${slot}. Click Start Game to begin.`;
      } else {
        lobbyStatus.innerText = `Welcome, ${playerName}! You are Player ${slot}. Waiting for Player 2 to join...`;
      }
    }
    const lobbyRoom = document.getElementById('lobby-room-code');
    if (lobbyRoom) {
      lobbyRoom.innerText = roomId.toUpperCase();
    }
    showScreen('lobby-screen');
  } else if (status === 'waiting') {
    mySlot = null;
    const queueVal = document.getElementById('queue-pos-val');
    if (queueVal) {
      queueVal.innerText = `#${position}`;
    }
    showScreen('queue-screen');
  }
});

// Receive room players and queue updates from server (to list players in phone lobby)
socket.on('lobby-update', (data) => {
  const { players } = data;
  
  let serverPlayerCount = data.playerCount || 1;
  
  const listEl = document.getElementById('lobby-players-list');
  if (listEl) {
    listEl.innerHTML = '';
    players.forEach(p => {
      const isMe = p.socketId === socket.id;
      const meTag = isMe ? ' (You)' : '';
      const slotColor = p.slot === 1 ? 'var(--primary-neon)' : 'var(--accent-neon)';
      const readyColor = p.ready ? 'var(--success-neon)' : 'var(--accent-neon)';
      const readyText = p.ready ? 'READY' : 'NOT READY';
      
      listEl.innerHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--glass-border); width: 100%;">
          <span style="font-weight: 600; color: ${slotColor};">Player ${p.slot}: ${p.name}${meTag}</span>
          <span style="font-size: 0.8rem; color: ${readyColor}; text-transform: uppercase; font-weight: 600;">${readyText}</span>
        </div>
      `;
    });
  }

  // Update status message dynamically based on players joined and ready states
  const lobbyStatus = document.getElementById('lobby-status-text');
  if (lobbyStatus) {
    const myInfo = players.find(p => p.socketId === socket.id);
    if (myInfo) {
      if (myInfo.ready) {
        if (serverPlayerCount === 1) {
          lobbyStatus.innerText = "Ready! Starting game...";
        } else {
          const otherPlayer = players.find(p => p.socketId !== socket.id);
          if (!otherPlayer) {
            lobbyStatus.innerText = "Ready! Waiting for Player 2 to join...";
          } else if (!otherPlayer.ready) {
            lobbyStatus.innerText = `Ready! Waiting for ${otherPlayer.name} to click start...`;
          } else {
            lobbyStatus.innerText = "All players ready! Starting game...";
          }
        }
      } else {
        if (serverPlayerCount === 1) {
          lobbyStatus.innerText = "You are connected! Click Start Game to begin.";
        } else {
          const otherPlayer = players.find(p => p.socketId !== socket.id);
          if (!otherPlayer) {
            lobbyStatus.innerText = "Waiting for Player 2 to join...";
          } else {
            lobbyStatus.innerText = `${otherPlayer.name} is in lobby. Click Start Game to play.`;
          }
        }
      }
    }
  }
});

// Handle game start notification
socket.on('game-started', () => {
  if (mySlot) {
    showScreen('controller-screen');
    
    // Update player title prominently
    const titleEl = document.getElementById('controller-player-title');
    if (titleEl) {
      const slotColor = mySlot === 1 ? 'var(--primary-neon)' : 'var(--accent-neon)';
      titleEl.style.color = slotColor;
      titleEl.innerText = `Player ${mySlot}: ${myName}`;
    }
    
    swingCount = 0;
    if (diagSwings) diagSwings.innerText = '0';
    if (diagPeak) diagPeak.innerText = '0.00';
  }
});

// Handle game over scorecard notification
socket.on('game-over', (stats) => {
  if (!mySlot) return; // Spectators stay in queue or waiting room

  const { playerCount, winnerSlot, winnerName, p1Name, p1Score, p2Name, p2Score, slicesNeeded } = stats;

  let resultText = "Game Over";
  if (playerCount === 1) {
    if (winnerSlot === 1) {
      resultText = "👑 YOU WON! 👑";
    } else if (winnerSlot === 0) {
      resultText = "💥 BOMB OUT! YOU LOST 💀";
    } else {
      resultText = "Need 20 slices to win";
    }
  } else {
    if (winnerSlot === mySlot) {
      resultText = "🔥 YOU WON! 🔥";
    } else if (winnerSlot === 3) {
      resultText = "🤝 DRAW! 🤝";
    } else {
      resultText = "💀 YOU LOST 💀";
    }
  }

  const resultEl = document.getElementById('game-over-result');
  if (resultEl) resultEl.innerText = resultText;

  const p1NameEl = document.getElementById('p1-score-name');
  if (p1NameEl) p1NameEl.innerText = p1Name || "Player 1";
  
  const p1ValEl = document.getElementById('p1-score-val');
  if (p1ValEl) p1ValEl.innerText = p1Score;

  // Toggle P2 score row visibility based on player count
  const p2Row = document.getElementById('p2-score-row');
  if (p2Row) {
    p2Row.style.display = playerCount === 1 ? 'none' : 'flex';
  }

  const p2NameEl = document.getElementById('p2-score-name');
  if (p2NameEl) p2NameEl.innerText = p2Name || "Player 2";
  
  const p2ValEl = document.getElementById('p2-score-val');
  if (p2ValEl) p2ValEl.innerText = p2Score;

  showScreen('game-over-screen');
});

// Handle restart sync back to lobby
socket.on('play-again-sync', () => {
  if (mySlot) {
    const readyBtn = document.getElementById('btn-ready');
    if (readyBtn) {
      readyBtn.disabled = false;
      readyBtn.innerText = "Start Game";
    }
    const lobbyStatus = document.getElementById('lobby-status-text');
    if (lobbyStatus) {
      lobbyStatus.innerText = `Welcome, ${myName}! You are Player ${mySlot}. Waiting for game start...`;
    }
    showScreen('lobby-screen');
  }
});

// Receive slice vibration feedback from laptop
socket.on('vibrate', (data) => {
  if (navigator.vibrate) {
    navigator.vibrate(data.duration || 80);
  }
});

// Request Motion & Orientation Permissions (iOS 13+ / Android)
async function enableSensors() {
  let motionGranted = false;
  let orientGranted = false;

  // 1. Motion permission
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceMotionEvent.requestPermission();
      motionGranted = (permission === 'granted');
    } catch (e) {
      console.error("Error requesting motion permission:", e);
    }
  } else {
    motionGranted = true;
  }

  // 2. Orientation permission
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      orientGranted = (permission === 'granted');
    } catch (e) {
      console.error("Error requesting orientation permission:", e);
    }
  } else {
    orientGranted = true;
  }

  if (motionGranted && orientGranted) {
    if (permissionScreen) permissionScreen.classList.add('hidden');
    
    if (roomId) {
      showScreen('name-entry-screen');
    } else {
      showScreen('room-entry-screen');
    }
    
    // Bind listeners
    window.addEventListener('devicemotion', handleMotion, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    
    // Start continuous transmission loop (~40 fps / every 25ms)
    setInterval(sendSensorData, 25);
  } else {
    alert("Motion and orientation permissions are required to use your phone as a sword!");
  }
}

// Submit Room Code to Server (Alternative Connection)
function submitRoomCode() {
  const roomInput = document.getElementById('room-code-input');
  if (!roomInput) return;
  const code = roomInput.value.toUpperCase().trim();
  if (!code || code.length !== 4) {
    alert("Please enter a valid 4-letter Room ID!");
    return;
  }
  roomId = code;
  socket.emit('join-room', roomId);
  if (connStatusDot) connStatusDot.classList.add('connected');
  if (connStatusText) {
    connStatusText.innerText = "Connected";
    connStatusText.style.color = "var(--success-neon)";
  }
  if (roomCodeTag) roomCodeTag.innerText = roomId;
  showScreen('name-entry-screen');
}

// Submit Name to Server
function submitName() {
  const nameInput = document.getElementById('ninja-name-input');
  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) {
    alert("Please enter your Ninja Name!");
    return;
  }
  myName = name;
  socket.emit('join-game', { roomId, playerName: name });
}

// Request Play Again (Restart)
function triggerPlayAgain() {
  socket.emit('play-again-request', { roomId });
}

// Handle click start game (ready check) on phone
function clickReady() {
  if (roomId && socket.connected && mySlot) {
    socket.emit('player-ready', { roomId });
    const readyBtn = document.getElementById('btn-ready');
    if (readyBtn) {
      readyBtn.disabled = true;
      readyBtn.innerText = "Ready!";
    }
    if (navigator.vibrate) {
      navigator.vibrate([60, 40]);
    }
  }
}

let smoothAlpha = null;
let smoothBeta = null;
const SMOOTHING_FACTOR = 0.25; // Filters shaky hands and hardware tremors

// Handle Device Orientation Data
function handleOrientation(event) {
  let rawAlpha = event.alpha || 0;
  let rawBeta = event.beta || 0;
  gamma = event.gamma || 0;

  if (smoothAlpha === null) {
    smoothAlpha = rawAlpha;
    smoothBeta = rawBeta;
  } else {
    // Smooth alpha (handle 360 wrap-around boundary)
    let diff = rawAlpha - smoothAlpha;
    if (diff > 180) rawAlpha -= 360;
    if (diff < -180) rawAlpha += 360;
    
    smoothAlpha = smoothAlpha + SMOOTHING_FACTOR * (rawAlpha - smoothAlpha);
    if (smoothAlpha < 0) smoothAlpha += 360;
    if (smoothAlpha > 360) smoothAlpha -= 360;

    // Smooth beta
    smoothBeta = smoothBeta + SMOOTHING_FACTOR * (rawBeta - smoothBeta);
  }

  alpha = smoothAlpha;
  beta = smoothBeta;
}

// Handle Device Motion Data
function handleMotion(event) {
  let acc = event.acceleration;
  let isUsingGravity = false;
  
  if (!acc || acc.x === null || acc.y === null) {
    acc = event.accelerationIncludingGravity;
    isUsingGravity = true;
  }
  
  if (!acc) return;

  let ax = acc.x || 0;
  let ay = acc.y || 0;
  let az = acc.z || 0;

  if (isUsingGravity) {
    gravityX = GRAVITY_ALPHA * gravityX + (1 - GRAVITY_ALPHA) * ax;
    gravityY = GRAVITY_ALPHA * gravityY + (1 - GRAVITY_ALPHA) * ay;
    gravityZ = GRAVITY_ALPHA * gravityZ + (1 - GRAVITY_ALPHA) * az;

    ax = ax - gravityX;
    ay = ay - gravityY;
    az = az - gravityZ;
  }

  accMag = Math.sqrt(ax * ax + ay * ay);

  if (diagAccel) {
    diagAccel.innerText = accMag.toFixed(2);
  }

  // Detect Swing spike
  if (accMag > SWING_THRESHOLD && !swingCooldown) {
    if (!isSwinging) {
      isSwinging = true;
      swingCooldown = true;

      // Local haptic buzz instantly
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }

      swingCount++;
      if (diagSwings) diagSwings.innerText = swingCount;
      if (diagPeak) diagPeak.innerText = accMag.toFixed(2);

      // Keep isSwinging true for the duration window, then trigger cooldown
      setTimeout(() => {
        isSwinging = false;
        
        setTimeout(() => {
          swingCooldown = false;
        }, SWING_COOLDOWN_MS);
      }, SWING_WINDOW_MS);
    }
  }
}

// Send sensor payload continuously to server via Socket.IO
function sendSensorData() {
  if (!roomId || !socket.connected || !mySlot) return;

  socket.emit('sensor-data', {
    roomId,
    orientation: { alpha, beta, gamma },
    motion: { magnitude: accMag },
    isSwing: isSwinging
  });
}

// Trigger manual calibration
function calibrateSword() {
  if (roomId && socket.connected && mySlot) {
    console.log("Triggering sword calibration...");
    socket.emit('trigger-calibration', { roomId });
    if (navigator.vibrate) {
      navigator.vibrate([40, 30, 40]);
    }
  }
}

// Auto-enable sensors on page load for non-iOS devices (Android/PC)
window.addEventListener('DOMContentLoaded', () => {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    console.log("iOS detected: waiting for manual activation click.");
  } else {
    console.log("Android/PC detected: auto-activating sensors.");
    enableSensors();
  }
});
