// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * DJ mode — the Carts/DJ layout toggle next to the page selector.
 *
 * Carts mode is the classic board. DJ mode hides the board (it stays loaded
 * underneath, so nothing playing there is interrupted) and the page dropdown,
 * and fills the main area with a slim library + three decks:
 *   LEFT  the library (fixed width): every enabled cart in a sections>carts
 *         tree with search, favourites filter, preview (the PFL bus), and
 *         per-row fire buttons into any of the three players. A marker
 *         column keeps the chain icon and the favourite star aligned.
 *   RIGHT PLAYER 1/2/3 — fully MANUAL decks. Firing a chained cart loads the
 *         WHOLE run from that cart to the chain's end; playback honours the
 *         chain-crossfade plan (next item launches early, the outgoing tail
 *         rings to its own end) and each cart's volume. Each deck shows the
 *         current item's decoded waveform with the progress washing over it,
 *         a repeat toggle (loops the whole load), and its assigned output
 *         (manager > Routing — simulated stereo outs for now).
 *
 * The engine is tick-driven (no setTimeout chains — those drift in
 * background tabs; see automation.js's watchdog for the same lesson).
 * The mode persists across reloads and is gated by the dj_mode switch.
 */
(() => {
    const $ = (id) => document.getElementById(id);
    const CAT = { '1': '#2f6fd6', '2': '#2f9e5f', '3': '#b0479e', '4': '#c98a2b', '5': '#2aa7bf' };
    const fmtDur = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
    // Wall-clock HH:MM:SS, same format automation.js's fmtClockSec uses for breaks.
    const fmtClockSec = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const byIndex = (i) => (window.CARTS || []).find((c) => c.i === i);
    const cartEnd = (c, a) => (c.end != null ? c.end : ((a && a.duration) || (c.start || 0)));
    const cartLen = (c) => (c.end != null ? Math.max(0, c.end - (c.start || 0)) : null);
    // The fade INTO the following chain member (ms) — only meaningful when
    // this cart actually chains onward.
    const fadeAfter = (c) => (c.cross ? Math.max(0, c.chainFade || 0) : 0);

    const MODE_STORE = 'cartPlayerDJMode';
    let active = false;

    // ---- tiny toast (the decks have no message strip of their own) --------
    let toastTimer = null;
    function toast(msg) {
        let t = $('djToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'djToast';
            t.className = 'dj-toast';
            $('djMode').appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
    }

    // ---- waveform decode (shared context, cached per file) ----------------
    let waveCtx = null;
    const waveBufs = {};
    function waveBuffer(file) {
        if (waveBufs[file] instanceof AudioBuffer) return Promise.resolve(waveBufs[file]);
        if (!waveBufs[file]) {
            waveCtx = waveCtx || new (window.AudioContext || window.webkitAudioContext)();
            waveBufs[file] = fetch('uploads/' + file)
                .then((r) => r.arrayBuffer())
                .then((buf) => waveCtx.decodeAudioData(buf))
                .then((decoded) => { waveBufs[file] = decoded; return decoded; })
                .catch(() => null);
        }
        return Promise.resolve(waveBufs[file]);
    }
    function drawWave(canvas, buffer, fromSec, toSec, color) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr; canvas.height = h * dpr;
        const g = canvas.getContext('2d');
        g.scale(dpr, dpr);
        if (!buffer) return;
        const data = buffer.getChannelData(0);
        const sr = buffer.sampleRate;
        const s0 = Math.max(0, Math.floor(fromSec * sr));
        const s1 = Math.min(data.length, Math.max(s0 + 1, Math.floor(toSec * sr)));
        const bars = Math.max(1, Math.floor(w / 3));
        const per = Math.max(1, Math.floor((s1 - s0) / bars));
        g.fillStyle = color;
        for (let i = 0; i < bars; i++) {
            let peak = 0;
            const from = s0 + i * per, to = Math.min(s1, from + per);
            for (let j = from; j < to; j += 16) peak = Math.max(peak, Math.abs(data[j]));
            const bh = Math.max(1, peak * (h - 4));
            g.fillRect(i * 3, (h - bh) / 2, 2, bh);
        }
    }

    // ---- library tree ------------------------------------------------------
    function sections() {
        const out = [];
        const grab = (selectId, ids) => {
            const s = $(selectId);
            if (!s) return;
            [...s.options].forEach((o) => {
                const m = o.value.match(/from=(\d+)&to=(\d+)/);
                if (m) out.push({ from: +m[1], to: +m[2], label: o.textContent.trim(), ids });
            });
        };
        grab('ids-select', true);      // Station IDs / Sweepers & FX first
        grab('section-select', false); // board pages after
        return out;
    }
    let query = '', favOnly = false;
    function renderTree() {
        const tree = $('djTree');
        tree.innerHTML = '';
        const q = query.trim().toLowerCase();
        const favs = new Set(window.FAVORITES || []);
        const filtering = q !== '' || favOnly;
        sections().forEach((sec) => {
            let carts = (window.CARTS || []).filter((c) => c.i >= sec.from && c.i < sec.to);
            if (q) carts = carts.filter((c) => c.name.toLowerCase().includes(q));
            if (favOnly) carts = carts.filter((c) => favs.has(c.i + 1));
            if (!carts.length) return;
            const open = sec.ids || filtering;
            const box = document.createElement('div');
            box.className = 'ptree-section' + (sec.ids ? ' ids' : '') + (open ? '' : ' collapsed');
            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'ptree-head';
            head.innerHTML = `<span class="ptree-exp">${open ? '−' : '+'}</span><span></span><em>${carts.length}</em>`;
            head.querySelectorAll('span')[1].textContent = sec.label;
            head.addEventListener('click', () => {
                const closed = box.classList.toggle('collapsed');
                head.querySelector('.ptree-exp').textContent = closed ? '+' : '−';
            });
            box.appendChild(head);
            const list = document.createElement('div');
            list.className = 'ptree-list';
            // A chain-member row keeps its OWN preview button (previewing one
            // cart in isolation is still a per-cart action) but carries no
            // fire/send-to-auto buttons of its own — those are inherently
            // GROUP actions (firing any member plays the whole run from its
            // start), so a single shared rail (built once per run) floats
            // over the whole group instead, tall as the group, and only on
            // hover. Only grouped while unfiltered: search/favourites can
            // hide a middle member, breaking index-adjacency, so filtered
            // views fall back to plain individual rows (each with its own
            // full button set).
            const buildRow = (c, isChainMember) => {
                const row = document.createElement('div');
                row.className = 'ptree-cart';
                row.dataset.ci = c.i;
                const len = cartLen(c);
                const inChain = c.cross || (byIndex(c.i - 1) && byIndex(c.i - 1).cross);
                row.innerHTML =
                    `<span class="ptree-dot" style="background:${CAT[c.color] || CAT['1']}"></span>` +
                    `<span class="dj-mark dj-mark-chain">${inChain ? '<i class="ph ph-link" title="Part of a chain"></i>' : ''}</span>` +
                    `<span class="dj-mark dj-mark-fav">${favs.has(c.i + 1) ? '<i class="ph-fill ph-star"></i>' : ''}</span>` +
                    `<span class="ptree-name"></span>` +
                    `<span class="ptree-len">${len != null ? fmtDur(len) : '—'}</span>` +
                    pflButtonHtml() +
                    (isChainMember ? '' : groupButtonsHtml());
                row.querySelector('.ptree-name').textContent = c.name;
                wirePflButton(row, c);
                if (!isChainMember) wireGroupButtons(row, c);
                return row;
            };
            const pflButtonHtml = () =>
                pflTreeAllowed() ? `<button type="button" class="ptree-btn ptree-play" title="Preview (PFL)"><span class="pfl-icon"><i class="ph ph-speaker-simple-high"></i></span></button>` : '';
            const groupButtonsHtml = () =>
                Array.from({ length: playerCount() }, (_, k) => k + 1).map((n) =>
                    `<button type="button" class="ptree-btn dj-fire" data-deck="${n}" title="Fire into Player ${n}">${n}</button>`).join('') +
                // Only meaningful while the automation panel is open —
                // CSS (body:has) shows/hides it live with the panel.
                `<button type="button" class="ptree-btn dj-send-auto" title="Send to autoplayer"><span class="icon-clocknote"><i class="ph ph-clock"></i><i class="ph-fill ph-music-note"></i></span></button>`;
            const wirePflButton = (row, c) => {
                const playBtn = row.querySelector('.ptree-play');
                if (playBtn) playBtn.addEventListener('click', (e) => sendToPFL(c, e.currentTarget));
            };
            const wireGroupButtons = (row, c) => {
                row.querySelectorAll('.dj-fire').forEach((b) => b.addEventListener('click', () => decks[+b.dataset.deck - 1].load(c)));
                row.querySelector('.dj-send-auto').addEventListener('click', () => sendToAuto(c));
            };
            // Chain-member rows reserve a right-hand gutter for the group's
            // shared rail (which floats over them, see below) instead of
            // rendering their own fire/auto buttons in flow. Sized to match
            // EXACTLY what a non-member row spends on those same buttons
            // (each one adds its 19px plus the row's 4px gap), so the length
            // column lines up whether or not a row belongs to a chain —
            // a fixed padding here used to fall out of step whenever
            // playerCount() (Options > DJ players) wasn't 3.
            const groupGutterPx = () => 8 + (playerCount() + 1) * 23;
            for (let idx = 0; idx < carts.length; idx++) {
                const c = carts[idx];
                const groupable = !filtering && c.cross && carts[idx + 1] && carts[idx + 1].i === c.i + 1;
                if (!groupable) { list.appendChild(buildRow(c, false)); continue; }
                const run = [c];
                let j = idx;
                while (carts[j] && carts[j].cross && carts[j + 1] && carts[j + 1].i === carts[j].i + 1) {
                    j++;
                    run.push(carts[j]);
                }
                const group = document.createElement('div');
                group.className = 'ptree-chain-group';
                const gutter = groupGutterPx() + 'px';
                run.forEach((cc) => {
                    const row = buildRow(cc, true);
                    row.style.paddingRight = gutter;
                    group.appendChild(row);
                });
                const rail = document.createElement('div');
                rail.className = 'ptree-chain-btns';
                rail.innerHTML = groupButtonsHtml();
                wireGroupButtons(rail, run[0]); // any button in the group plays the WHOLE run, from its start
                group.appendChild(rail);
                list.appendChild(group);
                idx = j;
            }
            box.appendChild(list);
            tree.appendChild(box);
        });
    }

    // Send a cart (or its whole chain run, as one grouped block) into the
    // automation playlist — the queue's own guards (locked / won't fit /
    // hour cap) all still apply.
    function sendToAuto(c) {
        if (!window.Automation) return;
        const run = chainRun(c);
        const items = run.map((cc, k) => ({
            cartId: cc.i + 1, name: cc.name, file: cc.file,
            start: cc.start, end: cc.end, volume: cc.volume, color: cc.color,
            runtime: cartLen(cc) || 0,
            // the chain-crossfade INTO this item rides along into the queue
            overlapIn: k > 0 ? fadeAfter(run[k - 1]) : 0,
        }));
        window.Automation.addItems(items, items.length > 1);
    }

    // ---- PFL (preview) mini-player -------------------------------------------
    // One shared slot: the library tree's per-row preview button and each
    // deck's PFL button both send a single cart here (trim-aware, one at a
    // time). Every PFL button uses the same static speaker-in-brackets icon
    // everywhere (tree, deck, search) — whichever one sent the current item
    // just turns amber (.active) — and clicking that SAME button again
    // unloads/stops it; the mini-player's own Stop does the same regardless
    // of the source.
    let pflState = null; // { cart, btn, audio, timer }
    function pflAllowed() { return !!(window.SETTINGS && window.SETTINGS.pfl_player); }
    function pflTreeAllowed() { return pflAllowed() && !!(window.SETTINGS && window.SETTINGS.pfl_buttons_tree); }
    function pflPlayersAllowed() { return pflAllowed() && !!(window.SETTINGS && window.SETTINGS.pfl_buttons_players); }
    function pflStop() {
        if (!pflState) return;
        const { btn, audio, timer } = pflState;
        clearInterval(timer);
        try { audio.pause(); } catch (e) {}
        if (btn) btn.classList.remove('active');
        pflState = null;
        const box = $('djPfl');
        if (box) {
            box.querySelector('.dj-pfl-name').textContent = '-';
            box.querySelector('.dj-pfl-bar > i').style.width = '0%';
            box.querySelector('.dj-pfl-stop').disabled = true;
        }
    }
    function pflOutBadge() {
        const box = $('djPfl');
        if (box) box.querySelector('.dj-pfl-out').textContent = 'OUT ' + ((window.ROUTING || {}).pfl || 1);
    }
    function sendToPFL(c, btn) {
        if (!pflAllowed()) return;
        if (pflState && pflState.btn === btn) { pflStop(); return; } // same source again -> unload
        pflStop(); // only one thing plays in PFL at a time
        const box = $('djPfl');
        const audio = new Audio(`uploads/${c.file}`);
        audio.currentTime = c.start || 0;
        audio.volume = c.volume != null ? c.volume : 1;
        const dur = () => (c.end != null ? c.end : (audio.duration || 0)) - (c.start || 0);
        const finish = () => pflStop();
        audio.addEventListener('ended', finish);
        if (c.end != null) audio.addEventListener('timeupdate', () => { if (audio.currentTime >= c.end) finish(); });
        audio.play().catch(finish);
        const timer = setInterval(() => {
            const d = dur();
            const done = Math.max(0, audio.currentTime - (c.start || 0));
            box.querySelector('.dj-pfl-bar > i').style.width = (d > 0 ? Math.min(100, (done / d) * 100) : 0) + '%';
        }, 100);
        if (box) {
            box.querySelector('.dj-pfl-name').textContent = c.name;
            box.querySelector('.dj-pfl-stop').disabled = false;
        }
        btn.classList.add('active');
        pflState = { cart: c, btn, audio, timer };
        pflOutBadge();
    }

    // ---- player decks --------------------------------------------------------
    // A deck holds a LOAD: one cart, or a whole chain run (fired cart to the
    // chain's end). Playback advances by the chain-crossfade plan — the next
    // item launches fadeAfter() early while the outgoing tail rings to its
    // own end — all driven by one 100 ms tick per deck.
    // Always the WHOLE run, from its true first item — firing any cart that
    // belongs to a chain (even a middle one) loads and plays it from the
    // start; a chain can never be loaded partially.
    function chainRun(c) {
        let start = c;
        while (true) {
            const prev = byIndex(start.i - 1);
            if (!prev || !prev.cross) break;
            start = prev;
        }
        const run = [start];
        let cur = start;
        while (cur.cross && run.length < 5) { // chains cap at 5 items
            const next = byIndex(cur.i + 1);
            if (!next) break; // disabled/empty successor ends the run
            run.push(next);
            cur = next;
        }
        return run;
    }
    function runLength(items) {
        let sum = 0;
        items.forEach((c, k) => {
            sum += cartLen(c) || 0;
            if (k < items.length - 1) sum -= fadeAfter(c) / 1000;
        });
        return Math.max(0, sum);
    }
    function makeDeck(no) {
        const root = $('djDeck' + no);
        const el = (sel) => root.querySelector(sel);
        const deck = { items: [], audios: [], idx: -1, playing: false, repeat: false, timer: null };

        // Tags the shared playback log (manager > Maintenance) with which
        // deck fired the cart and which (simulated) output it carries — lets
        // the log double as a check that different players are actually
        // routed to different real devices, once there's real multi-output
        // hardware behind OUT 1-4. dj.js runs in the parent document, not
        // grid.php's iframe, so it posts to grid.php explicitly.
        function logPlayback(cartName, action) {
            const out = (window.ROUTING || {})['player' + no] || no;
            fetch('grid.php', { method: 'POST', body: `${new Date().toLocaleString()} - ${cartName} - ${action} - DJ Player ${no} -> OUT ${out}` });
        }

        // VU meter: one shared analyser per deck — every audio element the
        // deck ever creates (load() below) routes through it, so the meter
        // follows whichever item in the run is actually on air. Real playback
        // routes through the persistent AudioEngine's master bus (audio-engine.js);
        // a <audio> element can only ever get ONE MediaElementSourceNode for its
        // whole lifetime, so the engine owns that call and this analyser is a
        // parallel, metering-only tap off the GainNode it hands back.
        let vuAnalyser = null, vuData = null, vuRaf = null, vuAvg = 0;
        function vuWire(audio) {
            try {
                const gainNode = window.AudioEngine.connectDeck(no, audio);
                if (!vuAnalyser) {
                    vuAnalyser = window.AudioEngine.audioContext.createAnalyser();
                    vuAnalyser.fftSize = 64;
                    vuAnalyser.smoothingTimeConstant = 0.75;
                    vuData = new Uint8Array(vuAnalyser.frequencyBinCount);
                }
                gainNode.connect(vuAnalyser);
            } catch (e) { /* metering is best-effort; playback still works without it */ }
        }
        function vuDrive() {
            if (!vuAnalyser) return;
            vuAnalyser.getByteFrequencyData(vuData);
            let sum = 0;
            for (let i = 0; i < vuData.length; i++) sum += vuData[i];
            const level = sum / vuData.length / 255;
            vuAvg = vuAvg * 0.72 + level * 0.28;
            const fill = el('.dj-deck-vu-fill');
            if (fill) fill.style.height = `${Math.max(0, Math.min(100, vuAvg * 165))}%`;
            vuRaf = requestAnimationFrame(vuDrive);
        }
        function vuStart() { window.AudioEngine.resume(); if (!vuRaf) vuDrive(); }
        function vuStop() {
            if (vuRaf) { cancelAnimationFrame(vuRaf); vuRaf = null; }
            vuAvg = 0;
            const fill = el('.dj-deck-vu-fill');
            if (fill) fill.style.height = '0%';
        }

        function curAudio() { return deck.audios[deck.idx] || null; }
        function curCart() { return deck.items[deck.idx] || null; }
        function loaded() { return deck.items.length > 0; }

        function paint() {
            root.classList.toggle('loaded', loaded());
            root.classList.toggle('playing', deck.playing);
            el('.dj-deck-empty').hidden = loaded();
            el('.dj-deck-wavebox').hidden = !loaded();
            el('.dj-deck-play').disabled = !loaded();
            el('.dj-deck-stop').disabled = !loaded();
            el('.dj-deck-repeat').disabled = !loaded();
            el('.dj-deck-eject').disabled = !loaded() || deck.playing;
            el('.dj-deck-pfl').disabled = !loaded();
            el('.dj-deck-repeat').classList.toggle('active', deck.repeat);
            el('.dj-deck-play').innerHTML = deck.playing ? '<i class="ph-fill ph-pause"></i>' : '<i class="ph-fill ph-play"></i>';
            if (!deck.playing) el('.dj-deck-time').classList.remove('ending');
            const c = curCart();
            el('.dj-deck-name').textContent = c ? c.name : '';
            if (c) root.style.setProperty('--deck-color', CAT[c.color] || CAT['1']);
            const pos = el('.dj-deck-chainpos');
            pos.hidden = deck.items.length < 2;
            if (!pos.hidden) pos.textContent = `${deck.idx + 1} / ${deck.items.length}`;
        }
        function drawCurrentWave() {
            const c = curCart();
            if (!c) return;
            const canvas = el('.dj-deck-wave');
            waveBuffer(c.file).then((buf) => {
                if (curCart() !== c) return; // deck moved on while decoding
                drawWave(canvas, buf, c.start || 0, cartEnd(c, curAudio()), 'rgba(255, 255, 255, 0.65)');
            });
        }
        // Remaining across the whole load (fades subtracted), and the wash
        // over the CURRENT item's waveform. The countdown turns red for the
        // final 4 seconds on air.
        function refreshTime() {
            if (!loaded()) return;
            const a = curAudio(), c = curCart();
            const done = a ? Math.max(0, a.currentTime - (c.start || 0)) : 0;
            let remain = Math.max(0, (cartLen(c) || 0) - done);
            for (let k = deck.idx + 1; k < deck.items.length; k++) {
                remain += (cartLen(deck.items[k]) || 0) - fadeAfter(deck.items[k - 1]) / 1000;
            }
            el('.dj-deck-remain').textContent = fmtDur(Math.max(0, remain));
            el('.dj-deck-len').textContent = fmtDur(runLength(deck.items));
            el('.dj-deck-time').classList.toggle('ending', deck.playing && remain <= 4);
            // Wall-clock end of the WHOLE load — same `remain` the countdown and
            // the "ending" flash use, so it already nets out trims (cartLen) and
            // crossfade overlaps (fadeAfter) across every chained item, not just
            // the one currently audible.
            el('.dj-deck-endtime').textContent = 'ENDS AT: ' + fmtClockSec(new Date(Date.now() + Math.max(0, remain) * 1000));
            const len = cartLen(c) || 0;
            el('.dj-deck-wash').style.width = len > 0 ? `${Math.min(100, (done / len) * 100)}%` : '0%';
        }
        function tick() {
            if (!deck.playing) return;
            const a = curAudio(), c = curCart();
            if (!a || !c) { stop(); return; }
            // Ring out finished tails (every non-current audio past its end).
            deck.audios.forEach((aud, k) => {
                if (k !== deck.idx && aud && !aud.paused) {
                    const cc = deck.items[k];
                    if (aud.ended || aud.currentTime >= cartEnd(cc, aud) - 0.03) { try { aud.pause(); } catch (e) {} }
                }
            });
            const end = cartEnd(c, a);
            const last = deck.idx >= deck.items.length - 1;
            const lead = last ? 0 : fadeAfter(c) / 1000;
            if (a.ended || a.currentTime >= end - 0.03 - lead) {
                if (!last) advance();                      // chain: launch the next, tail rings
                else if (deck.repeat) restart();           // loop the whole load
                else if (a.ended || a.currentTime >= end - 0.03) finish();
            }
            refreshTime();
        }
        function advance() {
            deck.idx++;
            const c = curCart(), a = curAudio();
            try { a.currentTime = c.start || 0; } catch (e) {}
            a.volume = c.volume != null ? c.volume : 1;
            a.play().catch(() => {});
            drawCurrentWave();
            paint();
        }
        function restart() {
            deck.audios.forEach((a) => { try { a.pause(); } catch (e) {} });
            deck.idx = 0;
            const c = curCart(), a = curAudio();
            try { a.currentTime = c.start || 0; } catch (e) {}
            a.play().catch(() => {});
            drawCurrentWave();
            paint();
        }
        // Natural end (no repeat): the deck UNLOADS itself — empty and ready
        // for the next fire, like a real cart machine spitting the cart out.
        function finish() {
            deck.playing = false;
            clearInterval(deck.timer); deck.timer = null;
            clearDeck();
        }
        function clearDeck() {
            deck.audios.forEach((a) => { try { a.pause(); } catch (e) {} });
            deck.items = []; deck.audios = []; deck.idx = -1;
            vuStop();
            el('.dj-deck-wash').style.width = '0%';
            el('.dj-deck-remain').textContent = '0:00';
            el('.dj-deck-len').textContent = '0:00';
            el('.dj-deck-time').classList.remove('ending');
            el('.dj-deck-endtime').textContent = '';
            // paint() only ever SETS --deck-color (never had a reason to clear
            // it) — an unloaded deck must drop the last cart's colour accent
            // too, or the border tint lingers on an otherwise-empty deck.
            root.style.removeProperty('--deck-color');
            // The unloaded cart's PFL preview (if this deck's button sent it)
            // no longer refers to anything on this deck — drop it too.
            if (pflState && pflState.btn === el('.dj-deck-pfl')) pflStop();
            paint();
        }
        function load(c) {
            if (deck.playing) { toast(`Player ${no} is on air — stop it first`); return; }
            if (pflState && pflState.btn === el('.dj-deck-pfl')) pflStop();
            deck.audios.forEach((a) => { try { a.pause(); } catch (e) {} });
            deck.items = chainRun(c);
            deck.audios = deck.items.map((cc) => {
                const a = new Audio(`uploads/${cc.file}`);
                a.preload = 'auto';
                a.volume = cc.volume != null ? cc.volume : 1;
                vuWire(a);
                return a;
            });
            deck.idx = 0;
            const a = curAudio();
            a.addEventListener('loadedmetadata', () => { try { a.currentTime = c.start || 0; } catch (e) {} refreshTime(); });
            drawCurrentWave();
            paint();
            refreshTime();
        }
        function playPause() {
            if (!loaded()) return;
            const a = curAudio();
            const c = curCart();
            if (deck.playing) {
                deck.playing = false;
                try { a.pause(); } catch (e) {}
                // A pause mid-fade silences any ringing tail too.
                deck.audios.forEach((aud, k) => { if (k !== deck.idx) { try { aud.pause(); } catch (e) {} } });
                clearInterval(deck.timer); deck.timer = null;
                if (c) logPlayback(c.name, 'stopped');
            } else {
                pflStop(); // a deck going on air silences the PFL preview
                deck.playing = true;
                a.play().catch(() => { deck.playing = false; toast('Could not start playback'); });
                deck.timer = setInterval(tick, 100);
                vuStart();
                if (c) logPlayback(c.name, 'played');
            }
            if (!deck.playing) vuStop();
            paint();
        }
        function stop() {
            const wasPlaying = deck.playing;
            const stoppedCart = curCart();
            deck.playing = false;
            clearInterval(deck.timer); deck.timer = null;
            deck.audios.forEach((a) => { try { a.pause(); } catch (e) {} });
            deck.idx = 0;
            vuStop();
            if (wasPlaying && stoppedCart) logPlayback(stoppedCart.name, 'stopped');
            const c = curCart(), a = curAudio();
            if (a && c) { try { a.currentTime = c.start || 0; } catch (e) {} }
            drawCurrentWave();
            paint();
            refreshTime();
        }
        function eject() {
            if (deck.playing) return;
            clearDeck();
        }
        function applyRouting() {
            const out = (window.ROUTING || {})['player' + no] || no;
            el('.dj-deck-out').textContent = 'OUT ' + out;
        }

        el('.dj-deck-play').addEventListener('click', playPause);
        el('.dj-deck-stop').addEventListener('click', stop);
        el('.dj-deck-eject').addEventListener('click', eject);
        el('.dj-deck-repeat').addEventListener('click', () => { deck.repeat = !deck.repeat; paint(); });
        el('.dj-deck-pfl').addEventListener('click', () => { const c = curCart(); if (c) sendToPFL(c, el('.dj-deck-pfl')); });
        applyRouting();
        paint();
        return { load, stop, applyRouting, isPlaying: () => deck.playing, redraw: drawCurrentWave };
    }
    const decks = [];

    // How many of the 3 decks the Options tab currently allows (1-3). Hidden
    // decks keep playing if something was already loaded — per the manager's
    // own answer, closing Settings refreshes the players page anyway, so no
    // special stop/eject logic runs here.
    function playerCount() {
        const n = (window.SETTINGS && window.SETTINGS.dj_players) || 3;
        return Math.max(1, Math.min(3, n));
    }
    function applyPlayerCount() {
        const n = playerCount();
        for (let d = 1; d <= 3; d++) {
            const el = $('djDeck' + d);
            if (el) el.hidden = d > n;
        }
        if (active) renderTree(); // fire-button columns follow the same count
    }

    // The manager Routing tab's "Allow PFL player" / "Allow PFL buttons"
    // switches — the mini-player and every send button follow live.
    function applyPflSettings() {
        const box = $('djPfl');
        if (box) box.hidden = !pflAllowed();
        if (!pflAllowed()) pflStop();
        document.querySelectorAll('.dj-deck-pfl').forEach((b) => { b.hidden = !pflPlayersAllowed(); });
        if (active) renderTree(); // the tree's own preview button follows the same gate
        pflOutBadge();
    }

    // ---- mode toggle ---------------------------------------------------------
    function apply() {
        document.body.classList.toggle('dj-mode', active);
        $('djMode').hidden = !active;
        const chip = $('chip-djmode');
        // Reversed on purpose: the dot lights for Carts mode (the "off"/
        // inactive DJ state), not for DJ mode itself.
        if (chip) chip.classList.toggle('is-active', !active);
        if (active) { applyPlayerCount(); renderTree(); decks.forEach((d) => d.redraw()); }
        else pflStop(); // decks keep playing across the toggle — audio-safe
        // The docked ring shows its centre digits only when it stands alone
        // (DJ tuck); beside the big digital clock they're redundant.
        if (window.syncDockClockRing) window.syncDockClockRing();
        try { localStorage.setItem(MODE_STORE, active ? '1' : '0'); } catch (e) {}
    }
    function toggle() {
        active = !active;
        apply();
    }
    function stopAll() {
        decks.forEach((d) => d.stop());
        pflStop();
    }

    function init() {
        const chip = $('chip-djmode');
        if (!chip || !$('djMode')) return;
        decks.push(makeDeck(1), makeDeck(2), makeDeck(3));
        chip.addEventListener('click', toggle);
        $('djSearch').addEventListener('input', (e) => {
            query = e.target.value;
            $('djSearchClear').hidden = query === '';
            renderTree();
        });
        $('djSearchClear').addEventListener('click', () => {
            $('djSearch').value = ''; query = '';
            $('djSearchClear').hidden = true;
            renderTree();
        });
        $('djFavFilter').addEventListener('click', (e) => {
            favOnly = !favOnly;
            e.currentTarget.classList.toggle('active', favOnly);
            renderTree();
        });
        const pflStopBtn = $('djPflStop');
        if (pflStopBtn) pflStopBtn.addEventListener('click', pflStop);
        window.addEventListener('resize', () => { if (active) decks.forEach((d) => d.redraw()); });
        // Restore the persisted mode; a first-ever visit (nothing stored yet)
        // starts in DJ mode — that's the out-of-box layout — but a returning
        // visitor's own choice (including switching back to Carts) sticks.
        // Never against the feature switch either way.
        let storedMode = null;
        try { storedMode = localStorage.getItem(MODE_STORE); } catch (e) {}
        active = storedMode === null ? true : storedMode === '1';
        if (!(window.SETTINGS && window.SETTINGS.dj_mode)) active = false;
        applyPlayerCount();
        applyPflSettings();
        apply();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.DJMode = {
        toggle,
        stopAll,
        isActive: () => active,
        // manager Routing tab pushes new assignments live
        applyRouting: () => { decks.forEach((d) => d.applyRouting()); pflOutBadge(); },
        // manager Options tab pushes a new DJ player count live
        applyPlayerCount,
        playerCount,
        // manager Routing tab pushes new PFL allow/deny switches live
        applyPflSettings,
        // audio manager rebuilt window.CARTS on close — rebuild the library
        // (names/colours/chain/fav marks all follow) and repaint loaded decks.
        refresh: () => { if (active) { renderTree(); decks.forEach((d) => d.redraw()); } },
        // Topbar search reuses these so its fire buttons behave identically to
        // the library tree's (chain-aware, no partial-chain loads).
        loadDeck: (n, c) => { const d = decks[n - 1]; if (d) d.load(c); },
        sendToAuto,
    };
})();
