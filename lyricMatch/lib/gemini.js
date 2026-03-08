/**
 * Gemini-powered lyrics analysis — server-side only, API key stays private.
 * Uses gemini-2.0-flash (fastest free model, massive music knowledge).
 */

export async function analyzeLyric({ lyricFragment, artistHint, songTitleHint, promptWord }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const songHintLine = songTitleHint
    ? `Song title hint (extracted from player's input): "${songTitleHint}"`
    : '';

  const prompt = `You are a world-class music scholar with encyclopedic knowledge of every genre and era:
pop, hip-hop, R&B, soul, rock, punk, metal, indie, folk, country, EDM, house, techno,
reggae, dancehall, afrobeats, amapiano, highlife, bongo flava, soca, latin (reggaeton,
cumbia, bachata, salsa), K-pop, J-pop, Bollywood, Mandopop, Brazilian funk, Turkish pop,
Arabic pop, French chanson, Nigerian afropop, UK grime, drill, garage, and global hits
from 1950s to 2025. You can identify songs even from partial, paraphrased, or translated lyrics.

TASK: A player submitted this lyric in a music trivia game. Assess whether it comes from a
real song, identify it if possible, and score credibility.

INPUT:
Lyric fragment: "${lyricFragment}"
Artist they named: "${artistHint || '(not provided)'}"
${songHintLine}
Prompt word for this round: "${promptWord}"

ARTIST FIELD RULES (critical):
- Players often type in search-engine style: "Ariana Grande", "Bang Bang Ariana Grande",
  or just a song title. Accept all these formats.
- A separate song title hint may be provided if the player typed "Artist - Song" format.
  Use it as strong additional evidence to identify the correct track.
- For collaboration tracks (e.g. Jessie J, Ariana Grande & Nicki Minaj on "Bang Bang"),
  accepting ANY of the featured artists is fully valid.
- Accept common artist nicknames (Drake, Ye/Kanye, MJ, Bey, Riri, Dua, Biebs, etc.)
- If the artist is wrong but the lyric is clearly real, STILL validate the lyric —
  set confirmedArtist to the correct one and award appropriate confidence.
- The LYRIC is the primary evidence; artist is a supporting hint only.

LYRIC VALIDATION RULES:
- Cross every genre and language. A Yoruba Afrobeats lyric is as valid as a Drake line.
- Accept paraphrases / slight misquotes (people rarely remember lyrics perfectly).
- Accept translated lyrics if the original song exists in that language.
- Do NOT penalise for obscure or non-English songs — reward genuine knowledge.
- wordMatch = true if the lyric contains the prompt word OR a conjugated/translated form of it.

CONFIDENCE SCALE:
90-100 → Identified exact song, lyric is accurate or very close
70-89  → Strong match, minor wording uncertainty or artist ambiguity
50-69  → Lyric pattern sounds real and plausible, can't pin exact song
30-49  → Possibly real but too generic or significantly misattributed
0-29   → Appears fabricated, nonsensical, or matches no known song

Return ONLY raw JSON (no markdown fences, no extra text):
{
  "songTitle": "<exact song title or null>",
  "confirmedArtist": "<correct artist name or null>",
  "confidence": <0-100 integer>,
  "lyricMatch": <true|false>,
  "wordMatch": <true|false>,
  "reasoning": "<1-2 sentences explaining the score — mention genre/language if relevant>"
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const cleaned = text.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Get a famous well-known song example for a given word (shown as hint on round end).
 * Excludes songs already used as answers this game.
 */
export async function getFamousSongHint({ word, usedSongs = [] }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const exclude = usedSongs.length > 0
    ? `Do NOT use any of these songs (already submitted by players this round): ${usedSongs.join(', ')}.`
    : '';

  const prompt = `Give me ONE extremely famous, universally-recognised song where the word "${word}" clearly appears in the lyrics.
${exclude}
Pick a massive chart hit or timeless classic that almost anyone would know.

Return ONLY raw JSON (no markdown fences):
{
  "songTitle": "<song title>",
  "artist": "<main artist or group>",
  "lyricLine": "<the exact lyric line containing the word '${word}'>",
  "joke": "<a short playful quip, max 8 words, e.g. 'Hidden in plain sight!' or 'Right under your nose the whole time!'>"
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const cleaned = text.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}
