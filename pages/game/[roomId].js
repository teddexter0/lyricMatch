import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';

const GameBoard = dynamic(() => import('../../components/GameBoard'), { ssr: false });

export default function GameRoom() {
  const router = useRouter();
  const { roomId, name } = router.query;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (roomId && name) setReady(true);
  }, [roomId, name]);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="waveform" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
            <span /><span /><span /><span /><span />
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Connecting to room…</p>
        </div>
      </div>
    );
  }

  return <GameBoard roomId={roomId} playerName={name} />;
}
