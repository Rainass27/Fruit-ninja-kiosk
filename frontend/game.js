// Game states: 'MENU', 'PLAYING', 'GAMEOVER'
let gameState = 'MENU';
let gameMode = 'zen'; // 'classic' or 'zen'
let debugMode = false; // Set to true for debug overlays & balanced settings

// Room and connection info
let roomId = '';
let isControllerConnected = false;
let socket;

// Canvas & sizing
let canvas;

// Sword Slash & Tracking System
// Sword Slash & Tracking System
let swordX1 = 0, swordY1 = 0, targetX1 = 0, targetY1 = 0;
let prevSwordX1 = 0, prevSwordY1 = 0;
let prevTargetX1 = 0, prevTargetY1 = 0;
let baseAlpha1 = 0, baseBeta1 = 0;
let calibrated1 = false;
let swordTrail1 = [];
let isSwinging1 = false;

let swordX2 = 0, swordY2 = 0, targetX2 = 0, targetY2 = 0;
let prevSwordX2 = 0, prevSwordY2 = 0;
let prevTargetX2 = 0, prevTargetY2 = 0;
let baseAlpha2 = 0, baseBeta2 = 0;
let calibrated2 = false;
let swordTrail2 = [];
let isSwinging2 = false;

const MAX_TRAIL_LENGTH = 25;
let sensitivityX = 22;
let sensitivityY = 18;

// Lobby & Multi-Player State
let playerCount = 1; // 1 or 2
let playersJoined = []; // list of connected players: { socketId, name, slot }
let p1Name = "Player 1";
let p2Name = "Player 2";
let p1Out = false;
let p2Out = false;

// Gameplay Variables
let score1 = 0;
let score2 = 0;
let lives = 3;
let zenTimer = 60; // seconds
let timerInterval = null;
let fruits = []; // P1 fruits (and P1/P2 shared in single player)
let fruitsP2 = []; // P2 fruits
let slicedFruits = [];
let particles = [];
let screenSplatJuices = [];
let slashMarks = []; // Stores persistent cut lines on screen

let spawnTimer = 0;
let spawnRate = 120; // Spawn every X frames
let baseSpeed = 1.0;

// Combo Tracking
let comboCount1 = 0, comboTimer1 = 0, bestCombo1 = 0;
let comboCount2 = 0, comboTimer2 = 0, bestCombo2 = 0;
const COMBO_WINDOW_MS = 450;

// Screen effects
let screenShake = 0;
let flashOpacity = 0;
let flashColor = [255, 255, 255];

// Web Audio API Synthesizer
let audioCtx = null;

class AudioSynth {
  init() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  playWhoosh() {
    this.init();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.18);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.18);

    gainNode.gain.setValueAtTime(0.01, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.18);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  }

  playSplat() {
    this.init();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    // 1. Synthesize wet high pitch sweep
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);

    // 2. Synthesize noise burst for "squish"
    const bufferSize = audioCtx.sampleRate * 0.08;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1000, audioCtx.currentTime);
    noiseFilter.Q.setValueAtTime(3, audioCtx.currentTime);

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);

    noiseNode.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);

    noiseNode.start();
    noiseNode.stop(audioCtx.currentTime + 0.08);
  }

  playExplosion() {
    this.init();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    // 1. Low rumble sweep
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(10, audioCtx.currentTime + 0.8);

    gainNode.gain.setValueAtTime(0.8, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);

    // 2. Exploding noise cloud
    const bufferSize = audioCtx.sampleRate * 1.2;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(300, audioCtx.currentTime);
    noiseFilter.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 1.2);

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);

    noiseNode.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);

    noiseNode.start();
    noiseNode.stop(audioCtx.currentTime + 1.2);
  }

  playChime() {
    this.init();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.08);

      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + idx * 0.08 + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.08 + 0.4);

      osc.start(audioCtx.currentTime + idx * 0.08);
      osc.stop(audioCtx.currentTime + idx * 0.08 + 0.45);
    });
  }
}

const synth = new AudioSynth();

// Fruit Configuration Types (Sizes increased by 25-30% for easier slicing)
const FRUIT_TYPES = [
  { name: 'watermelon', color: '#ff2a5f', innerColor: '#ff6b8b', size: 110, weight: 1.0 },
  { name: 'orange', color: '#ff9f0a', innerColor: '#ffd60a', size: 88, weight: 0.9 },
  { name: 'lime', color: '#39ff14', innerColor: '#8cff66', size: 72, weight: 0.8 },
  { name: 'banana', color: '#ffd60a', innerColor: '#fffae0', size: 66, weight: 0.7 },
  { name: 'plum', color: '#af52de', innerColor: '#d6a4eb', size: 78, weight: 0.8 },
  { name: 'coconut', color: '#8e8e93', innerColor: '#ffffff', size: 98, weight: 1.2 },
  { name: 'bomb', color: '#323232', innerColor: '#ff3b30', size: 90, weight: 1.1 }
];

// p5.js Setup
function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('canvas-container');
  
  // Initialize Room / Connection
  initSocketConnection();

  // Request Screen Wake Lock to prevent screen sleep during gameplay
  requestWakeLock();

  // Draw background details
  background(8, 8, 12);
}

// Laptop Screen Wake Lock implementation
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock activated on Laptop game screen.');
      
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

// p5.js Draw Loop
function draw() {
  // Motion blur trails for the background (strictly black backdrop)
  background(0, 60);



  // Screen shake translation
  if (screenShake > 0) {
    let dx = random(-screenShake, screenShake);
    let dy = random(-screenShake, screenShake);
    translate(dx, dy);
    screenShake *= 0.9;
  }

  // Draw and update persistent slash cut marks
  updateAndDrawSlashMarks();

  // Update Game Elements
  if (gameState === 'PLAYING') {
    handleSpawning();
    updateAndDrawFruits();
    updateAndDrawParticles();
    updateAndDrawSplatJuice();
    checkCollisions(); // Real-time collision detection on trail segments
  } else {
    // Menu or GameOver states
    updateAndDrawParticles();
    updateAndDrawSplatJuice();
  }

  // Draw glowing active sword slash trails
  drawSword();

  // Apply full-screen flash effects (explosions or mistakes)
  if (flashOpacity > 0) {
    noStroke();
    fill(flashColor[0], flashColor[1], flashColor[2], flashOpacity);
    rect(0, 0, width, height);
    flashOpacity -= 5;
  }
}

