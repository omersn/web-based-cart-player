// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Persistent audio engine — the one shared AudioContext + master DSP bus
 * every on-air audio subsystem (cart wall, autoplayer, DJ decks) routes
 * through. Lives here, in index.php's own top-level script, so it survives
 * every iframe reload the app does internally (switching board sections,
 * Stop all, a Station Manager save's refreshPlayerWindows()) — only a real
 * browser refresh resets it, same as automation.js/dj.js already do today.
 *
 * Master bus: per-source GainNode -> summing bus -> AGC -> compressor ->
 * limiter -> destination. All three DSP stages are native
 * DynamicsCompressorNodes with different parameters — no AudioWorklet
 * needed. Fixed defaults, no tuning UI yet (see the meter bridge in
 * index.php for the readout-only side of this).
 *
 * Cue/preview audio deliberately does NOT route through here — PFL preview
 * and the admin Audio Manager / Break Planner's trim/chain previews stay
 * dry, outside the master bus, by design (previewing a trim should sound
 * like the raw clip, not the on-air-processed mix).
 *
 * A <audio> element can only ever be wrapped in ONE MediaElementSourceNode,
 * for its whole lifetime (a hard Web Audio constraint) — callers must call
 * connectSource()/connectDeck()/connectAutoplayer() exactly once per element,
 * right after creating it, before any .play().
 */
(() => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // ---- Master bus + DSP chain ------------------------------------------------
    const masterBus = audioContext.createGain();
    masterBus.gain.value = 1;

    // AGC: slow leveler — gentle ratio, slow attack/release, evens out overall
    // loudness across sources without audibly "pumping."
    const agc = audioContext.createDynamicsCompressor();
    agc.threshold.value = -24;
    agc.knee.value = 30;
    agc.ratio.value = 3;
    agc.attack.value = 0.4;
    agc.release.value = 1.0;

    // Compressor: standard broadcast-style dynamics control.
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.3;

    // Limiter: near-brickwall safety net against overs.
    const limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    masterBus.connect(agc);
    agc.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(audioContext.destination);

    // Post-limiter level tap, for the meter bridge's Master channel.
    const masterAnalyser = audioContext.createAnalyser();
    masterAnalyser.fftSize = 256;
    limiter.connect(masterAnalyser);

    // ---- Sub-buses for the meter bridge's per-surface channels -----------------
    // Cart Wall: all cart-wall voices sum here (wired up in Stage 2 — inert until
    // then). Autoplayer: automation.js's queued items connect here directly.
    const cartWallBus = audioContext.createGain();
    const cartWallAnalyser = audioContext.createAnalyser();
    cartWallAnalyser.fftSize = 256;
    cartWallBus.connect(cartWallAnalyser);
    cartWallBus.connect(masterBus);

    const autoplayerBus = audioContext.createGain();
    const autoplayerAnalyser = audioContext.createAnalyser();
    autoplayerAnalyser.fftSize = 256;
    autoplayerBus.connect(autoplayerAnalyser);
    autoplayerBus.connect(masterBus);

    // ---- Generic source connection ---------------------------------------------
    /** Wrap `audioElement` in a MediaElementSourceNode and route it into `bus`
     *  (defaults to the master bus directly). Returns the per-source GainNode so
     *  callers can tap their own AnalyserNode off it (before the shared bus) for
     *  local metering, without a second (illegal) MediaElementSourceNode. */
    function connectSource(audioElement, bus) {
        const source = audioContext.createMediaElementSource(audioElement);
        const gainNode = audioContext.createGain();
        source.connect(gainNode);
        gainNode.connect(bus || masterBus);
        return gainNode;
    }

    function connectAutoplayer(audioElement) {
        return connectSource(audioElement, autoplayerBus);
    }

    // Per-deck analysers for dj.js, keyed by whatever id the caller chooses (dj.js
    // uses its deck number) — read directly by the meter bridge, same document.
    const deckAnalysers = {};
    function connectDeck(deckKey, audioElement) {
        const gainNode = connectSource(audioElement, masterBus);
        if (!deckAnalysers[deckKey]) {
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            deckAnalysers[deckKey] = analyser;
        }
        gainNode.connect(deckAnalysers[deckKey]);
        return gainNode;
    }

    // ---- Level helper (0..1 RMS from time-domain data) -------------------------
    function levelOf(analyser) {
        if (!analyser) return 0;
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sumSquares += v * v;
        }
        return Math.sqrt(sumSquares / data.length);
    }

    window.AudioEngine = {
        audioContext,
        masterBus, cartWallBus, autoplayerBus,
        connectSource, connectDeck, connectAutoplayer,
        resume: () => audioContext.resume(),
        // Meter bridge reads (assets/js/... nothing — driven from index.php's own
        // inline script, same document, no postMessage):
        levelOf,
        masterAnalyser, cartWallAnalyser, autoplayerAnalyser,
        deckAnalyser: (deckKey) => deckAnalysers[deckKey],
        reductionDb: {
            agc: () => agc.reduction,
            compressor: () => compressor.reduction,
            limiter: () => limiter.reduction,
        },
    };
})();
