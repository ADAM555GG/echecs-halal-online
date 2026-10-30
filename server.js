'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5
});
const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();
const ROOM_TTL = 30 * 60 * 1000;

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'echecs-halal-online' }));

function cleanName(value) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20);
  return name || 'Joueur';
}
function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), b => alphabet[b % alphabet.length]).join('');
  } while (rooms.has(code));
  return code;
}
function publicPlayers(room) {
  return {
    w: room.players.w ? { name: room.players.w.name, connected: !!room.players.w.socketId } : null,
    b: room.players.b ? { name: room.players.b.name, connected: !!room.players.b.socketId } : null
  };
}
function snapshot(room) {
  const history = room.chess.history({ verbose: true });
  const latest = history.length ? history[history.length - 1] : null;
  const checkmate = room.chess.isCheckmate();
  const stalemate = room.chess.isStalemate();
  const drawByRules = room.chess.isDraw();
  let result = room.result;
  if (!result && checkmate) result = room.chess.turn() === 'w' ? 'Échec et mat — les noirs gagnent.' : 'Échec et mat — les blancs gagnent.';
  if (!result && stalemate) result = 'Partie nulle — pat.';
  if (!result && drawByRules) result = 'Partie nulle selon les règles des échecs.';
  if (!result && room.chess.isGameOver()) result = 'Partie nulle selon les règles des échecs.';
  return {
    fen: room.chess.fen(),
    board: room.chess.board().map(row => row.map(piece => piece ? (piece.color === 'w' ? piece.type.toUpperCase() : piece.type) : null)),
    turn: room.chess.turn(),
    legalMoves: room.chess.moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, promotion: m.promotion || null, san: m.san, flags: m.flags })),
    history: history.map(m => ({ san: m.san, color: m.color, from: m.from, to: m.to, promotion: m.promotion || null })),
    lastMove: latest ? { from: latest.from, to: latest.to, san: latest.san } : null,
    check: room.chess.isCheck(),
    checkmate,
    stalemate,
    gameOver: !!room.result || room.chess.isGameOver(),
    result,
    drawOfferBy: room.drawOfferBy,
    players: publicPlayers(room)
  };
}
function sendState(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.updatedAt = Date.now();
  io.to(code).emit('gameState', snapshot(room));
}
function sendError(ack, message) {
  if (typeof ack === 'function') ack({ ok: false, error: message });
}
function detachCurrent(socket) {
  const code = socket.data.roomCode;
  const color = socket.data.color;
  const room = code && rooms.get(code);
  const seat = room && room.players[color];
  if (seat && seat.socketId === socket.id) {
    seat.socketId = null;
    socket.leave(code);
    sendState(code);
    scheduleCleanup(room);
  }
  socket.data.roomCode = null;
  socket.data.color = null;
}
async function attachSeat(socket, room, color, token, name, ack) {
  const seat = room.players[color];
  if (seat && seat.socketId && seat.socketId !== socket.id) {
    return sendError(ack, 'Cette place est déjà occupée. Réessaie après la déconnexion de l’autre joueur.');
  }
  if (seat && token && seat.token !== token) {
    return sendError(ack, 'Ce code de reprise ne correspond pas à cette place.');
  }
  if (!seat) {
    room.players[color] = { socketId: socket.id, token: token || crypto.randomUUID(), name: cleanName(name) };
  } else {
    seat.socketId = socket.id;
    seat.name = cleanName(name || seat.name);
  }
  await socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.color = color;
  room.updatedAt = Date.now();
  if (typeof ack === 'function') ack({ ok: true, roomCode: room.code, color, token: room.players[color].token, players: publicPlayers(room) });
  sendState(room.code);
}
function getPlayer(socket) {
  const code = socket.data.roomCode;
  const color = socket.data.color;
  const room = code && rooms.get(code);
  const seat = room && room.players[color];
  if (!room || !seat || seat.socketId !== socket.id) return null;
  return { room, color, seat };
}
function scheduleCleanup(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    const current = rooms.get(room.code);
    if (current === room && !current.players.w?.socketId && !current.players.b?.socketId) rooms.delete(room.code);
  }, ROOM_TTL);
  room.cleanupTimer.unref?.();
}

