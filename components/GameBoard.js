import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { io } from 'socket.io-client';
import { onAuth, submitGameScore } from '../lib/firebase';
import { shuffledPlaceholders } from '../data/lyricPlaceholders';
import { shuffledFacts } from '../data/musicFacts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ROUND_TIME = 60;

// ── ConfidenceMeter ──────────────────────────────────────────────────────────
function ConfidenceMeter({ value }) {
  const raw = Number(value);
  const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
  const cls = pct >= 70 ? 'confidence-high' : pct >= 40 ? 'confidence-mid' : 'confidence-low';
  const color = pct >= 70 ? '#1db954' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Credibility</span>
        <span style={{ fontSize: '1rem', fontWeight: 700, color }}>{pct}%</span>
      </div>
      <div className="confidence-bar">
        <div className={`confidence-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── SearchLinks ──────────────────────────────────────────────────────────────
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
            padding: '0.35rem 1rem',
            fontSize: '0.85rem',
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

// ── PlayerCard ───────────────────────────────────────────────────────────────
function PlayerCard({ name, score, isYou, submission, skipped }) {
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
          fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: 999,
        }}>YOU</span>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ fontWeight: 700, fontSize: '1rem' }}>{name}</p>
        <span className="score-badge">{score} pts</span>
      </div>

      {skipped && !hasResult && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          ⏭ Skipped this round
        </p>
      )}

      {pending && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          ⏳ Verifying…
        </p>
      )}

      {hasResult && !skipped && (
        <div style={{ marginTop: '0.6rem' }}>
          <ConfidenceMeter value={confidence} />
          {submission.result.songTitle && (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              🎵 {submission.result.songTitle}
              {submission.result.confirmedArtist && ` — ${submission.result.confirmedArtist}`}
            </p>
          )}
          {submission.result.wordMatch && (
            <p style={{ fontSize: '0.8rem', color: 'var(--accent-green)', marginTop: '0.2rem' }}>
              ✓ Contains the prompt word (+50% bonus earned)
            </p>
          )}
        </div>
      )}

      {!pending && !hasResult && !skipped && (
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.2)', marginTop: '0.4rem' }}>
          Waiting…
        </p>
      )}
    </div>
  );
}

// ── DYK Popup ────────────────────────────────────────────────────────────────
function DykPopup({ fact, onClose }) {
  if (!fact) return null;
  return (
    <div className="dyk-popup">
      <button className="dyk-popup-close" onClick={onClose} aria-label="Close">×</button>
      <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent-purple)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
        🎵 Did You Know?
      </p>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.55 }}>{fact}</p>
    </div>
  );
}

// ── Main GameBoard ────────────────────────────────────────────────────────────
export default function GameBoard({ roomId, playerName }) {
  const router = useRouter();
  const socketRef = useRef(null);
  const [user, setUser] = useState(null);

  // Game state
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState({});
  const [skippedPlayers, setSkippedPlayers] = useState({});
  const [currentLetterIndex, setCurrentLetterIndex] = useState(0);
  const [currentWord, setCurrentWord] = useState('');
  const [timer, setTimer] = useState(ROUND_TIME);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [isPaused, setIsPaused] = useState(false);

  // Submissions (all players)
  const [submissions, setSubmissions] = useState({});

  // My submission form
  const [lyric, setLyric] = useState('');
  const [artist, setArtist] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Round result overlay
  const [roundResults, setRoundResults] = useState(null);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const [myLastResult, setMyLastResult] = useState(null);

  // Dynamic placeholder queue (shuffled, non-repeating)
  const placeholderQueueRef = useRef([]);
  const [currentPlaceholder, setCurrentPlaceholder] = useState('e.g. "Yesterday, all my troubles seemed so far away…"');

  // DYK fact queue
  const factQueueRef = useRef([]);
  const [dykFact, setDykFact] = useState(null);
  const [showDyk, setShowDyk] = useState(false);

  // Forfeit confirm dialog
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);

  // Auth
  useEffect(() => {
    const unsub = onAuth(setUser);
    return unsub;
  }, []);

  // Initialise placeholder queue
  useEffect(() => {
    placeholderQueueRef.current = shuffledPlaceholders();
    factQueueRef.current = shuffledFacts();
  }, []);

  function popPlaceholder() {
    if (placeholderQueueRef.current.length === 0) {
      placeholderQueueRef.current = shuffledPlaceholders();
    }
    setCurrentPlaceholder(placeholderQueueRef.current.pop());
  }

  function popFact() {
    if (factQueueRef.current.length === 0) {
      factQueueRef.current = shuffledFacts();
    }
    return factQueueRef.current.pop();
  }

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
      setSkipped(false);
      setAnalyzing(false);
      setSubmissions({});
      setSkippedPlayers({});
      setShowRoundResult(false);
      setMyLastResult(null);
      setShowDyk(false);
      setIsPaused(false);
      popPlaceholder();
    });

    socket.on('timer-update', ({ timer: t }) => setTimer(t));

    socket.on('game-paused', () => setIsPaused(true));
    socket.on('game-resumed', ({ timer: t }) => { setIsPaused(false); setTimer(t); });

    socket.on('submission-received', ({ playerName: pn }) => {
      setSubmissions((prev) => ({ ...prev, [pn]: { ...prev[pn], pending: true } }));
    });

    socket.on('player-skipped', ({ playerName: pn }) => {
      setSkippedPlayers((prev) => ({ ...prev, [pn]: true }));
    });

    socket.on('player-scored', ({ playerName: pn, pts, result }) => {
      setScores((prev) => ({ ...prev, [pn]: (prev[pn] || 0) + pts }));
      setSubmissions((prev) => ({ ...prev, [pn]: { ...prev[pn], result, pending: false } }));
      if (pn === playerName) {
        setMyLastResult(result);
      }
    });

    socket.on('round-complete', ({ submissions: subs, scores: sc }) => {
      setSubmissions(subs);
      setScores(sc);
      setShowRoundResult(true);
      setRoundResults(subs);
      // Show DYK fact after round ends
      const fact = popFact();
      setDykFact(fact);
      setTimeout(() => setShowDyk(true), 800);
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

    socket.on('player-forfeited', ({ playerName: pn }) => {
      setPlayers((prev) => prev.filter((p) => p !== pn));
    });

    // Server asks client to call /api/lyrics-match
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
        socket.emit('lyric-result', { roomId: rid, playerName: pn, result: { confidence: 0, gameScore: 0, lyricMatch: false, wordMatch: false } });
      } finally {
        setAnalyzing(false);
      }
    });

    socket.on('player-left', ({ playerName: pn }) => {
      setPlayers((prev) => prev.filter((p) => p !== pn));
    });

    return () => socket.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, playerName]);

  // Keep user ref fresh for game-complete handler
  useEffect(() => {
    if (!socketRef.current) return;
    const socket = socketRef.current;
    const handler = ({ winner: w, scores: sc }) => {
      setScores(sc);
      setWinner(w);
      setGameOver(true);
      if (user) {
        const myScore = sc[playerName] || 0;
        submitGameScore(user.uid, myScore).catch(console.error);
      }
    };
    socket.off('game-complete');
    socket.on('game-complete', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function startGame() {
    socketRef.current?.emit('start-game', { roomId });
  }

  function submitLyric() {
    if (!lyric.trim() || submitted || skipped) return;
    setSubmitted(true);
    socketRef.current?.emit('submit-lyric', { roomId, playerName, lyric: lyric.trim(), artist: artist.trim() });
  }

  function skipTurn() {
    if (submitted || skipped) return;
    setSkipped(true);
    setSubmitted(true); // treat as acted
    socketRef.current?.emit('skip-turn', { roomId, playerName });
  }

  function togglePause() {
    if (isPaused) {
      socketRef.current?.emit('resume-game', { roomId });
    } else {
      socketRef.current?.emit('pause-game', { roomId });
    }
  }

  function confirmForfeit() {
    setShowForfeitConfirm(false);
    socketRef.current?.emit('forfeit', { roomId, playerName });
    router.push('/');
  }

  const currentLetter = ALPHABET[currentLetterIndex];
  const timerPct = (timer / ROUND_TIME) * 100;
  const timerColor = timer > 20 ? '#1db954' : timer > 10 ? '#f59e0b' : '#ef4444';

  // ── Game over screen ─────────────────────────────────────────────────────
  if (gameOver) {
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="glass-card fade-in-up" style={{ maxWidth: 500, width: '100%', padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>🏆</div>
          <h1 style={{ fontWeight: 900, fontSize: '2.2rem', marginBottom: '0.25rem' }}>
            {winner === playerName ? 'You won!' : `${winner} wins!`}
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '1rem' }}>Final scores</p>

          <div style={{ marginBottom: '2rem' }}>
            {sorted.map(([name, score], i) => (
              <div key={name} className="leaderboard-row">
                <span className={`rank-badge ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other'}`}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, textAlign: 'left', fontWeight: name === playerName ? 700 : 400, fontSize: '1rem' }}>
                  {name} {name === playerName && '(you)'}
                </span>
                <span className="score-badge">{score} pts</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="btn-primary" onClick={() => { window.location.href = `/game/${roomId}?name=${playerName}`; }}>
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

  // ── Lobby ────────────────────────────────────────────────────────────────
  if (!gameStarted) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="glass-card fade-in-up" style={{ maxWidth: 480, width: '100%', padding: '2.5rem', textAlign: 'center' }}>
          <div className="waveform" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
            <span /><span /><span /><span /><span />
          </div>
          <h2 style={{ fontWeight: 800, fontSize: '1.6rem', marginBottom: '0.5rem' }}>
            Room{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--accent-green)', letterSpacing: '0.12em', fontSize: '1.7rem' }}>
              {roomId}
            </span>
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: '1.5rem' }}>
            Share this code with friends to play together
          </p>

          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Players in room ({players.length})
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
              {players.map((p) => (
                <span key={p} style={{
                  background: p === playerName ? 'rgba(29, 185, 84, 0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${p === playerName ? 'rgba(29, 185, 84, 0.4)' : 'var(--border-subtle)'}`,
                  borderRadius: 999, padding: '0.35rem 1rem',
                  fontSize: '0.95rem', fontWeight: p === playerName ? 700 : 400,
                  color: p === playerName ? 'var(--accent-green)' : 'var(--text-primary)',
                }}>
                  {p} {p === playerName ? '(you)' : ''}
                </span>
              ))}
            </div>
          </div>

          <button className="btn-primary" style={{ width: '100%' }} onClick={startGame}>
            Start game →
          </button>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
            Game starts for everyone when you click start
          </p>
        </div>
      </div>
    );
  }

  // ── Main game ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '1.5rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="waveform">
              <span /><span /><span /><span /><span />
            </div>
            <span style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
              lyric<span style={{ color: 'var(--accent-green)' }}>Match</span>
            </span>
          </div>

          {/* Room code — bigger now */}
          <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontFamily: 'monospace', letterSpacing: '0.08em' }}>
            Room: <strong style={{ color: 'var(--accent-green)', fontSize: '1.05rem' }}>{roomId}</strong>
          </span>

          {/* Pause / forfeit controls */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="btn-ghost" onClick={togglePause} title={isPaused ? 'Resume game' : 'Pause game'}>
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button className="btn-danger" onClick={() => setShowForfeitConfirm(true)} title="Forfeit game">
              🏳 Forfeit
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
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                Round {currentLetterIndex + 1} of 26
              </p>
              <div className="letter-display">{currentLetter}</div>
              <div style={{ marginTop: '0.75rem' }}>
                <span className="prompt-word">{currentWord}</span>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                Type a lyric containing{' '}
                <strong style={{ color: '#c4b5fd' }}>&ldquo;{currentWord}&rdquo;</strong>{' '}
                for <strong style={{ color: 'var(--accent-green)' }}>+50% bonus</strong>
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
                    stroke={isPaused ? '#8b5cf6' : timerColor}
                    strokeWidth="6"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - timerPct / 100)}`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
                  />
                </svg>
                <div className="timer-text" style={{ color: isPaused ? '#8b5cf6' : timerColor }}>
                  {isPaused ? '⏸' : timer}
                </div>
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: '1rem' }}>{isPaused ? 'Paused' : 'Time left'}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  {isPaused ? 'Press Resume to continue' : submitted ? 'Submitted! Waiting…' : 'Type fast!'}
                </p>
              </div>
            </div>

            {/* Input form */}
            {!submitted ? (
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Type a lyric you know
                </label>
                <textarea
                  className="lyric-input"
                  rows={3}
                  placeholder={currentPlaceholder}
                  value={lyric}
                  onChange={(e) => setLyric(e.target.value)}
                  style={{ marginBottom: '0.75rem', fontSize: '1rem' }}
                  disabled={isPaused}
                />

                <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Artist / band name
                </label>
                <input
                  className="lyric-input"
                  placeholder="e.g. Queen"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitLyric()}
                  style={{ marginBottom: '1rem', fontSize: '1rem' }}
                  disabled={isPaused}
                />

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    className="btn-primary"
                    style={{ flex: 1 }}
                    disabled={!lyric.trim() || timer === 0 || isPaused}
                    onClick={submitLyric}
                  >
                    Submit →
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={timer === 0 || isPaused}
                    onClick={skipTurn}
                    title="Skip this round (0 points)"
                  >
                    ⏭ Skip
                  </button>
                </div>
              </div>
            ) : (
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                {skipped ? (
                  <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                    <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏭</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>Skipped — 0 points this round.</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.3rem' }}>Waiting for others to finish…</p>
                  </div>
                ) : analyzing ? (
                  <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                    <div className="waveform" style={{ justifyContent: 'center', marginBottom: '0.75rem' }}>
                      <span /><span /><span /><span /><span />
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>Gemini is verifying your lyric…</p>
                  </div>
                ) : myLastResult ? (
                  <div className="slide-in-right">
                    <ConfidenceMeter value={myLastResult.confidence} />
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.75rem', lineHeight: 1.5 }}>
                      {myLastResult.reasoning}
                    </p>
                    {myLastResult.songTitle && (
                      <p style={{ marginTop: '0.5rem', fontWeight: 700, fontSize: '1rem' }}>
                        🎵 {myLastResult.songTitle} — {myLastResult.confirmedArtist}
                      </p>
                    )}
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {myLastResult.wordMatch && <span className="score-badge">✓ Word match (+50%)</span>}
                      {myLastResult.confirmedArtist && <span className="score-badge">✓ Artist confirmed</span>}
                    </div>
                    <p style={{ marginTop: '0.75rem', fontSize: '1rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                      +{myLastResult.gameScore || 0} points
                    </p>
                    <SearchLinks links={myLastResult.searchLinks} />
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0', fontSize: '1rem' }}>
                    Submitted! Waiting for results…
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Right: Players ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Players — {players.length}
            </p>
            {players.map((p) => (
              <PlayerCard
                key={p}
                name={p}
                score={scores[p] || 0}
                isYou={p === playerName}
                submission={submissions[p]}
                skipped={skippedPlayers[p]}
                currentLetter={currentLetter}
              />
            ))}

            {/* Score summary */}
            <div className="glass-card" style={{ padding: '1rem 1.2rem', marginTop: '0.5rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Standings</p>
              {Object.entries(scores)
                .sort(([, a], [, b]) => b - a)
                .map(([name, score], i) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: name === playerName ? 700 : 400, color: name === playerName ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                      {i + 1}. {name}
                    </span>
                    <span className="score-badge">{score}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Pause overlay ── */}
      {isPaused && (
        <div className="pause-overlay">
          <div className="glass-card" style={{ padding: '3rem 2.5rem', textAlign: 'center', maxWidth: 380 }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⏸</div>
            <h2 style={{ fontWeight: 800, fontSize: '1.8rem', marginBottom: '0.5rem' }}>Game Paused</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '1rem' }}>
              Take your time — the timer is frozen.
            </p>
            <button className="btn-primary" style={{ width: '100%' }} onClick={togglePause}>
              ▶ Resume Game
            </button>
          </div>
        </div>
      )}

      {/* ── Forfeit confirm ── */}
      {showForfeitConfirm && (
        <div className="pause-overlay" onClick={() => setShowForfeitConfirm(false)}>
          <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center', maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏳</div>
            <h2 style={{ fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.5rem' }}>Forfeit game?</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.95rem' }}>
              You'll leave the game and return to the home screen. Your score won't be saved.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="btn-danger" onClick={confirmForfeit}>Yes, forfeit</button>
              <button className="btn-ghost" onClick={() => setShowForfeitConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── DYK Fact popup ── */}
      {showDyk && <DykPopup fact={dykFact} onClose={() => setShowDyk(false)} />}

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
