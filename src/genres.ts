export interface BeatlyVariant {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface BeatlyGenre {
  readonly id: BeatlyGenreId;
  readonly label: string;
  readonly bpm: number;
  readonly tags: readonly string[];
  readonly description: string;
  readonly defaultVariant: string;
  readonly variants: readonly BeatlyVariant[];
}

export type BeatlyGenreId =
  | "ambient"
  | "calming"
  | "deepFocus"
  | "lofi"
  | "jazzNoir"
  | "techno"
  | "dnb"
  | "dub"
  | "uplift"
  | "neoSoul"
  | "dreamPop"
  | "soulHop"
  | "cityPop"
  | "bossaNova"
  | "chillHouse"
  | "rainyPiano"
  | "sunsetGroove";

// Each genre has a set of named variants. The first variant listed is the
// default (matches the runtime in supercollider/music.js).
export const BEATLY_GENRES: readonly BeatlyGenre[] = [
  {
    id: "ambient",
    label: "Ambient",
    bpm: 60,
    tags: ["background", "spacious", "slow"],
    description: "Wide, slow, minimal motion for low-distraction sessions.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic", description: "Wide lydian wash." },
      { id: "abyss", label: "Abyss", description: "Deep, dark aeolian expanse." },
      { id: "cathedral", label: "Cathedral", description: "Very long reverb, slow motion." },
      { id: "glacial", label: "Glacial", description: "48 bpm — barely moving." },
      { id: "pastoral", label: "Pastoral", description: "Higher, brighter lydian." },
      { id: "voidwalk", label: "Voidwalk", description: "Low phrygian, cavernous." },
    ],
  },
  {
    id: "calming",
    label: "Calming",
    bpm: 70,
    tags: ["gentle", "lydian", "soft"],
    description: "Warm pads and light motion for stressful or blocked moments.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "warmth", label: "Warmth", description: "Warmer pad, ninth chords." },
      { id: "rain", label: "Rain", description: "Shimmer and slow delay." },
      { id: "cloudland", label: "Cloudland", description: "Very slow, long chords." },
      { id: "hymn", label: "Hymn", description: "Major pentatonic, higher tonic." },
      { id: "mist", label: "Mist", description: "Dorian haze." },
    ],
  },
  {
    id: "deepFocus",
    label: "Deep Focus",
    bpm: 86,
    tags: ["steady", "dorian", "focused"],
    description: "Sparse groove and stable harmony for sustained coding focus.",
    defaultVariant: "dorian",
    variants: [
      { id: "dorian", label: "Dorian", description: "The default steady groove." },
      { id: "phrygian", label: "Phrygian", description: "Darker mode." },
      { id: "minimal", label: "Minimal", description: "No drums, sparse lead." },
      { id: "driving", label: "Driving", description: "Four-on-the-floor kick." },
      { id: "pulse", label: "Pulse", description: "Slightly faster, no swing." },
      { id: "nocturne", label: "Nocturne", description: "Low aeolian late-night." },
    ],
  },
  {
    id: "lofi",
    label: "Lo-Fi",
    bpm: 78,
    tags: ["laid-back", "swing", "beats"],
    description: "Relaxed beat-driven profile for everyday coding sessions.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "night", label: "Night", description: "Slower, warmer, lower tonic." },
      { id: "crate", label: "Crate", description: "Dustier, more swing." },
      { id: "sunday", label: "Sunday", description: "Major pentatonic sweetness." },
      { id: "jazzy", label: "Jazzy", description: "Ninth chords, dorian swing." },
      { id: "tape", label: "Tape", description: "Saturated, longer delay." },
    ],
  },
  {
    id: "jazzNoir",
    label: "Jazz Noir",
    bpm: 96,
    tags: ["jazzy", "ride", "walking-bass"],
    description: "Smoky late-night groove with more movement and color.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "ballad", label: "Ballad", description: "Slower, rubato feel." },
      { id: "uptempo", label: "Uptempo", description: "Faster, busier lead." },
      { id: "rhodes", label: "Rhodes", description: "Warmer pad, extended chords." },
      { id: "blue", label: "Blue", description: "Blues scale colors." },
      { id: "afterhours", label: "After Hours", description: "Lower register, warmer." },
    ],
  },
  {
    id: "techno",
    label: "Techno",
    bpm: 128,
    tags: ["driving", "phrygian", "club"],
    description: "Fast, steady four-on-the-floor energy.",
    defaultVariant: "driving",
    variants: [
      { id: "driving", label: "Driving", description: "Classic four-on-the-floor." },
      { id: "dub", label: "Dub", description: "Echoey, looser." },
      { id: "melodic", label: "Melodic", description: "Minor, chord-led." },
      { id: "acid", label: "Acid", description: "Darker pad, more lead." },
      { id: "minimal", label: "Minimal", description: "Stripped-back pattern." },
      { id: "peak", label: "Peak", description: "Faster, peak-time energy." },
    ],
  },
  {
    id: "dnb",
    label: "DnB",
    bpm: 174,
    tags: ["fast", "breakbeat", "sub"],
    description: "High-energy profile for crunch time and momentum bursts.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "liquid", label: "Liquid", description: "Warmer, dorian, ninth chords." },
      { id: "neuro", label: "Neuro", description: "Darker, more aggressive." },
      { id: "jungle", label: "Jungle", description: "Chopped breakbeat." },
      { id: "atmospheric", label: "Atmospheric", description: "Lead pulled back, more air." },
      { id: "halftime", label: "Halftime", description: "Half-time feel at 86 bpm." },
    ],
  },
  {
    id: "dub",
    label: "Dub",
    bpm: 75,
    tags: ["echo", "space", "bass"],
    description: "Dubby low-end with roomy FX and slower pacing.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "roots", label: "Roots", description: "Slower, warmer, dorian." },
      { id: "echo", label: "Echo", description: "Longer delay, bigger reverb." },
      { id: "stepper", label: "Stepper", description: "One-drop shifted rhythm." },
      { id: "meditative", label: "Meditative", description: "62 bpm, minimal lead." },
      { id: "digital", label: "Digital", description: "Phrygian, higher tonic." },
    ],
  },
  {
    id: "uplift",
    label: "Uplift",
    bpm: 122,
    tags: ["positive", "bright", "forward"],
    description: "Brighter, more energetic profile for wins and progress moments.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "euphoric", label: "Euphoric", description: "Faster with ninth colors." },
      { id: "anthem", label: "Anthem", description: "Lead-forward, warmer." },
      { id: "gospel", label: "Gospel", description: "Major pentatonic." },
      { id: "dawn", label: "Dawn", description: "Slower, warmer." },
      { id: "stadium", label: "Stadium", description: "Big, drier mix." },
    ],
  },
  {
    id: "neoSoul",
    label: "Neo Soul",
    bpm: 84,
    tags: ["groove", "warm", "syncopated"],
    description: "Warm chords and syncopated rhythm with more personality.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "dusty", label: "Dusty", description: "More swing, warmer pad." },
      { id: "smooth", label: "Smooth", description: "Slower ninth chords." },
      { id: "rhodes", label: "Rhodes", description: "Very warm, thirteenth chords." },
      { id: "funk", label: "Funk", description: "Faster, lead-driven." },
      { id: "amber", label: "Amber", description: "Mixolydian color." },
    ],
  },
  {
    id: "dreamPop",
    label: "Dream Pop",
    bpm: 72,
    tags: ["lush", "sweet", "floating"],
    description: "Lush suspended harmony and soft pulse for pretty, floating focus.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "shoegaze", label: "Shoegaze", description: "Wall-of-sound reverb & shimmer." },
      { id: "bedroom", label: "Bedroom", description: "Slower, sparser." },
      { id: "summer", label: "Summer", description: "Higher tonic, brighter." },
      { id: "winter", label: "Winter", description: "Aeolian coolness." },
      { id: "nocturne", label: "Nocturne", description: "Lower dorian, slower." },
    ],
  },
  {
    id: "soulHop",
    label: "Soul Hop",
    bpm: 88,
    tags: ["soulful", "swing", "warm"],
    description: "Dusty drums and sweet extended chords with mellow pocket.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "boombap", label: "Boom Bap", description: "Punchier, more swing." },
      { id: "buttery", label: "Buttery", description: "Slower with thirteenth colors." },
      { id: "jazzy", label: "Jazzy", description: "Dorian with ninth chords." },
      { id: "midnight", label: "Midnight", description: "Lower tonic, warmer." },
      { id: "sunday", label: "Sunday", description: "Major pentatonic ease." },
    ],
  },
  {
    id: "cityPop",
    label: "City Pop",
    bpm: 110,
    tags: ["bright", "glossy", "jazzy"],
    description: "Glossy upbeat chords with smooth bass movement and pop shine.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "tokyo", label: "Tokyo", description: "Faster with thirteenth sparkle." },
      { id: "neon", label: "Neon", description: "Punchier lead, brighter pad." },
      { id: "coastal", label: "Coastal", description: "Warmer, slightly slower." },
      { id: "sunset", label: "Sunset", description: "Lower tonic, mixolydian." },
      { id: "drive", label: "Drive", description: "Driving bass, lead-forward." },
    ],
  },
  {
    id: "bossaNova",
    label: "Bossa Nova",
    bpm: 94,
    tags: ["gentle", "syncopated", "breezy"],
    description: "Gentle Brazilian-inspired pulse with light syncopation and color.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "samba", label: "Samba", description: "Faster, busier lead." },
      { id: "gentle", label: "Gentle", description: "Slower, warmer." },
      { id: "blue", label: "Blue", description: "Aeolian with ninth colors." },
      { id: "rio", label: "Rio", description: "Slightly swung." },
      { id: "jobim", label: "Jobim", description: "Eleventh extensions." },
    ],
  },
  {
    id: "chillHouse",
    label: "Chill House",
    bpm: 118,
    tags: ["steady", "soft-club", "euphoric"],
    description: "Soft four-on-the-floor with glossy chords and easy momentum.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "deep", label: "Deep", description: "Dorian, ninth chords, lower." },
      { id: "beach", label: "Beach", description: "Major pentatonic." },
      { id: "sunset", label: "Sunset", description: "Slower at 110 bpm." },
      { id: "rooftop", label: "Rooftop", description: "Faster, lead-forward." },
      { id: "balearic", label: "Balearic", description: "Warmer, ninth colors." },
    ],
  },
  {
    id: "rainyPiano",
    label: "Rainy Piano",
    bpm: 68,
    tags: ["piano-ish", "tender", "minimal"],
    description: "Tender, sparse harmony with very low rhythmic pressure.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "midnight", label: "Midnight", description: "Darker aeolian." },
      { id: "morning", label: "Morning", description: "Higher lydian." },
      { id: "moss", label: "Moss", description: "Even slower." },
      { id: "stormy", label: "Stormy", description: "More shimmer and reverb." },
      { id: "hymn", label: "Hymn", description: "Major with seventh chords." },
    ],
  },
  {
    id: "sunsetGroove",
    label: "Sunset Groove",
    bpm: 102,
    tags: ["warm", "optimistic", "golden-hour"],
    description: "Warm bass, bright chords, and easy-going forward motion.",
    defaultVariant: "classic",
    variants: [
      { id: "classic", label: "Classic" },
      { id: "beach", label: "Beach", description: "Major pentatonic warmth." },
      { id: "dusk", label: "Dusk", description: "Slower with warmer pad." },
      { id: "golden", label: "Golden", description: "Thirteenth chord colors." },
      { id: "saltwater", label: "Saltwater", description: "Dorian groove." },
      { id: "boardwalk", label: "Boardwalk", description: "Lead-forward." },
    ],
  },
] as const;

export const DEFAULT_GENRE: BeatlyGenreId = "deepFocus";

export function getGenre(id: BeatlyGenreId): BeatlyGenre {
  const genre = BEATLY_GENRES.find((entry) => entry.id === id);
  if (genre === undefined) {
    throw new Error(`Unknown Beatly genre: ${id}`);
  }

  return genre;
}

export function getVariant(genreId: BeatlyGenreId, variantId: string): BeatlyVariant | null {
  return getGenre(genreId).variants.find((v) => v.id === variantId) ?? null;
}

/**
 * Turn a `BeatlyGenreId` (+ optional variant) into the runtime profile id used
 * by the SuperCollider server, e.g. `"lofi" + "night" -> "lofi.night"`. Falls
 * back to the genre's `defaultVariant` when the variant is missing or unknown.
 */
export function resolveProfileId(genreId: BeatlyGenreId, variantId?: string | null): string {
  const genre = getGenre(genreId);
  const v = variantId && genre.variants.some((entry) => entry.id === variantId)
    ? variantId
    : genre.defaultVariant;
  return `${genreId}.${v}`;
}
