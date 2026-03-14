import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  signInWithGoogle, logOut, onAuth,
  getUserProfile, setUsername, validateUsernameFormat, checkUsernameAvailable,
} from '../lib/firebase';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [tickerIndex, setTickerIndex] = useState(0);

  // Username setup modal
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameSaving, setUsernameSaving] = useState(false);

  // Animated letter ticker
  useEffect(() => {
    const t = setInterval(() => setTickerIndex((i) => (i + 1) % ALPHABET.length), 1200);
    return () => clearInterval(t);
  }, []);

  // Firebase auth listener
  useEffect(() => {
    const unsub = onAuth(async (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        const profile = await getUserProfile(u.uid);
        setUserProfile(profile);
        // Pre-fill display name from username or Google name
        if (!playerName) {
          setPlayerName(profile?.username || u.displayName || '');
        }
        // Prompt for username if they don't have one yet
        if (profile && !profile.username) {
          setShowUsernameModal(true);
          setUsernameInput(
            // Suggest a username based on Google display name
            (u.displayName || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || ''
          );
        }
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNameChange(e) {
    let val = e.target.value.replace(/[^a-zA-Z\s'\-]/g, '');
    if (val.length > 0) val = val.charAt(0).toUpperCase() + val.slice(1);
    setPlayerName(val);
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

  // ── Username modal handlers ──────────────────────────────────────────────

  async function handleUsernameChange(e) {
    const val = e.target.value;
    setUsernameInput(val);
    setUsernameError('');

    const formatErr = validateUsernameFormat(val);
    if (formatErr) { setUsernameError(formatErr); return; }

    // Debounced availability check
    setUsernameChecking(true);
    const available = await checkUsernameAvailable(val);
    setUsernameChecking(false);
    if (!available) setUsernameError('That username is already taken.');
  }

  async function handleSaveUsername() {
    if (!user) return;
    setUsernameSaving(true);
    const result = await setUsername(user.uid, usernameInput);
    setUsernameSaving(false);
    if (result.ok) {
      const profile = await getUserProfile(user.uid);
      setUserProfile(profile);
      setPlayerName(profile.username);
      setShowUsernameModal(false);
      setUsernameError('');
    } else {
      setUsernameError(result.error);
    }
  }

  const canSaveUsername = !usernameError && !usernameChecking && usernameInput.length >= 3;

  return (
    <div className="bg-animated" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1.5rem' }}>

        {/* ── Header ── */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className="waveform">
              <span /><span /><span /><span /><span />
            </div>
            <span style={{ fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.02em' }}>
              lyric<span style={{ color: 'var(--accent-green)' }}>Match</span>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {!authLoading && (
              user ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {user.photoURL && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid var(--accent-green)' }} />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                    {userProfile?.username && (
                      <span style={{ color: 'var(--accent-green)', fontSize: '0.95rem', fontWeight: 700, lineHeight: 1 }}>
                        @{userProfile.username}
                      </span>
                    )}
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1 }}>{user.displayName}</span>
                  </div>
                  {!userProfile?.username && (
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.82rem', padding: '0.35rem 0.8rem' }}
                      onClick={() => setShowUsernameModal(true)}
                    >
                      Set username
                    </button>
                  )}
                  {userProfile?.username && (
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.82rem', padding: '0.35rem 0.8rem' }}
                      onClick={() => { setUsernameInput(userProfile.username); setShowUsernameModal(true); }}
                    >
                      Change
                    </button>
                  )}
                  <button className="btn-secondary" style={{ padding: '0.45rem 1.1rem', fontSize: '0.9rem' }} onClick={logOut}>
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
            it, name the artist — Gemini scores your credibility and links you to the song.
          </p>

          {/* Feature chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', justifyContent: 'center', marginBottom: '3rem' }}>
            {[
              { icon: '🤖', label: 'Gemini AI verification' },
              { icon: '🔗', label: 'Song search links' },
              { icon: '⚡', label: 'Real-time multiplayer' },
              { icon: '🏆', label: 'Global leaderboard' },
            ].map(({ icon, label }) => (
              <span key={label} style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 999,
                padding: '0.45rem 1.1rem',
                fontSize: '0.9rem',
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
            <h2 style={{ fontWeight: 700, fontSize: '1.3rem', marginBottom: '1.5rem' }}>
              {mode === 'create' ? 'Create a room' : 'Join a room'}
            </h2>

            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {['create', 'join'].map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{
                  flex: 1,
                  padding: '0.55rem',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  background: mode === m ? 'var(--accent-green)' : 'rgba(255,255,255,0.06)',
                  color: mode === m ? '#000' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                }}>
                  {m === 'create' ? 'Create' : 'Join'}
                </button>
              ))}
            </div>

            {/* Player name */}
            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
              Display name{user && <span style={{ color: 'var(--accent-green)', marginLeft: '0.4rem', fontSize: '0.8rem' }}>← edit me</span>}
            </label>
            <input
              className="lyric-input"
              style={{ marginBottom: '1rem', fontSize: '1rem' }}
              placeholder="Enter your name..."
              value={playerName}
              maxLength={20}
              onChange={handleNameChange}
              onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            />

            {/* Room ID (join mode) */}
            {mode === 'join' && (
              <>
                <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                  Room code
                </label>
                <input
                  className="lyric-input"
                  style={{ marginBottom: '1rem', fontSize: '1rem' }}
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
              style={{ width: '100%', marginTop: '0.5rem', fontSize: '1rem' }}
              disabled={!playerName.trim() || loading || (mode === 'join' && roomId.length < 4)}
              onClick={handleStart}
            >
              {loading ? 'Loading...' : mode === 'create' ? 'Create & Play' : 'Join Room'}
            </button>

            {!user && (
              <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
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
              { num: '02', title: 'Type a real lyric', desc: 'Type any lyric line from a song you know — artist name optional but boosts your score.' },
              { num: '03', title: 'Name the artist', desc: 'Tell us who sang it. Gemini AI cross-checks your lyric + artist combo.' },
              { num: '04', title: 'Score by confidence', desc: 'Get up to 100% credibility score. Rarer letters = more points. Find the song on Spotify, YouTube or Apple Music!' },
            ].map(({ num, title, desc }) => (
              <div key={num} className="glass-card" style={{ padding: '1.2rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent-green)', opacity: 0.7, paddingTop: 2, flexShrink: 0 }}>{num}</span>
                <div>
                  <p style={{ fontWeight: 700, marginBottom: '0.2rem', fontSize: '0.95rem' }}>{title}</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.5 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <footer style={{ textAlign: 'center', padding: '2rem 0', borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            lyricMatch · Powered by Gemini AI · Not affiliated with any music label
          </p>
        </footer>
      </div>

      {/* ── Username setup modal ── */}
      {showUsernameModal && (
        <div className="pause-overlay" onClick={() => setShowUsernameModal(false)}>
          <div
            className="glass-card fade-in-up"
            style={{ padding: '2.5rem', maxWidth: 400, width: 'calc(100% - 3rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.5rem' }}>
              {userProfile?.username ? 'Change username' : 'Choose your username'}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Your username is public, unique, and case-insensitive. 3–20 characters — letters, numbers, <code>_</code> and <code>-</code> only.
              {userProfile?.username && ' Changing it releases your old one.'}
            </p>

            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
              Username
            </label>
            <input
              className="lyric-input"
              style={{ marginBottom: '0.5rem', fontSize: '1rem' }}
              placeholder="e.g. musicnerdbro"
              value={usernameInput}
              maxLength={20}
              onChange={handleUsernameChange}
              autoFocus
            />

            {usernameChecking && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Checking availability…</p>
            )}
            {!usernameChecking && usernameError && (
              <p style={{ fontSize: '0.85rem', color: '#ef4444', marginBottom: '0.75rem' }}>{usernameError}</p>
            )}
            {!usernameChecking && !usernameError && usernameInput.length >= 3 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--accent-green)', marginBottom: '0.75rem' }}>✓ Available!</p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                className="btn-primary"
                style={{ flex: 1 }}
                disabled={!canSaveUsername || usernameSaving}
                onClick={handleSaveUsername}
              >
                {usernameSaving ? 'Saving…' : 'Save username'}
              </button>
              <button className="btn-ghost" onClick={() => setShowUsernameModal(false)}>
                {userProfile?.username ? 'Cancel' : 'Skip for now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