// Re-adjust canvas size dynamically
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// Draw futuristic grid background (disabled for clean dark look)
function drawGrid() {
}

// Draw giant low-opacity name watermarks on the background of each side
function drawBackgroundWatermarks() {
  if (gameState !== 'PLAYING') return;

  push();
  textAlign(CENTER, CENTER);
  textFont('Outfit');
  textStyle(BOLD);
  noStroke();

  if (playerCount === 1) {
    // Single player: draw a subtle name watermark in center
    fill(0, 242, 254, 15); // cyan, 6% opacity
    textSize(width * 0.07);
    text(p1Name, width / 2, height / 2);
  } else if (playerCount === 2) {
    // Player 1 (Left Half)
    fill(0, 242, 254, 18); // cyan, 7% opacity
    textSize(width * 0.055);
    text(p1Name, width / 4, height / 2);

    // Player 2 (Right Half)
    fill(255, 0, 127, 18); // pink, 7% opacity
    textSize(width * 0.055);
    text(p2Name, width * 3 / 4, height / 2);
  }
  pop();
}

// Set Game Mode selected in UI
function setGameMode(mode) {
  gameMode = mode;
}

// Parse Room ID from URL
const urlParams = new URLSearchParams(window.location.search);
const urlRoom = urlParams.get('room');

// Initialize Socket.IO Client
function initSocketConnection() {
  const BACKEND_URL = "https://fruit-ninja-kiosk-production.up.railway.app";
  socket = io(BACKEND_URL, { transports: ['websocket'] });

  // Use URL room parameter or empty string for auto-coupling
  roomId = urlRoom ? urlRoom.toUpperCase() : '';

  socket.on('connect', () => {
    console.log("Game Display connected to local Socket.IO server. Requested room:", roomId);
    socket.emit('create-room', roomId);
  });

  socket.on('room-connected', (data) => {
    roomId = data.roomId;
    console.log("Game display successfully paired with Room ID:", roomId);
  });

  // Receive room players and queue updates from server
  socket.on('lobby-update', (data) => {
    playersJoined = data.players;
    
    // Sync player count from server
    if (data.playerCount) {
      playerCount = data.playerCount;
    }

    // Keep active HUD names synchronized during play
    if (gameState === 'PLAYING') {
      const p1 = playersJoined.find(p => p.slot === 1);
      if (p1) {
        p1Name = p1.name;
        const label1 = document.getElementById('hud-p1-label');
        if (label1) label1.innerText = p1Name;
      }
      const p2 = playersJoined.find(p => p.slot === 2);
      if (p2) {
        p2Name = p2.name;
        const label2 = document.getElementById('hud-p2-label');
        if (label2) label2.innerText = p2Name;
      }
    }
  });

  socket.on('game-started', () => {
    if (gameState === 'MENU' || gameState === 'GAMEOVER') {
      startGame();
    }
  });

  socket.on('player-disconnected', (data) => {
    console.log(`Player disconnected during game: Slot ${data.slot} (${data.name})`);
    endGameDueToDisconnect(data.name);
  });

  // Receive real-time phone motion sensor events (P1 or P2)
  socket.on('sensor-update', (data) => {
    const { orientation, isSwing, slot } = data;
    if (!orientation) return;

    if (slot === 1) {
      if (!calibrated1) {
        baseAlpha1 = orientation.alpha;
        baseBeta1 = orientation.beta;
        calibrated1 = true;
        console.log(`Calibrated P1 sword baseline orientation alpha: ${baseAlpha1.toFixed(1)}, beta: ${baseBeta1.toFixed(1)}`);
      }
      
      let diffAlpha = orientation.alpha - baseAlpha1;
      if (diffAlpha > 180) diffAlpha -= 360;
      if (diffAlpha < -180) diffAlpha += 360;
      
      let diffBeta = orientation.beta - baseBeta1;
      
      prevTargetX1 = targetX1;
      prevTargetY1 = targetY1;
      
      // Subtract diffAlpha to invert horizontal mirroring so moving phone right moves sword right
      let maxX = playerCount === 2 ? width / 2 : width;
      targetX1 = (playerCount === 2 ? width / 4 : width / 2) - diffAlpha * sensitivityX;
      targetY1 = height / 2 - diffBeta * sensitivityY;
      
      targetX1 = constrain(targetX1, 0, maxX);
      targetY1 = constrain(targetY1, 0, height);
      
      isSwinging1 = isSwing;
    } else if (slot === 2 && playerCount === 2) {
      if (!calibrated2) {
        baseAlpha2 = orientation.alpha;
        baseBeta2 = orientation.beta;
        calibrated2 = true;
        console.log(`Calibrated P2 sword baseline orientation alpha: ${baseAlpha2.toFixed(1)}, beta: ${baseBeta2.toFixed(1)}`);
      }
      
      let diffAlpha = orientation.alpha - baseAlpha2;
      if (diffAlpha > 180) diffAlpha -= 360;
      if (diffAlpha < -180) diffAlpha += 360;
      
      let diffBeta = orientation.beta - baseBeta2;
      
      prevTargetX2 = targetX2;
      prevTargetY2 = targetY2;
      
      // Subtract diffAlpha to invert horizontal mirroring so moving phone right moves sword right
      targetX2 = (width * 3 / 4) - diffAlpha * sensitivityX;
      targetY2 = height / 2 - diffBeta * sensitivityY;
      
      targetX2 = constrain(targetX2, width / 2, width);
      targetY2 = constrain(targetY2, 0, height);
      
      isSwinging2 = isSwing;
    }
  });

  // Re-calibrate baseline coordinates on demand
  socket.on('calibrate-request', (data) => {
    console.log(`Calibration request received for slot ${data.slot}`);
    if (data.slot === 1) calibrated1 = false;
    if (data.slot === 2) calibrated2 = false;
  });

  socket.on('play-again-sync', () => {
    showMenu();
  });
}

