const express = require('express');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const fs = require('fs');
const selfsigned = require('selfsigned');

const app = express();

let server;
let io;

// Global server port reference
global.serverPort = 3000;

let tunnelURL = null;
let tunnelProcess = null;
global.tunnelProcess = null;

// Set tunnelURL directly to secure local HTTPS IP so the QR code never changes
function startTunnel(port) {
  const startupIP = getLocalIPAddress();
  tunnelURL = `https://${startupIP}:${port}`;
  // Notify any connected laptop display
  io.emit('tunnel-status', { connectionURL: tunnelURL });
}

// Disable caching for all responses to force immediate updates in Electron
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback to controller.html for controller route
app.get('/controller', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

// Serves the standalone game canvas page
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// Serves the desktop app executable for download
app.get('/download', (req, res) => {
  const filePath = path.join(__dirname, 'dist', 'Neon Ninja 1.0.0.exe');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'Neon Ninja Setup.exe');
  } else {
    res.status(404).send('Desktop application build not found. Please run "npm run build:desktop" on the host machine to generate it.');
  }
});

// Helper function to find the local IP address on the network, prioritizing physical adapters and filtering virtual ones
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  let fallbackIP = 'localhost';
  
  // Sort interfaces so physical-sounding ones are processed first
  const interfaceNames = Object.keys(interfaces).sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    
    // Prioritize Wi-Fi/WLAN and Ethernet
    const aPri = (aLower.includes('wi-fi') || aLower.includes('wlan') || aLower.includes('ethernet') || aLower.includes('local area')) ? 1 : 0;
    const bPri = (bLower.includes('wi-fi') || bLower.includes('wlan') || bLower.includes('ethernet') || bLower.includes('local area')) ? 1 : 0;
    
    return bPri - aPri;
  });

  for (const interfaceName of interfaceNames) {
    const nameLower = interfaceName.toLowerCase();
    
    // Ignore known virtual/internal networks
    if (nameLower.includes('virtual') || 
        nameLower.includes('vbox') || 
        nameLower.includes('vmware') || 
        nameLower.includes('wsl') || 
        nameLower.includes('vethernet') || 
        nameLower.includes('host-only') ||
        nameLower.includes('loopback')) {
      continue;
    }
    
    const networkInterface = interfaces[interfaceName];
    for (const ipInfo of networkInterface) {
      if (ipInfo.family === 'IPv4' && !ipInfo.internal) {
        return ipInfo.address; // Return the first matching physical IP
      }
    }
  }
  
  // If no physical interface matches, try any non-internal IPv4
  for (const interfaceName in interfaces) {
    const networkInterface = interfaces[interfaceName];
    for (const ipInfo of networkInterface) {
      if (ipInfo.family === 'IPv4' && !ipInfo.internal) {
        return ipInfo.address;
      }
    }
  }
  
  return fallbackIP;
}

let activeRoomId = null;
const rooms = {}; // roomId -> { players: [], queue: [], gameActive: false }

