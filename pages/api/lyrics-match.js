/**
 * POST /api/lyrics-match
 * Body: { lyricFragment, artistHint, promptWord, letter }
 *
 * Calls Gemini to analyze the lyric and returns a credibility report.
 * No Spotify API — free search links replace it (zero rate limits).
 */

import { analyzeLyric } from '../../lib/gemini';

const LETTER_SCORES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5,
  L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4,
  W: 4, X: 8, Y: 4, Z: 10,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lyricFragment, artistHint, promptWord, letter } = req.body;

  if (!lyricFragment || !promptWord || !letter) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const analysis = await analyzeLyric({ lyricFragment, artistHint: artistHint || '', promptWord });

    const letterScore = LETTER_SCORES[letter.toUpperCase()] || 1;
    const wordBonus = analysis.wordMatch ? 1.5 : 1;
    const artistBonus = analysis.confirmedArtist ? 1.2 : 1;
    const gameScore = Math.round((analysis.confidence / 100) * letterScore * wordBonus * artistBonus * 10);

    // Free search links — no API key, no rate limits
    const songQuery = [analysis.songTitle, analysis.confirmedArtist].filter(Boolean).join(' ')
      || lyricFragment.slice(0, 50);
    const q = encodeURIComponent(songQuery);
    const searchLinks = analysis.confidence >= 30
      ? {
          spotify: `https://open.spotify.com/search/${q}`,
          youtube: `https://music.youtube.com/search?q=${q}`,
          apple: `https://music.apple.com/search?term=${q}`,
        }
      : null;

    return res.status(200).json({ ...analysis, searchLinks, gameScore, letterScore });
  } catch (err) {
    console.error('[lyrics-match]', err);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
}
