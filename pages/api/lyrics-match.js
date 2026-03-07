/**
 * POST /api/lyrics-match
 * Body: { lyricFragment, artistHint, promptWord, letter }
 *
 * Calls Gemini to analyze the lyric, then Spotify to find the track.
 * Returns a full credibility report used by the game to score the submission.
 */

import { analyzeLyric } from '../../lib/gemini';
import { searchTrack } from '../../lib/spotify';

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
    // 1. Gemini analysis
    const analysis = await analyzeLyric({ lyricFragment, artistHint: artistHint || '', promptWord });

    // 2. Spotify track lookup (only if Gemini is confident enough)
    let spotifyTrack = null;
    if (analysis.confidence >= 40 && analysis.spotifyQuery) {
      spotifyTrack = await searchTrack(analysis.spotifyQuery);
    }

    // 3. Calculate final game score
    const letterScore = LETTER_SCORES[letter.toUpperCase()] || 1;
    const wordBonus = analysis.wordMatch ? 1.5 : 1;       // 50% bonus for using the prompt word
    const artistBonus = analysis.confirmedArtist ? 1.2 : 1; // 20% bonus for correct artist
    const rawScore = (analysis.confidence / 100) * letterScore * wordBonus * artistBonus;
    const gameScore = Math.round(rawScore * 10); // Scale to game points

    return res.status(200).json({
      ...analysis,
      spotifyTrack,
      gameScore,
      letterScore,
      breakdown: {
        baseScore: letterScore,
        confidenceMultiplier: `${analysis.confidence}%`,
        wordBonus: analysis.wordMatch ? '+50%' : 'none',
        artistBonus: analysis.confirmedArtist ? '+20%' : 'none',
        total: gameScore,
      },
    });
  } catch (err) {
    console.error('[lyrics-match]', err);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
}