// Start Game Mode Function
function startGame() {
  const waitingMsg = document.getElementById('game-waiting-message');
  if (waitingMsg) waitingMsg.style.display = 'none';

  synth.init();

  gameState = 'PLAYING';
  score1 = 0;
  score2 = 0;
  p1Out = false;
  p2Out = false;
  lives = 3;
  
  fruits = [];
  fruitsP2 = [];
  slicedFruits = [];
  particles = [];
  screenSplatJuices = [];
  slashMarks = [];
  baseSpeed = 1.0;
  spawnRate = 120;
  
  // Set Player Names
  const p1 = playersJoined.find(p => p.slot === 1);
  p1Name = p1 ? p1.name : "Player 1";
  
  const p2 = playersJoined.find(p => p.slot === 2);
  p2Name = p2 ? p2.name : "Player 2";

  document.getElementById('hud-p1-label').innerText = p1Name;
  document.getElementById('score-p1-val').innerText = '000';
  document.getElementById('combo-p1-val').classList.remove('active');

  const hudP2 = document.getElementById('hud-p2');
  const hudP2Label = document.getElementById('hud-p2-label');
  const scoreP2Val = document.getElementById('score-p2-val');
  const comboP2Val = document.getElementById('combo-p2-val');

  if (playerCount === 2) {
    if (hudP2) hudP2.style.display = 'block';
    if (hudP2Label) hudP2Label.innerText = p2Name;
    if (scoreP2Val) scoreP2Val.innerText = '000';
    if (comboP2Val) comboP2Val.classList.remove('active');
  } else {
    if (hudP2) hudP2.style.display = 'none';
  }

  document.getElementById('gameover-overlay').classList.remove('visible');
  document.getElementById('hud').classList.add('visible');

  // Set up 60-second timer
  const timerValEl = document.getElementById('timer-val');
  if (timerValEl) {
    timerValEl.style.display = 'block';
    timerValEl.innerText = '60s';
  }
  zenTimer = 60;
  
  // Clear existing timer if any
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    if (gameState === 'PLAYING') {
      zenTimer--;
      if (timerValEl) timerValEl.innerText = `${zenTimer}s`;
      if (zenTimer <= 0) {
        endGame();
      }
    }
  }, 1000);
}

// Handle unexpected player disconnection during play
function endGameDueToDisconnect(disconnectedName) {
  gameState = 'MENU';
  const waitingMsg = document.getElementById('game-waiting-message');
  if (waitingMsg) waitingMsg.style.display = 'block';
  document.getElementById('hud').classList.remove('visible');
  document.getElementById('gameover-overlay').classList.remove('visible');
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  alert(`Game stopped: Ninja '${disconnectedName}' disconnected.`);
}

// Pause Game if Controller Disconnects
function pauseGame() {
  gameState = 'MENU';
  const waitingMsg = document.getElementById('game-waiting-message');
  if (waitingMsg) waitingMsg.style.display = 'block';
  document.getElementById('hud').classList.remove('visible');
  if (timerInterval) clearInterval(timerInterval);
}

// Return to the main landing page and close the current session
function showMenu() {
  if (typeof socket !== 'undefined' && socket.connected) {
    socket.emit('reset-room-session', { roomId });
  }
  // Wait a brief moment for socket emission before redirecting
  setTimeout(() => {
    window.location.href = `/?room=${roomId}`;
  }, 100);
}

// Spawn Logic
function handleSpawning() {
  spawnTimer++;
  if (spawnTimer >= spawnRate) {
    spawnTimer = 0;
    
    // Reduce spawn interval slowly to increase difficulty
    spawnRate = max(55, spawnRate - 2);
    // Increase baseline launch velocities slightly over time
    baseSpeed += 0.015;

    // Decide how many fruits to spawn together (1 to 3, depending on score)
    let maxToSpawn = 1;
    let currentScore = playerCount === 2 ? max(score1, score2) : score1;
    if (currentScore > 15) maxToSpawn = 2;
    if (currentScore > 40) maxToSpawn = 3;
    let spawnCount = floor(random(1, maxToSpawn + 1));

    for (let i = 0; i < spawnCount; i++) {
      if (playerCount === 1) {
        spawnFruitInList(fruits, 1);
      } else {
        // Spawn independently for both P1 (left) and P2 (right)
        spawnFruitInList(fruits, 1);
        spawnFruitInList(fruitsP2, 2);
      }
    }
  }
}

// Spawn single fruit or bomb in target list
function spawnFruitInList(list, slot) {
  // Bombs are enabled in both 1-Player and 2-Player modes
  let isBombChoice = random() < 0.15; // 15% chance to spawn a bomb

  let config;
  if (isBombChoice) {
    config = FRUIT_TYPES.find(f => f.name === 'bomb');
  } else {
    // Pick random non-bomb fruit
    const nonBombs = FRUIT_TYPES.filter(f => f.name !== 'bomb');
    config = random(nonBombs);
  }

  // Setup starting positions based on player slot
  let minX, maxX;
  if (playerCount === 1) {
    minX = width * 0.15;
    maxX = width * 0.85;
  } else if (slot === 1) {
    minX = width * 0.05;
    maxX = width * 0.45;
  } else {
    minX = width * 0.55;
    maxX = width * 0.95;
  }

  let x = random(minX, maxX);
  let y = height + 30;

  // Launch dynamics
  let targetHeight = random(height * 0.15, height * 0.45);
  let distY = y - targetHeight;
  let gravity = 0.11; // Slower gravity for floatiness
  let vy = -Math.sqrt(2 * gravity * distY) * baseSpeed * 0.85;

  // Arc vx towards center of slot viewport
  let centerX = (minX + maxX) / 2;
  let dx = centerX - x;
  let vx = (dx / (abs(vy) / gravity)) + random(-1.0, 1.0);

  list.push({
    x,
    y,
    vx,
    vy,
    gravity,
    size: config.size * 1.25, // 25% larger
    color: config.color,
    innerColor: config.innerColor,
    type: config.name,
    weight: config.weight,
    sliced: false,
    rot: random(TWO_PI),
    rotSpeed: random(-0.06, 0.06),
    sparkTimer: 0 // Used for bomb sparks
  });
}

