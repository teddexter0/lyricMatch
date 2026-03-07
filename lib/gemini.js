/**
 * Gemini-powered lyrics analysis.
 * Used server-side (in /pages/api/lyrics-match.js) only — API key stays private.
 */

/**
 * Ask Gemini to identify a song from a lyric fragment + artist hint,
 * and return a structured confidence report.
 *
 * @param {object} params
 * @param {string} params.lyricFragment - What the user typed (lyric line/phrase)
 * @param {string} params.artistHint    - Artist name the user supplied
 * @param {string} params.promptWord    - The game's current prompt word (must appear in lyrics)
 * @returns {Promise<{
 *   songTitle: string|null,
 *   confirmedArtist: string|null,
 *   confidence: number,       // 0–100
 *   lyricMatch: boolean,
 *   wordMatch: boolean,       // does the lyric contain the prompt word?
 *   reasoning: string,
 *   spotifyQuery: string,     // pre-built query for Spotify search
 * }>}
 */
export async function analyzeLyric({ lyricFragment, artistHint, promptWord }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const systemPrompt = `You are a music expert with encyclopedic knowledge of songs and lyrics
across all genres and eras (1950s–2025). Your job is to analyze a lyric fragment submitted by
a player in a music trivia game.

GAME RULES FOR CONTEXT:
- The current prompt word is: "${promptWord}" (starting with letter "${promptWord[0].toUpperCase()}")
- The player typed a lyric fragment they believe comes from a real song
- The player also named an artist they believe sang/recorded this song
- You must assess how legitimate their submission is

ANALYZE the following:
Lyric fragment: "${lyricFragment}"
Artist hint: "${artistHint}"
Prompt word: "${promptWord}"

Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{
  "songTitle": "<most likely song title, or null if unidentifiable>",
  "confirmedArtist": "<corrected/confirmed artist name, or null>",
  "confidence": <integer 0-100>,
  "lyricMatch": <true|false — does this lyric plausibly belong to a real song?>,
  "wordMatch": <true|false — does the lyric contain or clearly reference the prompt word "${promptWord}"?>,
  "reasoning": "<1-2 sentence explanation of your confidence score>",
  "spotifyQuery": "<search string optimized for Spotify API, e.g. 'track:Halo artist:Beyonce'>"
}

SCORING GUIDE for confidence:
- 90-100: You can identify the exact song and the lyric is accurate
- 70-89:  You recognize the lyric but have minor uncertainty about artist/title
- 50-69:  The lyric sounds real and plausible but you can't pin it exactly
- 30-49:  The lyric could be real but seems generic or misattributed
- 0-29:   The lyric doesn't match any known song or appears fabricated

IMPORTANT: Be generous with lesser-known songs, regional hits, and non-English songs.
A player naming a deep cut they genuinely know deserves full credit.`;

  const result = await model.generateContent(systemPrompt);
  const text = result.response.text().trim();

  // Strip markdown code fences if Gemini wraps the JSON
  const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}
