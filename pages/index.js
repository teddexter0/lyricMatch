import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { signInWithGoogle, logOut, onAuth } from '../lib/firebase';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [tickerIndex, setTickerIndex] = useState(0);

  // Animated letter ticker
  useEffect(() => {
    const t = setInterval(() => setTickerIndex((i) => (i + 1) % ALPHABET.length), 1200);
    return () => clearInterval(t);
  }, []);

  // Restore saved name from localStorage on mount
  useEffect(() => {
    const saved = typeof window !== 'undefined' && localStorage.getItem('lyricmatch_name');
    if (saved) setPlayerName(saved);
  }, []);

  // Firebase auth listener
  useEffect(() => {
    const unsub = onAuth((u) => {
      setUser(u);
      // Only pre-fill from Google if the user hasn't manually set a name
      const saved = typeof window !== 'undefined' && localStorage.getItem('lyricmatch_name');
      if (u && !saved) setPlayerName(u.displayName || '');
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  function handleNameChange(e) {
    // Strip anything that's not a letter, space, apostrophe, or hyphen
    let val = e.target.value.replace(/[^a-zA-Z\s'\-]/g, '');
    // Auto-capitalize first letter
    if (val.length > 0) val = val.charAt(0).toUpperCase() + val.slice(1);
    setPlayerName(val);
    if (typeof window !== 'undefined') localStorage.setItem('lyricmatch_name', val);
  }

  function generateRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  async function handleStart() {
    const name = playerName.trim();
    if (!name) return;
    setLoading(true);
    const id = mode === 'create' ? generateRoomId() : roomId.trim().toUpperCase();
    if (!id) { setLoading(false); return; }
    router.push(`/game/${id}?name=${encodeURIComponent(name)}`);
  }

  async function handleGoogleAuth() {
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="bg-animated" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1.5rem' }}>

        {/* ── Header ── */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className="waveform">
              <span /><span /><span /><span /><span />
            </div>
            <span style={{ fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>
              lyric<span style={{ color: 'var(--accent-green)' }}>Match</span>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {!authLoading && (
              user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {user.photoURL && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.photoURL} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--accent-green)' }} />
                  )}
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{user.displayName}</span>
                  <button className="btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }} onClick={logOut}>
                    Sign out
                  </button>
                </div>
              ) : (
                <button className="btn-secondary" onClick={handleGoogleAuth}>
                  Sign in with Google
                </button>
              )
            )}
          </div>
        </header>

        {/* ── Hero ── */}
        <section style={{ textAlign: 'center', padding: '4rem 0 3rem' }}>

          {/* Animated giant letter */}
          <div className="letter-display" style={{ marginBottom: '1rem' }}>
            {ALPHABET[tickerIndex]}
          </div>

          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 900, lineHeight: 1.1, marginBottom: '1rem' }}>
            Know the lyric,<br />
            <span style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              prove it.
            </span>
          </h1>

          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', maxWidth: 520, margin: '0 auto 2.5rem' }}>
            Each round shows a letter + a music word. Type a real lyric containing
            it, name the artist — Gemini scores your credibility. Spotify plays the song.
          </p>

          {/* Feature chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', justifyContent: 'center', marginBottom: '3rem' }}>
            {[
              { icon: '🤖', label: 'Gemini AI verification' },
              { icon: '🎵', label: 'Spotify playback' },
              { icon: '⚡', label: 'Real-time multiplayer' },
              { icon: '🏆', label: 'Global leaderboard' },
            ].map(({ icon, label }) => (
              <span key={label} style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 999,
                padding: '0.4rem 1rem',
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
              }}>
                {icon} {label}
              </span>
            ))}
          </div>
        </section>

        {/* ── Play card ── */}
        <div className="play-grid">

          {/* Create / Join form */}
          <div className="glass-card" style={{ padding: '2rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '1.5rem' }}>
              {mode === 'create' ? 'Create a room' : 'Join a room'}
            </h2>

            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {['create', 'join'].map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  background: mode === m ? 'var(--accent-green)' : 'rgba(255,255,255,0.06)',
                  color: mode === m ? '#000' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                }}>
                  {m === 'create' ? 'Create' : 'Join'}
                </button>
              ))}
            </div>

            {/* Player name */}
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
              Display name{user && <span style={{ color: 'var(--accent-green)', marginLeft: '0.4rem', fontSize: '0.75rem' }}>← edit me</span>}
            </label>
            <input
              className="lyric-input"
              style={{ marginBottom: '1rem' }}
              placeholder="Enter your name..."
              value={playerName}
              maxLength={20}
              onChange={handleNameChange}
              onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            />

            {/* Room ID (join mode) */}
            {mode === 'join' && (
              <>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Room code
                </label>
                <input
                  className="lyric-input"
                  style={{ marginBottom: '1rem' }}
                  placeholder="e.g. AB12CD"
                  maxLength={6}
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                />
              </>
            )}

            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: '0.5rem' }}
              disabled={!playerName.trim() || loading || (mode === 'join' && roomId.length < 4)}
              onClick={handleStart}
            >
              {loading ? 'Loading...' : mode === 'create' ? 'Create & Play' : 'Join Room'}
            </button>

            {!user && (
              <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
                <span onClick={handleGoogleAuth} style={{ color: 'var(--accent-green)', cursor: 'pointer', textDecoration: 'underline' }}>
                  Sign in with Google
                </span>{' '}
                to save your score to the leaderboard
              </p>
            )}
          </div>

          {/* How to play */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[
              { num: '01', title: 'A letter + word appears', desc: 'Each round the game shows a letter (A→Z) and a random music word starting with it.' },
              { num: '02', title: 'Type a real lyric', desc: 'Type any lyric line from a song you know — like you\'re searching Spotify.' },
              { num: '03', title: 'Name the artist', desc: 'Tell us who sang it. Gemini AI cross-checks your lyric + artist combo.' },
              { num: '04', title: 'Score by confidence', desc: 'Get up to 100% credibility score. Rarer letters = more points. Spotify plays the song!' },
            ].map(({ num, title, desc }) => (
              <div key={num} className="glass-card" style={{ padding: '1.2rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent-green)', opacity: 0.7, paddingTop: 2, flexShrink: 0 }}>{num}</span>
                <div>
                  <p style={{ fontWeight: 700, marginBottom: '0.2rem', fontSize: '0.9rem' }}>{title}</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.5 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <footer style={{ textAlign: 'center', padding: '2rem 0', borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            lyricMatch · Powered by Gemini AI + Spotify · Not affiliated with any music label
          </p>
        </footer>
      </div>
    </div>
  );
}
