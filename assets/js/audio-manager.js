// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Audio manager (admin-only overlay): its own window, separate from the
 * Station manager.
 *
 * Every slot (incl. empty/disabled placeholders) in a sections list + ONE
 * detail panel: enable/disable, rename (pencil), colour, volume, an inline
 * drag-handle waveform trimmer (wavesurfer.js, no iframe), chain, move,
 * download, upload, clear-slot (two-step confirm). Search has a clear-X and
 * a favourites filter sharing window.FAVORITES with the planner.
 */
(() => {
    if (!window.IS_ADMIN) return;
    const $ = (id) => document.getElementById(id);
    const CAT = { '1': '#2f6fd6', '2': '#2f9e5f', '3': '#b0479e', '4': '#c98a2b', '5': '#2aa7bf' };
    const M = () => window.MANAGER_DATA || { carts: [], labels: [], ticker: '', stationName: '', logo: '', idSectionNames: [] };
    const fmtT = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

    let msgTimer = null;
    function flash(msg, ok) {
        const m = $('audioManagerMsg');
        m.textContent = msg;
        m.classList.toggle('ok', !!ok);
        m.classList.add('show');
        clearTimeout(msgTimer);
        msgTimer = setTimeout(() => m.classList.remove('show'), 2200);
    }
    async function post(url, body) {
        try {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const resp = await r.json();
            if (!resp.ok) { flash(resp.error || 'Save failed'); return null; }
            flash('Saved', true);
            return resp;
        } catch (e) { flash('Save failed — server unreachable'); return null; }
    }

    // ID-window sections (Station IDs, Sweepers & FX) come FIRST — they're
    // distinct floating-window sections, not board pages, so they get their
    // own icon instead of a "(window)" suffix and sit above the board list.
    function audioSections() {
        const L = M().labels;
        const idNames = M().idSectionNames || ['Station IDs', 'Sweepers & FX'];
        const ids = [
            { label: idNames[0] || 'Station IDs', from: 0, to: 10, ids: true },
            { label: idNames[1] || 'Sweepers & FX', from: 110, to: 120, ids: true },
        ];
        const board = [
            { label: L[0] || '1', from: 10, to: 35 }, { label: L[1] || '2', from: 35, to: 60 },
            { label: L[2] || '3', from: 60, to: 85 }, { label: L[3] || '4', from: 85, to: 110 },
            { label: L[4] || '5', from: 120, to: 145 }, { label: L[5] || '6', from: 145, to: 170 },
            { label: L[6] || '7', from: 170, to: 195 }, { label: L[7] || '8', from: 195, to: 220 },
            { label: L[8] || '9', from: 220, to: 245 }, { label: L[9] || '10', from: 245, to: 270 },
        ];
        return [...ids, ...board].filter((s) => s.from < M().carts.length);
    }
    let selId = 0, maQuery = '', favOnly = false;
    const isFav = (id) => (window.FAVORITES || []).includes(id);
    async function toggleFav(id) {
        const set = new Set(window.FAVORITES || []);
        if (set.has(id)) set.delete(id); else set.add(id);
        window.FAVORITES = [...set];
        try {
            await fetch('save-favorites.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: window.FAVORITES }),
            });
        } catch (e) { /* best-effort */ }
    }
    function renderAudioList() {
        const host = $('maList');
        host.innerHTML = '';
        const q = maQuery.trim().toLowerCase();
        const filtering = q !== '' || favOnly;
        audioSections().forEach((sec) => {
            let slots = M().carts.slice(sec.from, Math.min(sec.to, M().carts.length));
            if (q) slots = slots.filter((c) => !c.empty && c.name.toLowerCase().includes(q));
            if (favOnly) slots = slots.filter((c) => isFav(c.id));
            if (!slots.length) return;
            const open = filtering || slots.some((c) => c.id === selId);
            const box = document.createElement('div');
            box.className = 'ptree-section' + (sec.ids ? ' ids' : '') + (open ? '' : ' collapsed');
            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'ptree-head';
            head.innerHTML = `<span class="ptree-exp">${open ? '−' : '+'}</span>` +
                (sec.ids ? '<i class="ph ph-squares-four ma-ids-icon" title="Floating window section"></i>' : '') +
                `<span></span><em>${slots.filter((c) => !c.empty).length}</em>`;
            head.querySelectorAll('span')[1].textContent = sec.label;
            head.addEventListener('click', () => {
                const closed = box.classList.toggle('collapsed');
                head.querySelector('.ptree-exp').textContent = closed ? '+' : '−';
            });
            box.appendChild(head);
            const list = document.createElement('div');
            list.className = 'ptree-list';
            slots.forEach((c) => {
                const row = document.createElement('div');
                row.className = 'ptree-cart ma-item' + (c.id === selId ? ' sel' : '') + (c.empty ? ' emptyslot' : '') + (!c.empty && !c.enabled ? ' off' : '');
                const fav = isFav(c.id);
                row.innerHTML =
                    `<span class="ma-slot">${c.id}</span>` +
                    `<span class="ptree-dot" style="background:${c.empty ? 'transparent' : (CAT[c.color] || CAT['1'])}"></span>` +
                    `<span class="ptree-name"></span>` +
                    (c.cross ? '<i class="ph ph-link ma-linked" title="Chained to the next cart"></i>' : '') +
                    (c.empty ? '' : `<button type="button" class="ptree-star${fav ? ' faved' : ''}" title="Favourite"><i class="${fav ? 'ph-fill' : 'ph'} ph-star"></i></button>`);
                row.querySelector('.ptree-name').textContent = c.empty ? '(empty)' : c.name;
                row.addEventListener('click', () => selectCart(c.id));
                const starBtn = row.querySelector('.ptree-star');
                if (starBtn) starBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await toggleFav(c.id);
                    const on = isFav(c.id);
                    starBtn.classList.toggle('faved', on);
                    starBtn.innerHTML = `<i class="${on ? 'ph-fill' : 'ph'} ph-star"></i>`;
                    if (favOnly) renderAudioList();
                });
                list.appendChild(row);
            });
            box.appendChild(list);
            host.appendChild(box);
        });
    }
    function cart(id) { return M().carts.find((c) => c.id === id); }
    // The LIVE player islands (window.CARTS drives the board, DJ decks and
    // the autoplayer) must follow manager edits immediately — a stale island
    // was why fresh chain fades seemed ignored until a full reload.
    function syncLiveCart(id, patch) {
        const live = (window.CARTS || []).find((x) => x.i === id - 1);
        if (live) Object.assign(live, patch);
    }

    // -- Inline waveform trimmer (replaces the old iframe trimmer pages) --------
    let ws = null, wsHandlesWired = false, dragging = null; // 'start' | 'end' | null
    let trimStart = 0, trimEnd = 0, trimDur = 0, savedStart = 0, savedEnd = 0;
    function destroyWs() {
        if (ws) { try { ws.destroy(); } catch (e) {} ws = null; }
        // Belt-and-suspenders: WaveSurfer.destroy() can leave its canvas/wrapper
        // behind if a decode was still in flight, and a new instance created
        // alongside that leftover DOM is what caused the "collapsed on return"
        // waveform bug. Force the container empty before the next create().
        const host = $('maWaveform');
        if (host) host.innerHTML = '';
    }
    // Full length (this file, untrimmed) + the currently-SAVED trim, shown
    // beside the name. Deliberately not driven by the live drag — that's what
    // the trimmer's own Start/End/Length readout is for; this one only moves
    // when a trim is actually saved (or a different cart is selected).
    function updateLengthInfo() {
        const el = $('maLengthInfo');
        if (el) el.textContent = `${fmtT(trimDur)} full · ${fmtT(savedEnd - savedStart)} trimmed`;
    }
    function updateHandlePositions() {
        if (!trimDur) return;
        const wrap = document.querySelector('.ma-wave-wrap');
        if (!wrap) return;
        const w = wrap.clientWidth;
        $('maHandleStart').style.left = Math.round((trimStart / trimDur) * w) + 'px';
        $('maHandleEnd').style.left = Math.round((trimEnd / trimDur) * w) + 'px';
        $('maTStart').textContent = fmtT(trimStart);
        $('maTEnd').textContent = fmtT(trimEnd);
        $('maTLen').textContent = fmtT(trimEnd - trimStart);
        updateTrimSaveState();
    }
    // Save trim starts disabled; it only enables (with a glowing highlight,
    // never a size/visibility change so it can't shove neighbouring buttons
    // around) once the handles actually differ from what's saved.
    function updateTrimSaveState() {
        const btn = $('maTrimSave');
        const dirty = Math.abs(trimStart - savedStart) > 0.01 || Math.abs(trimEnd - savedEnd) > 0.01;
        btn.disabled = !dirty;
        btn.classList.toggle('dirty', dirty);
    }
    function wireHandleDrag() {
        if (wsHandlesWired) return;
        wsHandlesWired = true;
        const onMove = (e) => {
            if (!dragging || !trimDur) return;
            const wrap = document.querySelector('.ma-wave-wrap');
            const rect = wrap.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const secs = (x / rect.width) * trimDur;
            const MIN_GAP = 0.1;
            if (dragging === 'start') trimStart = Math.min(secs, trimEnd - MIN_GAP);
            else trimEnd = Math.max(secs, trimStart + MIN_GAP);
            trimStart = Math.max(0, trimStart);
            trimEnd = Math.min(trimDur, trimEnd);
            updateHandlePositions();
        };
        const onUp = () => { dragging = null; };
        $('maHandleStart').addEventListener('pointerdown', () => { dragging = 'start'; });
        $('maHandleEnd').addEventListener('pointerdown', () => { dragging = 'end'; });
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }
    function loadTrimmer(c) {
        destroyWs();
        wireHandleDrag();
        ws = WaveSurfer.create({
            container: '#maWaveform', height: 60,
            waveColor: '#4a5a78', progressColor: '#34c3d4', cursorColor: '#eef1f5',
            normalize: true, barWidth: 2, barGap: 1,
        });
        ws.load('uploads/' + c.file);
        ws.on('ready', () => {
            trimDur = ws.getDuration();
            trimStart = savedStart = Math.min(c.start || 0, trimDur);
            trimEnd = savedEnd = c.end != null ? Math.min(c.end, trimDur) : trimDur;
            updateHandlePositions();
            updateLengthInfo();
        });
        ws.on('finish', () => resetPlayButtons());
    }
    function resetPlayButtons() {
        $('maPlayFull').innerHTML = '<i class="ph-fill ph-play"></i> Play';
        $('maPlayTrim').innerHTML = '<i class="ph ph-brackets-square"></i> Play trimmed';
    }
    function playFull() {
        if (!ws) return;
        if (ws.isPlaying()) { ws.pause(); resetPlayButtons(); return; }
        resetPlayButtons();
        ws.play(0);
        $('maPlayFull').innerHTML = '<i class="ph-fill ph-stop"></i> Stop';
    }
    function playTrimmed() {
        if (!ws) return;
        if (ws.isPlaying()) { ws.pause(); resetPlayButtons(); return; }
        resetPlayButtons();
        ws.play(trimStart, trimEnd);
        $('maPlayTrim').innerHTML = '<i class="ph-fill ph-stop"></i> Stop';
    }
    async function saveTrim() {
        if (await post('save-cart.php', { op: 'update', id: selId, start: trimStart, end: trimEnd })) {
            Object.assign(cart(selId), { start: trimStart, end: trimEnd });
            syncLiveCart(selId, { start: trimStart, end: trimEnd });
            savedStart = trimStart; savedEnd = trimEnd;
            updateTrimSaveState();
            updateLengthInfo();
        }
    }

    // ---- chain crossfade editor -----------------------------------------------
    // EDIT CHAIN (visible when the selected cart belongs to a chain run of 2+)
    // opens the run — capped at 5 items — as staggered waveform lanes, one per
    // cart. Dragging a lane LEFT deepens its crossfade into the previous item
    // (capped at 30% of the shorter neighbour); each lane carries the same
    // volume line as the planner's cross editor. Save writes the fades onto
    // cross.txt (flag|ms) and the volumes onto the carts themselves — the
    // detail panel's volume slider follows. Board playout and the DJ decks
    // both honour the saved plan.
    const CHAIN_MAX = 5;
    let edCtx = null;              // shared decode/VU context
    const edBufs = {};             // file -> AudioBuffer | Promise
    let ed = null;                 // { run, fades[], vols[], openFades, openVols }
    let edDrag = null;             // { type:'fade'|'vol', k, startX?, startMs? }
    let edPrev = null;             // preview { audios, t0, timer, vuTimer, srcs, analyser }
    function edBuffer(file) {
        if (edBufs[file] instanceof AudioBuffer) return Promise.resolve(edBufs[file]);
        if (!edBufs[file]) {
            edCtx = edCtx || new (window.AudioContext || window.webkitAudioContext)();
            edBufs[file] = fetch('uploads/' + file)
                .then((r) => r.arrayBuffer())
                .then((buf) => edCtx.decodeAudioData(buf))
                .then((decoded) => { edBufs[file] = decoded; return decoded; })
                .catch(() => null);
        }
        return Promise.resolve(edBufs[file]);
    }
    function edDrawWave(canvas, buffer, fromSec, toSec) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const key = `${w}x${h}|${fromSec}|${toSec}|${!!buffer}`;
        if (canvas.dataset.wkey === key) return;
        canvas.dataset.wkey = key;
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
        g.fillStyle = 'rgba(255, 255, 255, 0.7)';
        for (let i = 0; i < bars; i++) {
            let peak = 0;
            const from = s0 + i * per, to = Math.min(s1, from + per);
            for (let j = from; j < to; j += 16) peak = Math.max(peak, Math.abs(data[j]));
            const bh = Math.max(1, peak * (h - 6));
            g.fillRect(i * 3, (h - bh) / 2, 2, bh);
        }
    }
    // Trimmed length; falls back to the decoded duration (then a placeholder)
    // for carts without an end trim, and relayouts once decoding lands.
    function edLen(c) {
        const end = c.end != null ? c.end : (edBufs[c.file] instanceof AudioBuffer ? edBufs[c.file].duration : null);
        return end != null ? Math.max(0.5, end - (c.start || 0)) : 3;
    }
    // The chain run containing cart `id`: walk back over predecessors that
    // chain into us, forward while we chain onward. Empty slots end a run.
    function chainRunFor(id) {
        const carts = M().carts;
        let s = id;
        while (s > 1 && carts[s - 2] && !carts[s - 2].empty && carts[s - 2].cross === 1 && !carts[s - 1].empty) s--;
        let e = id;
        while (carts[e - 1] && !carts[e - 1].empty && carts[e - 1].cross === 1 && carts[e] && !carts[e].empty) e++;
        return carts.slice(s - 1, e);
    }
    function updateChainEditBtn() {
        const btn = $('maChainEdit');
        if (!btn) return;
        const c = cart(selId);
        btn.hidden = !c || c.empty || chainRunFor(selId).length < 2;
    }
    function edStarts() {
        const xs = [0];
        for (let k = 1; k < ed.run.length; k++) xs.push(xs[k - 1] + edLen(ed.run[k - 1]) - ed.fades[k - 1] / 1000);
        return xs;
    }
    function edTotal() {
        const xs = edStarts();
        return xs[xs.length - 1] + edLen(ed.run[ed.run.length - 1]);
    }
    // Safety: a lane may reach back at most 25% INTO the track above it —
    // the fade can never exceed a quarter of the previous item's length.
    function edMaxFade(k) {
        return Math.round(Math.min(10000, 0.25 * edLen(ed.run[k - 1]) * 1000));
    }
    function chainEdOpen() {
        let run = chainRunFor(selId);
        if (run.length < 2) return;
        let note = '';
        if (run.length > CHAIN_MAX) {
            note = `Chain has ${run.length} items — editing the first ${CHAIN_MAX}`;
            run = run.slice(0, CHAIN_MAX);
        }
        if (ws && ws.isPlaying()) ws.pause(); // silence the trimmer preview
        ed = {
            run,
            fades: run.slice(0, -1).map((c) => Math.max(0, c.chainFade || 0)),
            vols: run.map((c) => (c.volume != null ? c.volume : 1)),
        };
        ed.openFades = [...ed.fades];
        ed.openVols = [...ed.vols];
        $('chainEdNote').textContent = note;
        $('chainEdTitle').textContent = `Chain crossfade — ${run.length} items`;
        buildChainLanes();
        $('chainEditor').hidden = false;
        run.forEach((c) => edBuffer(c.file).then(() => { if (ed) layoutChainLanes(); }));
        layoutChainLanes();
    }
    function chainEdClose() {
        chainEdStop();
        edDrag = null;
        ed = null;
        $('chainEditor').hidden = true;
    }
    function buildChainLanes() {
        const host = $('chainLanes');
        host.querySelectorAll('.chain-lane').forEach((n) => n.remove());
        ed.run.forEach((c, k) => {
            const lane = document.createElement('div');
            lane.className = 'chain-lane';
            lane.innerHTML =
                `<div class="chain-block" data-k="${k}">` +
                    `<canvas class="cross-wave"></canvas>` +
                    `<div class="cross-vol-line"></div>` +
                    `<div class="cross-vol-handle" title="Volume"><span></span></div>` +
                    `<span class="chain-block-name"></span>` +
                    (k > 0 ? `<span class="chain-fade-label"></span>` : '') +
                    (k > 0 ? `<i class="ph ph-arrows-left-right cross-drag-hint"></i>` : '') +
                `</div>`;
            const blk = lane.querySelector('.chain-block');
            blk.style.setProperty('--blk', CAT[c.color] || CAT['1']);
            lane.querySelector('.chain-block-name').textContent = c.name;
            // Volume handle: vertical drag (never starts a fade drag).
            lane.querySelector('.cross-vol-handle').addEventListener('pointerdown', (e) => {
                if (edPrev) { chainEdStop(); return; }
                e.preventDefault();
                e.stopPropagation();
                edDrag = { type: 'vol', k };
            });
            // Fade drag: the lane block itself, from the second lane on.
            blk.addEventListener('pointerdown', (e) => {
                if (edPrev) { chainEdStop(); return; } // touching stops the preview
                if (k === 0) return;
                e.preventDefault();
                edDrag = { type: 'fade', k, startX: e.clientX, startMs: ed.fades[k - 1] };
            });
            host.appendChild(lane);
        });
    }
    function layoutChainLanes(skipWaves) {
        if (!ed) return;
        const host = $('chainLanes');
        const w = host.clientWidth || 1;
        const total = edTotal();
        const px = (s) => Math.round((s / total) * w);
        const xs = edStarts();
        host.querySelectorAll('.chain-block').forEach((blk, k) => {
            const c = ed.run[k];
            blk.style.left = px(xs[k]) + 'px';
            blk.style.width = px(edLen(c)) + 'px';
            const y = ((1 - ed.vols[k]) * 100).toFixed(1) + '%';
            blk.querySelector('.cross-vol-line').style.top = y;
            const hd = blk.querySelector('.cross-vol-handle');
            hd.style.top = y;
            hd.querySelector('span').textContent = Math.round(ed.vols[k] * 100) + '%';
            const fl = blk.querySelector('.chain-fade-label');
            if (fl) fl.textContent = ed.fades[k - 1] > 0 ? `${(ed.fades[k - 1] / 1000).toFixed(2)}s cross` : 'no cross';
            // Waveforms are skipped while a drag is in flight — re-rendering
            // canvases at pointer-move rate is what made the browser choke.
            if (!skipWaves) {
                const buf = edBufs[c.file] instanceof AudioBuffer ? edBufs[c.file] : null;
                edDrawWave(blk.querySelector('canvas'), buf, c.start || 0, (c.start || 0) + edLen(c));
            }
        });
        $('chainEdInfo').textContent = `chain total ${fmtT(total)}`;
        const dirty = JSON.stringify(ed.fades) !== JSON.stringify(ed.openFades) ||
                      JSON.stringify(ed.vols) !== JSON.stringify(ed.openVols);
        $('chainEdSave').disabled = !dirty;
        $('chainEdSave').classList.toggle('dirty', dirty);
    }
    function chainEdStop() {
        if (!edPrev) return;
        const p = edPrev;
        edPrev = null;
        clearInterval(p.timer);
        clearInterval(p.vuTimer);
        p.audios.forEach((a) => { try { a.pause(); } catch (e) {} });
        [...(p.srcs || []), p.analyser].forEach((n) => { try { n && n.disconnect(); } catch (e) {} });
        $('chainVuFill').style.width = '0%';
        $('chainPlayhead').hidden = true;
        $('chainEdPlay').innerHTML = '<i class="ph-fill ph-play"></i> Play';
    }
    function chainEdPlayToggle() {
        if (edPrev) { chainEdStop(); return; }
        if (!ed) return;
        const xs = edStarts(), total = edTotal();
        const audios = ed.run.map((c, k) => {
            const a = new Audio('uploads/' + c.file);
            a.volume = ed.vols[k];
            try { a.currentTime = c.start || 0; } catch (e) {}
            return a;
        });
        const p = { audios, t0: performance.now(), started: ed.run.map((_, k) => k === 0) };
        // Combined VU (+25% display gain), same meter language as the planner.
        try {
            edCtx = edCtx || new (window.AudioContext || window.webkitAudioContext)();
            edCtx.resume();
            p.analyser = edCtx.createAnalyser();
            p.analyser.fftSize = 512;
            p.srcs = audios.map((a) => { const s = edCtx.createMediaElementSource(a); s.connect(p.analyser); return s; });
            p.analyser.connect(edCtx.destination);
            const buf = new Uint8Array(p.analyser.fftSize);
            p.vuTimer = setInterval(() => {
                p.analyser.getByteTimeDomainData(buf);
                let peak = 0;
                for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v; }
                $('chainVuFill').style.width = Math.min(100, Math.round(peak * 125)) + '%';
            }, 33);
        } catch (e) { /* no VU is never fatal */ }
        audios[0].play().catch(() => {});
        p.timer = setInterval(() => {
            if (!ed) { chainEdStop(); return; }
            const t = (performance.now() - p.t0) / 1000;
            if (t >= total) { chainEdStop(); return; }
            ed.run.forEach((c, k) => {
                if (!p.started[k] && t >= xs[k]) { p.started[k] = true; audios[k].play().catch(() => {}); }
                const end = (c.start || 0) + edLen(c);
                if (p.started[k] && !audios[k].paused && (audios[k].ended || audios[k].currentTime >= end - 0.03)) {
                    try { audios[k].pause(); } catch (e) {}
                }
            });
            const ph = $('chainPlayhead');
            ph.hidden = false;
            ph.style.left = Math.round((t / total) * ($('chainLanes').clientWidth || 1)) + 'px';
        }, 40);
        edPrev = p;
        $('chainEdPlay').innerHTML = '<i class="ph-fill ph-stop"></i> Stop';
    }
    async function chainEdSave() {
        if (!ed) return;
        chainEdStop();
        // Volume changes belong to the CARTS (permanent, everywhere).
        for (let k = 0; k < ed.run.length; k++) {
            if (ed.vols[k] !== ed.openVols[k]) {
                if (!await post('save-cart.php', { op: 'update', id: ed.run[k].id, volume: ed.vols[k] })) return;
                ed.run[k].volume = ed.vols[k];
                syncLiveCart(ed.run[k].id, { volume: ed.vols[k] });
            }
        }
        // Fades belong to the chain (cross.txt's second field).
        if (JSON.stringify(ed.fades) !== JSON.stringify(ed.openFades)) {
            if (!await post('save-cart.php', { op: 'chainfades', id: ed.run[0].id, fades: ed.fades })) return;
            ed.fades.forEach((ms, k) => {
                ed.run[k].chainFade = ms;
                syncLiveCart(ed.run[k].id, { chainFade: ms });
            });
        }
        // "Update the volume slider in the previous page": the detail panel
        // may be showing one of the run's carts.
        const cur = cart(selId);
        if (cur && !cur.empty) {
            $('maVolume').value = Math.round((cur.volume != null ? cur.volume : 1) * 100);
            $('maVolVal').textContent = $('maVolume').value + '%';
        }
        renderAudioList();
        chainEdClose();
    }
    function wireChainEditor() {
        $('maChainEdit').addEventListener('click', chainEdOpen);
        $('chainEdPlay').addEventListener('click', chainEdPlayToggle);
        $('chainEdSave').addEventListener('click', chainEdSave);
        $('chainEdCancel').addEventListener('click', chainEdClose);
        document.addEventListener('pointermove', (e) => {
            if (!edDrag || !ed) return;
            if (edDrag.type === 'vol') {
                const blk = $('chainLanes').querySelectorAll('.chain-block')[edDrag.k];
                const r = blk.getBoundingClientRect();
                ed.vols[edDrag.k] = Math.round(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / (r.height || 1))) * 100) / 100;
            } else {
                // Dragging LEFT deepens the fade into the previous lane.
                const msPerPx = (edTotal() * 1000) / ($('chainLanes').clientWidth || 1);
                const val = edDrag.startMs + (edDrag.startX - e.clientX) * msPerPx;
                ed.fades[edDrag.k - 1] = Math.round(Math.max(0, Math.min(edMaxFade(edDrag.k), val)));
            }
            layoutChainLanes(true); // waves redraw once, on release
        });
        document.addEventListener('pointerup', () => {
            if (edDrag && ed) layoutChainLanes(false);
            edDrag = null;
        });
        window.addEventListener('resize', () => { if (ed) layoutChainLanes(false); });
    }

    function selectCart(id) {
        selId = id;
        destroyWs();
        const c = cart(id);
        $('maEmptyHint').hidden = true;
        $('maDeleteConfirm').hidden = true; $('maDelete').hidden = false;
        // Empty slot: nothing but the uploader until a file lands — none of
        // enable/name/colour/volume/trim/chain/move/download mean anything yet.
        if (c.empty) {
            $('maForm').hidden = true;
            $('maEmptyUpload').hidden = false;
            renderAudioList();
            return;
        }
        $('maEmptyUpload').hidden = true;
        $('maForm').hidden = false;
        $('maEnabled').checked = c.enabled !== 0;
        $('maEnabled').disabled = false;
        $('maNameText').textContent = c.name;
        $('maName').value = c.name;
        $('maName').hidden = true; $('maNameText').hidden = false;
        $('maVolume').value = Math.round((c.volume != null ? c.volume : 1) * 100);
        $('maVolVal').textContent = $('maVolume').value + '%';
        $('maChain').checked = !!c.cross;
        $('maDownload').href = 'uploads/' + c.file;
        $('maDownload').download = c.name.replace(/[^\w -]+/g, '_') + '.mp3';
        updateChainEditBtn();
        updateFavBtn();
        renderSwatches(c.color);
        renderMoveSlots(id);
        loadTrimmer(c);
        renderAudioList();
    }
    function renderSwatches(active) {
        const host = $('maSwatches');
        host.innerHTML = '';
        Object.entries(CAT).forEach(([code, hex]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ma-swatch' + (code === active ? ' active' : '');
            b.style.background = hex;
            b.addEventListener('click', async () => {
                if (await post('save-cart.php', { op: 'update', id: selId, color: code })) {
                    cart(selId).color = code;
                    renderSwatches(code);
                    renderAudioList();
                }
            });
            host.appendChild(b);
        });
    }
    function renderMoveSlots(id) {
        const sel = $('maMoveSlot');
        sel.innerHTML = '';
        audioSections().forEach((sec) => {
            const g = document.createElement('optgroup');
            g.label = sec.label;
            M().carts.slice(sec.from, sec.to).forEach((c) => {
                const o = document.createElement('option');
                o.value = c.id;
                o.textContent = `${c.id} — ${c.empty ? '(empty)' : c.name}`;
                if (c.id === id) o.selected = true;
                g.appendChild(o);
            });
            sel.appendChild(g);
        });
    }
    // Favourite star beside the rename pencil — same station-wide list the
    // tree rows, planner and DJ library share.
    function updateFavBtn() {
        const btn = $('maFav');
        if (!btn) return;
        const on = isFav(selId);
        btn.innerHTML = `<i class="${on ? 'ph-fill' : 'ph'} ph-star"></i>`;
        btn.classList.toggle('faved', on);
    }

    function wireAudioTab() {
        $('maFav').addEventListener('click', async () => {
            await toggleFav(selId);
            updateFavBtn();
            renderAudioList();
        });
        $('maSearch').addEventListener('input', (e) => {
            maQuery = e.target.value;
            $('maSearchClear').hidden = maQuery === '';
            renderAudioList();
        });
        $('maSearchClear').addEventListener('click', () => {
            $('maSearch').value = ''; maQuery = '';
            $('maSearchClear').hidden = true;
            renderAudioList();
        });
        $('maFavFilter').addEventListener('click', (e) => {
            favOnly = !favOnly;
            e.currentTarget.classList.toggle('active', favOnly);
            renderAudioList();
        });
        $('maEnabled').addEventListener('change', async () => {
            const on = $('maEnabled').checked;
            if (await post('save-cart.php', { op: 'enable', id: selId, enabled: on ? 1 : 0 })) {
                cart(selId).enabled = on ? 1 : 0;
                renderAudioList();
            }
        });
        // Name: plain text + pencil (matches the planner's rename pattern).
        $('maNameEdit').addEventListener('click', () => {
            $('maNameText').hidden = true;
            $('maName').hidden = false;
            $('maName').focus(); $('maName').select();
        });
        $('maName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('maName').blur(); });
        $('maName').addEventListener('blur', async () => {
            const name = $('maName').value.trim();
            if (await post('save-cart.php', { op: 'update', id: selId, name })) {
                cart(selId).name = name || '-';
                $('maNameText').textContent = cart(selId).name;
                renderAudioList();
            }
            $('maName').hidden = true; $('maNameText').hidden = false;
        });
        $('maVolume').addEventListener('input', () => { $('maVolVal').textContent = $('maVolume').value + '%'; });
        $('maVolume').addEventListener('change', async () => {
            const v = (+$('maVolume').value) / 100;
            if (await post('save-cart.php', { op: 'update', id: selId, volume: v })) {
                cart(selId).volume = v;
                syncLiveCart(selId, { volume: v });
            }
        });
        $('maChain').addEventListener('change', async () => {
            const on = $('maChain').checked;
            if (await post('save-cart.php', { op: 'chain', id: selId, cross: on ? 1 : 0 })) {
                cart(selId).cross = on ? 1 : 0;
                if (!on) cart(selId).chainFade = 0; // server zeroes the fade too
                syncLiveCart(selId, { cross: on ? 1 : 0, ...(on ? {} : { chainFade: 0 }) });
                updateChainEditBtn();
                renderAudioList();
            } else {
                // Refused (e.g. the 5-item chain cap) — snap the switch back.
                $('maChain').checked = !on;
            }
        });
        $('maPlayFull').addEventListener('click', playFull);
        $('maPlayTrim').addEventListener('click', playTrimmed);
        $('maTrimSave').addEventListener('click', saveTrim);
        // Upload new audio into the slot (or replace what's there). Trims
        // reset server-side — they belonged to the old file. Client-side
        // gate on type/size too, so a bad pick fails fast with a clear reason.
        $('maAudioUpload').addEventListener('click', () => $('maAudioFile').click());
        $('maEmptyUploadBtn').addEventListener('click', () => $('maAudioFile').click());
        $('maAudioFile').addEventListener('change', async () => {
            const f = $('maAudioFile').files[0];
            if (!f) return;
            if (!/\.mp3$/i.test(f.name) && f.type !== 'audio/mpeg') { flash('Only .mp3 files are accepted'); $('maAudioFile').value = ''; return; }
            if (f.size > 30 * 1024 * 1024) { flash('Too big — max 30 MB (~30 min)'); $('maAudioFile').value = ''; return; }
            const fd = new FormData();
            fd.append('id', selId);
            fd.append('audio', f);
            try {
                const r = await fetch('upload-audio.php', { method: 'POST', body: fd });
                const resp = await r.json();
                if (!resp.ok) { flash(resp.error || 'Upload failed'); return; }
                Object.assign(cart(selId), { file: resp.file, name: resp.name, start: 0, end: null, empty: false });
                selectCart(selId);
                flash('Audio saved', true);
            } catch (e) { flash('Upload failed'); }
            $('maAudioFile').value = '';
        });
        $('maMoveBtn').addEventListener('click', async () => {
            const to = +$('maMoveSlot').value;
            if (!to || to === selId) return;
            if (await post('save-cart.php', { op: 'move', id: selId, to })) {
                const carts = M().carts;
                const moved = carts.splice(selId - 1, 1)[0];
                carts.splice(to - 1, 0, moved);
                carts.forEach((c, i) => { c.id = i + 1; });
                selectCart(to);
            }
        });
        // Clear this slot: two-step "are you sure" instead of a modal.
        $('maDelete').addEventListener('click', () => { $('maDelete').hidden = true; $('maDeleteConfirm').hidden = false; });
        $('maDeleteNo').addEventListener('click', () => { $('maDeleteConfirm').hidden = true; $('maDelete').hidden = false; });
        $('maDeleteYes').addEventListener('click', async () => {
            if (await post('save-cart.php', { op: 'delete', id: selId })) {
                Object.assign(cart(selId), { name: '-', file: '0.mp3', start: 0, end: null, volume: 1, color: '1', cross: 0, enabled: 1, empty: true });
                selectCart(selId);
            }
        });
    }

    // ---- shell ------------------------------------------------------------------
    function open() {
        renderAudioList();
        $('audioManagerOverlay').hidden = false;
        document.addEventListener('keydown', onKey);
    }
    function close() {
        chainEdClose();
        if (ws && ws.isPlaying()) ws.pause();
        destroyWs();
        // destroyWs() empties the waveform container, so a reopen with the old
        // selection still up would show a broken (blank) trimmer. Drop the
        // selection and put the detail panel back on the intro page — the next
        // open starts clean, and picking the item again rebuilds the wave.
        selId = 0;
        $('maForm').hidden = true;
        $('maEmptyUpload').hidden = true;
        $('maEmptyHint').hidden = false;
        $('audioManagerOverlay').hidden = true;
        document.removeEventListener('keydown', onKey);
        // Rebuild the live island (drives the DJ library + decks, the board
        // and the autoplayer) from the manager's now-authoritative data, so
        // EVERY edit — name, colour, trim, volume, chain, enable, move,
        // delete — shows without a page reload. Mirrors index.php's filter:
        // only real, enabled carts appear.
        window.CARTS = M().carts
            .filter((c) => !c.empty && c.enabled !== 0)
            .map((c) => ({
                i: c.id - 1, name: c.name, file: c.file, start: c.start, color: c.color,
                end: c.end, volume: c.volume != null ? c.volume : 1,
                cross: c.cross || 0, chainFade: c.chainFade || 0,
            }));
        if (window.DJMode && window.DJMode.refresh) window.DJMode.refresh();
        // Cart edits may have changed the board / ID windows / clock too —
        // refresh what's behind, holding the (opaque) overlay 2.5s longer.
        if (window.refreshPlayerWindows) window.refreshPlayerWindows(2500);
    }
    function onKey(e) {
        if (e.key !== 'Escape' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (!$('chainEditor').hidden) { chainEdClose(); return; } // one Esc closes the editor first
        close();
    }

    function init() {
        const openBtn = $('chip-audiomgr');
        if (openBtn) openBtn.addEventListener('click', open);
        $('audioManagerClose').addEventListener('click', close);
        wireAudioTab();
        wireChainEditor();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.AudioManager = { open, close };
})();
