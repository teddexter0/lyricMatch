import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { io } from 'socket.io-client';
import { onAuth, submitGameScore } from '../lib/firebase';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ROUND_TIME = 60;

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

function SpotifyPlayer({ track, autoConsent }) {
  const [consented, setConsented] = useState(autoConsent);
  if (!track) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      {!consented ? (
        <div style={{
          background: 'rgba(29, 185, 84, 0.08)',
          border: '1px solid rgba(29, 185, 84, 0.3)',
          borderRadius: 12,
          padding: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {track.albumArt && <img src={track.albumArt} alt="" style={{ width: 48, height: 48, borderRadius: 6 }} />}
            <div>
              <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>{track.title}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{track.artist}</p>
            </div>
          </div>
          <button
            className="btn-primary"
            style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
            onClick={() => setConsented(true)}
          >
            ▶ Play on Spotify
          </button>
        </div>
      ) : (
        <div className="spotify-embed-wrapper">
          <iframe
            src={track.embedUrl}
            width="100%"
            height="80"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}

function PlayerCard({ name, score, isYou, submission, currentLetter }) {
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

  // Spotify
  const [spotifyTrack, setSpotifyTrack] = useState(null);

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
    });

    socket.on('new-round', ({ letter, word, letterIndex, timer: t }) => {
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
      setSpotifyTrack(null);
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
        if (result.spotifyTrack) setSpotifyTrack(result.spotifyTrack);
      }
    });

    socket.on('round-complete', ({ submissions: subs, scores: sc }) => {
      setSubmissions(subs);
      setScores(sc);
      setShowRoundResult(true);
      setRoundResults(subs);
    });

    socket.on('game-complete', ({ winner: w, scores: sc }) => {
      setScores(sc);
      setWinner(w);
      setGameOver(true);
      // Save score to Firebase
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
        if (result.spotifyTrack) setSpotifyTrack(result.spotifyTrack);
        setMyLastResult(result);
      } catch (e) {
        console.error(e);
        socket.emit('lyric-result', { roomId: rid, playerName: pn, result: { confidence: 0, gameScore: 0, lyricMatch: false } });
      } finally {
        setAnalyzing(false);
      }
    });

    socket.on('player-left', ({ playerName: pn }) => {
      setPlayers((prev) => prev.filter((p) => p !== pn));
    });

    return () => socket.disconnect();
  }, [roomId, playerName]);

  function startGame() {
    socketRef.current?.emit('start-game', { roomId });
  }

  function submitLyric() {
    if (!lyric.trim() || submitted) return;
    setSubmitted(true);
    socketRef.current?.emit('submit-lyric', { roomId, playerName, lyric: lyric.trim(), artist: artist.trim() });
  }

  const currentLetter = ALPHABET[currentLetterIndex];
  const timerPct = (timer / ROUND_TIME) * 100;
  const timerColor = timer > 20 ? '#1db954' : timer > 10 ? '#f59e0b' : '#ef4444';

  // ── Game over screen ────────────────────────────────────────────────────────
  if (gameOver) {
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="glass-card fade-in-up" style={{ maxWidth: 500, width: '100%', padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🏆</div>
          <h1 style={{ fontWeight: 900, fontSize: '2rem', marginBottom: '0.25rem' }}>
            {winner === playerName ? 'You won!' : `${winner} wins!`}
          </h1>
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

  // ── Lobby ────────────────────────────────────────────────────────────────────
  if (!gameStarted) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
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

          <button className="btn-primary" style={{ width: '100%' }} onClick={startGame}>
            Start game →
          </button>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.75rem' }}>
            Game starts for everyone when you click start
          </p>
        </div>
      </div>
    );
  }

  // ── Main game ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '1.5rem' }}>
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
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            Room: {roomId}
          </span>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>

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
                Type a lyric containing <strong style={{ color: '#c4b5fd' }}>"{currentWord}"</strong> for +50% bonus
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
                  {submitted ? 'Submitted! Waiting…' : 'Type fast!'}
                </p>
              </div>
            </div>

            {/* Input form */}
            {!submitted ? (
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Type a lyric you know
                </label>
                <textarea
                  className="lyric-input"
                  rows={3}
                  placeholder={`e.g. "Is this the real life, is this just fantasy…"`}
                  value={lyric}
                  onChange={(e) => setLyric(e.target.value)}
                  style={{ marginBottom: '0.75rem' }}
                />

                <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Artist / band name
                </label>
                <input
                  className="lyric-input"
                  placeholder="e.g. Queen"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitLyric()}
                  style={{ marginBottom: '1rem' }}
                />

                <button
                  className="btn-primary"
                  style={{ width: '100%' }}
                  disabled={!lyric.trim() || timer === 0}
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
                    {spotifyTrack && <SpotifyPlayer track={spotifyTrack} autoConsent={false} />}
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
                currentLetter={currentLetter}
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