io.on('connection', socket => {
  socket.on('createRoom', async (payload = {}, ack) => {
    let room;
    try {
      detachCurrent(socket);
      const code = makeCode();
      room = {
        code, chess: new Chess(), players: { w: null, b: null },
        result: null, drawOfferBy: null, createdAt: Date.now(),
        updatedAt: Date.now(), cleanupTimer: null
      };
      rooms.set(code, room);
      await attachSeat(socket, room, 'w', null, payload.name, ack);
    } catch (error) {
      if (room) rooms.delete(room.code);
      console.error('createRoom failed:', error);
      sendError(ack, 'Le serveur n’a pas pu créer la salle. Réessaie.');
    }
  });

  socket.on('joinRoom', async (payload = {}, ack) => {
    const code = cleanCode(payload.code);
    const room = rooms.get(code);
    if (!/^[A-Z0-9]{6}$/.test(code) || !room) return sendError(ack, 'Salle introuvable. Vérifie le code ou demande à ton ami de créer une nouvelle salle.');
    const token = typeof payload.token === 'string' ? payload.token : '';
    let color = null;
    if (token && room.players.w?.token === token) color = 'w';
    else if (token && room.players.b?.token === token) color = 'b';
    else if (!room.players.w) color = 'w';
    else if (!room.players.b) color = 'b';
    if (!color) return sendError(ack, 'Cette salle contient déjà deux joueurs.');
    const seat = room.players[color];
    if (seat && seat.socketId && seat.socketId !== socket.id) return sendError(ack, 'Ce joueur est encore connecté à cette place.');
    if (seat && token && seat.token !== token) return sendError(ack, 'Code de reprise incorrect.');
    detachCurrent(socket);
    try { await attachSeat(socket, room, color, token || undefined, payload.name, ack); }
    catch (error) { console.error('joinRoom failed:', error); sendError(ack, 'Le serveur n’a pas pu rejoindre la salle. Réessaie.'); }
  });

  socket.on('makeMove', (payload = {}, ack) => {
    const player = getPlayer(socket);
    if (!player) return sendError(ack, 'Tu n’es plus connecté à cette partie.');
    const { room, color } = player;
    if (room.result || room.chess.isGameOver()) return sendError(ack, 'La partie est terminée.');
    if (room.chess.turn() !== color) return sendError(ack, 'Ce n’est pas ton tour.');
    const from = String(payload.from || '');
    const to = String(payload.to || '');
    const promotion = String(payload.promotion || '');
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to) || (promotion && !/^[qrbn]$/.test(promotion))) {
      return sendError(ack, 'Coup mal formé.');
    }
    try {
      const move = room.chess.move({ from, to, ...(promotion ? { promotion } : {}) });
      if (!move) return sendError(ack, 'Coup illégal.');
      room.drawOfferBy = null;
      if (typeof ack === 'function') ack({ ok: true });
      sendState(room.code);
    } catch (_error) {
      sendError(ack, 'Coup impossible. Vérifie le déplacement.');
    }
  });

  socket.on('offerDraw', (_payload, ack) => {
    const player = getPlayer(socket);
    if (!player) return sendError(ack, 'Partie introuvable.');
    if (player.room.result || player.room.chess.isGameOver()) return sendError(ack, 'La partie est terminée.');
    player.room.drawOfferBy = player.color;
    if (typeof ack === 'function') ack({ ok: true });
    sendState(player.room.code);
  });

  socket.on('answerDraw', (payload = {}, ack) => {
    const player = getPlayer(socket);
    if (!player) return sendError(ack, 'Partie introuvable.');
    const room = player.room;
    if (!room.drawOfferBy || room.drawOfferBy === player.color) return sendError(ack, 'Aucune proposition de nulle à accepter.');
    if (payload.accept) room.result = 'Partie nulle — accord des deux joueurs.';
    room.drawOfferBy = null;
    if (typeof ack === 'function') ack({ ok: true });
    sendState(room.code);
  });

  socket.on('resign', (_payload, ack) => {
    const player = getPlayer(socket);
    if (!player) return sendError(ack, 'Partie introuvable.');
    const { room, color } = player;
    if (room.result || room.chess.isGameOver()) return sendError(ack, 'La partie est déjà terminée.');
    room.result = `${color === 'w' ? 'Les blancs' : 'Les noirs'} abandonnent — ${color === 'w' ? 'les noirs' : 'les blancs'} gagnent.`;
    room.drawOfferBy = null;
    if (typeof ack === 'function') ack({ ok: true });
    sendState(room.code);
  });

  socket.on('restartGame', (_payload, ack) => {
    const player = getPlayer(socket);
    if (!player) return sendError(ack, 'Partie introuvable.');
    player.room.chess = new Chess();
    player.room.result = null;
    player.room.drawOfferBy = null;
    if (typeof ack === 'function') ack({ ok: true });
    sendState(player.room.code);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const color = socket.data.color;
    const room = code && rooms.get(code);
    const seat = room && room.players[color];
    if (seat && seat.socketId === socket.id) {
      seat.socketId = null;
      room.updatedAt = Date.now();
      sendState(code);
      if (!room.players.w?.socketId && !room.players.b?.socketId) scheduleCleanup(room);
      else scheduleCleanup(room);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Échecs Halal Online écoute sur http://localhost:${PORT}`);
});
