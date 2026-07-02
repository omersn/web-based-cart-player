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
            savedStart = trimStart; savedEnd = trimEnd;
            updateTrimSaveState();
            updateLengthInfo();
        }
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
    function wireAudioTab() {
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
            if (await post('save-cart.php', { op: 'update', id: selId, volume: v })) cart(selId).volume = v;
        });
        $('maChain').addEventListener('change', async () => {
            const on = $('maChain').checked;
            if (await post('save-cart.php', { op: 'chain', id: selId, cross: on ? 1 : 0 })) {
                cart(selId).cross = on ? 1 : 0;
                renderAudioList();
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
        // Cart names/colours/enable-state/trims may have changed underneath
        // the board, the ID windows, and the clock — refresh what's behind.
        if (window.refreshPlayerWindows) window.refreshPlayerWindows();
    }
    function onKey(e) {
        if (e.key !== 'Escape' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        close();
    }

    function init() {
        const openBtn = $('chip-audiomgr');
        if (openBtn) openBtn.addEventListener('click', open);
        $('audioManagerClose').addEventListener('click', close);
        wireAudioTab();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.AudioManager = { open, close };
})();