// Update Fruits Physics & Draw
function updateAndDrawFruits() {
  // Normal Fruits
  for (let i = fruits.length - 1; i >= 0; i--) {
    let f = fruits[i];
    f.vy += f.gravity * f.weight;
    f.x += f.vx;
    f.y += f.vy;
    f.rot += f.rotSpeed;

    // Draw
    push();
    translate(f.x, f.y);
    rotate(f.rot);

    if (f.type === 'bomb') {
      drawBombGraphics(f);
    } else {
      drawFruitGraphics(f);
    }
    pop();

    // Check boundary drops (fell past bottom)
    if (f.y > height + 80 && f.vy > 0) {
      if (f.type !== 'bomb' && gameMode === 'classic') {
        // Drop counts as strike
        loseLife();
      }
      fruits.splice(i, 1);
    }
  }

  // Sliced Halves Physics
  for (let i = slicedFruits.length - 1; i >= 0; i--) {
    let sf = slicedFruits[i];
    
    // Half 1
    sf.h1.vy += sf.gravity * sf.weight;
    sf.h1.x += sf.h1.vx;
    sf.h1.y += sf.h1.vy;
    sf.h1.rot += sf.h1.rotSpeed;

    // Half 2
    sf.h2.vy += sf.gravity * sf.weight;
    sf.h2.x += sf.h2.vx;
    sf.h2.y += sf.h2.vy;
    sf.h2.rot += sf.h2.rotSpeed;

    // Draw Halves
    drawHalfFruit(sf.h1, sf.type, sf.color, sf.innerColor, sf.size, true);
    drawHalfFruit(sf.h2, sf.type, sf.color, sf.innerColor, sf.size, false);

    // Clean up when both halves fall off-screen
    if (sf.h1.y > height + 100 && sf.h2.y > height + 100) {
      slicedFruits.splice(i, 1);
    }
  }
}

// Sliced Fruit Half Drawing
function drawHalfFruit(h, type, color, innerColor, size, isLeft) {
  push();
  translate(h.x, h.y);
  rotate(h.rot);

  // Outer Skin Glow
  drawingContext.shadowBlur = 18;
  drawingContext.shadowColor = color;
  stroke(color);
  strokeWeight(3);
  fill(innerColor);

  // Draw semi-circle
  let startAng = isLeft ? HALF_PI : -HALF_PI;
  let endAng = isLeft ? -HALF_PI : HALF_PI;
  
  arc(0, 0, size, size, startAng, endAng, CHORD);

  // Draw pulp design inside half
  if (type === 'watermelon') {
    fill('#000');
    noStroke();
    let seedDir = isLeft ? -1 : 1;
    // Draw 3 tiny seeds
    ellipse(seedDir * size * 0.2, -size * 0.15, 3, 5);
    ellipse(seedDir * size * 0.28, 0, 3, 5);
    ellipse(seedDir * size * 0.2, size * 0.15, 3, 5);
  } else if (type === 'orange' || type === 'lime') {
    stroke(color);
    strokeWeight(1.5);
    let step = PI / 4;
    let seedDir = isLeft ? -1 : 1;
    for (let angle = -HALF_PI + 0.3; angle < HALF_PI - 0.2; angle += step) {
      let drawAngle = isLeft ? angle + PI : angle;
      let x2 = cos(drawAngle) * (size * 0.45);
      let y2 = sin(drawAngle) * (size * 0.45);
      line(0, 0, x2, y2);
    }
  }

  pop();
}

// Render neon fruit
function drawFruitGraphics(f) {
  // Ambient glow
  drawingContext.shadowBlur = 24;
  drawingContext.shadowColor = f.color;
  
  stroke(f.color);
  strokeWeight(3);
  fill(f.innerColor);

  if (f.type === 'banana') {
    // Custom banana curve
    beginShape();
    vertex(-f.size * 0.4, -f.size * 0.1);
    quadraticVertex(0, -f.size * 0.4, f.size * 0.4, -f.size * 0.1);
    quadraticVertex(f.size * 0.5, 0, f.size * 0.4, f.size * 0.1);
    quadraticVertex(0, -f.size * 0.1, -f.size * 0.4, f.size * 0.1);
    quadraticVertex(-f.size * 0.5, 0, -f.size * 0.4, -f.size * 0.1);
    endShape(CLOSE);
  } else {
    // Standard circular fruits (Apple, Orange, Lime, Plum, Coconut)
    ellipse(0, 0, f.size, f.size);

    // Decorative cores
    if (f.type === 'watermelon') {
      stroke(f.color);
      strokeWeight(2);
      ellipse(0, 0, f.size * 0.85, f.size * 0.85);
      // Small seeds
      noStroke();
      fill('#000');
      ellipse(-f.size * 0.2, -f.size * 0.1, 4, 6);
      ellipse(0, f.size * 0.2, 4, 6);
      ellipse(f.size * 0.2, -f.size * 0.1, 4, 6);
    } else if (f.type === 'orange' || f.type === 'lime') {
      stroke(f.color);
      strokeWeight(1);
      ellipse(0, 0, f.size * 0.9, f.size * 0.9);
      strokeWeight(1.5);
      // Slices segments
      for (let a = 0; a < TWO_PI; a += PI / 4) {
        line(0, 0, cos(a) * (f.size * 0.42), sin(a) * (f.size * 0.42));
      }
    } else if (f.type === 'coconut') {
      stroke('#5c3a21');
      strokeWeight(2);
      ellipse(0, 0, f.size * 0.9, f.size * 0.9);
    }
  }
  
  // reset shadow blur to save performance
  drawingContext.shadowBlur = 0;
}

// Render neon bomb
function drawBombGraphics(f) {
  // Pulse glow
  f.sparkTimer += 0.2;
  let pulse = 20 + sin(f.sparkTimer * 2) * 8;
  
  drawingContext.shadowBlur = pulse;
  drawingContext.shadowColor = f.innerColor; // Red glow

  // Core shell
  stroke(f.color);
  strokeWeight(4);
  fill(16, 16, 20);
  ellipse(0, 0, f.size, f.size);

  // Skull symbol or danger cross
  stroke(f.innerColor);
  strokeWeight(3);
  line(-f.size * 0.2, -f.size * 0.2, f.size * 0.2, f.size * 0.2);
  line(f.size * 0.2, -f.size * 0.2, -f.size * 0.2, f.size * 0.2);

  // Fuse cord
  noFill();
  stroke('#b58a55');
  strokeWeight(3.5);
  bezier(0, -f.size * 0.45, 10, -f.size * 0.65, -15, -f.size * 0.75, -5, -f.size * 0.9);

  // Glowing fuse spark
  drawingContext.shadowBlur = 25;
  drawingContext.shadowColor = '#ffd60a';
  noStroke();
  fill(255, 230, 0);
  let sparkSize = 12 + sin(f.sparkTimer * 4) * 4;
  ellipse(-5, -f.size * 0.9, sparkSize, sparkSize);

  // Reset shadow
  drawingContext.shadowBlur = 0;
}

