export interface BeatlyGenre {
  readonly id: BeatlyGenreId;
  readonly label: string;
  readonly bpm: number;
  readonly tags: readonly string[];
  readonly description: string;
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

export const BEATLY_GENRES: readonly BeatlyGenre[] = [
  {
    id: "ambient",
    label: "Ambient",
    bpm: 60,
    tags: ["background", "spacious", "slow"],
    description: "Wide, slow, minimal motion for low-distraction sessions.",
  },
  {
    id: "calming",
    label: "Calming",
    bpm: 70,
    tags: ["gentle", "lydian", "soft"],
    description: "Warm pads and light motion for stressful or blocked moments.",
  },
  {
    id: "deepFocus",
    label: "Deep Focus",
    bpm: 86,
    tags: ["steady", "dorian", "focused"],
    description: "Sparse groove and stable harmony for sustained coding focus.",
  },
  {
    id: "lofi",
    label: "Lo-Fi",
    bpm: 78,
    tags: ["laid-back", "swing", "beats"],
    description: "Relaxed beat-driven profile for everyday coding sessions.",
  },
  {
    id: "jazzNoir",
    label: "Jazz Noir",
    bpm: 96,
    tags: ["jazzy", "ride", "walking-bass"],
    description: "Smoky late-night groove with more movement and color.",
  },
  {
    id: "techno",
    label: "Techno",
    bpm: 128,
    tags: ["driving", "phrygian", "club"],
    description: "Fast, steady four-on-the-floor energy.",
  },
  {
    id: "dnb",
    label: "DnB",
    bpm: 174,
    tags: ["fast", "breakbeat", "sub"],
    description: "High-energy profile for crunch time and momentum bursts.",
  },
  {
    id: "dub",
    label: "Dub",
    bpm: 75,
    tags: ["echo", "space", "bass"],
    description: "Dubby low-end with roomy FX and slower pacing.",
  },
  {
    id: "uplift",
    label: "Uplift",
    bpm: 122,
    tags: ["positive", "bright", "forward"],
    description: "Brighter, more energetic profile for wins and progress moments.",
  },
  {
    id: "neoSoul",
    label: "Neo Soul",
    bpm: 84,
    tags: ["groove", "warm", "syncopated"],
    description: "Warm chords and syncopated rhythm with more personality.",
  },
  {
    id: "dreamPop",
    label: "Dream Pop",
    bpm: 72,
    tags: ["lush", "sweet", "floating"],
    description: "Lush suspended harmony and soft pulse for pretty, floating focus.",
  },
  {
    id: "soulHop",
    label: "Soul Hop",
    bpm: 88,
    tags: ["soulful", "swing", "warm"],
    description: "Dusty drums and sweet extended chords with mellow pocket.",
  },
  {
    id: "cityPop",
    label: "City Pop",
    bpm: 110,
    tags: ["bright", "glossy", "jazzy"],
    description: "Glossy upbeat chords with smooth bass movement and pop shine.",
  },
  {
    id: "bossaNova",
    label: "Bossa Nova",
    bpm: 94,
    tags: ["gentle", "syncopated", "breezy"],
    description: "Gentle Brazilian-inspired pulse with light syncopation and color.",
  },
  {
    id: "chillHouse",
    label: "Chill House",
    bpm: 118,
    tags: ["steady", "soft-club", "euphoric"],
    description: "Soft four-on-the-floor with glossy chords and easy momentum.",
  },
  {
    id: "rainyPiano",
    label: "Rainy Piano",
    bpm: 68,
    tags: ["piano-ish", "tender", "minimal"],
    description: "Tender, sparse harmony with very low rhythmic pressure.",
  },
  {
    id: "sunsetGroove",
    label: "Sunset Groove",
    bpm: 102,
    tags: ["warm", "optimistic", "golden-hour"],
    description: "Warm bass, bright chords, and easy-going forward motion.",
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
