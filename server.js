const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  
  const filePath = path.join(__dirname, url);
  const ext = path.extname(filePath).toLowerCase();
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // إذا كان الملف غير موجود، أرسل index.html (لـ SPA)
      fs.readFile(path.join(__dirname, 'index.html'), (e2, d2) => {
        if (e2) {
          res.writeHead(404);
          res.end('404 Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let connectionId = 0;

// توليد كود غرفة عشوائي مكون من 4 أحرف
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

// إرسال رسالة عبر WebSocket
function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws, req) => {
  ws.id = ++connectionId;
  ws.room = null;
  ws.color = null;
  
  console.log(`[+] اتصال جديد #${ws.id}`);
  
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (e) {
      console.error('خطأ في تحليل JSON:', e);
      return;
    }
    
    // إنشاء غرفة جديدة
    if (message.type === 'create') {
      // إذا كان المستخدم في غرفة سابقة، قم بإزالته
      if (ws.room) {
        const oldRoom = rooms.get(ws.room);
        if (oldRoom) {
          delete oldRoom[ws.color];
          if (!oldRoom.w && !oldRoom.b) {
            rooms.delete(ws.room);
          }
        }
      }
      
      const roomCode = generateRoomCode();
      const playerColor = message.color === 'b' ? 'b' : 'w';
      
      rooms.set(roomCode, {
        w: playerColor === 'w' ? ws : null,
        b: playerColor === 'b' ? ws : null,
        started: false
      });
      
      ws.room = roomCode;
      ws.color = playerColor;
      
      send(ws, {
        type: 'created',
        code: roomCode
      });
      
      console.log(`[غرفة ${roomCode}] تم إنشاؤها بواسطة #${ws.id} باللون ${playerColor === 'w' ? 'أبيض' : 'أسود'}`);
    }
    
    // الانضمام إلى غرفة موجودة
    else if (message.type === 'join') {
      const roomCode = (message.code || '').toUpperCase().trim();
      const room = rooms.get(roomCode);
      
      if (!room) {
        send(ws, { type: 'error', msg: '❌ الغرفة غير موجودة. تحقق من الكود.' });
        return;
      }
      
      if (room.started) {
        send(ws, { type: 'error', msg: '❌ الغرفة ممتلئة أو بدأت اللعبة بالفعل.' });
        return;
      }
      
      // تحديد لون اللاعب الجديد (اللون المتبقي)
      const takenColor = room.w ? 'w' : (room.b ? 'b' : null);
      const joinColor = takenColor === 'w' ? 'b' : 'w';
      
      if (joinColor === 'w') {
        room.w = ws;
      } else {
        room.b = ws;
      }
      
      room.started = true;
      ws.room = roomCode;
      ws.color = joinColor;
      
      // إرسال إشعار بدء اللعبة لكل من اللاعبين
      if (room.w) {
        send(room.w, { type: 'start', myColor: 'w', myId: room.w.id });
      }
      if (room.b) {
        send(room.b, { type: 'start', myColor: 'b', myId: room.b.id });
      }
      
      console.log(`[غرفة ${roomCode}] بدأت! الأبيض: #${room.w?.id}, الأسود: #${room.b?.id}`);
    }
    
    // نقل حركة
    else if (message.type === 'move') {
      const room = rooms.get(ws.room);
      if (!room) return;
      
      const opponent = ws.color === 'w' ? room.b : room.w;
      if (opponent) {
        send(opponent, {
          type: 'move',
          from: message.from,
          to: message.to,
          promo: message.promo || null
        });
      }
    }
  });
  
  ws.on('close', () => {
    console.log(`[-] قطع الاتصال #${ws.id}`);
    
    if (!ws.room) return;
    
    const room = rooms.get(ws.room);
    if (!room) return;
    
    // إعلام الخصم بأن الخصم غادر
    const opponent = ws.color === 'w' ? room.b : room.w;
    if (opponent) {
      send(opponent, { type: 'opponent_left' });
    }
    
    // حذف الغرفة
    rooms.delete(ws.room);
    console.log(`[غرفة ${ws.room}] تم حذفها بسبب انقطاع الاتصال`);
  });
  
  ws.on('error', (err) => {
    console.error(`خطأ في WebSocket #${ws.id}:`, err.message);
  });
});

server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════╗');
  console.log('║       ♜ شطرنج — Am-Kh ♞           ║');
  console.log('╠════════════════════════════════════╣');
  console.log(`║  ▶ الخادم يعمل على:                 ║`);
  console.log(`║  http://localhost:${PORT}           ║`);
  console.log(`║  http://127.0.0.1:${PORT}           ║`);
  console.log('╠════════════════════════════════════╣');
  console.log('║  ✦ اضغط Ctrl+C لإيقاف الخادم       ║');
  console.log('╚════════════════════════════════════╝\n');
});