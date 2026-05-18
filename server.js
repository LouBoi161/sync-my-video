import express from 'express';
import http from 'http';
import https from 'https';
import { Server } from 'socket.io';
import multer from 'multer';
import ip from 'ip';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

let server;
try {
  if (!fs.existsSync('server.key') || !fs.existsSync('server.cert')) {
    console.log('[Server] Erstelle selbstsigniertes SSL-Zertifikat für HTTPS...');
    execSync('openssl req -nodes -new -x509 -keyout server.key -out server.cert -days 365 -subj "/C=DE/CN=localhost"');
  }
  
  const options = {
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.cert')
  };
  server = https.createServer(options, app);
  console.log('[Server] Server läuft im HTTPS-Modus (Kamera-Support aktiv!)');
} catch (e) {
  console.log('[Server] WARNUNG: HTTPS konnte nicht gestartet werden (Kein openssl?). Fallback auf HTTP.');
  server = http.createServer(app);
}

const io = new Server(server);

// Manage videos directory
const videosDir = path.join(__dirname, 'public', 'videos');

function clearVideosDirectory(exceptFiles = []) {
  try {
    if (fs.existsSync(videosDir)) {
      const files = fs.readdirSync(videosDir);
      for (const file of files) {
        if (!exceptFiles.includes(file)) {
          fs.unlinkSync(path.join(videosDir, file));
        }
      }
    } else {
      fs.mkdirSync(videosDir, { recursive: true });
    }
  } catch (err) {
    console.error('[Server] Fehler beim Leeren des Video-Ordners:', err);
  }
}

// Clear on startup to prevent storage bloating
clearVideosDirectory();

// Cleanup on normal process exits
const handleExit = () => {
  clearVideosDirectory();
  process.exit(0);
};
process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, videosDir);
  },
  filename: (req, file, cb) => {
    // Save with timestamp to avoid conflicts in playlist
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
  }
});

const upload = multer({ storage });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to get network IPs
app.get('/api/network', (req, res) => {
  const interfaces = os.networkInterfaces();
  const networks = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Categorize roughly based on common interface names or IP ranges
        let type = 'WLAN';
        if (name.includes('wlan') || name.includes('wifi')) type = 'WLAN / Hotspot';
        else if (name.includes('eth') || name.includes('en')) type = 'LAN (Kabel)';
        else if (name.includes('tun') || name.includes('wg')) type = 'VPN';
        
        // Also guess by IP
        if (iface.address.startsWith('10.')) type = 'Hotspot / 10.x Netz';
        
        networks.push({ name, ip: iface.address, type });
      }
    }
  }
  res.json({ networks, port: process.env.PORT || 3000 });
});

// Endpoint for host to upload the video playlist
app.post('/upload-playlist', upload.array('videos'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send('No video files uploaded.');
  }
  
  // Delete old videos that are not part of this new upload
  const newFiles = req.files.map(f => f.filename);
  clearVideosDirectory(newFiles);


  // Sort based on the order they were sent from the client
  // Express multer array preserves order, but we can also pass an order array if needed
  // For now, we trust the FormData append order.
  const playlist = req.files.map(file => ({
    url: `/stream/${file.filename}`,
    filename: file.originalname
  }));
  
  console.log(`[Server] Playlist uploaded with ${playlist.length} videos`);
  
  currentVideoState.playlist = playlist;
  currentVideoState.currentIndex = 0;
  currentVideoState.isPlaying = false;
  currentVideoState.currentTime = 0;
  currentVideoState.playbackMode = req.body.playbackMode || 'ram';
  currentVideoState.lastUpdateTime = Date.now();
  
  // Notify all clients that a new playlist is available
  io.emit('playlist-ready', { 
    playlist: currentVideoState.playlist, 
    currentIndex: 0,
    playbackMode: currentVideoState.playbackMode
  });
  
  res.json({ success: true, playlist: currentVideoState.playlist });
});

// Endpoint to append videos to the existing playlist
app.post('/append-playlist', upload.array('videos'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send('No video files uploaded.');
  }

  const appendedPlaylist = req.files.map(file => ({
    url: `/stream/${file.filename}`,
    filename: file.originalname
  }));

  currentVideoState.playlist.push(...appendedPlaylist);
  console.log(`[Server] Playlist appended with ${appendedPlaylist.length} videos. Total: ${currentVideoState.playlist.length}`);

  // Notify clients
  io.emit('playlist-updated', {
    playlist: currentVideoState.playlist,
    currentIndex: currentVideoState.currentIndex,
    playbackMode: currentVideoState.playbackMode
  });

  res.json({ success: true, playlist: currentVideoState.playlist });
});

