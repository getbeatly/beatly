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
  | "neoSoul";

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
] as const;

export const DEFAULT_GENRE: BeatlyGenreId = "deepFocus";

export function getGenre(id: BeatlyGenreId): BeatlyGenre {
  const genre = BEATLY_GENRES.find((entry) => entry.id === id);
  if (genre === undefined) {
    throw new Error(`Unknown Beatly genre: ${id}`);
  }

  return genre;
}
