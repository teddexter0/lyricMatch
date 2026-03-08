/**
 * Gemini-powered lyrics analysis — server-side only, API key stays private.
 * Uses gemini-2.0-flash (fastest free model, massive music knowledge).
 */

export async function analyzeLyric({ lyricFragment, artistHint, promptWord }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // gemini-2.0-flash: faster + better than 1.5-flash, still on free tier
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are a world-class music scholar with deep knowledge of every genre and era:
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
Prompt word for this round: "${promptWord}"

RULES FOR SCORING:
- Cross every genre and language. A Yoruba Afrobeats lyric is as valid as a Drake line.
- Accept paraphrases / slight misquotes (people rarely remember lyrics perfectly).
- Accept translated lyrics if the original song exists (e.g. Spanish lyrics for a Spanish song is fine).
- If artist is wrong but the lyric is clearly real, set confirmedArtist to the correct one.
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
