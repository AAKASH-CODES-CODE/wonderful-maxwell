const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Keep track of game rooms and player connections
// roomCode -> Map(playerId -> { name, res })
const rooms = new Map();

// Helper to send SSE message to a specific client
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. WebRTC Signaling: Server-Sent Events (SSE) registration
  if (pathname === '/events') {
    const id = parsedUrl.searchParams.get('id');
    const name = parsedUrl.searchParams.get('name') || 'Guest';
    const roomCode = (parsedUrl.searchParams.get('room') || 'default').toUpperCase();

    if (!id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing player id');
    }

    // Initialize SSE Headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('\n'); // keep-alive ping

    // Get or create room
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, new Map());
    }
    const roomPlayers = rooms.get(roomCode);

    // Send list of existing players in room to the new client
    const existingPlayers = [];
    roomPlayers.forEach((player, pId) => {
      existingPlayers.push({ id: pId, name: player.name });
    });
    sendSSE(res, 'lobby', { selfId: id, roomCode, players: existingPlayers });

    // Notify other players in the room about this new player
    roomPlayers.forEach((player) => {
      sendSSE(player.res, 'join', { id, name });
    });

    // Add new player to room list
    roomPlayers.set(id, { name, res });
    console.log(`[Lobby] Player ${name} (${id}) joined room ${roomCode}. Total: ${roomPlayers.size}`);

    // Handle connection close
    req.on('close', () => {
      const p = roomPlayers.get(id);
      roomPlayers.delete(id);
      console.log(`[Lobby] Player ${p ? p.name : id} disconnected from room ${roomCode}. Total: ${roomPlayers.size}`);

      // Clean up room if empty
      if (roomPlayers.size === 0) {
        rooms.delete(roomCode);
      } else {
        // Notify others of player leaving
        roomPlayers.forEach((player) => {
          sendSSE(player.res, 'leave', { id });
        });
      }
    });
    return;
  }

  // 2. WebRTC Signaling: Send signal to another peer
  if (pathname === '/signal' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { senderId, targetId, roomCode, signal } = JSON.parse(body);
        const room = rooms.get((roomCode || 'default').toUpperCase());
        
        if (room && room.has(targetId)) {
          const target = room.get(targetId);
          sendSSE(target.res, 'signal', { senderId, signal });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Target peer not found in room' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
      }
    });
    return;
  }

  // 3. Static File Server
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  let contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Create public folder if it doesn't exist
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(` DEATHLY SILENCE: MULTIPLAYER HORROR SERVER RUNNING`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` Network URL: http://[your-ip-address]:${PORT}`);
  console.log(`===================================================`);
});
