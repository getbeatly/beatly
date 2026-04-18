// Compile SynthDefs to ./synthdefs/*.scsyndef and exit.
// Run:  npm run build:synthdefs
//
// Bus layout (set up by server.js):
//   0,1   master out (master synth ReplaceOuts here at end of chain)
//   4,5   reverb send (cleared by sysClear at head of chain)
//   6,7   delay send  (cleared by sysClear at head of chain)
//
// Group order:
//   50  sysClear (zeros send buses each block)
//   100 voices
//   200 reverb, pingDelay (read send buses, write to 0,1)
//   300 master (reads 0,1, processes, ReplaceOut to 0,1)

(
var dir = thisProcess.nowExecutingPath.dirname +/+ "synthdefs";
File.mkdir(dir);

[
    // -------------- bus housekeeping --------------
    SynthDef(\sysClear, {
        ReplaceOut.ar(4, Silent.ar(2));
        ReplaceOut.ar(6, Silent.ar(2));
    }),

    // -------------- send FX --------------
    SynthDef(\reverb, { |in=4, out=0, mix=1.0, room=0.85, damp=0.4|
        var sig = In.ar(in, 2);
        var wet = FreeVerb2.ar(sig[0], sig[1], 1.0, room, damp);
        Out.ar(out, wet * mix);
    }),

    SynthDef(\pingDelay, { |in=6, out=0, time=0.375, fb=0.5, mix=0.6|
        var sig = In.ar(in, 2);
        var local = LocalIn.ar(2);
        var feedSig = sig + (local * fb);
        var delayed = DelayN.ar(feedSig, 1.5, time.clip(0.01, 1.4));
        var wet = LPF.ar(HPF.ar(delayed, 250), 4500);
        // ping-pong: cross channels in feedback path
        LocalOut.ar([wet[1], wet[0]]);
        Out.ar(out, delayed * mix);
    }),

    // -------------- master --------------
    SynthDef(\master, {
        var sig = In.ar(0, 2);
        // tilt-EQ-ish: a touch of low-shelf warmth, slight high cut
        sig = BLowShelf.ar(sig, 220, 1, 1.5);
        sig = BHiShelf.ar(sig, 7000, 1, -0.8);
        // gentle saturation
        sig = (sig * 1.1).tanh / 1.1.tanh;
        sig = Limiter.ar(sig, 0.92, 0.005);
        ReplaceOut.ar(0, sig);
    }),

    // -------------- pad --------------
    // 3 detuned saws + (optional) sub sine on lowest voice; slow filter LFO;
    // long ADSR, Haas widening, reverb + delay sends.
    SynthDef(\pad, { |out=0, fxOut=4, dlyOut=6,
                     freq=220, amp=0.07, dur=4, cutoff=1200, pan=0,
                     sub=0, rvbSend=0.55, dlySend=0.12|
        var sig, env, lfo, sigL, sigR, mix;
        sig = Mix.fill(3, { |i|
            // detune is in CENTS (1/100 semitone). 7 cents = 7/1200 of an octave.
            // Without the /1200 we'd be detuning by ~5% pitch (= 84 semitones!).
            var detune = [-7, 0, 7][i] / 1200;
            Saw.ar(freq * (2 ** detune), 1/3.5)
        });
        sig = sig + (SinOsc.ar(freq * 0.5) * sub * 0.35);
        lfo = SinOsc.kr(Rand(0.07, 0.19), Rand(0, 2pi), 0.18, 1);
        sig = RLPF.ar(sig, (cutoff * lfo).clip(120, 9000), 0.7);
        env = EnvGen.kr(
            Env.new([0,1,1,0], [1.5, (dur - 1.5).max(0.5), 2.5], [2, 0, -2]),
            doneAction: 2);
        sig = sig * env * amp;
        // Haas widening
        sigL = sig;
        sigR = DelayN.ar(sig, 0.012, 0.007);
        mix = Balance2.ar(sigL, sigR, pan, 1.0);
        Out.ar(out, mix);
        Out.ar(fxOut, mix * rvbSend);
        Out.ar(dlyOut, mix * dlySend);
    }),

    // -------------- bass --------------
    SynthDef(\bass, { |out=0, fxOut=4, freq=55, amp=0.42, dur=0.4,
                      cutoff=200, rvbSend=0.06|
        var sig, env;
        sig = SinOsc.ar(freq) + (LFTri.ar(freq * 2, 0, 0.28));
        env = EnvGen.kr(
            Env.new([0,1,0.65,0], [0.005, dur*0.3, dur*0.7], [-2,0,-3]),
            doneAction: 2);
        sig = LPF.ar(sig, cutoff);
        sig = HPF.ar(sig, 35);
        sig = sig * env * amp;
        Out.ar(out, sig.dup);
        Out.ar(fxOut, sig.dup * rvbSend);
    }),

    // -------------- sub bass (dnb / dub) --------------
    SynthDef(\subBass, { |out=0, freq=40, amp=0.5, dur=0.5|
        var sig, env;
        sig = SinOsc.ar(freq) * 0.85 + (SinOsc.ar(freq * 2) * 0.15);
        env = EnvGen.kr(
            Env.new([0,1,0.85,0], [0.008, dur*0.2, dur*0.8], [-2,0,-3]),
            doneAction: 2);
        sig = (sig * env * amp * 1.05).tanh;
        sig = HPF.ar(sig, 25);
        Out.ar(out, sig.dup);
    }),

    // -------------- kick --------------
    // body sine with pitch env + tiny click + soft-clip body.
    SynthDef(\kick, { |out=0, fxOut=4, amp=0.85, rvbSend=0.05|
        var click, body, env, pitch, sig;
        pitch = EnvGen.kr(Env([180, 55, 42], [0.04, 0.08], \exp));
        body = SinOsc.ar(pitch);
        click = WhiteNoise.ar(1) * EnvGen.kr(Env.perc(0.001, 0.005)) * 0.18;
        env = EnvGen.kr(Env.perc(0.001, 0.32), doneAction: 2);
        sig = ((body + click) * env * amp * 1.3).tanh;
        sig = HPF.ar(sig, 30);
        Out.ar(out, sig.dup);
        Out.ar(fxOut, sig.dup * rvbSend);
    }),

    // -------------- snare --------------
    SynthDef(\snare, { |out=0, fxOut=4, amp=0.4, rvbSend=0.25|
        var n, tone, noise, env, sig;
        n = WhiteNoise.ar(1);
        tone = SinOsc.ar(195) * EnvGen.kr(Env.perc(0.001, 0.06)) * 0.55;
        noise = BPF.ar(n, 2200, 0.55) * EnvGen.kr(Env.perc(0.001, 0.16));
        env = EnvGen.kr(Env.perc(0.001, 0.22), doneAction: 2);
        sig = (noise + tone) * amp * env;
        Out.ar(out, sig.dup);
        Out.ar(fxOut, sig.dup * rvbSend);
    }),

    // -------------- clap (3-burst) --------------
    SynthDef(\clap, { |out=0, fxOut=4, amp=0.4, rvbSend=0.45|
        var bursts, tail, sig;
        bursts = EnvGen.kr(Env(
            [0, 1, 0, 1, 0, 1, 0, 0.7, 0],
            [0.001, 0.012, 0.001, 0.012, 0.001, 0.012, 0.001, 0.05]
        ));
        tail = EnvGen.kr(Env.perc(0.04, 0.18), doneAction: 2);
        sig = WhiteNoise.ar(1);
        sig = BPF.ar(sig, 1500, 0.55);
        sig = ((sig * bursts) + (sig * tail * 0.35)) * amp;
        Out.ar(out, sig.dup);
        Out.ar(fxOut, sig.dup * rvbSend);
    }),

    // -------------- closed/open hat --------------
    SynthDef(\hat, { |out=0, fxOut=4, amp=0.18, len=0.05, pan=0.25, rvbSend=0.18|
        var sig, env;
        sig = WhiteNoise.ar(1);
        sig = HPF.ar(sig, 7000);
        sig = BPF.ar(sig, 9500, 0.55);
        env = EnvGen.kr(Env.perc(0.001, len), doneAction: 2);
        sig = sig * env * amp;
        sig = Pan2.ar(sig, pan);
        Out.ar(out, sig);
        Out.ar(fxOut, sig * rvbSend);
    }),

    // -------------- ride cymbal --------------
    SynthDef(\ride, { |out=0, fxOut=4, amp=0.28, pan=0.4, rvbSend=0.55|
        var sig, env, tone;
        sig = WhiteNoise.ar(1);
        sig = HPF.ar(sig, 4000);
        sig = (BPF.ar(sig, 7000, 0.45) + BPF.ar(sig, 9500, 0.45)) * 0.5;
        tone = Mix([SinOsc.ar(2300), SinOsc.ar(3700), SinOsc.ar(4100)]) * 0.04;
        env = EnvGen.kr(
            Env.new([0, 1, 0.5, 0], [0.002, 0.05, 0.45], [-2, 0, -4]),
            doneAction: 2);
        sig = (sig + tone) * env * amp;
        sig = Pan2.ar(sig, pan);
        Out.ar(out, sig);
        Out.ar(fxOut, sig * rvbSend);
    }),

    // -------------- side-stick / rim --------------
    SynthDef(\rim, { |out=0, fxOut=4, amp=0.35, rvbSend=0.3|
        var sig, env;
        sig = SinOsc.ar(800) + (WhiteNoise.ar(0.5));
        sig = BPF.ar(sig, 1800, 0.4);
        env = EnvGen.kr(Env.perc(0.001, 0.06), doneAction: 2);
        sig = sig * env * amp;
        Out.ar(out, Pan2.ar(sig, -0.2));
        Out.ar(fxOut, Pan2.ar(sig, -0.2) * rvbSend);
    }),

    // -------------- lead (bell-like FM marimba) --------------
    // Replaces the harsh Pluck with a softer FM tone.
    SynthDef(\lead, { |out=0, fxOut=4, dlyOut=6,
                      freq=440, amp=0.22, dur=0.4, pan=0.15, spark=0.5,
                      rvbSend=0.42, dlySend=0.5|
        var carrier, mod, sig, env, click;
        mod = SinOsc.ar(freq * 3) * EnvGen.kr(Env.perc(0.001, 0.08))
              * (200 + (spark * 800));
        carrier = SinOsc.ar(freq + mod);
        click = SinOsc.ar(freq * 2) * 0.2 * EnvGen.kr(Env.perc(0.001, 0.04));
        sig = carrier + click + (SinOsc.ar(freq) * 0.5);
        env = EnvGen.kr(
            Env.new([0, 1, 0.25, 0], [0.003, dur*0.25, dur*0.75], [-1, -2, -3]),
            doneAction: 2);
        sig = sig * env * amp * 0.6;
        sig = Pan2.ar(sig, pan);
        Out.ar(out, sig);
        Out.ar(fxOut, sig * rvbSend);
        Out.ar(dlyOut, sig * dlySend);
    }),

    // -------------- shimmer (ornamental bell partials) --------------
    SynthDef(\shimmer, { |out=0, fxOut=4, dlyOut=6,
                         freq=880, amp=0.04, dur=0.6, pan=0,
                         rvbSend=0.85, dlySend=0.3|
        var sig, env;
        sig = SinOsc.ar(freq)
              + (SinOsc.ar(freq * 2.01) * 0.3)
              + (SinOsc.ar(freq * 3.03) * 0.12);
        env = EnvGen.kr(Env([0, 1, 0], [dur*0.3, dur*0.7], \sine), doneAction: 2);
        sig = sig * env * amp;
        sig = Pan2.ar(sig, pan);
        Out.ar(out, sig);
        Out.ar(fxOut, sig * rvbSend);
        Out.ar(dlyOut, sig * dlySend);
    })
].do { |sd|
    sd.writeDefFile(dir);
    ("wrote " ++ dir +/+ sd.name ++ ".scsyndef").postln;
};

0.exit;
)
