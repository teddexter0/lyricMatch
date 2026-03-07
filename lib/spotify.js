/**
 * Spotify Web API helpers (server-side, credentials stay private).
 * Uses Client Credentials flow — no user login required for search/embed.
 * For actual playback (Spotify Connect), the user would need to auth separately.
 */

let _tokenCache = null;

async function getAccessToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) {
    return _tokenCache.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`Spotify token fetch failed: ${response.status}`);
  }

  const data = await response.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return _tokenCache.token;
}

/**
 * Search Spotify for a track.
 * @param {string} query - Spotify search query (e.g. "track:Halo artist:Beyonce")
 * @returns {Promise<SpotifyTrack|null>}
 */
export async function searchTrack(query) {
  try {
    const token = await getAccessToken();
    const params = new URLSearchParams({ q: query, type: 'track', limit: '1' });
    const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const track = data.tracks?.items?.[0];
    if (!track) return null;

    return {
      id: track.id,
      title: track.name,
      artist: track.artists.map((a) => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images?.[0]?.url || null,
      previewUrl: track.preview_url,           // 30s MP3 preview (may be null)
      spotifyUrl: track.external_urls.spotify, // Full song link
      embedUrl: `https://open.spotify.com/embed/track/${track.id}?utm_source=generator&theme=0`,
    };
  } catch {
    return null;
  }
}
