// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Audio library manager (admin-only overlay): its own window, separate from
 * the Station manager.
 *
 * Every slot (incl. empty/disabled placeholders) in a sections list + ONE
 * detail panel: enable/disable, rename (pencil), colour, volume, an inline
 * drag-handle waveform trimmer (wavesurfer.js, no iframe), chain, move,
 * download, upload, clear-slot (two-step confirm). Search has a clear-X and
 * a favourites filter sharing window.FAVORITES with the planner.
 *
 * Field edits (enable/name/volume/chain/colour/trim, and the chain crossfade
 * editor's own Save) are a local draft, committed to the server only on
 * Save & Close — Cancel discards them (confirming first if dirty), just like
 * the Station manager and the planner. Move/Delete/Upload stay immediate,
 * structural actions (reordering carts.txt lines, replacing audio content) —
 * the same way Maintenance's backup/restore/danger-zone stay immediate in the
 * Station manager — and each silently flushes any pending draft edits first
 * so the server is never left inconsistent with what's on screen.
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
            return resp;
        } catch (e) { flash('Save failed — server unreachable'); return null; }
    }

    // ---- draft --------------------------------------------------------------
    // draftCarts is the working copy the whole UI reads/writes while the
    // overlay is open; baseline is the last server-confirmed state (refreshed
    // on open, on Save & Close, and after any immediate structural action).
    // Diffing draftCarts against baseline (by id) at Save & Close time is what
    // decides which save-cart.php calls to make.
    let draftCarts = null;
    let baseline = null;
    let dirty = false;
    // Move/Delete/Upload are immediate (structural) — they hit the server
    // regardless of Save vs Cancel, so a Cancel afterward still needs the
    // board/DJ/ID windows refreshed even though no "save" happened.
    let structuralChange = false;
    function markDirty() { dirty = true; }
    function isDirty() { return dirty; }

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
        return [...ids, ...board].filter((s) => s.from < draftCarts.length);
    }
    let selId = 0, maQuery = '', favOnly = false;
    const isFav = (id) => (window.FAVORITES || []).includes(id);
    // Favourites are a station-wide "like" list, not a station setting — kept
    // immediate (saved as it's clicked) exactly like the planner tree does.
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
            let slots = draftCarts.slice(sec.from, Math.min(sec.to, draftCarts.length));
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
    function cart(id) { return draftCarts.find((c) => c.id === id); }

    // ---- Inline waveform trimmer (replaces the old iframe trimmer pages) ------
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
        // No separate "Save trim" step — releasing the handle commits straight
        // into the draft (like every other field here), so it survives
        // switching to another cart and only the outer Save & Close/Cancel
        // decide whether it actually lands on the server.
        const onUp = () => { if (dragging) saveTrim(); dragging = null; };
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
    // Commits a finished drag into the draft (not the server) — the outer
    // Save & Close persists it, Cancel discards it along with everything else.
    function saveTrim() {
        if (Math.abs(trimStart - savedStart) < 0.01 && Math.abs(trimEnd - savedEnd) < 0.01) return; // handle released without moving
        Object.assign(cart(selId), { start: trimStart, end: trimEnd });
        markDirty();
        savedStart = trimStart; savedEnd = trimEnd;
        updateLengthInfo();
    }

    // ---- chain crossfade editor -----------------------------------------------
    // EDIT CHAIN (visible when the selected cart belongs to a chain run of 2+)
    // opens the run — capped at 5 items — as staggered waveform lanes, one per
    // cart. Dragging a lane LEFT deepens its crossfade into the previous item
    // (capped at 30% of the shorter neighbour); each lane carries the same
    // volume line as the planner's cross editor. Its own Save commits the
    // fades + volumes into the draft (not the server) — the outer Save &
    // Close writes them to cross.txt / the carts themselves; its own Cancel
    // (chainEdClose) already discarded transient edits without touching
    // anything, so that half needed no change.
    const CHAIN_MAX = 5;
    let edCtx = null;              // shared decode/VU context
    const edBufs = {};             // file -> AudioBuffer | Promise
    let ed = null;                 // { run, fades[], vols[], openFades, openVols }
    let edDrag = null;             // { type:'fade'|'vol', k, startX?, startMs? }
    let edPrev = null;             // preview { audios, t0, timer, vuTimer, srcs, analyser }
    let edScrub = false;           // true while the pointer is down scrubbing a live preview
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
        const carts = draftCarts;
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
        // Assigned output (manager > Routing): 0 = the PFL bus, 1-4 = OUT N.
        const out = (window.ROUTING || {}).manager_preview || 0;
        $('chainEdOut').textContent = out ? `OUT ${out}` : 'PFL';
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
        host.querySelectorAll('.chain-lane, .chain-overlap-track').forEach((n) => n.remove());
        // One gray overlap strip per junction (k = 1..run.length-1), straddling
        // the border between lane k-1 and lane k — same visual language as the
        // planner cross editor's overlap track.
        for (let k = 1; k < ed.run.length; k++) {
            const track = document.createElement('div');
            track.className = 'chain-overlap-track';
            track.dataset.k = k;
            host.appendChild(track);
        }
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
            // Volume handle: vertical drag (never starts a fade drag). While a
            // preview is running, the lane-level capture listener (below)
            // already turns this touch into a scrub — no editing mid-preview.
            lane.querySelector('.cross-vol-handle').addEventListener('pointerdown', (e) => {
                if (edPrev) return;
                e.preventDefault();
                e.stopPropagation();
                edDrag = { type: 'vol', k };
            });
            // Fade drag: the lane block itself, from the second lane on.
            blk.addEventListener('pointerdown', (e) => {
                if (edPrev) return; // scrubbing handled by the lane-level listener
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
        // Overlap strips: lanes are equal-height flex rows, so the border
        // between lane k-1 and lane k sits at k/run.length of the host height.
        const laneH = (host.clientHeight || 1) / ed.run.length;
        host.querySelectorAll('.chain-overlap-track').forEach((trk) => {
            const k = +trk.dataset.k;
            const prevEnd = xs[k - 1] + edLen(ed.run[k - 1]);
            trk.style.top = Math.round(k * laneH) + 'px';
            trk.style.left = px(xs[k]) + 'px';
            trk.style.width = Math.max(0, px(prevEnd) - px(xs[k])) + 'px';
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
    // Reposition a live preview to tSec (seconds into the whole chain run):
    // re-times every item's currentTime/play state as if playback had
    // reached tSec naturally. Lets click/drag on the lanes scrub instead of
    // only stopping the preview.
    function chainSeekTo(tSec) {
        if (!edPrev || !ed) return;
        const p = edPrev;
        const xs = edStarts(), total = edTotal();
        tSec = Math.max(0, Math.min(total, tSec));
        p.t0 = performance.now() - tSec * 1000;
        ed.run.forEach((c, k) => {
            const start = xs[k], end = start + edLen(c);
            const a = p.audios[k];
            if (tSec >= start && tSec < end) {
                p.started[k] = true;
                try { a.currentTime = (c.start || 0) + (tSec - start); } catch (e) {}
                a.play().catch(() => {});
            } else {
                try { a.pause(); } catch (e) {}
                p.started[k] = tSec >= end;
            }
        });
        const ph = $('chainPlayhead');
        ph.hidden = false;
        ph.style.left = Math.round((tSec / total) * ($('chainLanes').clientWidth || 1)) + 'px';
    }
    // Window-seconds for a given clientX over #chainLanes.
    function chainXToTime(clientX) {
        if (!ed) return 0;
        const lanes = $('chainLanes');
        const r = lanes.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
        return frac * edTotal();
    }
    // Commits into the draft only — the outer Save & Close writes fades to
    // cross.txt and volumes to the carts.
    function chainEdSave() {
        if (!ed) return;
        chainEdStop();
        for (let k = 0; k < ed.run.length; k++) {
            if (ed.vols[k] !== ed.openVols[k]) ed.run[k].volume = ed.vols[k];
        }
        if (JSON.stringify(ed.fades) !== JSON.stringify(ed.openFades)) {
            ed.fades.forEach((ms, k) => { ed.run[k].chainFade = ms; });
        }
        markDirty();
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
        // Touching the lanes while a preview is running scrubs the playhead
        // instead of starting a fade/volume drag (both those handlers already
        // bail out while edPrev is set, so there's no conflict). Capture
        // phase so it fires before any per-block listener.
        $('chainLanes').addEventListener('pointerdown', (e) => {
            if (!edPrev) return;
            e.preventDefault();
            edScrub = true;
            chainSeekTo(chainXToTime(e.clientX));
        }, true);
        document.addEventListener('pointermove', (e) => {
            if (edScrub) { chainSeekTo(chainXToTime(e.clientX)); return; }
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
            edScrub = false;
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
            b.addEventListener('click', () => {
                cart(selId).color = code;
                markDirty();
                renderSwatches(code);
                renderAudioList();
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
            draftCarts.slice(sec.from, sec.to).forEach((c) => {
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

    // ---- draft commit ------------------------------------------------------------
    // Diffs draftCarts against baseline and posts exactly the ops needed;
    // re-baselines on success. Used by Save & Close, and by Move/Delete/Upload
    // as a pre-step so a pending draft is never silently lost or left
    // inconsistent with a structural change that's already gone live.
    async function flushDraft() {
        for (const c of draftCarts) {
            const b = baseline.find((x) => x.id === c.id);
            if (!b) continue;
            const upd = {};
            if (c.name !== b.name) upd.name = c.name;
            if (c.color !== b.color) upd.color = c.color;
            if (c.volume !== b.volume) upd.volume = c.volume;
            if (c.start !== b.start) upd.start = c.start;
            if (c.end !== b.end) upd.end = c.end;
            if (Object.keys(upd).length && !(await post('save-cart.php', { op: 'update', id: c.id, ...upd }))) return false;
            if ((c.enabled !== 0) !== (b.enabled !== 0) && !(await post('save-cart.php', { op: 'enable', id: c.id, enabled: c.enabled !== 0 ? 1 : 0 }))) return false;
            if (!!c.cross !== !!b.cross && !(await post('save-cart.php', { op: 'chain', id: c.id, cross: c.cross ? 1 : 0 }))) return false;
        }
        // Chain-fade runs: any contiguous chained run whose chainFade values
        // changed gets ONE 'chainfades' call, keyed on the run's first id.
        const postedRuns = new Set();
        for (const c of draftCarts) {
            if (c.empty || postedRuns.has(c.id)) continue;
            const run = chainRunFor(c.id);
            run.forEach((rc) => postedRuns.add(rc.id));
            if (run.length < 2) continue;
            const changed = run.slice(0, -1).some((rc) => {
                const b = baseline.find((x) => x.id === rc.id);
                return b && (rc.chainFade || 0) !== (b.chainFade || 0);
            });
            if (!changed) continue;
            const fades = run.slice(0, -1).map((rc) => rc.chainFade || 0);
            if (!(await post('save-cart.php', { op: 'chainfades', id: run[0].id, fades }))) return false;
        }
        window.MANAGER_DATA.carts = draftCarts;
        baseline = draftCarts.map((c) => ({ ...c }));
        dirty = false;
        return true;
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
        $('maEnabled').addEventListener('change', () => {
            cart(selId).enabled = $('maEnabled').checked ? 1 : 0;
            markDirty();
            renderAudioList();
        });
        // Name: plain text + pencil (matches the planner's rename pattern).
        $('maNameEdit').addEventListener('click', () => {
            $('maNameText').hidden = true;
            $('maName').hidden = false;
            $('maName').focus(); $('maName').select();
        });
        $('maName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('maName').blur(); });
        $('maName').addEventListener('blur', () => {
            const name = $('maName').value.trim();
            cart(selId).name = name || '-';
            $('maNameText').textContent = cart(selId).name;
            markDirty();
            renderAudioList();
            $('maName').hidden = true; $('maNameText').hidden = false;
        });
        $('maVolume').addEventListener('input', () => { $('maVolVal').textContent = $('maVolume').value + '%'; });
        $('maVolume').addEventListener('change', () => {
            cart(selId).volume = (+$('maVolume').value) / 100;
            markDirty();
        });
        $('maChain').addEventListener('change', () => {
            const on = $('maChain').checked;
            const c = cart(selId);
            if (on) {
                c.cross = 1;
                // Mirror the server's 5-item chain cap client-side, since this
                // no longer hits save-cart.php right away.
                if (chainRunFor(selId).length > CHAIN_MAX) {
                    c.cross = 0;
                    $('maChain').checked = false;
                    flash(`A chain can hold at most ${CHAIN_MAX} items`);
                    return;
                }
            } else {
                c.cross = 0;
                c.chainFade = 0; // an unchained joint has no fade
            }
            markDirty();
            updateChainEditBtn();
            renderAudioList();
        });
        $('maPlayFull').addEventListener('click', playFull);
        $('maPlayTrim').addEventListener('click', playTrimmed);
        // Upload new audio into the slot (or replace what's there): immediate
        // (structural, like Move/Delete below), flushing any pending draft
        // edits first. Trims reset server-side — they belonged to the old
        // file. Client-side gate on type/size too, so a bad pick fails fast.
        $('maAudioUpload').addEventListener('click', () => $('maAudioFile').click());
        $('maEmptyUploadBtn').addEventListener('click', () => $('maAudioFile').click());
        $('maAudioFile').addEventListener('change', async () => {
            const f = $('maAudioFile').files[0];
            if (!f) return;
            if (!/\.mp3$/i.test(f.name) && f.type !== 'audio/mpeg') { flash('Only .mp3 files are accepted'); $('maAudioFile').value = ''; return; }
            if (f.size > 30 * 1024 * 1024) { flash('Too big — max 30 MB (~30 min)'); $('maAudioFile').value = ''; return; }
            if (!(await flushDraft())) { $('maAudioFile').value = ''; return; }
            const fd = new FormData();
            fd.append('id', selId);
            fd.append('audio', f);
            try {
                const r = await fetch('upload-audio.php', { method: 'POST', body: fd });
                const resp = await r.json();
                if (!resp.ok) { flash(resp.error || 'Upload failed'); return; }
                Object.assign(cart(selId), { file: resp.file, name: resp.name, start: 0, end: null, empty: false });
                window.MANAGER_DATA.carts = draftCarts;
                baseline = draftCarts.map((c) => ({ ...c }));
                dirty = false;
                structuralChange = true;
                selectCart(selId);
                flash('Audio saved', true);
            } catch (e) { flash('Upload failed'); }
            $('maAudioFile').value = '';
        });
        // Move: immediate (structural — reorders carts.txt lines and remaps
        // breaks/favourites), flushing any pending draft edits first.
        $('maMoveBtn').addEventListener('click', async () => {
            const to = +$('maMoveSlot').value;
            if (!to || to === selId) return;
            if (!(await flushDraft())) return;
            if (await post('save-cart.php', { op: 'move', id: selId, to })) {
                const moved = draftCarts.splice(selId - 1, 1)[0];
                draftCarts.splice(to - 1, 0, moved);
                draftCarts.forEach((c, i) => { c.id = i + 1; });
                window.MANAGER_DATA.carts = draftCarts;
                baseline = draftCarts.map((c) => ({ ...c }));
                dirty = false;
                structuralChange = true;
                selectCart(to);
            }
        });
        // Clear this slot: two-step "are you sure" instead of a modal. Also
        // immediate/structural, flushing any pending draft edits first.
        $('maDelete').addEventListener('click', () => { $('maDelete').hidden = true; $('maDeleteConfirm').hidden = false; });
        $('maDeleteNo').addEventListener('click', () => { $('maDeleteConfirm').hidden = true; $('maDelete').hidden = false; });
        $('maDeleteYes').addEventListener('click', async () => {
            if (!(await flushDraft())) return;
            if (await post('save-cart.php', { op: 'delete', id: selId })) {
                Object.assign(cart(selId), { name: '-', file: '0.mp3', start: 0, end: null, volume: 1, color: '1', cross: 0, enabled: 1, empty: true });
                window.MANAGER_DATA.carts = draftCarts;
                baseline = draftCarts.map((c) => ({ ...c }));
                dirty = false;
                structuralChange = true;
                selectCart(selId);
            }
        });
    }

    // ---- shell ------------------------------------------------------------------
    function open() {
        draftCarts = M().carts.map((c) => ({ ...c }));
        baseline = draftCarts.map((c) => ({ ...c }));
        dirty = false;
        structuralChange = false;
        renderAudioList();
        $('audioManagerOverlay').hidden = false;
        document.addEventListener('keydown', onKey);
    }
    /** Persists the draft; returns true once the server has accepted it. */
    async function save() {
        if (!(await flushDraft())) return false;
        flash('Saved', true);
        return true;
    }
    // Closing with unsaved changes asks first — via a styled in-overlay
    // dialog (not the browser's native confirm). A plain Cancel never
    // touched the server on its own, so it doesn't need to refresh what's
    // behind — UNLESS a Move/Delete/Upload already went live this session.
    function close(didSave) {
        if (isDirty()) { $('audioManagerConfirm').hidden = false; return; }
        doClose(didSave);
    }
    function doClose(didSave) {
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
        $('audioManagerConfirm').hidden = true;
        $('audioManagerOverlay').hidden = true;
        document.removeEventListener('keydown', onKey);
        if (!didSave && !structuralChange) return; // nothing actually changed on the server
        // Rebuild the live island (drives the DJ library + decks, the board
        // and the autoplayer) from the manager's now-authoritative data, so
        // EVERY committed edit — name, colour, trim, volume, chain, enable,
        // move, delete, upload — shows without a page reload.
        // Mirrors index.php's filter: only real, enabled carts appear.
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
        if (!$('audioManagerConfirm').hidden) { $('audioManagerConfirm').hidden = true; return; } // then the discard dialog
        close(false);
    }

    function init() {
        const openBtn = $('chip-audiomgr');
        if (openBtn) openBtn.addEventListener('click', open);
        $('audioManagerCancel').addEventListener('click', () => close(false)); // discard (confirms if dirty)
        $('audioManagerConfirmDiscard').addEventListener('click', () => doClose(false));
        $('audioManagerConfirmKeep').addEventListener('click', () => { $('audioManagerConfirm').hidden = true; });
        // Save & Close: after a successful save the draft matches the server,
        // so close() proceeds without the discard prompt; a failed save stays
        // open with the error showing.
        $('audioManagerSave').addEventListener('click', async () => { if (await save()) close(true); });
        wireAudioTab();
        wireChainEditor();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.AudioManager = { open, close };
})();