// Lose a Life (Strikes)
function loseLife() {
  if (gameMode !== 'classic') return;

  lives--;
  
  // Flash screen red briefly
  flashColor = [220, 20, 60];
  flashOpacity = 90;
  screenShake = 15;

  // Update strikes overlay
  if (lives === 2) document.getElementById('life-3').classList.remove('active');
  if (lives === 1) document.getElementById('life-2').classList.remove('active');
  if (lives === 0) {
    document.getElementById('life-1').classList.remove('active');
    endGame();
  }
}

// Particle System updates
function updateAndDrawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.vy += p.gravity;
    p.x += p.vx;
    p.y += p.vy;
    p.opacity -= p.fadeSpeed;
    p.size *= 0.96;

    // Draw glow particle
    drawingContext.shadowBlur = p.size * 2;
    drawingContext.shadowColor = p.color;
    noStroke();
    let c = color(p.color);
    c.setAlpha(p.opacity * 255);
    fill(c);
    ellipse(p.x, p.y, p.size, p.size);

    if (p.opacity <= 0 || p.size < 1) {
      particles.splice(i, 1);
    }
  }
  drawingContext.shadowBlur = 0;
}

// Helper to convert float opacity 0-1 to hex string
function hexOpacity(op) {
  let val = Math.floor(constrain(op, 0, 1) * 255);
  let hex = val.toString(16);
  return hex.length === 1 ? '0' + hex : hex;
}

// Splat Juice Dripping Down Screen
function updateAndDrawSplatJuice() {
  for (let i = screenSplatJuices.length - 1; i >= 0; i--) {
    let s = screenSplatJuices[i];
    s.y += s.dripSpeed; // Drip down
    s.opacity -= s.fadeSpeed;

    // Draw
    noStroke();
    let c = color(s.color);
    c.setAlpha(s.opacity * 255);
    fill(c);
    
    // Main splat blob
    ellipse(s.x, s.y, s.size, s.size * 0.95);
    
    // Drip tail
    ellipse(s.x, s.y - s.size * 0.3, s.size * 0.7, s.size * 0.7);

    if (s.opacity <= 0) {
      screenSplatJuices.splice(i, 1);
    }
  }
}

// Update & draw glowing persistent slash cut marks
function updateAndDrawSlashMarks() {
  for (let i = slashMarks.length - 1; i >= 0; i--) {
    let m = slashMarks[i];
    m.opacity -= 8; // fade out over 30 frames
    m.weight *= 0.95; // thin out

    if (m.opacity <= 0 || m.weight < 0.5) {
      slashMarks.splice(i, 1);
      continue;
    }

    push();
    drawingContext.shadowBlur = 18;
    drawingContext.shadowColor = m.color;
    
    // Glowing neon outer glow
    let c = color(m.color);
    c.setAlpha(m.opacity);
    stroke(c);
    strokeWeight(m.weight);
    line(m.x1, m.y1, m.x2, m.y2);
    
    // Core white hot center
    stroke(255, 255, 255, m.opacity);
    strokeWeight(m.weight * 0.4);
    line(m.x1, m.y1, m.x2, m.y2);
    
    pop();
  }
  drawingContext.shadowBlur = 0;
}

// Spawn visual particles
function createJuiceSplatter(x, y, color) {
  // Splash particles
  let count = floor(random(12, 22));
  for (let i = 0; i < count; i++) {
    let angle = random(TWO_PI);
    let speed = random(3, 9);
    particles.push({
      x,
      y,
      vx: cos(angle) * speed,
      vy: sin(angle) * speed - random(1, 4), // Initial push upward
      gravity: 0.28,
      size: random(6, 16),
      color: color,
      opacity: 1.0,
      fadeSpeed: random(0.015, 0.035)
    });
  }

  // Wall splat drips (25% chance per slice)
  if (random() < 0.25) {
    screenSplatJuices.push({
      x: x + random(-20, 20),
      y: y + random(-20, 20),
      size: random(18, 40),
      color: color,
      opacity: 0.85,
      dripSpeed: random(0.08, 0.22),
      fadeSpeed: random(0.001, 0.003)
    });
  }
}

// Render and update glowing active sword slash trails
function drawSword() {
  // --- PLAYER 1 ---
  let prevSwordX = swordX1;
  let prevSwordY = swordY1;
  
  
  swordX1 = lerp(swordX1, targetX1, 0.22);
  swordY1 = lerp(swordY1, targetY1, 0.22);

  let d1 = dist(swordX1, swordY1, prevSwordX, prevSwordY);
  if (d1 > 1.5) {
    let activeSwing = isSwinging1 || (d1 > 8.0);
    swordTrail1.push({ x: swordX1, y: swordY1, isSwing: activeSwing });
    if (swordTrail1.length > MAX_TRAIL_LENGTH) swordTrail1.shift();
  } else {
    if (swordTrail1.length > 0) swordTrail1.shift();
  }
  
  drawTrailList(swordTrail1, isSwinging1 || (d1 > 8.0), '#ff007f', '#00f2fe');

  // --- PLAYER 2 (if active) ---
  if (playerCount === 2) {
    let prevSwordX2_val = swordX2;
    let prevSwordY2_val = swordY2;
    
    swordX2 = lerp(swordX2, targetX2, 0.22);
    swordY2 = lerp(swordY2, targetY2, 0.22);

    let d2 = dist(swordX2, swordY2, prevSwordX2_val, prevSwordY2_val);
    if (d2 > 1.5) {
      let activeSwing = isSwinging2 || (d2 > 8.0);
      swordTrail2.push({ x: swordX2, y: swordY2, isSwing: activeSwing });
      if (swordTrail2.length > MAX_TRAIL_LENGTH) swordTrail2.shift();
    } else {
      if (swordTrail2.length > 0) swordTrail2.shift();
    }
    
    // Player 2 uses Orange (#ff9f0a) / Neon Green (#39ff14)
    drawTrailList(swordTrail2, isSwinging2 || (d2 > 8.0), '#ff9f0a', '#39ff14');
  }
}