function registerSocketEvents() {
  io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create or join a room (from Laptop)
  socket.on('create-room', (roomId) => {
    let targetRoomId = roomId;
    if (!targetRoomId && activeRoomId) {
      targetRoomId = activeRoomId;
    }
    if (!targetRoomId) {
      targetRoomId = 'default';
    }
    socket.join(targetRoomId);
    activeRoomId = targetRoomId;
    rooms[targetRoomId] = rooms[targetRoomId] || { players: [], queue: [], gameActive: false, playerCount: 1 };
    const currentIP = getLocalIPAddress();
    const connectionURL = tunnelURL ? tunnelURL : `http://${currentIP}:${global.serverPort}`;
    console.log(`Game Display created/joined room: ${targetRoomId}. Active room set to: ${activeRoomId}`);
    
    // Notify the game display of the final assigned room code
    socket.emit('room-connected', { roomId: targetRoomId });

    // Send IP and server connection info to the laptop display
    socket.emit('server-info', { localIP: currentIP, port: global.serverPort, connectionURL });

    // Sync any existing players in case of page reload
    socket.emit('lobby-update', { 
      players: rooms[targetRoomId].players, 
      queueLength: rooms[targetRoomId].queue.length,
      playerCount: rooms[targetRoomId].playerCount || 1
    });

    // If game is already active, tell this display socket immediately to start
    if (rooms[targetRoomId].gameActive) {
      socket.emit('game-started');
    }
  });

  socket.on('join-room', (roomId) => {
    let targetRoom = roomId;
    if (activeRoomId && activeRoomId !== roomId) {
      console.log(`Controller requested room ${roomId}, but active game room is ${activeRoomId}. Auto-routing to active room.`);
      targetRoom = activeRoomId;
    }
    socket.join(targetRoom);
    console.log(`Controller connected to room: ${targetRoom}`);
    // Inform the controller of the actual room it joined
    socket.emit('room-joined', { roomId: targetRoom });
  });

  // Handle Player Name Submission and Lobby Enrollment
  socket.on('join-game', (data) => {
    const { roomId, playerName } = data;
    if (!roomId) return;

    rooms[roomId] = rooms[roomId] || { players: [], queue: [], gameActive: false, playerCount: 1 };
    const r = rooms[roomId];

    // Prevent duplicate entries
    const existingPlayer = r.players.find(p => p.socketId === socket.id);
    const existingQueued = r.queue.find(q => q.socketId === socket.id);
    if (existingPlayer || existingQueued) return;

    if (r.players.length < (r.playerCount || 1)) {
      // Find vacant slot (1 or 2)
      let slot = 1;
      if (r.players.length === 1) {
        slot = r.players[0].slot === 1 ? 2 : 1;
      }
      const newPlayer = { socketId: socket.id, name: playerName, slot, ready: false };
      r.players.push(newPlayer);
      
      console.log(`Player '${playerName}' joined room ${roomId} as slot ${slot}`);
      socket.emit('join-result', { status: 'joined', slot, playerName, playerCount: r.playerCount || 1 });
      
      // If game is active, transition controller to active screen immediately
      if (r.gameActive) {
        socket.emit('game-started');
      }
      
      // Update laptop lobby view
      io.to(roomId).emit('lobby-update', { 
        players: r.players, 
        queueLength: r.queue.length,
        playerCount: r.playerCount || 1
      });
    } else {
      // Lobby full, send to waiting queue
      const queuedPlayer = { socketId: socket.id, name: playerName };
      r.queue.push(queuedPlayer);
      
      const pos = r.queue.length;
      console.log(`Player '${playerName}' queued in room ${roomId} at position ${pos}`);
      socket.emit('join-result', { status: 'waiting', position: pos, playerName });
      
      // Update laptop lobby view
      io.to(roomId).emit('lobby-update', { 
        players: r.players, 
        queueLength: r.queue.length,
        playerCount: r.playerCount || 1
      });
    }
  });

  // Handle lobby headcount adjustments from game display
  socket.on('set-lobby-mode', (data) => {
    const { roomId, playerCount } = data;
    if (roomId && rooms[roomId]) {
      rooms[roomId].playerCount = playerCount;
      console.log(`Room ${roomId} headcount set to: ${playerCount}`);
      // Broadcast update to notify controllers of slot expectation changes
      io.to(roomId).emit('lobby-update', { 
        players: rooms[roomId].players, 
        queueLength: rooms[roomId].queue.length,
        playerCount: rooms[roomId].playerCount
      });
    }
  });

  // Handle mobile controller "Start Game" readiness clicks
  socket.on('player-ready', (data) => {
    const { roomId } = data;
    if (!roomId || !rooms[roomId]) return;

    const r = rooms[roomId];
    const player = r.players.find(p => p.socketId === socket.id);
    if (!player) return;

    player.ready = true;
    console.log(`Player '${player.name}' (slot ${player.slot}) is READY in room ${roomId}`);

    // Broadcast updated ready states to everyone in the room
    io.to(roomId).emit('lobby-update', { 
      players: r.players, 
      queueLength: r.queue.length,
      playerCount: r.playerCount || 1
    });

    // Check if ready conditions are met to start the game
    const pc = r.playerCount || 1;
    if (pc === 1) {
      if (r.players.length >= 1 && r.players.some(p => p.ready)) {
        r.gameActive = true;
        console.log(`1-Player start condition met. Starting game in room ${roomId}...`);
        io.to(roomId).emit('game-started');
      }
    } else if (pc === 2) {
      if (r.players.length >= 2 && r.players[0].ready && r.players[1].ready) {
        r.gameActive = true;
        console.log(`2-Player start condition met. Starting game in room ${roomId}...`);
        io.to(roomId).emit('game-started');
      }
    }
  });

  // Relay real-time sensor data from controller to game screen (tagged with player slot)
  socket.on('sensor-data', (data) => {
    const { roomId } = data;
    if (roomId && rooms[roomId]) {
      const player = rooms[roomId].players.find(p => p.socketId === socket.id);
      if (player) {
        socket.to(roomId).emit('sensor-update', { ...data, slot: player.slot });
      }
    }
  });

  // Relay slice feedback from game screen to targeted controller (for haptics/vibration)
  socket.on('slice-event', (data) => {
    const { roomId, slot, duration } = data;
    if (roomId && rooms[roomId]) {
      const player = rooms[roomId].players.find(p => p.slot === slot);
      if (player) {
        io.to(player.socketId).emit('vibrate', { duration: duration || 80 });
      }
    }
  });

  // Relay calibration trigger from controller to game screen (tagged with player slot)
  socket.on('trigger-calibration', (data) => {
    const { roomId } = data;
    if (roomId && rooms[roomId]) {
      const player = rooms[roomId].players.find(p => p.socketId === socket.id);
      if (player) {
        socket.to(roomId).emit('calibrate-request', { slot: player.slot });
      }
    }
  });

  // Sync game start state from laptop to all controllers in the room
  socket.on('game-start-broadcast', (data) => {
    const { roomId } = data;
    if (roomId && rooms[roomId]) {
      rooms[roomId].gameActive = true;
      io.to(roomId).emit('game-started');
    }
  });

  // Sync game over scores from laptop to all controllers in the room
  socket.on('game-over-broadcast', (data) => {
    const { roomId, stats } = data;
    if (roomId && rooms[roomId]) {
      rooms[roomId].gameActive = false;
      io.to(roomId).emit('game-over', stats);
    }
  });

  // Relay play-again request from laptops or active controllers
  socket.on('play-again-request', (data) => {
    const { roomId } = data;
    if (roomId && rooms[roomId]) {
      const r = rooms[roomId];
      r.players.forEach(p => p.ready = false);
      r.gameActive = false;
      io.to(roomId).emit('play-again-sync');
      io.to(roomId).emit('lobby-update', { 
        players: r.players, 
        queueLength: r.queue.length,
        playerCount: r.playerCount || 1
      });
    }
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id && rooms[roomId]) {
        const r = rooms[roomId];
        
        // Check if disconnecting socket is an active player
        const playerIndex = r.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex !== -1) {
          const player = r.players[playerIndex];
          console.log(`Active player '${player.name}' disconnected from room ${roomId}`);
          r.players.splice(playerIndex, 1);

          // Force stop game if active
          if (r.gameActive) {
            r.gameActive = false;
            io.to(roomId).emit('player-disconnected', { slot: player.slot, name: player.name });
          }

          // Promote first queued player to active slot
          if (r.queue.length > 0) {
            const nextPlayer = r.queue.shift();
            nextPlayer.slot = player.slot;
            r.players.push({ socketId: nextPlayer.socketId, name: nextPlayer.name, slot: nextPlayer.slot });
            
            console.log(`Promoted '${nextPlayer.name}' to active slot ${nextPlayer.slot} in room ${roomId}`);
            io.to(nextPlayer.socketId).emit('join-result', { 
              status: 'promoted', 
              slot: nextPlayer.slot, 
              playerName: nextPlayer.name 
            });

            // Recalculate waiting positions for remaining queued players
            r.queue.forEach((qp, idx) => {
              io.to(qp.socketId).emit('join-result', { 
                status: 'waiting', 
                position: idx + 1, 
                playerName: qp.name 
              });
            });
          }

          // Broadcast updated lobby info to laptop
          io.to(roomId).emit('lobby-update', { 
            players: r.players, 
            queueLength: r.queue.length,
            playerCount: r.playerCount || 1
          });
        } else {
          // Check if socket was in queue
          const queueIndex = r.queue.findIndex(q => q.socketId === socket.id);
          if (queueIndex !== -1) {
            const qPlayer = r.queue[queueIndex];
            console.log(`Queued player '${qPlayer.name}' disconnected from room ${roomId}`);
            r.queue.splice(queueIndex, 1);

            // Recalculate queue positions
            r.queue.forEach((qp, idx) => {
              io.to(qp.socketId).emit('join-result', { 
                status: 'waiting', 
                position: idx + 1, 
                playerName: qp.name 
              });
            });

            // Broadcast updated lobby info to laptop
            io.to(roomId).emit('lobby-update', { 
              players: r.players, 
              queueLength: r.queue.length,
              playerCount: r.playerCount || 1
            });
          }
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});
}

function startServer(portToTry) {
  server.listen(portToTry, '0.0.0.0', () => {
    global.serverPort = portToTry;
    
    // Start Cloudflare Tunnel once port is bound successfully
    startTunnel(portToTry);

    const startupIP = getLocalIPAddress();
    console.log(`\n======================================================`);
    console.log(`Fruit Ninja local HTTPS server is running!`);
    console.log(`Laptop Game Display URL: https://localhost:${portToTry}`);
    console.log(`WiFi address (phone controller): https://${startupIP}:${portToTry}/controller`);
    console.log(`======================================================\n`);

    if (global.onServerListening) {
      global.onServerListening(portToTry);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${portToTry} is busy, trying port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error(`Server error:`, err);
    }
  });
}

const START_PORT = 3000;

(async () => {
  try {
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = await selfsigned.generate(attrs, { days: 365 });

    server = https.createServer({
      key: pems.private,
      cert: pems.cert
    }, app);

    io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    registerSocketEvents();

    startServer(START_PORT);
  } catch (err) {
    console.error("Failed to generate SSL certificates and start server:", err);
  }
})();
