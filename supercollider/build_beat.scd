// Build a minimal beat score and exit.
// Output: out/beat.osc  (binary OSC score for scsynth -N)

(
var outDir, score, bpm, beatSec, barSec, bars, nid, t;
var kick, hat, snare;

outDir = thisProcess.nowExecutingPath.dirname +/+ "out";
File.mkdir(outDir);

kick = SynthDef(\kick, { |out=0, amp=0.9|
    var pitch = EnvGen.kr(Env([150, 45], [0.08], \exp));
    var sig = SinOsc.ar(pitch);
    var env = EnvGen.kr(Env.perc(0.001, 0.25), doneAction: 2);
    sig = (sig * env * amp * 1.4).tanh;
    sig = HPF.ar(sig, 30);
    Out.ar(out, sig.dup);
});

hat = SynthDef(\hat, { |out=0, amp=0.25, dur=0.05, pan=0.25|
    var sig = WhiteNoise.ar(1);
    var env = EnvGen.kr(Env.perc(0.001, dur), doneAction: 2);
    sig = HPF.ar(sig, 7000);
    sig = BPF.ar(sig, 9000, 0.6);
    Out.ar(out, Pan2.ar(sig * env * amp, pan));
});

snare = SynthDef(\snare, { |out=0, amp=0.5|
    var n = WhiteNoise.ar(1);
    var tone = SinOsc.ar(180) * EnvGen.kr(Env.perc(0.001, 0.08));
    var env = EnvGen.kr(Env.perc(0.002, 0.18), doneAction: 2);
    var sig = (BPF.ar(n, 2500, 0.7) * env) + (tone * 0.5);
    Out.ar(out, Pan2.ar(sig * amp, 0));
});

bpm = 94;
beatSec = 60 / bpm;
barSec = beatSec * 4;
bars = 8;

score = Score.new;
score.add([0.0, [\d_recv, kick.asBytes]]);
score.add([0.0, [\d_recv, hat.asBytes]]);
score.add([0.0, [\d_recv, snare.asBytes]]);

nid = 1000;
bars.do { |bar|
    var b0 = bar * barSec;
    // kick on 1 & 3
    [0, 2].do { |b|
        score.add([b0 + (b * beatSec), [\s_new, \kick, nid, 0, 0, \amp, 0.95]]);
        nid = nid + 1;
    };
    // snare on 2 & 4
    [1, 3].do { |b|
        score.add([b0 + (b * beatSec), [\s_new, \snare, nid, 0, 0, \amp, 0.45]]);
        nid = nid + 1;
    };
    // closed hat 8ths, open hat on the & of 4
    8.do { |h|
        var t1 = b0 + (h * beatSec / 2);
        var isOpen = (h == 7);
        score.add([t1, [\s_new, \hat, nid, 0, 0,
            \amp, if(h.even, 0.22, 0.14),
            \dur, if(isOpen, 0.25, 0.05),
            \pan, if(h.even, -0.2, 0.2)]]);
        nid = nid + 1;
    };
};
// tail
score.add([bars * barSec + 1.0, [\c_set, 0, 0]]);
score.sort;

score.writeOSCFile(outDir +/+ "beat.osc");
("wrote " ++ outDir +/+ "beat.osc").postln;
("duration " ++ (bars * barSec + 1.5)).postln;
0.exit;
)
