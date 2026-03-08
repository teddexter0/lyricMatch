# Grok Prompt — Generate A-Z Music Word Pool (1000+ words per letter)

Use the following prompt with Grok (or any capable LLM) to generate an expanded
music word pool. After generation, paste each letter's array into `/data/wordPool.js`.

---

## PROMPT TO PASTE INTO GROK:

```
You are a music culture expert with encyclopedic knowledge of song lyrics across
all genres: pop, hip-hop, R&B, rap, soul, funk, rock, indie, alternative,
EDM/electronic, country, reggae, jazz, blues, Latin, K-pop, Afrobeats, drill,
trap, lo-fi, punk, metal, and classic hits from the 1950s to 2025.

Your task: Generate a massive, highly curated pool of words for each letter
of the alphabet (A–Z). These words must meet ALL of the following criteria:

1. COMMONLY APPEARS in real song lyrics, song titles, or album names across
   multiple genres and eras.
2. SHORT TO MEDIUM LENGTH — ideally 3–12 characters. Prioritize punchy,
   singable, emotionally resonant words.
3. CULTURALLY DIVERSE — pull from pop, hip-hop, R&B, rock, EDM, country,
   soul, reggae, Latin, Afrobeats, and K-pop equally.
4. NO PROPER NOUNS — avoid artist names, specific song titles, or place names.
   Focus on common vocabulary that APPEARS in lyrics.
5. EMOTIONALLY CHARGED — words that evoke feeling, motion, relationships,
   struggle, joy, heartbreak, confidence, spirituality, night life, hustle.
6. SLANG IS WELCOME — include authentic slang from hip-hop, UK drill, R&B,
   dancehall (e.g., "vibes", "drip", "slay", "gassed", "lit", "flex").
7. AIM FOR 200–500 WORDS PER LETTER (more is always better — I will curate
   the final list).
8. AVOID duplicates within the same letter.

OUTPUT FORMAT (strict JSON, no markdown, no explanation — just raw JSON):

{
  "A": ["word1", "word2", "word3", ...],
  "B": ["word1", "word2", "word3", ...],
  ...
  "Z": ["word1", "word2", "word3", ...]
}

Go letter by letter. Be exhaustive. The more words the better.
Think of every chorus, hook, verse, bridge, and ad-lib you've ever heard.

IMPORTANT: Every word must start with the corresponding letter.
```

---

## After getting Grok's output:

1. Copy the JSON output
2. Open `/data/wordPool.js`
3. Replace each letter's array with Grok's expanded list
4. Run `node -e "import('./data/wordPool.js').then(m => console.log(m.getPoolStats()))"` to verify counts

## Tips for best results:
- Run the prompt 2–3 times per letter group if Grok truncates (split A-M, N-Z)
- Ask Grok to "add 200 more words for letter X that appear in hip-hop lyrics"
- Ask Grok to "add 200 more words for letter X from 2000s R&B and pop ballads"
- Combine all outputs and deduplicate before pasting