// Dedicated endpoint for streaming large files with Range support
app.get('/stream/:filename', (req, res) => {
  const filePath = path.join(videosDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    let start, end;
    
    if (parts[0] === "") {
      // Suffix range (e.g., bytes=-500)
      start = Math.max(fileSize - parseInt(parts[1], 10), 0);
      end = fileSize - 1;
    } else {
      start = parseInt(parts[0], 10);
      // Remove artificial chunk limit to prevent constant HTTP reconnections and stuttering
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    }
    
    if (start >= fileSize) {
      res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };

    res.writeHead(206, head);
    file.pipe(res);

    req.on('close', () => {
      if (!file.destroyed) file.destroy();
    });
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Store connected clients
let clients = new Set();
let clientStates = {};

// Sync Scanner Interval
setInterval(() => {
  if (currentVideoState.playlist.length === 0) return;

  const activeClients = Object.values(clientStates).filter(c => Date.now() - c.lastUpdate < 5000);
  if (activeClients.length <= 1) return;

  let forciblyResumed = false;
  activeClients.forEach(c => {
    if (c.isBuffering && Date.now() - c.bufferingSince > 3000) {
      c.isBuffering = false;
      forciblyResumed = true;
    }
  });

  const isBuffering = activeClients.some(c => c.isBuffering);
  
  if (forciblyResumed && !isBuffering) {
    io.emit('force-resume-sync', { autoPlay: currentVideoState.isPlaying });
  }

  if (isBuffering) return; // Don't process drift while someone is buffering

  if (!currentVideoState.isPlaying) return; // Don't process drift if manually paused

  let minTime = Infinity;
  let maxTime = -1;
  
  activeClients.forEach(c => {
    if (c.currentTime < minTime) minTime = c.currentTime;
    if (c.currentTime > maxTime) maxTime = c.currentTime;
  });

  if (minTime === Infinity) return;

  const drift = maxTime - minTime;

  if (drift > 30) {
    console.log(`[Sync Scanner] Macro-sync. Drift: ${drift}s`);
    io.emit('force-seek-sync', minTime);
  } else if (drift > 3) {
    for (const [socketId, state] of Object.entries(clientStates)) {
      if (Date.now() - state.lastUpdate < 5000) {
        if (state.currentTime > minTime + 3) {
          io.to(socketId).emit('force-pause-sync', { reason: 'drift' });
        } else {
          io.to(socketId).emit('force-resume-sync');
        }
      }
    }
  } else {
    io.emit('force-resume-sync', { autoPlay: currentVideoState.isPlaying });
  }
}, 2000);
let currentVideoState = {
  playlist: [],
  currentIndex: 0,
  isPlaying: false,
  currentTime: 0,
  lastUpdateTime: Date.now(),
  playbackMode: 'ram'
};

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  clients.add(socket.id);
  
  // Assign host role to the first connected client (or if no host exists)
  // For simplicity, we just trust the client that says "I am the host" via the UI,
  // but let's notify them of the state
  if (currentVideoState.playlist.length > 0) {
    socket.emit('playlist-ready', { 
      playlist: currentVideoState.playlist, 
      currentIndex: currentVideoState.currentIndex,
      playbackMode: currentVideoState.playbackMode
    });
  }

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
    clients.delete(socket.id);
    delete clientStates[socket.id];
    
    // Notify others for WebRTC cleanup
    socket.broadcast.emit('user-left', socket.id);
  });

  socket.on('join-room', (username) => {
    clientStates[socket.id] = { 
      currentTime: 0, 
      isBuffering: false, 
      isPlaying: false, 
      lastUpdate: Date.now(), 
      username: username || 'Unbekannt' 
    };

    // Send existing peers to the new user
    const existingPeers = Object.entries(clientStates)
      .filter(([id]) => id !== socket.id)
      .map(([id, state]) => ({ id, username: state.username }));
    
    socket.emit('existing-peers', existingPeers);

    // Notify others
    socket.broadcast.emit('user-joined', { id: socket.id, username: clientStates[socket.id].username });

    // Force a full sync for everyone when someone joins to ensure perfect alignment
    let estimatedTime = currentVideoState.currentTime;
    if (currentVideoState.isPlaying) {
      estimatedTime += (Date.now() - currentVideoState.lastUpdateTime) / 1000;
    }
    io.emit('sync-state', {
      currentTime: estimatedTime,
      isPlaying: currentVideoState.isPlaying,
      force: true
    });
  });

  // Chat
  socket.on('chat-message', (text) => {
    if (!clientStates[socket.id]) return;
    io.emit('chat-message', {
      sender: clientStates[socket.id].username,
      text: text,
      time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    });
  });

  // WebRTC Signaling
  socket.on('webrtc-offer', (data) => {
    io.to(data.target).emit('webrtc-offer', {
      sender: socket.id,
      offer: data.offer,
      username: clientStates[socket.id]?.username
    });
  });

  socket.on('webrtc-answer', (data) => {
    io.to(data.target).emit('webrtc-answer', {
      sender: socket.id,
      answer: data.answer
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    io.to(data.target).emit('webrtc-ice-candidate', {
      sender: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('sync-heartbeat', (state) => {
    if (!clientStates[socket.id]) {
      clientStates[socket.id] = { currentTime: 0, isBuffering: false, isPlaying: false, lastUpdate: Date.now(), username: 'Unbekannt' };
    }
    clientStates[socket.id].currentTime = state.currentTime;
    clientStates[socket.id].isPlaying = state.isPlaying;
    clientStates[socket.id].lastUpdate = Date.now();
  });

  socket.on('buffer-state-change', (isBuffering) => {
    if (!clientStates[socket.id]) {
      clientStates[socket.id] = { currentTime: 0, isBuffering: false, isPlaying: false, lastUpdate: Date.now(), username: 'Unbekannt' };
    }
    clientStates[socket.id].isBuffering = isBuffering;
    if (isBuffering) {
      clientStates[socket.id].bufferingSince = Date.now();
    }
    clientStates[socket.id].lastUpdate = Date.now();

    // Instant evaluation to avoid 2-second interval delays
    const activeClients = Object.values(clientStates).filter(c => Date.now() - c.lastUpdate < 5000);
    const anyBuffering = activeClients.some(c => c.isBuffering);

    if (anyBuffering) {
      io.emit('force-pause-sync', { reason: 'buffering' });
    } else {
      io.emit('force-resume-sync', { autoPlay: currentVideoState.isPlaying });
    }
  });

  // Sync events from clients
  socket.on('play', (time) => {
    currentVideoState.isPlaying = true;
    currentVideoState.currentTime = time;
    currentVideoState.lastUpdateTime = Date.now();
    socket.broadcast.emit('play', time);
  });

  socket.on('pause', (time) => {
    currentVideoState.isPlaying = false;
    currentVideoState.currentTime = time;
    currentVideoState.lastUpdateTime = Date.now();
    socket.broadcast.emit('pause', time);
  });

  socket.on('seek', (time) => {
    currentVideoState.currentTime = time;
    currentVideoState.lastUpdateTime = Date.now();
    socket.broadcast.emit('seek', time);
  });

  socket.on('change-video', (index) => {
    if (index >= 0 && index < currentVideoState.playlist.length) {
      currentVideoState.currentIndex = index;
      currentVideoState.currentTime = 0;
      currentVideoState.isPlaying = false;
      currentVideoState.lastUpdateTime = Date.now();
      io.emit('change-video', index);
    }
  });

  socket.on('request-sync', () => {
    let estimatedTime = currentVideoState.currentTime;
    if (currentVideoState.isPlaying) {
      estimatedTime += (Date.now() - currentVideoState.lastUpdateTime) / 1000;
    }
    socket.emit('sync-state', {
      currentTime: estimatedTime,
      isPlaying: currentVideoState.isPlaying
    });
  });

  socket.on('update-playlist', (data) => {
    if (data.newPlaylist && data.newCurrentIndex !== undefined) {
      currentVideoState.playlist = data.newPlaylist;
      currentVideoState.currentIndex = data.newCurrentIndex;
      io.emit('playlist-updated', {
        playlist: currentVideoState.playlist,
        currentIndex: currentVideoState.currentIndex,
        playbackMode: currentVideoState.playbackMode
      });
    }
  });

  socket.on('end-session', () => {
    currentVideoState.playlist = [];
    currentVideoState.currentIndex = 0;
    currentVideoState.isPlaying = false;
    currentVideoState.currentTime = 0;
    clearVideosDirectory([]);
    io.emit('session-ended');
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('🎥 Sync My Video - Server läuft!');
  console.log('='.repeat(50));
  console.log(`Öffne diesen Link auf deinem Host-PC:`);
  console.log(`👉 https://localhost:${PORT}`);
  console.log('');
  console.log(`Teile einen dieser Links mit anderen Geräten (z.B. im WLAN oder Hotspot):`);
  console.log(`⚠️ WICHTIG: Euer Browser wird eine Warnung ("Nicht sicher") anzeigen.`);
  console.log(`   Klickt auf "Erweitert" -> "Risiko akzeptieren und weiter", um die App zu öffnen!`);
  console.log('');
  
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`👉 https://${iface.address}:${PORT} (${name})`);
      }
    }
  }
  console.log('='.repeat(50));
});
