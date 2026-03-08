import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { io } from 'socket.io-client';
import { onAuth, submitGameScore } from '../lib/firebase';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ROUND_TIME = 60;

// ── Toast system ────────────────────────────────────────────────────────────
function useToasts() {
  const [toasts, setToasts] = useState([]);
  function addToast(msg, type = 'info') {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }
  return { toasts, addToast };
}

function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
      alignItems: 'center', zIndex: 200, pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: t.type === 'leave' ? 'rgba(239,68,68,0.15)' : 'rgba(29,185,84,0.13)',
          border: `1px solid ${t.type === 'leave' ? 'rgba(239,68,68,0.35)' : 'rgba(29,185,84,0.3)'}`,
          color: '#fff',
          borderRadius: 999,
          padding: '0.5rem 1.25rem',
          fontSize: '0.85rem',
          fontWeight: 600,
          backdropFilter: 'blur(8px)',
          animation: 'slideUpFade 0.3s ease',
          whiteSpace: 'nowrap',
        }}>
          {t.msg}
        </div>
      ))}
      <style>{`
        @keyframes slideUpFade {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function ConfidenceMeter({ value }) {
  const pct = Math.max(0, Math.min(100, value));
  const cls = pct >= 70 ? 'confidence-high' : pct >= 40 ? 'confidence-mid' : 'confidence-low';
  const color = pct >= 70 ? '#1db954' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Credibility</span>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div className="confidence-bar">
        <div className={`confidence-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SearchLinks({ links }) {
  if (!links) return null;
  const services = [
    { key: 'spotify', label: 'Spotify', color: '#1db954' },
    { key: 'youtube', label: 'YT Music', color: '#ff0000' },
    { key: 'apple', label: 'Apple', color: '#fc3c44' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
      {services.map(({ key, label, color }) => links[key] && (
        <a
          key={key}
          href={links[key]}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: `${color}18`,
            border: `1px solid ${color}55`,
            borderRadius: 999,
            padding: '0.3rem 0.8rem',
            fontSize: '0.78rem',
            fontWeight: 600,
            color,
            textDecoration: 'none',
            transition: 'background 0.15s',
          }}
        >
          ▶ {label}
        </a>
      ))}
    </div>
  );
}

function PlayerCard({ name, score, isYou, submission }) {
  const hasResult = submission?.result;
  const confidence = hasResult ? submission.result.confidence : null;
  const pending = submission?.pending;

  return (
    <div className="glass-card" style={{
      padding: '1rem 1.2rem',
      border: isYou ? '1.5px solid var(--accent-green)' : '1px solid var(--border-subtle)',
      position: 'relative',
    }}>
      {isYou && (
        <span style={{
          position: 'absolute', top: -10, left: 12,
          background: 'var(--accent-green)', color: '#000',
          fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 999,
        }}>YOU</span>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>{name}</p>
        <span className="score-badge">{score} pts</span>
      </div>

      {pending && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          ⏳ Verifying…
        </p>
      )}

      {hasResult && (
        <div style={{ marginTop: '0.6rem' }}>
          <ConfidenceMeter value={confidence} />
          {submission.result.songTitle && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              🎵 {submission.result.songTitle}
              {submission.result.confirmedArtist && ` — ${submission.result.confirmedArtist}`}
            </p>
          )}
          {submission.result.wordMatch && (
            <p style={{ fontSize: '0.75rem', color: 'var(--accent-green)', marginTop: '0.2rem' }}>
              ✓ Contains the prompt word
            </p>
          )}
        </div>
      )}

      {!pending && !hasResult && (
        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.2)', marginTop: '0.4rem' }}>
          Waiting…
        </p>
      )}
    </div>
  );
}

