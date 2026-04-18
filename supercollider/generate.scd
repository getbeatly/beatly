// Random procedural music generator inspired by beatly/AUDIO_SPEC.md
// Uses non-realtime rendering → WAVs in ./out/
// Run: sclang generate.scd

(
var outDir, profiles, scales, renderProfile, toFreq, chooseWeighted;

outDir = thisProcess.nowExecutingPath.dirname +/+ "out";
File.mkdir(outDir);

// ----- helpers -----
toFreq = { |midi| 440 * (2 ** ((midi - 69) / 12)) };

chooseWeighted = { |pairs, rng|  // pairs = [[val,w], ...]
    var total = pairs.collect(_[1]).sum;
    var r = rng.nextFloat * total;
    var acc = 0, hit = pairs[0][0];
    block { |break|
        pairs.do { |p|
            acc = acc + p[1];
            if(r <= acc) { hit = p[0]; break.() }
        }
    };
    hit
};

scales = (
    ionian:     [0,2,4,5,7,9,11],
    dorian:     [0,2,3,5,7,9,10],
    lydian:     [0,2,4,6,7,9,11],
    mixolydian: [0,2,4,5,7,9,10],
    aeolian:    [0,2,3,5,7,8,10],
    phrygian:   [0,1,3,5,7,8,10]
);

// Chord built from scale degree (1-indexed Roman numeral) – triad or 7th
// returns array of MIDI pitches near a target octave
~chordTones = { |tonic, scale, deg, ext=\triad|
    var degs = [0,2,4];
    if(ext == \seventh) { degs = [0,2,4,6] };
    if(ext == \ninth)   { degs = [0,2,4,6,8] };
    degs.collect { |d|
        var scaleIdx = (deg - 1 + d);
        var oct = scaleIdx.div(scale.size);
        var pc = scale.wrapAt(scaleIdx);
        tonic + pc + (12 * oct)
    }
};

// Voice-lead pad voicing toward previous top voice
~voiceLead = { |chord, prevTop, windowLo=60, windowHi=84|
    var candidates, best;
    // generate inversions spanning up to 2 octaves
    candidates = (-1..2).collect { |oct|
        chord.size.collect { |inv|
            var c = chord.collect { |n,i|
                n + (12 * oct) + if(i < inv, 12, 0)
            }.sort;
            c
        }
    }.flatten(1);
    candidates = candidates.select { |c|
        c.every { |n| (n >= windowLo) && (n <= windowHi + 4) } and: { c.last <= windowHi }
    };
    if(candidates.isEmpty) { candidates = [chord + 60.nearest(chord).neg] };
    best = candidates.minItem { |c| (c.last - prevTop).abs + (c.first - (prevTop-12)).abs };
    best
};

// ----- profile definitions -----
profiles = [
    (
        id: \calming, tonic: 65 /*F4*/ - 12, scale: \lydian, bpm: 70,
        progression: [[[1,5,6,4],3],[[1,3,4,1],2],[[1,2,1,5],1]],
        chordExt: \ninth, barsPerChord: 4,
        drums: false, lead: true, leadDensity: 0.25,
        warmth: 0.8, sparkle: 0.35, space: 0.85, pulse: 0.2
    ),
    (
        id: \deepFocus, tonic: 52 /*E3*/, scale: \dorian, bpm: 86,
        progression: [[[1,7,6,7],3],[[1,4,7,3],2]],
        chordExt: \seventh, barsPerChord: 2,
        drums: true, lead: true, leadDensity: 0.5,
        warmth: 0.55, sparkle: 0.45, space: 0.6, pulse: 0.5
    ),
    (
        id: \lofi, tonic: 57 /*A3*/, scale: \aeolian, bpm: 78,
        progression: [[[1,6,3,7],3],[[1,4,7,1],2]],
        chordExt: \seventh, barsPerChord: 2,
        drums: true, lead: true, leadDensity: 0.4, swing: 0.16,
        warmth: 0.7, sparkle: 0.3, space: 0.55, pulse: 0.6
    ),
    (
        id: \techno, tonic: 45 /*A2*/, scale: \phrygian, bpm: 128,
        progression: [[[1,1,1,2],5],[[1,1,1,1],2]],
        chordExt: \triad, barsPerChord: 4,
        drums: true, lead: false, driving: true,
        warmth: 0.35, sparkle: 0.6, space: 0.4, pulse: 0.95
    )
];

// ----- synth defs (used at NRT time) -----
~mkSynthDefs = {
    SynthDef(\pad, { |out=0, freq=220, amp=0.1, gate=1, cutoff=1200, pan=0|
        var sig, env, lfo;
        sig = Mix.fill(3, { |i|
            var detune = [-7, 0, 7][i] * 0.01 * 1.0;
            Saw.ar(freq * (2 ** detune), 1/3)
        });
        sig = sig + (SinOsc.ar(freq * 0.5, 0, 0.3));
        lfo = SinOsc.kr(Rand(0.07, 0.19), Rand(0,2pi), 0.15, 1);
        sig = RLPF.ar(sig, cutoff * lfo, 0.7);
        env = EnvGen.kr(Env.adsr(1.2, 0.4, 0.85, 2.5), gate, doneAction: 2);
        sig = sig * env * amp;
        Out.ar(out, Pan2.ar(sig, pan));
    }).add;

    SynthDef(\bass, { |out=0, freq=55, amp=0.5, gate=1, cutoff=180|
        var sig, env;
        sig = SinOsc.ar(freq, 0, 1) + (LFTri.ar(freq * 2, 0, 0.3));
        sig = RLPF.ar(sig, cutoff, 0.5);
        sig = HPF.ar(sig, 40);
        env = EnvGen.kr(Env.adsr(0.008, 0.12, 0.7, 0.18), gate, doneAction: 2);
        Out.ar(out, (sig * env * amp).dup);
    }).add;

    SynthDef(\kick, { |out=0, amp=0.9|
        var sig, env, pitch;
        pitch = EnvGen.kr(Env([110, 45], [0.08], \exp));
        sig = SinOsc.ar(pitch);
        env = EnvGen.kr(Env.perc(0.001, 0.22), doneAction: 2);
        sig = (sig * env * amp * 1.2).tanh;
        sig = HPF.ar(sig, 30);
        Out.ar(out, sig.dup);
    }).add;

    SynthDef(\hat, { |out=0, amp=0.2, dur=0.05, pan=0.25|
        var sig, env;
        sig = WhiteNoise.ar(1);
        sig = HPF.ar(sig, 7000);
        sig = BPF.ar(sig, 9000, 0.5);
        env = EnvGen.kr(Env.perc(0.001, dur), doneAction: 2);
        Out.ar(out, Pan2.ar(sig * env * amp, pan));
    }).add;

    SynthDef(\lead, { |out=0, freq=440, amp=0.25, gate=1, pan=0.15, spark=0.5|
        var sig, env, exc;
        exc = WhiteNoise.ar(1) * EnvGen.kr(Env.perc(0.001, 0.02));
        sig = Pluck.ar(exc, Impulse.kr(0), 1/freq, 1/freq, 5, 0.5);
        sig = LPF.ar(sig, 3500 + (4000 * spark));
        env = EnvGen.kr(Env.adsr(0.003, 0.18, 0.25, 0.4), gate, doneAction: 2);
        Out.ar(out, Pan2.ar(sig * env * amp, pan));
    }).add;

    SynthDef(\shimmer, { |out=0, freq=880, amp=0.06, dur=0.5, pan=0|
        var sig, env;
        sig = SinOsc.ar(freq);
        env = EnvGen.kr(Env([0, 1, 0], [dur*0.5, dur*0.5], \sine), doneAction: 2);
        Out.ar(out, Pan2.ar(sig * env * amp, pan));
    }).add;

    SynthDef(\masterFx, { |in=10, out=0, space=0.6, wet=0.4|
        var dry, wetSig, rt60;
        dry = In.ar(in, 2);
        rt60 = 1.5 + (5.5 * space);
        wetSig = DelayN.ar(dry, 0.06, 0.02 + (0.04 * space));
        wetSig = FreeVerb2.ar(wetSig[0], wetSig[1], 1, (rt60/8).clip(0.3, 0.95),
            (3500 + (3500 * (1-space))) / 20000);
        // ping pong
        wetSig = wetSig + [
            CombL.ar(dry[1], 1.0, 60/128 * 1, 0.5),
            CombL.ar(dry[0], 1.0, 60/128 * 1, 0.5)
        ] * 0.25;
        Out.ar(out, (dry + (wetSig * wet)).tanh);
    }).add;
};

// ----- render one profile via NRT -----
renderProfile = { |prof, seed=1, seconds=32|
    var rng = Routine { var r = 0; loop { r = (r * 1103515245 + 12345 + seed) % 2147483647; seed = r; r.yield } };
    // simpler: use a seeded sc Random
    var sr = 48000;
    var score, fname, beatSec, barSec, totalBars, scale, tonic, progChoice, prog;
    var t = 0.0, chordIdx = 0, prevTop = 72, fxNode, padMaxId = 2000;
    var nextId = 1000;

    // deterministic RNG
    thisThread.randSeed = seed;
    rng = { |hi=1.0, lo=0.0| lo + ((hi - lo) * 1.0.rand) };

    scale = scales[prof[\scale]];
    tonic = prof[\tonic];
    progChoice = chooseWeighted.(prof[\progression], (next: { 1.0.rand }, nextFloat: { 1.0.rand }));
    beatSec = 60 / prof[\bpm];
    barSec = beatSec * 4;
    totalBars = (seconds / barSec).ceil.asInteger;
    fname = outDir +/+ ("sample_" ++ prof[\id] ++ ".wav");

    score = Score.new;

    // load synth defs into score
    [\pad, \bass, \kick, \hat, \lead, \shimmer, \masterFx].do { |name|
        score.add([0.0, ['/d_recv', SynthDef.wrap({ }).asBytes]]); // placeholder; replaced below
    };
    score = Score.new; // reset; use proper approach

    // Build score by adding synthdef bytes
    [
        SynthDef(\pad, { |out=10, freq=220, amp=0.1, gate=1, cutoff=1200, pan=0, dur=4|
            var sig, env, lfo;
            sig = Mix.fill(3, { |i|
                var detune = [-7, 0, 7][i] * 0.01;
                Saw.ar(freq * (2 ** detune), 1/3)
            });
            sig = sig + (SinOsc.ar(freq * 0.5, 0, 0.4));
            lfo = SinOsc.kr(Rand(0.07, 0.19), Rand(0,2pi), 0.15, 1);
            sig = RLPF.ar(sig, (cutoff * lfo).clip(100, 12000), 0.6);
            env = EnvGen.kr(Env.adsr(1.2, 0.4, 0.85, 2.5),
                EnvGen.kr(Env([1,1,0],[dur, 0.01])), doneAction: 2);
            sig = sig * env * amp;
            Out.ar(out, Pan2.ar(sig, pan));
        }),
        SynthDef(\bass, { |out=10, freq=55, amp=0.55, cutoff=180, dur=0.9|
            var sig, env;
            sig = SinOsc.ar(freq) + (LFTri.ar(freq * 2, 0, 0.35));
            sig = RLPF.ar(sig, cutoff, 0.5);
            sig = HPF.ar(sig, 40);
            env = EnvGen.kr(Env.new([0,1,0.7,0],[0.01, dur*0.3, dur*0.7],[-2,0,-3]),
                doneAction: 2);
            Out.ar(out, (sig * env * amp).dup);
        }),
        SynthDef(\kick, { |out=10, amp=0.95|
            var sig, env, pitch;
            pitch = EnvGen.kr(Env([150, 45], [0.08], \exp));
            sig = SinOsc.ar(pitch);
            env = EnvGen.kr(Env.perc(0.001, 0.25), doneAction: 2);
            sig = (sig * env * amp * 1.4).tanh;
            sig = HPF.ar(sig, 30);
            Out.ar(out, sig.dup);
        }),
        SynthDef(\hat, { |out=10, amp=0.18, dur=0.05, pan=0.25|
            var sig, env;
            sig = WhiteNoise.ar(1);
            sig = HPF.ar(sig, 7000);
            sig = BPF.ar(sig, 9000, 0.6);
            env = EnvGen.kr(Env.perc(0.001, dur), doneAction: 2);
            Out.ar(out, Pan2.ar(sig * env * amp, pan));
        }),
        SynthDef(\lead, { |out=10, freq=440, amp=0.28, pan=0.15, spark=0.5, dur=0.4|
            var sig, env, exc;
            exc = WhiteNoise.ar(1) * EnvGen.kr(Env.perc(0.001, 0.015));
            sig = Pluck.ar(exc, Impulse.kr(0), 0.02, 1/freq, 6, 0.5);
            sig = LPF.ar(sig, 3500 + (4000 * spark));
            env = EnvGen.kr(Env.new([0,1,0.3,0],[0.005, dur*0.4, dur*0.6]), doneAction: 2);
            Out.ar(out, Pan2.ar(sig * env * amp, pan));
        }),
        SynthDef(\shimmer, { |out=10, freq=880, amp=0.05, dur=0.5, pan=0|
            var sig, env;
            sig = SinOsc.ar(freq);
            env = EnvGen.kr(Env([0, 1, 0], [dur*0.5, dur*0.5], \sine), doneAction: 2);
            Out.ar(out, Pan2.ar(sig * env * amp, pan));
        }),
        SynthDef(\masterFx, { |in=10, out=0, space=0.6, wet=0.4|
            var dry, wetSig, rt60, pp;
            dry = In.ar(in, 2);
            rt60 = (1.5 + (5.5 * space)).clip(0.3, 6);
            wetSig = DelayN.ar(dry, 0.08, 0.02 + (0.04 * space));
            wetSig = FreeVerb2.ar(wetSig[0], wetSig[1], 1,
                (0.7 + (0.25 * space)).clip(0.3, 0.95),
                (1 - (space * 0.6)).clip(0.1, 0.9));
            pp = [
                CombL.ar(dry[1] * 0.5, 1.2, 0.375, 1.5),
                CombL.ar(dry[0] * 0.5, 1.2, 0.375, 1.5)
            ];
            Out.ar(out, (dry + (wetSig * wet) + (pp * 0.2 * wet)).softclip);
        })
    ].do { |sd|
        score.add([0.0, [\d_recv, sd.asBytes]]);
    };

    // master fx node first (on bus 10, out bus 0)
    score.add([0.0, [\s_new, \masterFx, nextId, 0, 0,
        \in, 10, \out, 0, \space, prof[\space], \wet, 0.35 + (prof[\space] * 0.25)]]);
    fxNode = nextId; nextId = nextId + 1;

    // schedule content
    totalBars.do { |bar|
        var chord, top, padVoicing, rootMidi, barStart;
        var romanDegree;
        barStart = bar * barSec;
        chordIdx = bar.div(prof[\barsPerChord]) % progChoice.size;
        romanDegree = progChoice[chordIdx];
        chord = ~chordTones.(tonic, scale, romanDegree, prof[\chordExt]);
        padVoicing = ~voiceLead.(chord + 12, prevTop);  // shift up for pad register
        prevTop = padVoicing.last;
        rootMidi = tonic + scale.wrapAt(romanDegree - 1) - 24; // bass

        // pad: sustains for prof[\barsPerChord] bars, but only (re)triggered when chord changes
        if(bar % prof[\barsPerChord] == 0) {
            padVoicing.do { |n, i|
                var pan = [-0.4, 0.0, 0.4, -0.2][i] ? 0;
                var dur = barSec * prof[\barsPerChord] - 0.05;
                score.add([barStart + i * 0.007, [\s_new, \pad, nextId, 0, fxNode,
                    \freq, toFreq.(n), \amp, 0.08, \cutoff, 600 + (2400 * prof[\warmth]),
                    \pan, pan, \dur, dur]]);
                nextId = nextId + 1;
            };
        };

        // bass on beats 1 & 3 (or four-on-floor for techno)
        if(prof[\driving] == true) {
            4.do { |b|
                score.add([barStart + (b * beatSec), [\s_new, \bass, nextId, 0, fxNode,
                    \freq, toFreq.(rootMidi), \cutoff, 160 + (120 * prof[\warmth]),
                    \dur, beatSec * 0.85]]);
                nextId = nextId + 1;
            }
        } {
            [0, 2].do { |b|
                score.add([barStart + (b * beatSec), [\s_new, \bass, nextId, 0, fxNode,
                    \freq, toFreq.(rootMidi), \cutoff, 160 + (120 * prof[\warmth]),
                    \dur, beatSec * 1.6]]);
                nextId = nextId + 1;
            }
        };

        // drums
        if(prof[\drums] == true) {
            // kick pattern
            if(prof[\driving] == true) {
                4.do { |b|
                    score.add([barStart + (b * beatSec), [\s_new, \kick, nextId, 0, fxNode,
                        \amp, 0.95 * prof[\pulse]]]);
                    nextId = nextId + 1;
                }
            } {
                // typical: 1, 3 (plus sometimes a ghost)
                [0, 2].do { |b|
                    score.add([barStart + (b * beatSec), [\s_new, \kick, nextId, 0, fxNode,
                        \amp, 0.9 * prof[\pulse]]]);
                    nextId = nextId + 1;
                };
                if(1.0.rand < 0.3) {
                    score.add([barStart + (2.75 * beatSec), [\s_new, \kick, nextId, 0, fxNode,
                        \amp, 0.5 * prof[\pulse]]]);
                    nextId = nextId + 1;
                }
            };

            // hats - 8ths, closed; with swing
            8.do { |h|
                var swing = if(h.odd) { (prof[\swing] ? 0) * (beatSec/2) } { 0 };
                if(1.0.rand < (0.7 + (prof[\sparkle] * 0.3))) {
                    score.add([barStart + (h * beatSec/2) + swing, [\s_new, \hat, nextId, 0, fxNode,
                        \amp, 0.12 + (prof[\sparkle] * 0.1),
                        \dur, if(h%4==2, 0.18, 0.05),
                        \pan, (h.even.if(-0.25, 0.25))]]);
                    nextId = nextId + 1;
                }
            };
        };

        // lead: sparse notes over chord
        if(prof[\lead] == true) {
            16.do { |step|
                if(1.0.rand < prof[\leadDensity] / 2) {
                    var noteChoice = chord.choose + 12 + ([0, 12, 7, -12].choose * 0.5).asInteger;
                    noteChoice = noteChoice.clip(67, 88);
                    score.add([barStart + (step * beatSec/4), [\s_new, \lead, nextId, 0, fxNode,
                        \freq, toFreq.(noteChoice),
                        \amp, 0.2 + 0.1.rand,
                        \spark, prof[\sparkle],
                        \dur, (beatSec/4) * (1 + 3.rand)]]);
                    nextId = nextId + 1;
                }
            }
        };

        // shimmer: poisson sprinkle
        (4.rand + 1).do {
            var grainT = barStart + barSec.rand;
            var n = chord.choose + [12, 24, 19, 28].choose;
            var gdur = 0.2 + 0.7.rand;
            score.add([grainT, [\s_new, \shimmer, nextId, 0, fxNode,
                \freq, toFreq.(n),
                \amp, (0.03 + 0.05.rand) * prof[\sparkle],
                \dur, gdur,
                \pan, 1.0.rand2]]);
            nextId = nextId + 1;
        };
    };

    // tail
    score.add([totalBars * barSec + 4, [\c_set, 0, 0]]);

    score.sort;
    ~lastDuration = totalBars * barSec + 5;
    ~lastFname = fname;
    ~lastScore = score;
    score.recordNRT(
        outputFilePath: fname,
        sampleRate: sr,
        headerFormat: "WAV",
        sampleFormat: "int16",
        options: ServerOptions.new.numOutputBusChannels_(2).numInputBusChannels_(0),
        duration: totalBars * barSec + 5,
        action: { |x| ("rendered " ++ fname ++ " exit=" ++ x).postln; ~renderDone.signalAll; }
    );
    fname
};

~mkSynthDefs.();

~renderDone = CondVar.new;

Routine {
    profiles.do { |p, i|
        var seed = 1000 + (i * 17);
        ("=== rendering " ++ p[\id] ++ " (seed " ++ seed ++ ") ===").postln;
        renderProfile.(p, seed, 24);
        ~renderDone.wait;  // wait for NRT subprocess to finish
        1.wait;
    };
    "ALL DONE".postln;
    1.wait;
    0.exit;
}.play;
)
