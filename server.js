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

/** Fisher-Yates in-place shuffle */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build per-letter queues (shuffled, no repeat until pool exhausted).
 * Each game pre-picks its 26 words up front.
 */
function buildWordQueues() {
  const queues = {};
  for (const letter of ALPHABET) {
    const pool = [...(WORD_POOL[letter] || [letter.toLowerCase()])];
    queues[letter] = shuffle(pool);
  }
  return queues;
}

/**
 * Pop next word from a letter's queue.
 * Refills + reshuffles when exhausted so words only repeat after full cycle.
 */
function nextWord(room, letter) {
  const queue = room.wordQueues[letter];
  if (!queue || queue.length === 0) {
    // Refill
    room.wordQueues[letter] = shuffle([...(WORD_POOL[letter] || [letter.toLowerCase()])]);
    return room.wordQueues[letter].pop();
  }
  return queue.pop();
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

    // ── Join room ─────────────────────────────────────────────────────────────
    socket.on('join-room', ({ roomId, playerName }) => {
      if (!rooms[roomId]) {
        rooms[roomId] = {
          id: roomId,
          players: {},
          scores: {},
          submissions: {},
          currentLetterIndex: 0,
          currentWord: '',
          timer: ROUND_TIME,
          timerInterval: null,
          isActive: false,
          gameStarted: false,
          winner: null,
          // Non-repeating shuffle queues (initialised at game start)
          wordQueues: {},
          // Track confirmed songs this game to avoid repeating in hints
          confirmedSongs: [],
          // Pause state
          isPaused: false,
          pauseVotes: new Set(),
        };
      }

      const room = rooms[roomId];
      room.players[playerName] = socket.id;
      room.scores[playerName] = room.scores[playerName] || 0;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.playerName = playerName;

      io.to(roomId).emit('room-update', buildRoomState(room));
      // Notify everyone else that this player joined
      socket.to(roomId).emit('player-joined', { playerName });
      console.log(`[socket] ${playerName} joined room ${roomId}`);
    });

    // ── Start game ────────────────────────────────────────────────────────────
    socket.on('start-game', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || room.gameStarted) return;

      room.gameStarted = true;
      room.isActive = true;
      room.currentLetterIndex = 0;
      room.confirmedSongs = [];
      room.wordQueues = buildWordQueues(); // fresh shuffle for this game

      io.to(roomId).emit('room-update', buildRoomState(room));
      startRound(io, room, roomId);
    });

    // ── Submit lyric ──────────────────────────────────────────────────────────
    socket.on('submit-lyric', ({ roomId, playerName, lyric, artist }) => {
      const room = rooms[roomId];
      if (!room || !room.isActive || room.isPaused) return;
      if (room.submissions[playerName]) return; // already submitted

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

    // ── Receive analysis result (client relays Gemini result back) ────────────
    socket.on('lyric-result', ({ roomId, playerName, result }) => {
      const room = rooms[roomId];
      if (!room) return;

      room.submissions[playerName] = {
        ...room.submissions[playerName],
        result,
        pending: false,
      };

      // Track confirmed songs to exclude from hints
      if (result.songTitle && result.confidence >= 60) {
        room.confirmedSongs.push(result.songTitle);
      }

      const pts = result.gameScore || 0;
      room.scores[playerName] = (room.scores[playerName] || 0) + pts;

      io.to(roomId).emit('player-scored', { playerName, pts, result });
      io.to(roomId).emit('room-update', buildRoomState(room));

      // If all players have submitted, end round early
      const allIn = Object.keys(room.players).every(
        (p) => room.submissions[p] && !room.submissions[p].pending
      );
      if (allIn) endRound(io, room, roomId, false);
    });

    // ── Pause ─────────────────────────────────────────────────────────────────
    socket.on('request-pause', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || !room.isActive || room.isPaused) return;

      const playerName = socket.data.playerName;
      room.pauseVotes.add(playerName);

      const totalPlayers = Object.keys(room.players).length;

      if (totalPlayers === 1 || room.pauseVotes.size >= totalPlayers) {
        // Solo or unanimous — pause immediately
        room.isPaused = true;
        clearInterval(room.timerInterval);
        room.pauseVotes.clear();
        io.to(roomId).emit('game-paused', { pausedBy: playerName });
      } else {
        // Notify others
        io.to(roomId).emit('pause-requested', {
          by: playerName,
          votes: room.pauseVotes.size,
          needed: totalPlayers,
        });
      }
    });

    // ── Resume ────────────────────────────────────────────────────────────────
    socket.on('resume-game', ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || !room.isPaused) return;

      room.isPaused = false;
      room.pauseVotes.clear();
      io.to(roomId).emit('game-resumed');

      // Restart timer from remaining time
      room.timerInterval = setInterval(() => {
        room.timer -= 1;
        io.to(roomId).emit('timer-update', { timer: room.timer });
        if (room.timer <= 0) {
          clearInterval(room.timerInterval);
          endRound(io, room, roomId, true);
        }
      }, 1000);
    });

    // ── Explicit leave ────────────────────────────────────────────────────────
    socket.on('leave-room', ({ roomId, playerName: pn }) => {
      const room = rooms[roomId];
      if (room) {
        delete room.players[pn];
        room.pauseVotes.delete(pn);
        io.to(roomId).emit('player-left', { playerName: pn });
        io.to(roomId).emit('room-update', buildRoomState(room));
        if (Object.keys(room.players).length === 0) {
          clearInterval(room.timerInterval);
          delete rooms[roomId];
        }
      }
      socket.leave(roomId);
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const { roomId, playerName } = socket.data;
      if (!roomId || !rooms[roomId]) return;
      const room = rooms[roomId];
      delete room.players[playerName];
      room.pauseVotes.delete(playerName);
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
      if (room.isPaused) return; // skip ticks while paused
      room.timer -= 1;
      io.to(roomId).emit('timer-update', { timer: room.timer });

      if (room.timer <= 0) {
        clearInterval(room.timerInterval);
        endRound(io, room, roomId, true);
      }
    }, 1000);
  }

  function endRound(io, room, roomId, timedOut) {
    clearInterval(room.timerInterval);
    room.isActive = false;

    io.to(roomId).emit('round-complete', {
      submissions: room.submissions,
      scores: room.scores,
      timedOut: !!timedOut,
      promptWord: room.currentWord,
      usedSongs: [...room.confirmedSongs],
    });

    setTimeout(() => {
      if (room.currentLetterIndex >= ALPHABET.length - 1) {
        // Game over
        const sorted = Object.entries(room.scores).sort(([, a], [, b]) => b - a);
        room.winner = sorted.length > 0 ? sorted[0][0] : null;
        io.to(roomId).emit('game-complete', {
          winner: room.winner,
          scores: room.scores,
        });
      } else {
        room.currentLetterIndex += 1;
        room.isActive = true;
        startRound(io, room, roomId);
      }
    }, timedOut ? 6000 : 4000); // extra time when timed out so hint can load
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