export default function GameBoard({ roomId, playerName }) {
  const router = useRouter();
  const socketRef = useRef(null);
  const [user, setUser] = useState(null);

  // Game state
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState({});
  const [currentLetterIndex, setCurrentLetterIndex] = useState(0);
  const [currentWord, setCurrentWord] = useState('');
  const [timer, setTimer] = useState(ROUND_TIME);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);

  // Submissions (all players)
  const [submissions, setSubmissions] = useState({});

  // My submission form
  const [lyric, setLyric] = useState('');
  const [artist, setArtist] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Round result overlay
  const [roundResults, setRoundResults] = useState(null);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const [myLastResult, setMyLastResult] = useState(null);
  const [roundTimedOut, setRoundTimedOut] = useState(false);
  const [songHint, setSongHint] = useState(null);
  const [hintLoading, setHintLoading] = useState(false);

  // Pause state
  const [isPaused, setIsPaused] = useState(false);
  const [pauseRequestedBy, setPauseRequestedBy] = useState(null);
  const [pauseVotes, setPauseVotes] = useState({ votes: 0, needed: 0 });

  // Toast notifications
  const { toasts, addToast } = useToasts();

  // Leave-room confirmation dialog
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Auth
  useEffect(() => {
    const unsub = onAuth(setUser);
    return unsub;
  }, []);

  // Socket
  useEffect(() => {
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.emit('join-room', { roomId, playerName });

    socket.on('room-update', (state) => {
      setPlayers(state.players || []);
      setScores(state.scores || {});
      setCurrentLetterIndex(state.currentLetterIndex ?? 0);
      setCurrentWord(state.currentWord || '');
      setTimer(state.timer ?? ROUND_TIME);
      setGameStarted(state.gameStarted);
      setIsPaused(state.isPaused || false);
    });

    socket.on('new-round', ({ letter, word, letterIndex, timer: t }) => {
      setGameStarted(true);
      setCurrentLetterIndex(letterIndex);
      setCurrentWord(word);
      setTimer(t);
      setLyric('');
      setArtist('');
      setSubmitted(false);
      setAnalyzing(false);
      setSubmissions({});
      setShowRoundResult(false);
      setMyLastResult(null);
      setRoundTimedOut(false);
      setSongHint(null);
      setIsPaused(false);
      setPauseRequestedBy(null);
    });

    socket.on('timer-update', ({ timer: t }) => setTimer(t));

    socket.on('submission-received', ({ playerName: pn }) => {
      setSubmissions((prev) => ({ ...prev, [pn]: { ...prev[pn], pending: true } }));
    });

    socket.on('player-scored', ({ playerName: pn, pts, result }) => {
      setScores((prev) => ({ ...prev, [pn]: (prev[pn] || 0) + pts }));
      setSubmissions((prev) => ({ ...prev, [pn]: { ...prev[pn], result, pending: false } }));
      if (pn === playerName) {
        setMyLastResult(result);
      }
    });

    socket.on('round-complete', async ({ submissions: subs, scores: sc, timedOut, promptWord, usedSongs }) => {
      setSubmissions(subs);
      setScores(sc);
      setShowRoundResult(true);
      setRoundResults(subs);
      setRoundTimedOut(!!timedOut);

      // Fetch a famous song hint (shown as playful reveal when timed out)
      if (timedOut && promptWord) {
        setHintLoading(true);
        try {
          const resp = await fetch('/api/song-hint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: promptWord, usedSongs: usedSongs || [] }),
          });
          const hint = await resp.json();
          setSongHint(hint.songTitle ? hint : null);
        } catch {
          setSongHint(null);
        } finally {
          setHintLoading(false);
        }
      }
    });

    socket.on('game-complete', ({ winner: w, scores: sc }) => {
      setScores(sc);
      setWinner(w);
      setGameOver(true);
      if (user) {
        const myScore = sc[playerName] || 0;
        submitGameScore(user.uid, myScore).catch(console.error);
      }
    });

    // Server asks client to call /api/lyrics-match (so API key stays server-side via Next.js API route)
    socket.on('analyze-lyric', async ({ lyric: l, artist: a, promptWord, letter: lt, roomId: rid, playerName: pn }) => {
      if (pn !== playerName) return;
      setAnalyzing(true);
      try {
        const res = await fetch('/api/lyrics-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lyricFragment: l, artistHint: a, promptWord, letter: lt }),
        });
        const result = await res.json();
        socket.emit('lyric-result', { roomId: rid, playerName: pn, result });
        setMyLastResult(result);
      } catch (e) {
        console.error(e);
        socket.emit('lyric-result', { roomId: rid, playerName: pn, result: { confidence: 0, gameScore: 0, lyricMatch: false } });
      } finally {
        setAnalyzing(false);
      }
    });

    socket.on('game-paused', ({ pausedBy }) => {
      setIsPaused(true);
      setPauseRequestedBy(null);
    });

    socket.on('game-resumed', () => {
      setIsPaused(false);
      setPauseRequestedBy(null);
    });

    socket.on('pause-requested', ({ by, votes, needed }) => {
      setPauseRequestedBy(by);
      setPauseVotes({ votes, needed });
    });

    socket.on('player-left', ({ playerName: pn }) => {
      setPlayers((prev) => prev.filter((p) => p !== pn));
      if (pn !== playerName) {
        addToast(`🚪 ${pn} left the room`, 'leave');
      }
    });

    socket.on('player-joined', ({ playerName: pn }) => {
      if (pn !== playerName) {
        addToast(`👋 ${pn} joined the room`);
      }
    });

    return () => socket.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, playerName]);

  function startGame() {
    socketRef.current?.emit('start-game', { roomId });
  }

  function submitLyric() {
    if (!lyric.trim() || submitted) return;
    setSubmitted(true);
    socketRef.current?.emit('submit-lyric', { roomId, playerName, lyric: lyric.trim(), artist: artist.trim() });
  }

  function requestPause() {
    socketRef.current?.emit('request-pause', { roomId });
  }

  function resumeGame() {
    socketRef.current?.emit('resume-game', { roomId });
  }

  function agreeToResume() {
    setPauseRequestedBy(null);
    socketRef.current?.emit('request-pause', { roomId }); // cast vote
  }

  function leaveRoom() {
    socketRef.current?.emit('leave-room', { roomId, playerName });
    socketRef.current?.disconnect();
    router.push('/');
  }

  const currentLetter = ALPHABET[currentLetterIndex];
  const timerPct = (timer / ROUND_TIME) * 100;
  const timerColor = timer > 20 ? '#1db954' : timer > 10 ? '#f59e0b' : '#ef4444';

  // ── Game over screen ─────────────────────────────────────────────────────────
  if (gameOver) {
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
    const iWon = winner === playerName;
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="glass-card fade-in-up" style={{ maxWidth: 500, width: '100%', padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>{iWon ? '🏆' : '🎵'}</div>
          <h1 style={{ fontWeight: 900, fontSize: '2rem', marginBottom: '0.25rem' }}>
            {iWon ? 'You won!' : `${winner} wins!`}
          </h1>
          {!iWon && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem', fontStyle: 'italic' }}>
              The answers were there all along — the songs never lie 🎶
            </p>
          )}
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Final scores</p>

          <div style={{ marginBottom: '2rem' }}>
            {sorted.map(([name, score], i) => (
              <div key={name} className="leaderboard-row">
                <span className={`rank-badge ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other'}`}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, textAlign: 'left', fontWeight: name === playerName ? 700 : 400 }}>
                  {name} {name === playerName && '(you)'}
                </span>
                <span className="score-badge">{score} pts</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn-primary" onClick={() => { window.location.href = `/game/${roomId}?name=${encodeURIComponent(playerName)}`; }}>
              Play again
            </button>
            <button className="btn-secondary" onClick={() => router.push('/')}>
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────────
  if (!gameStarted) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <ToastStack toasts={toasts} />
        {showLeaveConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150, backdropFilter: 'blur(4px)', padding: '1.5rem' }}>
            <div className="glass-card fade-in-up" style={{ maxWidth: 340, width: '100%', padding: '2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🚪</div>
              <h2 style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.5rem' }}>Leave the room?</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>You'll go back to the home screen.</p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowLeaveConfirm(false)}>Stay</button>
                <button onClick={leaveRoom} style={{ flex: 1, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '0.6rem', color: '#f87171', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}>Leave</button>
              </div>
            </div>
          </div>
        )}
        <div className="glass-card fade-in-up" style={{ maxWidth: 480, width: '100%', padding: '2.5rem', textAlign: 'center' }}>
          <div className="waveform" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
            <span /><span /><span /><span /><span />
          </div>
          <h2 style={{ fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Room <span style={{ fontFamily: 'monospace', color: 'var(--accent-green)', letterSpacing: '0.1em' }}>{roomId}</span>
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Share this code with friends to play together
          </p>

          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Players in room ({players.length})
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
              {players.map((p) => (
                <span key={p} style={{
                  background: p === playerName ? 'rgba(29, 185, 84, 0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${p === playerName ? 'rgba(29, 185, 84, 0.4)' : 'var(--border-subtle)'}`,
                  borderRadius: 999, padding: '0.3rem 0.9rem',
                  fontSize: '0.85rem', fontWeight: p === playerName ? 700 : 400,
                  color: p === playerName ? 'var(--accent-green)' : 'var(--text-primary)',
                }}>
                  {p} {p === playerName ? '(you)' : ''}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={startGame}>
              Start game →
            </button>
            <button
              onClick={() => setShowLeaveConfirm(true)}
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '0.6rem 1rem', color: '#f87171', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
            >
              🚪 Leave
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.75rem' }}>
            Game starts for everyone when you click start
          </p>
        </div>
      </div>
    );
  }

  // ── Main game ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '1.5rem', position: 'relative' }}>

      {/* ── Toast notifications ── */}
      <ToastStack toasts={toasts} />

      {/* ── Leave-room confirmation dialog ── */}
      {showLeaveConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 150, backdropFilter: 'blur(4px)', padding: '1.5rem',
        }}>
          <div className="glass-card fade-in-up" style={{ maxWidth: 340, width: '100%', padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🚪</div>
            <h2 style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.5rem' }}>Leave the room?</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              {gameStarted && !gameOver
                ? "You'll forfeit your current game score and your spot in the room."
                : "You'll go back to the home screen."}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setShowLeaveConfirm(false)}
              >
                Stay
              </button>
              <button
                onClick={leaveRoom}
                style={{
                  flex: 1, background: 'rgba(239,68,68,0.15)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: 10, padding: '0.6rem',
                  color: '#f87171', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pause overlay ── */}
      {isPaused && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, backdropFilter: 'blur(6px)',
        }}>
          <div className="glass-card fade-in-up" style={{ padding: '2.5rem', textAlign: 'center', maxWidth: 360, width: '100%' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⏸</div>
            <h2 style={{ fontWeight: 800, fontSize: '1.4rem', marginBottom: '0.5rem' }}>Game Paused</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Timer is frozen. All players can see this.
            </p>
            <button className="btn-primary" style={{ width: '100%' }} onClick={resumeGame}>
              ▶ Resume
            </button>
          </div>
        </div>
      )}

      {/* ── Pause request banner (from another player) ── */}
      {pauseRequestedBy && !isPaused && (
        <div style={{
          position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)',
          borderRadius: 12, padding: '0.75rem 1.5rem', zIndex: 90,
          display: 'flex', alignItems: 'center', gap: '1rem',
        }}>
          <span style={{ fontSize: '0.9rem' }}>
            <strong>{pauseRequestedBy}</strong> wants to pause ({pauseVotes.votes}/{pauseVotes.needed})
          </span>
          <button
            onClick={agreeToResume}
            style={{
              background: '#f59e0b', color: '#000', border: 'none',
              borderRadius: 8, padding: '0.35rem 0.9rem',
              fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            Agree
          </button>
          <button
            onClick={() => setPauseRequestedBy(null)}
            style={{
              background: 'transparent', color: 'var(--text-muted)', border: 'none',
              fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Round-complete overlay ── */}
      {showRoundResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 80, backdropFilter: 'blur(4px)', padding: '1.5rem',
        }}>
          <div className="glass-card fade-in-up" style={{ maxWidth: 500, width: '100%', padding: '2rem' }}>
            <h2 style={{ fontWeight: 800, fontSize: '1.3rem', marginBottom: '1rem', textAlign: 'center' }}>
              Round complete!
            </h2>

            {/* Show each player's result */}
            {roundResults && Object.entries(roundResults).map(([name, sub]) => (
              <div key={name} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{name}</span>
                  {sub.result && (
                    <span className="score-badge">+{sub.result.gameScore || 0} pts</span>
                  )}
                </div>
                {sub.result?.songTitle && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    🎵 {sub.result.songTitle} — {sub.result.confirmedArtist}
                  </p>
                )}
                {sub.result && <ConfidenceMeter value={sub.result.confidence || 0} />}
                {!sub.result && (
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)' }}>No submission</p>
                )}
              </div>
            ))}

            {/* Timed-out hint reveal */}
            {roundTimedOut && (
              <div style={{
                marginTop: '1rem', padding: '1rem',
                background: 'rgba(196,181,253,0.08)',
                border: '1px solid rgba(196,181,253,0.25)',
                borderRadius: 10,
              }}>
                {hintLoading ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Finding a hint…
                  </p>
                ) : songHint ? (
                  <>
                    <p style={{ fontSize: '0.78rem', color: '#c4b5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
                      It was right there! 👀
                    </p>
                    <p style={{ fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                      "{songHint.lyricLine}"
                    </p>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                      🎵 {songHint.songTitle} — {songHint.artist}
                    </p>
                    {songHint.joke && (
                      <p style={{ fontSize: '0.78rem', color: '#c4b5fd', marginTop: '0.4rem', fontStyle: 'italic' }}>
                        {songHint.joke}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            )}

            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '1rem' }}>
              Next round starting soon…
            </p>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="waveform">
              <span /><span /><span /><span /><span />
            </div>
            <span style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              lyric<span style={{ color: 'var(--accent-green)' }}>Match</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              Room: {roomId}
            </span>
            {!submitted && !showRoundResult && (
              <button
                onClick={requestPause}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8, padding: '0.35rem 0.8rem',
                  fontSize: '0.8rem', color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                ⏸ Pause
              </button>
            )}
            <button
              onClick={() => setShowLeaveConfirm(true)}
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 8, padding: '0.35rem 0.8rem',
                fontSize: '0.8rem', color: '#f87171',
                cursor: 'pointer',
              }}
            >
              🚪 Leave
            </button>
          </div>
        </div>

        {/* A-Z Progress */}
        <div className="alphabet-track" style={{ marginBottom: '1.5rem' }}>
          {ALPHABET.map((l, i) => (
            <div key={l} className={`letter-dot ${i < currentLetterIndex ? 'done' : i === currentLetterIndex ? 'current' : 'future'}`}>
              {l}
            </div>
          ))}
        </div>

        {/* Main grid */}
        <div className="game-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>

          {/* ── Left: Letter + Prompt + Input ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Letter + word card */}
            <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                Round {currentLetterIndex + 1} of 26
              </p>
              <div className="letter-display">{currentLetter}</div>
              <div style={{ marginTop: '0.75rem' }}>
                <span className="prompt-word">{currentWord}</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                Type a lyric containing <strong style={{ color: '#c4b5fd' }}>&ldquo;{currentWord}&rdquo;</strong> for +50% bonus
              </p>
            </div>

            {/* Timer */}
            <div className="glass-card" style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="timer-ring">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                  <circle
                    cx="40" cy="40" r="34"
                    fill="none"
                    stroke={timerColor}
                    strokeWidth="6"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - timerPct / 100)}`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
                  />
                </svg>
                <div className="timer-text" style={{ color: timerColor }}>{timer}</div>
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>Time left</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {submitted ? 'Submitted! Waiting…' : isPaused ? 'Paused' : 'Type fast!'}
                </p>
              </div>
            </div>

            {/* Input form */}
            {!submitted ? (
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Type a lyric containing &ldquo;<span style={{ color: '#c4b5fd' }}>{currentWord}</span>&rdquo;
                </label>
                <textarea
                  className="lyric-input"
                  rows={3}
                  placeholder={`e.g. a line from any song that has "${currentWord}" in it…`}
                  value={lyric}
                  onChange={(e) => setLyric(e.target.value)}
                  style={{ marginBottom: '0.75rem' }}
                />

                <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Artist · band · or &ldquo;Song Title — Artist&rdquo;
                </label>
                <input
                  className="lyric-input"
                  placeholder={`e.g. Ariana Grande  or  "Bang Bang — Ariana Grande"`}
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitLyric()}
                  style={{ marginBottom: '1rem' }}
                />

                <button
                  className="btn-primary"
                  style={{ width: '100%' }}
                  disabled={!lyric.trim() || timer === 0 || isPaused}
                  onClick={submitLyric}
                >
                  Submit →
                </button>
              </div>
            ) : (
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                {analyzing ? (
                  <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                    <div className="waveform" style={{ justifyContent: 'center', marginBottom: '0.75rem' }}>
                      <span /><span /><span /><span /><span />
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Gemini is verifying your lyric…</p>
                  </div>
                ) : myLastResult ? (
                  <div className="slide-in-right">
                    <ConfidenceMeter value={myLastResult.confidence} />
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                      {myLastResult.reasoning}
                    </p>
                    {myLastResult.songTitle && (
                      <p style={{ marginTop: '0.5rem', fontWeight: 700, fontSize: '0.9rem' }}>
                        🎵 {myLastResult.songTitle} — {myLastResult.confirmedArtist}
                      </p>
                    )}
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {myLastResult.wordMatch && <span className="score-badge">✓ Word match</span>}
                      {myLastResult.confirmedArtist && <span className="score-badge">✓ Artist confirmed</span>}
                    </div>
                    <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                      +{myLastResult.gameScore || 0} points
                    </p>
                    <SearchLinks links={myLastResult.searchLinks} />
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                    Submitted! Waiting for results…
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Right: Players ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Players — {players.length}
            </p>
            {players.map((p) => (
              <PlayerCard
                key={p}
                name={p}
                score={scores[p] || 0}
                isYou={p === playerName}
                submission={submissions[p]}
              />
            ))}

            {/* Score summary */}
            <div className="glass-card" style={{ padding: '1rem 1.2rem', marginTop: '0.5rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Standings</p>
              {Object.entries(scores)
                .sort(([, a], [, b]) => b - a)
                .map(([name, score], i) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: name === playerName ? 700 : 400, color: name === playerName ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                      {i + 1}. {name}
                    </span>
                    <span className="score-badge">{score}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Media query styles ── */}
      <style jsx>{`
        @media (max-width: 768px) {
          div[style*="gridTemplateColumns"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
