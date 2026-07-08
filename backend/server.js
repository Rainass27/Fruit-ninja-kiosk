const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {}; // roomId -> { players: [], queue: [], gameActive: false, playerCount: 1 }

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Neon Ninja Socket.IO backend is running!');
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create or join a room (from Laptop)
  socket.on('create-room', (roomId) => {
    const targetRoomId = roomId || 'default';
    socket.join(targetRoomId);
    
    rooms[targetRoomId] = rooms[targetRoomId] || { players: [], queue: [], gameActive: false, playerCount: 1 };
    console.log(`Game Display created/joined room: ${targetRoomId}`);
    
    // Notify the game display of the final assigned room code
    socket.emit('room-connected', { roomId: targetRoomId });

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
    const targetRoom = roomId || 'default';
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
      // Queue the player in the waiting room
      r.queue.push({ socketId: socket.id, name: playerName });
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
              playerName: nextPlayer.name,
              playerCount: r.playerCount || 1
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