// Draw a ribbon trail list with custom styling
function drawTrailList(trail, activeSwing, swingColor, moveColor) {
  if (trail.length > 1) {
    let glowColor = activeSwing ? swingColor : moveColor;

    // 1. Draw Outer Glow Layer
    push();
    drawingContext.shadowBlur = activeSwing ? 35 : 20;
    drawingContext.shadowColor = glowColor;
    for (let i = 1; i < trail.length; i++) {
      let pt1 = trail[i - 1];
      let pt2 = trail[i];
      let progress = i / trail.length;
      let alphaVal = progress * 255;
      
      let r, g, b;
      if (activeSwing) {
        r = swingColor === '#ff007f' ? 255 : 255;
        g = swingColor === '#ff007f' ? 0 : 159;
        b = swingColor === '#ff007f' ? 127 : 10;
      } else {
        r = moveColor === '#00f2fe' ? 0 : 57;
        g = moveColor === '#00f2fe' ? 242 : 255;
        b = moveColor === '#00f2fe' ? 254 : 20;
      }
      
      stroke(r, g, b, alphaVal * 0.45);
      strokeWeight(pt2.isSwing ? (20 + progress * 30) : (6 + progress * 10));
      line(pt1.x, pt1.y, pt2.x, pt2.y);
    }
    pop();

    // 2. Draw Inner Glow Layer
    push();
    drawingContext.shadowBlur = activeSwing ? 18 : 10;
    drawingContext.shadowColor = glowColor;
    for (let i = 1; i < trail.length; i++) {
      let pt1 = trail[i - 1];
      let pt2 = trail[i];
      let progress = i / trail.length;
      let alphaVal = progress * 255;

      let r, g, b;
      if (activeSwing) {
        r = swingColor === '#ff007f' ? 255 : 255;
        g = swingColor === '#ff007f' ? 0 : 159;
        b = swingColor === '#ff007f' ? 127 : 10;
      } else {
        r = moveColor === '#00f2fe' ? 0 : 57;
        g = moveColor === '#00f2fe' ? 242 : 255;
        b = moveColor === '#00f2fe' ? 254 : 20;
      }

      stroke(r, g, b, alphaVal * 0.85);
      strokeWeight(pt2.isSwing ? (10 + progress * 15) : (3 + progress * 5));
      line(pt1.x, pt1.y, pt2.x, pt2.y);
    }
    pop();

    // 3. Draw White Center Core
    push();
    for (let i = 1; i < trail.length; i++) {
      let pt1 = trail[i - 1];
      let pt2 = trail[i];
      let progress = i / trail.length;
      let alphaVal = progress * 255;

      stroke(255, 255, 255, alphaVal);
      strokeWeight(pt2.isSwing ? (4 + progress * 6) : (1.5 + progress * 2));
      line(pt1.x, pt1.y, pt2.x, pt2.y);
    }
    pop();
  }
}

// Check collisions using the active sword trail segments
function checkCollisions() {
  // --- PLAYER 1 ---
  if (swordTrail1.length >= 2) {
    let lastPt = swordTrail1[swordTrail1.length - 1];
    let prevPt = swordTrail1[swordTrail1.length - 2];
    let cursorSpeed = dist(lastPt.x, lastPt.y, prevPt.x, prevPt.y);
    let activeSwing = isSwinging1 || (cursorSpeed > 8.0);
    
    if (activeSwing) {
      checkCollisionsForPlayer(fruits, swordTrail1, 1);
    }
  }

  // --- PLAYER 2 ---
  if (playerCount === 2 && swordTrail2.length >= 2) {
    let lastPt = swordTrail2[swordTrail2.length - 1];
    let prevPt = swordTrail2[swordTrail2.length - 2];
    let cursorSpeed = dist(lastPt.x, lastPt.y, prevPt.x, prevPt.y);
    let activeSwing = isSwinging2 || (cursorSpeed > 8.0);
    
    if (activeSwing) {
      checkCollisionsForPlayer(fruitsP2, swordTrail2, 2);
    }
  }
}

// Collisions helper per player
function checkCollisionsForPlayer(list, trail, slot) {
  for (let i = list.length - 1; i >= 0; i--) {
    let f = list[i];
    
    for (let j = trail.length - 1; j >= 1; j--) {
      let pt1 = trail[j - 1];
      let pt2 = trail[j];
      
      if (pt2.isSwing) {
        if (checkSegmentCircleIntersection(pt1.x, pt1.y, pt2.x, pt2.y, f.x, f.y, f.size / 2)) {
          sliceFruitForPlayer(f, i, pt1.x, pt1.y, pt2.x, pt2.y, list, slot);
          break;
        }
      }
    }
  }
}

// Math helper: Perpendicular distance from circle to segment
function checkSegmentCircleIntersection(x1, y1, x2, y2, cx, cy, r) {
  let vx = x2 - x1;
  let vy = y2 - y1;
  let wx = cx - x1;
  let wy = cy - y1;

  let segmentLenSq = vx * vx + vy * vy;
  if (segmentLenSq === 0) {
    return dist(x1, y1, cx, cy) < r;
  }

  let t = (wx * vx + wy * vy) / segmentLenSq;
  t = constrain(t, 0, 1);

  let closestX = x1 + t * vx;
  let closestY = y1 + t * vy;

  let dSq = (cx - closestX) * (cx - closestX) + (cy - closestY) * (cy - closestY);

  return dSq < (r * r);
}

