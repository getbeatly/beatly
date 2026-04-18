// live.scd — edit and save to hot-reload.
// Rules of thumb:
//   • Pdef(\name, Pbind(...)).play      starts or replaces a pattern
//   • Pdef(\name).stop                  stops one pattern
//   • Pdef(\name).quant = 4             next change waits for next 4-beat bar
//   • SynthDef(...).add                 redefines an instrument (affects new notes)
//   • TempoClock.default.tempo = X/60   change BPM live

// -------- Tempo --------
TempoClock.default.tempo = 94 / 60;

// -------- Drums (8 eighth-notes per bar) --------
Pdef(\kicks, Pbind(
    \instrument, \kick,
    \dur, 0.5,
    \amp, Pseq([0.95, 0, 0, 0, 0.95, 0, 0, 0], inf)
)).quant_(4).play;

Pdef(\snares, Pbind(
    \instrument, \snare,
    \dur, 0.5,
    \amp, Pseq([0, 0, 0.5, 0, 0, 0, 0.5, 0], inf)
)).quant_(4).play;

Pdef(\hats, Pbind(
    \instrument, \hat,
    \dur, 0.5,
    \amp, Pseq([0.22, 0.12, 0.22, 0.12, 0.22, 0.12, 0.22, 0.14], inf),
    \len, Pseq([0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.25], inf),
    \pan, Pseq([-0.2, 0.2, -0.2, 0.2, -0.2, 0.2, -0.2, 0.2], inf)
)).quant_(4).play;

// -------- Add new instruments here, then save. --------
// Example: uncomment to add a bass line locked to the kick.
/*
SynthDef(\bass, { |out=0, freq=55, amp=0.5, gate=1|
    var sig = SinOsc.ar(freq) + (LFTri.ar(freq*2, 0, 0.3));
    var env = EnvGen.kr(Env.adsr(0.008, 0.12, 0.7, 0.2), gate, doneAction: 2);
    sig = RLPF.ar(sig, 220, 0.5);
    sig = HPF.ar(sig, 40);
    Out.ar(out, (sig * env * amp).dup);
}).add;

Pdef(\bassline, Pbind(
    \instrument, \bass,
    \dur, Pseq([1, 1, 0.5, 0.5, 1], inf),        // rhythm in beats
    \midinote, Pseq([33, 33, 36, 40, 33], inf),  // A1, A1, C2, E2, A1
    \amp, 0.5,
    \legato, 0.9
)).quant_(4).play;
*/

// Example: simple pad chords
/*
SynthDef(\pad, { |out=0, freq=220, amp=0.1, gate=1, cutoff=1200, pan=0|
    var sig = Mix.fill(3, { |i|
        Saw.ar(freq * (2 ** ([-7, 0, 7][i] * 0.01)), 1/3)
    });
    sig = sig + SinOsc.ar(freq*0.5, 0, 0.3);
    sig = RLPF.ar(sig, cutoff, 0.6);
    var env = EnvGen.kr(Env.adsr(1.2, 0.4, 0.85, 2.5), gate, doneAction: 2);
    Out.ar(out, Pan2.ar(sig * env * amp, pan));
}).add;

Pdef(\pad, Pbind(
    \instrument, \pad,
    \dur, 8,                                       // one chord per 2 bars
    \midinote, Pseq([[52,55,59,62], [50,53,57,60], [48,52,55,59], [55,59,62,65]], inf),
    \amp, 0.08,
    \cutoff, 1800,
    \legato, 0.98
)).quant_(4).play;
*/

// Turn something off (example): uncomment to drop the snare
// Pdef(\snares).stop;
