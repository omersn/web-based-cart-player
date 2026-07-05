// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Persistent audio engine — the one shared AudioContext + master DSP chain
 * every on-air audio subsystem (cart wall, autoplayer, DJ decks, and — in
 * multichannel mode only — PFL) routes through. Lives here, in index.php's
 * own top-level script, so it survives every iframe reload the app does
 * internally (switching board sections, Stop all, a Station Manager save's
 * refreshPlayerWindows()) — only a real browser refresh resets it, same as
 * automation.js/dj.js already do today.
 *
 * Two audio modes (manager Audio tab's mode switch, persisted as audio_mode):
 *  - "stereo" (default): every on-air source sums into ONE chain -> ONE
 *    combined output. PFL NEVER routes through here in this mode, full stop —
 *    no opt-in, no exception. The Audio tab's only stereo-mode control is a
 *    "disable PFL entirely" switch (reusing settings.txt's existing
 *    pfl_player flag), specifically so there is no possible path for cue
 *    audio to leak into the on-air signal when there's only one output to
 *    leak into — see dj.js's pflAllowed()/sendToPFL().
 *  - "multichannel": independent output CHANNELS (up to NUM_CHANNELS, though
 *    how many are actually AVAILABLE depends on which simulated "devices" are
 *    enabled — see availableOutputCount()), each its own bus + its own DSP
 *    node instances + its own analyser — genuinely separate signals, not one
 *    summed "master" (per the user's own framing: "in this multichannel mode
 *    we actually have no master channel"). Every source — cartwall/
 *    autoplayer/deck1-3, AND NOW PFL TOO — is patched into whichever channel
 *    the Audio tab's routing matrix currently assigns it to. Routing PFL
 *    into the same channel as on-air content is possible here, but it's a
 *    deliberate, informed choice in the matrix, not a systemic default.
 *  - Real per-device hardware output is explicitly OUT of scope for this
 *    pass (user's own call, asked twice) — "devices" are simulated: for now
 *    just one, contributing 4 discrete stereo outputs. Real
 *    navigator.mediaDevices.enumerateDevices()/output channel counts are
 *    future work. All channels still reach the same real
 *    audioContext.destination; only the DSP/metering are genuinely separate.
 *
 * IMPORTANT: the DSP style/on-off is ONE shared setting regardless of mode —
 * multichannel does NOT mean per-channel configuration. Each channel gets its
 * own AGC/compressor/limiter NODE INSTANCES (Web Audio nodes sum whatever
 * connects to them, so genuinely separate signals need genuinely separate
 * node instances — there's no way around that), but every instance is always
 * configured identically, from the same setType()/setEnabled() calls. This
 * was a deliberate choice after an earlier pass this session built fully
 * independent per-output type/on-off controls and the user asked for the
 * simpler uniform version instead — don't reintroduce per-channel DSP config.
 *
 * The admin Audio Library Manager / Break Planner's trim/chain previews stay
 * dry always, no exceptions, in any mode — only PFL has the multichannel
 * opt-in described above.
 *
 * A <audio> element can only ever be wrapped in ONE MediaElementSourceNode,
 * for its whole lifetime (a hard Web Audio constraint) — callers must call
 * connectDeck()/connectAutoplayer()/connectPfl() exactly once per element,
 * right after creating it, before any .play().
 */
(() => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const SETTINGS = window.SETTINGS || {};
    const ROUTING = window.ROUTING || {};
    const NUM_CHANNELS = 5; // fixed internal allocation; availableOutputCount() below is the real, device-driven ceiling for UI purposes

    // Named DSP types — which stages are in the chain (order matters) and
    // their parameters. "aggressive" carries this feature's original,
    // already-tested fixed-chain values verbatim. Exposed read-only via
    // typeParams() so the Audio tab can display the real numbers rather than
    // just a name — see manager.js's DSP section.
    const TYPES = {
        limiting: {
            chain: ['limiter'],
            limiter: { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1 },
        },
        agcOnly: {
            chain: ['agc'],
            agc: { threshold: -24, knee: 30, ratio: 3, attack: 0.4, release: 1.0 },
        },
        // Standard broadcast-style chain: gentle leveling AGC, moderate
        // compressor, brickwall limiter as the final safety net.
        aggressive: {
            chain: ['agc', 'compressor', 'limiter'],
            agc: { threshold: -24, knee: 30, ratio: 3, attack: 0.4, release: 1.0 },
            compressor: { threshold: -18, knee: 12, ratio: 4, attack: 0.02, release: 0.3 },
            limiter: { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1 },
        },
        // Same three stages, higher thresholds/lower ratios/softer knees —
        // noticeably less processed than "aggressive."
        gentle: {
            chain: ['agc', 'compressor', 'limiter'],
            agc: { threshold: -28, knee: 30, ratio: 2, attack: 0.5, release: 1.2 },
            compressor: { threshold: -22, knee: 15, ratio: 2.5, attack: 0.04, release: 0.4 },
            limiter: { threshold: -1.5, knee: 3, ratio: 12, attack: 0.005, release: 0.15 },
        },
    };

    function setParams(node, params) {
        if (!params) return;
        ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach((k) => {
            if (params[k] != null) node[k].value = params[k];
        });
    }

    let currentType = TYPES[SETTINGS.dsp_type] ? SETTINGS.dsp_type : 'aggressive';
    let dspEnabled = !!SETTINGS.dsp_enabled;
    let audioMode = SETTINGS.audio_mode === 'multichannel' ? 'multichannel' : 'stereo';

    // ---- One DSP chain "instance" — stereo mode uses exactly one; ---------------
    // ---- multichannel mode uses up to NUM_CHANNELS, all configured alike. ------
    function createChainInstance() {
        return {
            bus: audioContext.createGain(),
            agc: audioContext.createDynamicsCompressor(),
            compressor: audioContext.createDynamicsCompressor(),
            limiter: audioContext.createDynamicsCompressor(),
            analyser: (() => { const a = audioContext.createAnalyser(); a.fftSize = 256; return a; })(),
        };
    }
    // Tears down and rebuilds ONE instance's outgoing wiring only — sources
    // feeding INTO its bus (repatchSource, below) are untouched. Disabled, or
    // a stage left out of the type's chain, means fully disconnected, not
    // just parametrically bypassed, so .reduction genuinely reads 0.
    function rebuildChainInstance(inst) {
        const preset = TYPES[currentType] || TYPES.aggressive;
        [inst.bus, inst.agc, inst.compressor, inst.limiter].forEach((n) => n.disconnect());
        setParams(inst.agc, preset.agc);
        setParams(inst.compressor, preset.compressor);
        setParams(inst.limiter, preset.limiter);
        const stageNodes = { agc: inst.agc, compressor: inst.compressor, limiter: inst.limiter };
        let tail = inst.bus;
        if (dspEnabled) preset.chain.forEach((key) => { tail.connect(stageNodes[key]); tail = stageNodes[key]; });
        tail.connect(audioContext.destination);
        tail.connect(inst.analyser);
    }
    const stereoChain = createChainInstance();
    const channelChains = []; // index 0..NUM_CHANNELS-1, always created (so mode switches are instant)
    for (let i = 0; i < NUM_CHANNELS; i++) channelChains.push(createChainInstance());
    function rebuildAllChains() {
        rebuildChainInstance(stereoChain);
        channelChains.forEach(rebuildChainInstance);
    }
    function setType(name) { if (TYPES[name]) { currentType = name; rebuildAllChains(); } }
    function setEnabled(on) { dspEnabled = !!on; rebuildAllChains(); }
    rebuildAllChains();

    // ---- Simulated "devices" — each contributes some number of the ------------
    // ---- available stereo outputs (matrix rows). Real hardware detection ------
    // ---- is explicitly future work — see the header comment. -------------------
    const DEVICE_CHANNELS = { sim4: 4 };
    const deviceEnabled = { sim4: SETTINGS.device_sim4_enabled != null ? !!SETTINGS.device_sim4_enabled : true };
    function setDeviceEnabled(id, on) { if (id in DEVICE_CHANNELS) deviceEnabled[id] = !!on; }
    function isDeviceEnabled(id) { return !!deviceEnabled[id]; }
    /** How many of the fixed NUM_CHANNELS chain instances are actually
     *  "available" right now, per which simulated devices are on — this is
     *  what the routing matrix and the footer flyout size themselves to. */
    function availableOutputCount() {
        let n = 0;
        Object.keys(DEVICE_CHANNELS).forEach((id) => { if (deviceEnabled[id]) n += DEVICE_CHANNELS[id]; });
        return Math.min(n, NUM_CHANNELS);
    }

    // ---- Source buses: one per logical on-air source (including PFL now — ------
    // ---- see connectPfl()). Always exist, always carry their own metering -----
    // ---- tap; WHICH chain instance they feed into depends on audio_mode -------
    // ---- (+ Routing assignment in multichannel). -------------------------------
    function makeSourceBus() {
        const bus = audioContext.createGain();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        return { bus, analyser };
    }
    const sources = {
        cartwall: makeSourceBus(),
        autoplayer: makeSourceBus(),
        deck1: makeSourceBus(),
        deck2: makeSourceBus(),
        deck3: makeSourceBus(),
        pfl: makeSourceBus(),
    };
    // Maps a source's key to the Routing matrix's key for it (window.ROUTING) —
    // used only in multichannel mode to pick which channel it feeds.
    const ROUTING_KEY = { cartwall: 'carts', autoplayer: 'autoplayer', deck1: 'player1', deck2: 'player2', deck3: 'player3', pfl: 'pfl' };
    /** Re-patches one source's bus into whichever chain it currently belongs
     *  to (its own metering tap is rebuilt alongside — bus.disconnect() clears
     *  ALL of a node's outputs, so both have to be re-established together,
     *  every time). Called once at startup for every source, and again
     *  whenever audio_mode changes or the routing matrix saves new
     *  assignments. PFL is the one exception: in stereo mode it is NEVER
     *  patched anywhere (see connectPfl() — the whole point of the
     *  stereo-mode "disable PFL" switch is that there's no path for it to
     *  reach the on-air signal at all in that mode). */
    function repatchSource(key) {
        const src = sources[key];
        if (!src) return;
        if (key === 'pfl' && audioMode !== 'multichannel') {
            src.bus.disconnect(); // no metering tap, no destination — inert until multichannel
            return;
        }
        let targetBus = stereoChain.bus;
        if (audioMode === 'multichannel') {
            const n = ROUTING[ROUTING_KEY[key]] || 1;
            targetBus = (channelChains[n - 1] || channelChains[0]).bus;
        }
        src.bus.disconnect();
        src.bus.connect(src.analyser);
        src.bus.connect(targetBus);
    }
    function repatchAllSources() { Object.keys(sources).forEach(repatchSource); }
    repatchAllSources();

    function setAudioMode(mode) {
        audioMode = mode === 'multichannel' ? 'multichannel' : 'stereo';
        repatchAllSources();
    }
    // Called by manager.js right after the routing matrix saves new
    // assignments — a no-op in stereo mode (nothing there depends on ROUTING).
    function refreshRouting() { repatchAllSources(); }

    // ---- Generic source connection ---------------------------------------------
    /** Wrap `audioElement` in a MediaElementSourceNode and route it into `bus`.
     *  Returns the per-source GainNode so callers (dj.js) can tap their own
     *  AnalyserNode off it (before the shared bus) for local metering, without
     *  a second (illegal) MediaElementSourceNode. */
    function wrapAndConnect(audioElement, bus) {
        const source = audioContext.createMediaElementSource(audioElement);
        const gainNode = audioContext.createGain();
        source.connect(gainNode);
        gainNode.connect(bus);
        return gainNode;
    }
    function connectAutoplayer(audioElement) {
        return wrapAndConnect(audioElement, sources.autoplayer.bus);
    }
    function connectDeck(deckKey, audioElement) {
        return wrapAndConnect(audioElement, sources['deck' + deckKey].bus);
    }
    // dj.js calls this on every PFL preview unconditionally. In stereo mode
    // this ALWAYS returns null and touches nothing — no opt-in, no exception,
    // by design (see header comment). In multichannel mode PFL is a real,
    // routable source like any other — wrap it and let repatchSource('pfl')
    // (already run at connect time via the element's initial bus target)
    // decide which channel it lands on. Note pflAllowed()'s "disable PFL
    // entirely" check happens further upstream in dj.js — if that's off,
    // sendToPFL() never creates the element in the first place, so this
    // never even gets called.
    function connectPfl(audioElement) {
        if (audioMode !== 'multichannel') return null;
        return wrapAndConnect(audioElement, sources.pfl.bus);
    }

    // ---- Cart-wall voices ------------------------------------------------------
    // The engine owns the real <audio> elements for cart wall — cartwall.js
    // (running inside grid.php's iframe, a different document) can't call in
    // here directly, and a real <audio> element can't cross the iframe
    // boundary via postMessage (structured clone can't carry DOM nodes). So
    // cartwall.js only ever sends plain metadata commands (see index.php's
    // 'cart-engine-cmd' message handler) and reacts to the state broadcasts
    // below. One voice per absolute cartId (carts.txt line number), created
    // lazily and reused across replays — same one-persistent-element-per-cart
    // idea cartwall.js used to own locally, just relocated here so it survives
    // an iframe reload instead of being destroyed by one.
    const cartVoices = new Map(); // cartId -> voice record
    function connectCartwall(audioElement) {
        return wrapAndConnect(audioElement, sources.cartwall.bus);
    }
    function getOrCreateVoice(cartId, file, start, end, volume, chainFadeMs) {
        let v = cartVoices.get(cartId);
        if (!v) {
            const audio = new Audio(`uploads/${file}`);
            v = {
                cartId, audio, gainNode: connectCartwall(audio),
                file, start, end, volume, chainFadeMs,
                primed: false, priming: false, leadFired: false, endedFired: false, fullSec: null,
            };
            cartVoices.set(cartId, v);
            audio.addEventListener('loadedmetadata', () => {
                v.fullSec = (v.end != null ? v.end : audio.duration) - (v.start || 0);
            });
            audio.addEventListener('timeupdate', () => onVoiceTick(v));
            audio.addEventListener('ended', () => finishVoice(v));
        } else if (v.file !== file) {
            // Cart was replaced/edited (new audio) since this voice was made.
            v.audio.src = `uploads/${file}`;
            v.primed = false;
        }
        v.file = file; v.start = start; v.end = end; v.volume = volume; v.chainFadeMs = chainFadeMs;
        return v;
    }
    // Ported from cartwall.js's original preload hack: mute, play, confirm
    // "playing" actually fired within 100ms, pause and reset to the start
    // point — so the first REAL play is instant. Retries with growing
    // backoff if the browser didn't actually start playback in time.
    function primeVoice(v) {
        if (v.primed || v.priming) return;
        v.priming = true;
        let attempts = 0;
        const maxAttempts = 5;
        const attempt = () => {
            const audio = v.audio;
            audio.currentTime = v.start || 0;
            audio.volume = 0;
            let playbackStarted = false;
            const onPlaying = () => { playbackStarted = true; audio.removeEventListener('playing', onPlaying); };
            audio.addEventListener('playing', onPlaying);
            audio.play().then(() => {
                setTimeout(() => {
                    if (!playbackStarted) {
                        audio.currentTime = 0;
                        attempts++;
                        if (attempts < maxAttempts) setTimeout(attempt, 10 * attempts);
                        else v.priming = false;
                        return;
                    }
                    if (!audio.paused) {
                        audio.pause();
                        audio.currentTime = v.start || 0;
                    }
                    audio.volume = 1;
                    v.primed = true;
                    v.priming = false;
                }, 100);
            }).catch(() => {
                attempts++;
                if (attempts < maxAttempts) setTimeout(attempt, 10 * attempts);
                else v.priming = false;
            });
        };
        if (v.audio.readyState >= 3) attempt();
        else v.audio.addEventListener('canplaythrough', attempt, { once: true });
    }
    function cartPrime(carts) {
        (carts || []).forEach(({ cartId, file, start, end }) => {
            primeVoice(getOrCreateVoice(cartId, file, start, end, 1, 0));
        });
    }
    function cartPlay({ cartId, file, start, end, volume, chainFadeMs }) {
        const v = getOrCreateVoice(cartId, file, start, end, volume, chainFadeMs);
        v.leadFired = false;
        v.endedFired = false;
        v.audio.currentTime = start || 0;
        v.audio.volume = volume != null ? volume : 1;
        v.audio.play();
    }
    function cartStop({ cartId }) {
        const v = cartVoices.get(cartId);
        if (v) v.audio.pause();
    }
    function cartStopAll() {
        cartVoices.forEach((v) => v.audio.pause());
    }
    function onVoiceTick(v) {
        if (v.audio.paused) return;
        if (v.end != null && v.audio.currentTime >= v.end) {
            finishVoice(v);
            return;
        }
        if (!v.leadFired && v.chainFadeMs > 0) {
            const endPoint = v.end != null ? v.end : (v.audio.duration || 0);
            if ((endPoint - v.audio.currentTime) * 1000 <= v.chainFadeMs) {
                v.leadFired = true;
                broadcastCartEvent('cart-lead', v.cartId);
            }
        }
    }
    function finishVoice(v) {
        if (v.endedFired) return;
        v.endedFired = true;
        v.audio.pause();
        broadcastCartEvent('cart-ended', v.cartId);
    }
    // Every mounted grid.php iframe, found fresh each time (not cached) — a
    // reloaded/newly-mounted iframe is picked up automatically with no
    // registration step, and a torn-down one is never posted to stale.
    function gridIframeWindows() {
        return Array.from(document.querySelectorAll('iframe'))
            .filter((f) => f.src && f.src.includes('grid.php'))
            .map((f) => f.contentWindow)
            .filter(Boolean);
    }
    function broadcastCartEvent(type, cartId) {
        const msg = { source: 'cart-engine-state', type, cartId };
        gridIframeWindows().forEach((w) => { try { w.postMessage(msg, '*'); } catch (e) { /* torn down mid-broadcast */ } });
    }
    // ~5/sec: every known cart voice's current state, playing or not (not-yet-
    // playing entries still carry fullSec, which cartwall.js's chain-forward
    // duration math needs for cart members further down a chain).
    function broadcastTick() {
        const voices = [];
        cartVoices.forEach((v) => {
            const playing = !v.audio.paused;
            const endPoint = v.end != null ? v.end : (v.audio.duration || 0);
            voices.push({
                cartId: v.cartId,
                playing,
                remainingSec: playing ? Math.max(0, endPoint - v.audio.currentTime) : 0,
                fullSec: v.fullSec != null ? v.fullSec : Math.max(0, endPoint - (v.start || 0)),
            });
        });
        const msg = { source: 'cart-engine-state', type: 'tick', voices };
        gridIframeWindows().forEach((w) => { try { w.postMessage(msg, '*'); } catch (e) { /* torn down mid-broadcast */ } });
    }
    setInterval(broadcastTick, 200);

    // ---- Level helpers (0..1 RMS from time-domain data) -------------------------
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
    function reductionOf(inst) {
        return Math.max(Math.abs(inst.agc.reduction || 0), Math.abs(inst.compressor.reduction || 0), Math.abs(inst.limiter.reduction || 0));
    }
    // Footer pills' compact (collapsed) reading — the stereo chain in stereo
    // mode, or the loudest/hardest-working AVAILABLE channel in multichannel
    // mode (the expanded flyout, driven by channelAnalyser()/
    // channelReductionDb(), is where the real per-channel breakdown lives —
    // see index.php).
    function masterLevel() {
        if (audioMode === 'stereo') return levelOf(stereoChain.analyser);
        const n = availableOutputCount();
        return n === 0 ? 0 : Math.max(...channelChains.slice(0, n).map((c) => levelOf(c.analyser)));
    }
    function dspActivity() {
        if (audioMode === 'stereo') return reductionOf(stereoChain);
        const n = availableOutputCount();
        return n === 0 ? 0 : Math.max(...channelChains.slice(0, n).map(reductionOf));
    }

    window.AudioEngine = {
        audioContext,
        connectDeck, connectAutoplayer, connectPfl,
        resume: () => audioContext.resume(),
        levelOf, masterLevel, dspActivity,
        // Per-source metering (dj.js's own deck VU bars, footer pills):
        deckAnalyser: (deckKey) => sources['deck' + deckKey] && sources['deck' + deckKey].analyser,
        cartWallAnalyser: sources.cartwall.analyser,
        autoplayerAnalyser: sources.autoplayer.analyser,
        // DSP — admin-only controls, wired up from the Station Manager's
        // Audio tab (manager.js). ONE shared style/on-off regardless of mode.
        setType, getType: () => currentType, typeNames: Object.keys(TYPES),
        setEnabled, isEnabled: () => dspEnabled,
        typeParams: (name) => TYPES[name] || TYPES[currentType],
        allStageKeys: ['agc', 'compressor', 'limiter'],
        // Audio mode + simulated devices + per-channel metering (multichannel
        // mode only — stereo mode ignores these, everything sums into
        // masterLevel()):
        setAudioMode, getAudioMode: () => audioMode, numChannels: NUM_CHANNELS,
        setDeviceEnabled, isDeviceEnabled, deviceChannelCounts: { ...DEVICE_CHANNELS }, availableOutputCount,
        refreshRouting,
        channelAnalyser: (n) => channelChains[n - 1] && channelChains[n - 1].analyser,
        channelReductionDb: (n) => channelChains[n - 1] ? reductionOf(channelChains[n - 1]) : 0,
        // Cart-wall commands — called only from index.php's 'cart-engine-cmd'
        // message handler, never directly by cartwall.js (different document).
        cartPlay, cartStop, cartStopAll, cartPrime,
    };
})();