// Slice Action for specific player
function sliceFruitForPlayer(f, index, sx1, sy1, sx2, sy2, list, slot) {
  f.sliced = true;
  console.log(`HIT in slot ${slot} at x: ${f.x.toFixed(1)}, y: ${f.y.toFixed(1)}`);

  // Remove from list
  list.splice(index, 1);

  // Send back feedback to let phone vibrate (slice tactile click)
  if (roomId) {
    socket.emit('slice-event', { roomId, slot, duration: f.type === 'bomb' ? 400 : 75 });
  }

  // Calculate cut vector for splitting halves
  let dx = sx2 - sx1;
  let dy = sy2 - sy1;
  let len = Math.sqrt(dx * dx + dy * dy);

  // Spawn visual slash cut mark
  if (len > 3) {
    let ndx = dx / len;
    let ndy = dy / len;
    slashMarks.push({
      x1: f.x - ndx * (f.size * 0.75),
      y1: f.y - ndy * (f.size * 0.75),
      x2: f.x + ndx * (f.size * 0.75),
      y2: f.y + ndy * (f.size * 0.75),
      color: f.color,
      opacity: 255,
      weight: 7
    });
  } else {
    slashMarks.push({
      x1: f.x - 30,
      y1: f.y - 30,
      x2: f.x + 30,
      y2: f.y + 30,
      color: f.color,
      opacity: 255,
      weight: 7
    });
  }

  // --- BOMB HIT ---
  if (f.type === 'bomb') {
    synth.playExplosion();
    triggerBombBlast(f.x, f.y);
    
    if (slot === 1) {
      score1 = max(0, score1 - 2);
      document.getElementById('score-p1-val').innerText = score1.toString().padStart(3, '0');
      
      const comboEl = document.getElementById('combo-p1-val');
      if (comboEl) {
        comboEl.innerText = `BOMB HIT! -2 PTS`;
        comboEl.style.color = '#ff3b30';
        comboEl.classList.add('active');
        setTimeout(() => {
          comboEl.classList.remove('active');
          comboEl.style.color = 'var(--accent-neon)';
        }, 1500);
      }
    } else {
      score2 = max(0, score2 - 2);
      document.getElementById('score-p2-val').innerText = score2.toString().padStart(3, '0');
      
      const comboEl = document.getElementById('combo-p2-val');
      if (comboEl) {
        comboEl.innerText = `BOMB HIT! -2 PTS`;
        comboEl.style.color = '#ff3b30';
        comboEl.classList.add('active');
        setTimeout(() => {
          comboEl.classList.remove('active');
          comboEl.style.color = 'var(--primary-neon)';
        }, 1500);
      }
    }
    return;
  }

  // --- NORMAL FRUIT SLICE ---
  synth.playSplat();
  
  if (slot === 1) {
    score1++;
    document.getElementById('score-p1-val').innerText = score1.toString().padStart(3, '0');
    registerComboSliceForPlayer(1);
  } else {
    score2++;
    document.getElementById('score-p2-val').innerText = score2.toString().padStart(3, '0');
    registerComboSliceForPlayer(2);
  }

  // Create neon juice splatters
  createJuiceSplatter(f.x, f.y, f.color);

  // Calculate cutting slice angle to send halves flying perpendicular
  let sliceAngle = atan2(dy, dx);
  let perpAngle = sliceAngle + HALF_PI;

  let splitSpeed = random(3.5, 6);
  let vx1 = f.vx + cos(perpAngle) * splitSpeed;
  let vy1 = random(2.0, 4.5); // Force downward velocity immediately
  let vx2 = f.vx - cos(perpAngle) * splitSpeed;
  let vy2 = random(2.0, 4.5); // Force downward velocity immediately

  // Split into 2 halves
  slicedFruits.push({
    type: f.type,
    color: f.color,
    innerColor: f.innerColor,
    size: f.size,
    gravity: f.gravity,
    weight: f.weight,
    h1: { x: f.x, y: f.y, vx: vx1, vy: vy1, rot: f.rot, rotSpeed: -abs(f.rotSpeed) * 2 - 0.05 },
    h2: { x: f.x, y: f.y, vx: vx2, vy: vy2, rot: f.rot, rotSpeed: abs(f.rotSpeed) * 2 + 0.05 }
  });
}

// Combo calculations per player
function registerComboSliceForPlayer(slot) {
  const now = millis();
  if (slot === 1) {
    if (comboCount1 === 0 || now - comboTimer1 < COMBO_WINDOW_MS) {
      comboCount1++;
      comboTimer1 = now;
    } else {
      comboCount1 = 1;
      comboTimer1 = now;
    }

    if (comboCount1 >= 3) {
      score1 += comboCount1;
      document.getElementById('score-p1-val').innerText = score1.toString().padStart(3, '0');
      synth.playChime();
      
      const comboEl = document.getElementById('combo-p1-val');
      comboEl.innerText = `${comboCount1}-FRUIT COMBO! +${comboCount1} PTS`;
      comboEl.classList.add('active');
      
      if (comboCount1 > bestCombo1) bestCombo1 = comboCount1;
      setTimeout(() => comboEl.classList.remove('active'), 1500);
      comboCount1 = 0;
    }
  } else {
    if (comboCount2 === 0 || now - comboTimer2 < COMBO_WINDOW_MS) {
      comboCount2++;
      comboTimer2 = now;
    } else {
      comboCount2 = 1;
      comboTimer2 = now;
    }

    if (comboCount2 >= 3) {
      score2 += comboCount2;
      document.getElementById('score-p2-val').innerText = score2.toString().padStart(3, '0');
      synth.playChime();
      
      const comboEl = document.getElementById('combo-p2-val');
      comboEl.innerText = `${comboCount2}-FRUIT COMBO! +${comboCount2} PTS`;
      comboEl.classList.add('active');
      
      if (comboCount2 > bestCombo2) bestCombo2 = comboCount2;
      setTimeout(() => comboEl.classList.remove('active'), 1500);
      comboCount2 = 0;
    }
  }
}

