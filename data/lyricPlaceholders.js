/**
 * 120 famous lyric fragments used as rotating input placeholders.
 * Drawn from iconic songs across pop, hip-hop, R&B, rock, soul, afrobeats,
 * K-pop, reggae, country, EDM and more — something for every player.
 *
 * Rotation is managed client-side with a shuffled queue so no two consecutive
 * rounds show the same hint, and the full set cycles before repeating.
 */
export const LYRIC_PLACEHOLDERS = [
  // Pop / mainstream
  "Is this the real life, is this just fantasy",
  "We will, we will rock you",
  "Don't stop believin', hold on to that feeling",
  "I will always love you",
  "Just a small town girl, living in a lonely world",
  "Hit me baby one more time",
  "Like a rolling stone",
  "Every breath you take, every move you make",
  "Hello, is it me you're looking for",
  "I want to dance with somebody who loves me",
  "Purple rain, purple rain",
  "You shake my nerves and you rattle my brain",
  "Shake it off, shake it off",
  "Let it go, let it go, can't hold it back anymore",
  "Baby one more time, I lost my mind",
  "Call me maybe",
  "I kissed a girl and I liked it",
  "Roar, I am the champion",
  "We found love in a hopeless place",
  "Somebody that I used to know",
  // Hip-hop / trap
  "Started from the bottom, now we're here",
  "I got 99 problems but a girl ain't one",
  "Money, cash, hoes, I know everything",
  "Jumpman, jumpman, jumpman — they up to something",
  "God's plan, I hold back, sometimes I won't",
  "They see me rollin', they hatin'",
  "I'm the one, I'm the one",
  "HUMBLE, sit down",
  "Tell me something, girl, are you happy in this modern world",
  "Real friends, how many of us",
  // R&B / soul
  "At last my love has come along",
  "I heard it through the grapevine",
  "What's going on, what's going on",
  "Let's stay together",
  "I feel good, I knew that I would",
  "A change is gonna come",
  "No woman, no cry",
  "One love, one heart, let's get together",
  "Killing me softly with his song",
  "Ain't no mountain high enough",
  // Rock / indie
  "Smells like teen spirit",
  "With or without you",
  "Mr. Brightside, coming out of my cage",
  "Here comes the sun, little darling",
  "Yesterday, all my troubles seemed so far away",
  "Bohemian Rhapsody — mama, just killed a man",
  "I'm a creep, I'm a weirdo",
  "Boulevard of broken dreams, I walk alone",
  "Wake me up when September ends",
  "Seven Nation Army, I'm gonna fight 'em off",
  // EDM / dance
  "One more time, we're gonna celebrate",
  "Don't you worry, don't you worry child",
  "Levels, levels, levels",
  "Blue, da ba dee da ba daa",
  "I'm coming out, I want the world to know",
  "This is what you came for, lightning strikes",
  "Turn down for what",
  "We found love right where we are",
  "Sweet dreams are made of this",
  "Take me to church",
  // Afrobeats / Afropop
  "Soco, soco dance",
  "Lagos to the world",
  "Fall for your type, oh na na na",
  "E be like say na me you dey find",
  "Ye, ye, ye, nobody test me",
  "Ojuelegba, underground authority",
  "Love on the brain, it must be love on the brain",
  "Ke star, ke star ke ke ke star",
  "Essence of you flows through me",
  "Electricity, you give it all to me",
  // K-pop
  "Fire, fire, fire — we gonna light it up",
  "DNA — in my blood and in my heart forever",
  "Dynamite — light it up like dynamite",
  "I got a boy, intrepid and free",
  "Gee gee gee gee baby baby baby",
  "Kill this love, love love love",
  "How you like that, look at you now",
  "Next level, we are the next level",
  "Fancy, I fancy you",
  "Feel special, you are special",
  // Reggae / dancehall
  "One love, one heart, everything's gonna be alright",
  "Could you be loved, and be loved",
  "Buffalo soldier, dreadlock rasta",
  "Redemption song, these songs of freedom",
  "Chant down Babylon one more time",
  "Mr. Vegas, heads high in the air",
  "Dutty wine, dutty wine",
  "Temperature's rising, gimme the loving",
  "Turn me on, make me feel alive",
  "Boom, shake the room",
  // Country
  "Friends in low places where the whiskey drowns",
  "I will always love you, the song that won",
  "Take me home, country roads, to the place I belong",
  "Man of constant sorrow, I've seen trouble all my days",
  "Ring of fire, and it burns burns burns",
  "I'm a ramblin' man",
  "You are the best thing that ever happened to me",
  "Before he cheats, I dug my key into the side",
  "Need you now, it's a quarter after one",
  "Wagon wheel, rock me mama",
  // Latin
  "Livin' la vida loca, she'll push and pull you down",
  "Despacito, quiero respirar tu cuello despacito",
  "La bamba, la bamba, la bamba",
  "Gasolina, dame mas gasolina",
  "Taki taki rumba, taki taki",
  "Con calma y con cuidado",
  "Malamente, capitana de mi corazon",
  "Un verano sin ti, all summer long",
  "Me porto bonito contigo",
  "Pepas, pepas, rompe, rompe",
  // Throwbacks
  "Superstition, writing's on the wall",
  "Living on a prayer, whoa-oh we're halfway there",
  "Jump, for my love",
  "Time after time, if you're lost you can look",
  "Girls just want to have fun",
  "Everybody wants to rule the world",
  "Don't you forget about me",
  "Take on me, I'll be gone in a day",
  "Wake me up before you go-go",
  "Hungry like the wolf, strut on a line",
];

/**
 * Returns a shuffled copy of LYRIC_PLACEHOLDERS.
 * Store the result in a ref and pop() from it each round.
 */
export function shuffledPlaceholders() {
  const arr = [...LYRIC_PLACEHOLDERS];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
