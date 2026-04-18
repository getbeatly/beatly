// Realtime beat host with live-reload of live.scd.
// Run:    sclang play_beat.scd
// Edit:   live.scd  (save = hot-reload)
// Stop:   Ctrl+C

(
s = Server.default;
s.options.numOutputBusChannels = 2;
s.options.memSize = 2**16;

s.waitForBoot({
    // ---- Drum SynthDefs (baseline kit) ----
    SynthDef(\kick, { |out=0, amp=0.9|
        var pitch = EnvGen.kr(Env([150, 45], [0.08], \exp));
        var sig = SinOsc.ar(pitch);
        var env = EnvGen.kr(Env.perc(0.001, 0.25), doneAction: 2);
        sig = (sig * env * amp * 1.4).tanh;
        sig = HPF.ar(sig, 30);
        Out.ar(out, sig.dup);
    }).add;

    SynthDef(\hat, { |out=0, amp=0.2, len=0.05, pan=0.25|
        var sig = WhiteNoise.ar(1);
        var env = EnvGen.kr(Env.perc(0.001, len), doneAction: 2);
        sig = HPF.ar(sig, 7000);
        sig = BPF.ar(sig, 9000, 0.6);
        Out.ar(out, Pan2.ar(sig * env * amp, pan));
    }).add;

    SynthDef(\snare, { |out=0, amp=0.45|
        var n = WhiteNoise.ar(1);
        var tone = SinOsc.ar(180) * EnvGen.kr(Env.perc(0.001, 0.08));
        var env = EnvGen.kr(Env.perc(0.002, 0.18), doneAction: 2);
        var sig = (BPF.ar(n, 2500, 0.7) * env) + (tone * 0.5);
        Out.ar(out, Pan2.ar(sig * amp, 0));
    }).add;

    s.sync;

    TempoClock.default.tempo = 94 / 60;

    // ---- Live-reload watcher ----
    ~livePath = thisProcess.nowExecutingPath.dirname +/+ "live.scd";
    ~liveMtime = 0;

    ~reloadLive = {
        if(File.exists(~livePath)) {
            protect {
                ~livePath.load;
                ("↻ reloaded " ++ ~livePath ++ " @ " ++ Date.getDate.stamp).postln;
            } { |err|
                if(err.notNil) { ("✗ error in live.scd: " ++ err.errorString).postln };
            };
        } {
            ("(waiting for " ++ ~livePath ++ ")").postln;
        };
    };

    Routine({
        inf.do {
            var m;
            if(File.exists(~livePath)) {
                m = File.mtime(~livePath);
                if(m != ~liveMtime) {
                    ~liveMtime = m;
                    ~reloadLive.();
                };
            };
            0.3.wait;
        };
    }).play;

    "▶ server up. Edit live.scd to change the music. Ctrl+C to stop.".postln;
});
)
