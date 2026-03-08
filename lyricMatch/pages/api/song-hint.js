/**
 * POST /api/song-hint
 * Body: { word, usedSongs: string[] }
 *
 * Returns a famous song example containing the given word, excluding
 * any songs already submitted by players this round.
 * Shown as a playful reveal when the round timer runs out.
 */

import { getFamousSongHint } from '../../lib/gemini';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { word, usedSongs } = req.body;
  if (!word) {
    return res.status(400).json({ error: 'Missing word' });
  }

  try {
    const hint = await getFamousSongHint({ word, usedSongs: usedSongs || [] });
    return res.status(200).json(hint);
  } catch (err) {
    console.error('[song-hint]', err);
    return res.status(500).json({ error: 'Could not get hint' });
  }
}
