const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const LETTER_SCORES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5,
  L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4,
  W: 4, X: 8, Y: 4, Z: 10,
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ROUND_TIME = 60;

// In-memory game state keyed by roomId
const rooms = {};

// Word pool (loaded once at startup via dynamic import workaround for ESM)
let WORD_POOL = {};

// Fisher-Yates shuffle — returns a new shuffled copy
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build per-letter shuffled queues so words don't repeat until the pool is exhausted
function buildLetterQueues() {
  const queues = {};
  for (const letter of ALPHABET) {
    const pool = WORD_POOL[letter] || [];
    queues[letter] = pool.length > 0 ? shuffle(pool) : [letter.toLowerCase()];
  }
  return queues;
}

// Pop next word for a letter, reshuffling when the queue is empty
function nextWord(room, letter) {
  const q = room.letterQueues[letter];
  if (!q || q.length === 0) {
    const pool = WORD_POOL[letter] || [];
    room.letterQueues[letter] = pool.length > 0 ? shuffle(pool) : [letter.toLowerCase()];
  }
  return room.letterQueues[letter].pop();
}

app.prepare().then(async () => {
  // Load ESM word pool
  try {
    const mod = await import('./data/wordPool.js');
    WORD_POOL = mod.WORD_POOL;
    console.log('[lyricMatch] Word pool loaded:', Object.keys(WORD_POOL).length, 'letters');
  } catch (e) {
    console.warn('[lyricMatch] Could not load word pool:', e.message);
  }

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log('[socket] connected:', socket.id);

    // ── Join room ────────────────────────────────────────────────────────────
    socket.on('join-room', ({ roomId, playerName }) => {
      if (!rooms[roomId]) {
        rooms[roomId] = {
          id: roomId,
          players: {},
          scores: {},
          submissions: {},       // { playerName: { lyric, artist, result } }
          skipped: {},           // { playerName: true } — skipped this round
          currentLetterIndex: 0,
          currentWord: '',
          timer: ROUND_TIME,
          timerInterval: null,
          isActive: false,
          gameStarted: false,
          isPaused: false,
          pausedAt: null,        // timer value when paused
          winner: null,
          letterQueues: buildLetterQueues(),
        };
      }

      const room = rooms[roomId];
      room.players[playerName] = socket.id;
      room.scores[playerName] = room.scores[playerName] || 0;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.playerName = playerName;

      io.to(roomId).emit('room-update', buildRoomState(room));
      console.log(`[socket] ${playerName} joined room ${roomId}`);
    });

    // ── Start game ───────────────────────────────────────────────────────────
    socket.on('start-game', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || room.gameStarted) return;

      room.gameStarted = true;
      room.isActive = true;
      room.currentLetterIndex = 0;

      // Broadcast updated state so all clients leave the lobby immediately
      io.to(roomId).emit('room-update', buildRoomState(room));
      startRound(io, room, roomId);
    });

    // ── Submit lyric ─────────────────────────────────────────────────────────
    socket.on('submit-lyric', ({ roomId, playerName, lyric, artist }) => {
      const room = rooms[roomId];
      if (!room || !room.isActive || room.isPaused) return;
      if (room.submissions[playerName] || room.skipped[playerName]) return; // already acted

      room.submissions[playerName] = { lyric, artist, pending: true };
      io.to(roomId).emit('submission-received', { playerName });

      // Tell the client to call /api/lyrics-match and report back
      socket.emit('analyze-lyric', {
        lyric,
        artist,
        promptWord: room.currentWord,
        letter: ALPHABET[room.currentLetterIndex],
        roomId,
        playerName,
      });
    });

    // ── Skip turn ────────────────────────────────────────────────────────────
    socket.on('skip-turn', ({ roomId, playerName }) => {
      const room = rooms[roomId];
      if (!room || !room.isActive || room.isPaused) return;
      if (room.submissions[playerName] || room.skipped[playerName]) return;

      room.skipped[playerName] = true;
      // Treat as 0-score submission so round-end logic still works
      room.submissions[playerName] = { lyric: '', artist: '', result: { confidence: 0, gameScore: 0, lyricMatch: false, wordMatch: false, reasoning: 'Skipped.' }, pending: false };
      io.to(roomId).emit('player-skipped', { playerName });
      io.to(roomId).emit('player-scored', { playerName, pts: 0, result: room.submissions[playerName].result });
      io.to(roomId).emit('room-update', buildRoomState(room));

      const allIn = Object.keys(room.players).every(
        (p) => (room.submissions[p] && !room.submissions[p].pending) || room.skipped[p]
      );
      if (allIn) endRound(io, room, roomId);
    });

    // ── Forfeit game ─────────────────────────────────────────────────────────
    socket.on('forfeit', ({ roomId, playerName }) => {
      const room = rooms[roomId];
      if (!room) return;

      delete room.players[playerName];
      io.to(roomId).emit('player-forfeited', { playerName });
      io.to(roomId).emit('room-update', buildRoomState(room));

      // If nobody left, clean up
      if (Object.keys(room.players).length === 0) {
        clearInterval(room.timerInterval);
        delete rooms[roomId];
        return;
      }

      // If only one player remains, they win
      const remaining = Object.keys(room.players);
      if (remaining.length === 1 && room.gameStarted) {
        clearInterval(room.timerInterval);
        room.winner = remaining[0];
        io.to(roomId).emit('game-complete', { winner: room.winner, scores: room.scores });
        return;
      }

      // Check if all remaining players have submitted
      const allIn = remaining.every(
        (p) => (room.submissions[p] && !room.submissions[p].pending) || room.skipped[p]
      );
      if (allIn) endRound(io, room, roomId);
    });

    // ── Pause game ───────────────────────────────────────────────────────────
    socket.on('pause-game', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || !room.gameStarted || room.isPaused || !room.isActive) return;

      room.isPaused = true;
      room.pausedAt = room.timer;
      clearInterval(room.timerInterval);
      io.to(roomId).emit('game-paused', { timer: room.timer });
      io.to(roomId).emit('room-update', buildRoomState(room));
    });

    // ── Resume game ──────────────────────────────────────────────────────────
    socket.on('resume-game', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || !room.isPaused) return;

      room.isPaused = false;
      room.timer = room.pausedAt ?? room.timer;
      io.to(roomId).emit('game-resumed', { timer: room.timer });
      io.to(roomId).emit('room-update', buildRoomState(room));

      // Restart the countdown
      clearInterval(room.timerInterval);
      room.timerInterval = setInterval(() => {
        room.timer -= 1;
        io.to(roomId).emit('timer-update', { timer: room.timer });
        if (room.timer <= 0) {
          clearInterval(room.timerInterval);
          endRound(io, room, roomId);
        }
      }, 1000);
    });

    // ── Receive analysis result (client relays Gemini result back) ───────────
    socket.on('lyric-result', ({ roomId, playerName, result }) => {
      const room = rooms[roomId];
      if (!room) return;

      room.submissions[playerName] = {
        ...room.submissions[playerName],
        result,
        pending: false,
      };

      // Award points immediately so scores update live
      const pts = result.gameScore || 0;
      room.scores[playerName] = (room.scores[playerName] || 0) + pts;

      io.to(roomId).emit('player-scored', { playerName, pts, result });
      io.to(roomId).emit('room-update', buildRoomState(room));

      // If all remaining players have submitted/skipped, end round early
      const remaining = Object.keys(room.players);
      const allIn = remaining.every(
        (p) => (room.submissions[p] && !room.submissions[p].pending) || room.skipped[p]
      );
      if (allIn) endRound(io, room, roomId);
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const { roomId, playerName } = socket.data;
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      delete room.players[playerName];
      io.to(roomId).emit('player-left', { playerName });
      io.to(roomId).emit('room-update', buildRoomState(room));
      if (Object.keys(room.players).length === 0) {
        clearInterval(room.timerInterval);
        delete rooms[roomId];
      }
    });
  });

  // ── Game flow helpers ─────────────────────────────────────────────────────

  function startRound(io, room, roomId) {
    const letter = ALPHABET[room.currentLetterIndex];
    room.currentWord = nextWord(room, letter);
    room.submissions = {};
    room.skipped = {};
    room.timer = ROUND_TIME;
    room.isPaused = false;

    io.to(roomId).emit('new-round', {
      letter,
      word: room.currentWord,
      letterIndex: room.currentLetterIndex,
      letterScore: LETTER_SCORES[letter],
      timer: ROUND_TIME,
    });

    clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      if (room.isPaused) return; // skip tick while paused (belt-and-suspenders)
      room.timer -= 1;
      io.to(roomId).emit('timer-update', { timer: room.timer });

      if (room.timer <= 0) {
        clearInterval(room.timerInterval);
        endRound(io, room, roomId);
      }
    }, 1000);
  }

  function endRound(io, room, roomId) {
    clearInterval(room.timerInterval);
    room.isActive = false;

    io.to(roomId).emit('round-complete', {
      submissions: room.submissions,
      scores: room.scores,
    });

    setTimeout(() => {
      if (!rooms[roomId]) return; // room may have been cleaned up
      if (room.currentLetterIndex >= ALPHABET.length - 1) {
        // Game over
        const winner = Object.entries(room.scores).sort(([, a], [, b]) => b - a)[0];
        room.winner = winner ? winner[0] : null;
        io.to(roomId).emit('game-complete', {
          winner: room.winner,
          scores: room.scores,
        });
      } else {
        room.currentLetterIndex += 1;
        room.isActive = true;
        startRound(io, room, roomId);
      }
    }, 4000);
  }

  function buildRoomState(room) {
    return {
      players: Object.keys(room.players),
      scores: room.scores,
      currentLetterIndex: room.currentLetterIndex,
      currentWord: room.currentWord,
      timer: room.timer,
      gameStarted: room.gameStarted,
      isActive: room.isActive,
      isPaused: room.isPaused,
      winner: room.winner,
    };
  }

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`[lyricMatch] Running on http://localhost:${PORT}`);
  });
});