// End Game and Scoreboard Sync
function endGame() {
  gameState = 'GAMEOVER';
  
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  let winnerSlot = null;
  let winnerName = "";
  
  if (playerCount === 1) {
    const announceEl = document.getElementById('gameover-announcement');
    announceEl.style.display = 'block';
    
    if (p1Out) {
      announceEl.innerText = "💥 BOMB OUT! Game Over.";
      winnerSlot = 0;
    } else if (score1 >= 20) {
      announceEl.innerText = "👑 YOU WON! 👑";
      winnerSlot = 1;
    } else {
      let needed = 20 - score1;
      announceEl.innerText = `Could do better! ${needed} more slices needed to win`;
      winnerSlot = -1;
    }

    document.getElementById('gameover-single-score').style.display = 'flex';
    document.getElementById('gameover-double-score').style.display = 'none';
    
    document.getElementById('gameover-score').innerText = score1;
    document.getElementById('gameover-combo').innerText = `${bestCombo1}x`;
    document.getElementById('gameover-mode-info').innerText = '1-Minute Game';
    
    // Update score card label to include player's name
    const singleScoreLabel = document.querySelector('#gameover-single-score .gameover-score-label');
    if (singleScoreLabel) {
      singleScoreLabel.innerText = `${p1Name}'s Score`;
    }
  } else {
    // 2-Player Mode Scoreboard
    document.getElementById('gameover-single-score').style.display = 'none';
    document.getElementById('gameover-double-score').style.display = 'flex';
    
    let p1Status = "PLAYED";
    let p2Status = "PLAYED";
    
    if (p1Out && !p2Out) {
      winnerSlot = 2;
      winnerName = p2Name;
      p1Status = "💥 BOMB OUT";
      p2Status = "👑 WINNER";
    } else if (p2Out && !p1Out) {
      winnerSlot = 1;
      winnerName = p1Name;
      p1Status = "👑 WINNER";
      p2Status = "💥 BOMB OUT";
    } else if (score1 > score2) {
      winnerSlot = 1;
      winnerName = p1Name;
      p1Status = "👑 WINNER";
    } else if (score2 > score1) {
      winnerSlot = 2;
      winnerName = p2Name;
      p2Status = "👑 WINNER";
    } else {
      winnerSlot = 3; // Draw
      winnerName = "Draw";
      p1Status = "🤝 DRAW";
      p2Status = "🤝 DRAW";
    }
    
    const announceEl = document.getElementById('gameover-announcement');
    announceEl.style.display = 'block';
    if (winnerSlot === 3) {
      announceEl.innerText = "Match ended in a DRAW!";
    } else {
      announceEl.innerText = `${winnerName} WINS!`;
    }

    document.getElementById('gameover-mode-info').innerText = '1-Minute Duel';

    // Populate scoreboard
    document.getElementById('p1-go-name').innerText = p1Name;
    document.getElementById('p1-go-score').innerText = score1;
    document.getElementById('p1-go-status').innerText = p1Status;
    
    const p1GoStatusEl = document.getElementById('p1-go-status');
    if (p1GoStatusEl) {
      p1GoStatusEl.style.color = p1Status.includes("WINNER") ? "var(--success-neon)" : (p1Status.includes("BOMB") ? "var(--accent-neon)" : "var(--text-muted)");
    }

    document.getElementById('p2-go-name').innerText = p2Name;
    document.getElementById('p2-go-score').innerText = score2;
    document.getElementById('p2-go-status').innerText = p2Status;

    const p2GoStatusEl = document.getElementById('p2-go-status');
    if (p2GoStatusEl) {
      p2GoStatusEl.style.color = p2Status.includes("WINNER") ? "var(--success-neon)" : (p2Status.includes("BOMB") ? "var(--accent-neon)" : "var(--text-muted)");
    }
  }

  document.getElementById('gameover-overlay').classList.add('visible');
  document.getElementById('hud').classList.remove('visible');

  // Notify server of game stats to relay to controllers
  const stats = {
    playerCount,
    winnerSlot,
    winnerName,
    p1Name,
    p1Score: score1,
    p2Name,
    p2Score: score2
  };
  socket.emit('game-over-broadcast', { roomId, stats });
}

// Request Play Again (Restart) from Laptop
function triggerPlayAgain() {
  socket.emit('play-again-request', { roomId });
}

// Bomb Explosion Effect
function triggerBombBlast(bx, by) {
  flashColor = [255, 255, 255];
  flashOpacity = 255;
  screenShake = 45;

  let count = 40;
  for (let i = 0; i < count; i++) {
    let angle = random(TWO_PI);
    let speed = random(5, 18);
    particles.push({
      x: bx,
      y: by,
      vx: cos(angle) * speed,
      vy: sin(angle) * speed,
      gravity: 0.1,
      size: random(8, 30),
      color: '#ff3b30',
      opacity: 1.0,
      fadeSpeed: random(0.015, 0.03)
    });
  }

  fruits = [];
  fruitsP2 = []; // Clear both fruit list arrays on bomb hit
}

// Update and Draw Sliced Fruit Halves and active fruits
function updateAndDrawFruits() {
  // Update Player 1 Fruits
  updateAndDrawFruitsList(fruits, 1);

  // Update Player 2 Fruits (if 2-Player mode)
  if (playerCount === 2) {
    updateAndDrawFruitsList(fruitsP2, 2);
    
    // Draw split divider line in canvas
    push();
    stroke(255, 255, 255, 30);
    strokeWeight(2);
    line(width / 2, 0, width / 2, height);
    pop();
  }

  // Sliced Halves Physics (shared globally across screen)
  for (let i = slicedFruits.length - 1; i >= 0; i--) {
    let sf = slicedFruits[i];
    
    // Half 1
    sf.h1.vy += sf.gravity * sf.weight;
    sf.h1.x += sf.h1.vx;
    sf.h1.y += sf.h1.vy;
    sf.h1.rot += sf.h1.rotSpeed;

    // Half 2
    sf.h2.vy += sf.gravity * sf.weight;
    sf.h2.x += sf.h2.vx;
    sf.h2.y += sf.h2.vy;
    sf.h2.rot += sf.h2.rotSpeed;

    // Draw Halves
    drawHalfFruit(sf.h1, sf.type, sf.color, sf.innerColor, sf.size, true);
    drawHalfFruit(sf.h2, sf.type, sf.color, sf.innerColor, sf.size, false);

    // Clean up when both halves fall off-screen
    if (sf.h1.y > height + 100 && sf.h2.y > height + 100) {
      slicedFruits.splice(i, 1);
    }
  }
}

// Update Fruits Physics & Draw for specific list
function updateAndDrawFruitsList(list, slot) {
  for (let i = list.length - 1; i >= 0; i--) {
    let f = list[i];
    f.vy += f.gravity * f.weight;
    f.x += f.vx;
    f.y += f.vy;
    f.rot += f.rotSpeed;

    // Draw
    push();
    translate(f.x, f.y);
    rotate(f.rot);

    if (f.type === 'bomb') {
      drawBombGraphics(f);
    } else {
      drawFruitGraphics(f);
    }
    pop();

    // Check boundary drops (fell past bottom)
    if (f.y > height + 80 && f.vy > 0) {
      if (f.type !== 'bomb' && gameMode === 'classic' && playerCount === 1) {
        loseLife();
      }
      list.splice(i, 1);
    }
  }
}
