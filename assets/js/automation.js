// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Automation Playlist
 * ===================
 * A scheduled auto-playback queue, docked on the right. Carts are sent here by
 * right-clicking them on the board; they play back-to-back (FIFO) at a scheduled
 * time, honouring each cart's trim (start/end) + volume. Its own playback engine
 * (hidden primed <audio> per item) keeps it independent of the board.
 *
 * Chains: right-clicking any cart of a chain queues the WHOLE chain as one group
 * that drags/deletes together and can't be split.
 *
 * Anchor: start-at-hour (From) or end-at-hour (To, back-timed start).
 * Modes: AUTO (armed, fires at start) and MANUAL (play/pause + stop).
 */
(() => {
    const HOUR = 3600; // seconds
    const CAT = { '1': '#2f6fd6', '2': '#2f9e5f', '3': '#b0479e', '4': '#c98a2b', '5': '#2aa7bf' };
    const el = (id) => document.getElementById(id);

    const ICON = {
        start: '<svg viewBox="0 0 40 22" width="36" height="20"><circle cx="8" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 11V6.6M8 11h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18 11h16M30 7l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        end: '<svg viewBox="0 0 40 22" width="36" height="20"><path d="M4 11h16M16 7l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M32 11V6.6M32 11h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    };

    const state = {
        items: [],            // {id,groupId,name,file,start,end,volume,color,runtime,audio,played}
        anchorTime: nextFullHour(),
        anchorMode: 'start',  // 'start' (From) | 'end' (To)
        mode: 'auto',         // 'auto' | 'manual'
        running: false,
        playingIndex: -1,
        locked: false,
    };
    let idSeq = 1, groupSeq = 1, progressRaf = null;

    // ---- persistence (localStorage) ---------------------------------------
    // Reload restores the queue, its order/colours/names, and the schedule.
    // Playback progress is NOT restored — a fresh load always starts idle; if
    // the scheduled time has already passed, AUTO mode will fire right away.
    const AUTO_STORE = 'cartPlayerAutomation';
    function saveState() {
        try {
            localStorage.setItem(AUTO_STORE, JSON.stringify({
                anchorTime: state.anchorTime.toISOString(),
                anchorMode: state.anchorMode,
                mode: state.mode,
                items: state.items.map((it) => ({
                    groupId: it.groupId, name: it.name, file: it.file,
                    start: it.start, end: it.end, volume: it.volume, color: it.color, runtime: it.runtime,
                })),
            }));
        } catch (e) { /* ignore (storage disabled/full) */ }
    }
    function loadState() {
        try {
            const raw = localStorage.getItem(AUTO_STORE);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.items)) return;
            state.anchorMode = data.anchorMode === 'end' ? 'end' : 'start';
            state.mode = data.mode === 'manual' ? 'manual' : 'auto';
            const t = new Date(data.anchorTime);
            state.anchorTime = Number.isNaN(t.getTime()) ? nextFullHour() : t;
            data.items.forEach((d) => {
                const audio = new Audio(`uploads/${d.file}`);
                audio.preload = 'auto';
                const item = {
                    id: idSeq++, groupId: d.groupId, name: d.name, file: d.file,
                    start: d.start, end: d.end, volume: d.volume, color: d.color, runtime: d.runtime,
                    audio, played: false,
                };
                primeAudio(item);
                state.items.push(item);
            });
            const maxGroupId = data.items.reduce((m, d) => (d.groupId != null ? Math.max(m, d.groupId) : m), 0);
            groupSeq = Math.max(groupSeq, maxGroupId + 1);
            if (state.items.length > 0) show();
        } catch (e) { /* ignore corrupt storage */ }
    }

    // ---- time helpers -----------------------------------------------------
    function nextFullHour() { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; }
    function fmtClock(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
    // Countdown that grows an hours field when the start is more than an hour away.
    function fmtCountdown(sec) {
        sec = Math.max(0, Math.round(sec));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }
    function totalRuntime() { return state.items.reduce((a, it) => a + it.runtime, 0); }
    function actualStart() { return state.anchorMode === 'end' ? new Date(state.anchorTime.getTime() - totalRuntime() * 1000) : state.anchorTime; }
    function actualEnd() { return state.anchorMode === 'end' ? state.anchorTime : new Date(state.anchorTime.getTime() + totalRuntime() * 1000); }
    function secsToStart() { return (actualStart().getTime() - Date.now()) / 1000; }
    function itemEnd(it) { return (it.end != null ? it.end : (it.audio && it.audio.duration)) || (it.start + it.runtime); }

    function remainingRuntime() {
        if (!state.running) return totalRuntime();
        let rem = 0;
        state.items.forEach((it, i) => {
            if (i < state.playingIndex) return;
            if (i === state.playingIndex) rem += Math.max(0, itemEnd(it) - it.audio.currentTime);
            else rem += it.runtime;
        });
        return rem;
    }

    // ---- add --------------------------------------------------------------
    function addItems(list, grouped) {
        if (!Array.isArray(list) || list.length === 0) return;
        const sumNew = list.reduce((a, d) => a + (Number(d.runtime) || 0), 0);
        if (state.locked || state.running) return toast('Playlist locked');
        if (secsToStart() <= 5) return toast('Too close to start');
        if (sumNew > secsToStart() + 5) return toast("Won't fit before start");
        if (totalRuntime() + sumNew > HOUR) return toast('Would overrun the hour');

        const gid = grouped && list.length > 1 ? groupSeq++ : null;
        list.forEach((d) => {
            const audio = new Audio(`uploads/${d.file}`);
            audio.preload = 'auto';
            const item = {
                id: idSeq++, groupId: gid, name: d.name || '—', file: d.file,
                start: Number(d.start) || 0,
                end: (d.end != null && d.end !== '') ? Number(d.end) : null,
                volume: (d.volume != null && d.volume !== '') ? Number(d.volume) : 1,
                color: String(d.color || '1'), runtime: Math.max(0, Number(d.runtime) || 0),
                audio, played: false,
            };
            primeAudio(item);
            state.items.push(item);
        });
        show();
        saveState();
        render();
    }

    function primeAudio(item) {
        const a = item.audio;
        const onReady = () => {
            a.removeEventListener('canplaythrough', onReady);
            const vol = a.volume; a.volume = 0;
            try { a.currentTime = item.start; } catch (e) {}
            const p = a.play();
            if (p) p.then(() => setTimeout(() => { a.pause(); try { a.currentTime = item.start; } catch (e) {} a.volume = vol; }, 60)).catch(() => { a.volume = vol; });
        };
        a.addEventListener('canplaythrough', onReady);
        a.load();
    }

    // ---- blocks (group-aware units for render + drag) ---------------------
    function blocks() {
        const out = [];
        for (let i = 0; i < state.items.length;) {
            const it = state.items[i];
            if (it.groupId == null) { out.push({ groupId: null, items: [it], from: i, to: i }); i++; continue; }
            let j = i;
            while (j < state.items.length && state.items[j].groupId === it.groupId) j++;
            out.push({ groupId: it.groupId, items: state.items.slice(i, j), from: i, to: j - 1 });
            i = j;
        }
        return out;
    }

    // ---- remove -----------------------------------------------------------
    function removeAt(from, to) {
        if (state.locked || state.running) return;
        state.items.slice(from, to + 1).forEach(it => { try { it.audio.pause(); } catch (e) {} });
        state.items.splice(from, to - from + 1);
        saveState();
        render();
    }

    // ---- playback ---------------------------------------------------------
    function beginPlayback(fromIndex) {
        if (state.items.length === 0 || state.running) return;
        state.running = true;
        state.items.forEach(it => { it.played = false; });
        state.playingIndex = (fromIndex != null ? fromIndex : 0) - 1;
        playNext();
    }
    function playNext() {
        const prev = state.items[state.playingIndex];
        if (prev) { try { prev.audio.pause(); } catch (e) {} clearTimeout(prev._timer); prev.played = true; }
        state.playingIndex++;
        if (state.playingIndex >= state.items.length) { endPlayback(); render(); return; }
        const it = state.items[state.playingIndex];
        const a = it.audio;
        try { a.currentTime = it.start; } catch (e) {}
        a.volume = it.volume;
        a.play().catch(() => {});
        clearTimeout(it._timer);
        it._timer = setTimeout(() => playNext(), Math.max(0, (itemEnd(it) - it.start) * 1000));
        render();
        centerCurrent();
        startProgress();
    }
    function pause() { const it = state.items[state.playingIndex]; if (it) { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); } render(); }
    function resume() {
        const it = state.items[state.playingIndex];
        if (!it) { playNext(); return; }
        it.audio.play().catch(() => {});
        it._timer = setTimeout(() => playNext(), Math.max(0, (itemEnd(it) - it.audio.currentTime) * 1000));
        render();
    }
    function endPlayback() {
        state.running = false; state.playingIndex = -1;
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        stopProgress();
    }
    function stopAll() {
        endPlayback();
        state.items.forEach(it => { it.played = false; });
        render();
    }

    // Progress overlay on the playing item (setInterval, not RAF — RAF is
    // throttled when the tab/preview isn't focused).
    function startProgress() {
        stopProgress();
        progressRaf = setInterval(() => {
            const it = state.items[state.playingIndex];
            if (!it) return;
            const bar = el('autoList').querySelector(`[data-id="${it.id}"] .auto-progress`);
            if (bar) {
                const span = itemEnd(it) - it.start;
                const done = Math.min(1, Math.max(0, (it.audio.currentTime - it.start) / (span || 1)));
                bar.style.width = `${done * 100}%`;
            }
        }, 100);
    }
    function stopProgress() { if (progressRaf) { clearInterval(progressRaf); progressRaf = null; } }

    function centerCurrent() {
        const it = state.items[state.playingIndex];
        if (!it) return;
        const row = el('autoList').querySelector(`[data-id="${it.id}"]`);
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // ---- modes / transport -----------------------------------------------
    function setMode(m) { state.mode = m; saveState(); render(); } // allowed while running (escape to manual for Stop)
    function onPlayPause() {
        if (state.mode !== 'manual') return;
        if (!state.running) beginPlayback(0);
        else { const it = state.items[state.playingIndex]; if (it && it.audio.paused) resume(); else pause(); }
    }
    function onStop() { if (state.mode === 'manual') stopAll(); }

    // ---- header popover / anchor / big time picker -----------------------
    function togglePop(force) {
        const pop = el('autoPop');
        const openNow = force != null ? force : pop.hidden;
        if (openNow && (state.locked || state.running)) return;
        pop.hidden = !openNow;
        if (openNow) syncPicker();
    }
    function setAnchor(mode) { state.anchorMode = mode; saveState(); render(); }
    function setAnchorHM(h, m) {
        const cur = state.anchorTime;
        const hh = h != null ? h : cur.getHours();
        const mm = m != null ? m : cur.getMinutes();
        const d = new Date(); d.setHours(hh, mm, 0, 0);
        if (d.getTime() < Date.now() + 60000) d.setDate(d.getDate() + 1); // next occurrence
        state.anchorTime = d; saveState(); render();
    }
    function buildPickerGrids() {
        const hours = el('autoPopHours'); hours.innerHTML = '';
        for (let h = 0; h < 24; h++) {
            const b = document.createElement('button');
            b.textContent = String(h).padStart(2, '0'); b.dataset.h = h;
            b.addEventListener('click', () => setAnchorHM(h, null));
            hours.appendChild(b);
        }
        const mins = el('autoPopMins'); mins.innerHTML = '';
        for (let m = 0; m < 60; m += 5) {
            const b = document.createElement('button');
            b.textContent = String(m).padStart(2, '0'); b.dataset.m = m;
            b.addEventListener('click', () => setAnchorHM(null, m));
            mins.appendChild(b);
        }
    }
    function syncPicker() {
        const hh = state.anchorTime.getHours(), mm = state.anchorTime.getMinutes();
        el('autoPopHours').querySelectorAll('button').forEach(b => b.classList.toggle('sel', +b.dataset.h === hh));
        el('autoPopMins').querySelectorAll('button').forEach(b => b.classList.toggle('sel', +b.dataset.m === mm));
        const typed = el('autoTimeTyped');
        if (document.activeElement !== typed) typed.value = fmtClock(state.anchorTime);
    }
    function onTyped(v) {
        const parts = v.match(/^(\d{1,2}):?(\d{0,2})$/);
        if (!parts) return;
        const h = Math.min(23, parseInt(parts[1], 10) || 0);
        const m = parts[2] ? Math.min(59, parseInt(parts[2], 10)) : 0;
        setAnchorHM(h, m);
    }

    // ---- show / clear -----------------------------------------------------
    function show() { el('automationPanel').classList.add('active'); }
    function clearAndHide() {
        if (state.running) return;
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        try { localStorage.removeItem(AUTO_STORE); } catch (e) { /* ignore */ }
        render();
        // Brief pause on the now-empty list — just long enough to register that
        // it's cleared — before the panel closes.
        setTimeout(() => el('automationPanel').classList.remove('active'), 700);
    }

    function syncLock() {
        const lock = state.running || (state.mode === 'auto' && state.items.length > 0 && secsToStart() <= 5);
        state.locked = lock;
        el('automationPanel').classList.toggle('locked', lock);
    }

    // ---- drag & drop reorder (block-aware, container-delegated) -----------
    // Delegating dragover/drop to the LIST CONTAINER (rather than each row) is
    // what lets a drop register in the empty space below the last item — and
    // using the exact same "insertion index" for both the guide line and the
    // actual move keeps the two perfectly in sync.
    let dragBlock = null, dropLine = null, dropBlocks = [];
    function removeDropLine() { if (dropLine && dropLine.parentNode) dropLine.parentNode.removeChild(dropLine); dropLine = null; }
    // Insertion index (a position BETWEEN blocks, 0..dropBlocks.length) for a
    // given pointer Y, based on the midpoint of each rendered block's node.
    function insertionIndexAt(list, clientY) {
        const nodes = [...list.children].filter((n) => n.dataset.from !== undefined);
        for (let i = 0; i < nodes.length; i++) {
            const rect = nodes[i].getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) return i;
        }
        return nodes.length; // past the last row -> end of the list
    }
    function reorderBlock(src, insertBlockIndex) {
        const srcCount = src.to - src.from + 1;
        // insertBlockIndex counts blocks BEFORE removal; translate to an item index.
        let insertAt = insertBlockIndex >= dropBlocks.length
            ? state.items.length
            : dropBlocks[insertBlockIndex].from;
        const moved = state.items.splice(src.from, srcCount);
        if (src.from < insertAt) insertAt -= srcCount;
        state.items.splice(insertAt, 0, ...moved);
        saveState();
        render();
    }
    function attachDrag(node, block) {
        node.dataset.from = block.from;
        node.draggable = !(state.locked || state.running);
        node.addEventListener('dragstart', (e) => {
            dragBlock = block; dropBlocks = blocks();
            node.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', ''); } catch (x) {}
        });
        node.addEventListener('dragend', () => { node.classList.remove('dragging'); removeDropLine(); dragBlock = null; });
    }
    function initListDragDrop() {
        const list = el('autoList');
        list.addEventListener('dragover', (e) => {
            if (!dragBlock) return;
            e.preventDefault();
            const idx = insertionIndexAt(list, e.clientY);
            if (!dropLine) { dropLine = document.createElement('div'); dropLine.className = 'auto-drop-line'; }
            const nodes = [...list.children].filter((n) => n.dataset.from !== undefined);
            if (idx >= nodes.length) list.appendChild(dropLine); else nodes[idx].before(dropLine);
        });
        list.addEventListener('drop', (e) => {
            if (!dragBlock) return;
            e.preventDefault();
            const idx = insertionIndexAt(list, e.clientY);
            removeDropLine();
            reorderBlock(dragBlock, idx);
        });
    }

    // ---- render -----------------------------------------------------------
    function render() {
        const list = el('autoList');
        list.innerHTML = '';
        blocks().forEach((block) => {
            const makeItemRow = (it, idx) => {
                const row = document.createElement('div');
                row.className = 'auto-item' + (idx === state.playingIndex ? ' playing' : '') + (it.played ? ' played' : '');
                row.dataset.id = it.id;
                row.style.setProperty('--item-color', CAT[it.color] || CAT['1']);
                row.innerHTML =
                    `<span class="auto-progress"></span>` +
                    `<span class="auto-name"></span>` +
                    `<span class="auto-runtime">${fmtDur(it.runtime)}</span>` +
                    (block.groupId == null ? `<button class="auto-remove" title="Remove"><i class="ph ph-trash"></i></button>` : '');
                row.querySelector('.auto-name').textContent = it.name;
                const rm = row.querySelector('.auto-remove');
                if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); removeAt(block.from, block.to); });
                return row;
            };
            if (block.groupId == null) {
                const idx = block.from;
                const row = makeItemRow(block.items[0], idx);
                attachDrag(row, block);
                list.appendChild(row);
            } else {
                const g = document.createElement('div');
                g.className = 'auto-group';
                block.items.forEach((it, k) => g.appendChild(makeItemRow(it, block.from + k)));
                const trash = document.createElement('button');
                trash.className = 'auto-group-trash';
                trash.title = 'Remove chain';
                trash.innerHTML = '<i class="ph ph-trash"></i>';
                trash.addEventListener('click', (e) => { e.stopPropagation(); removeAt(block.from, block.to); });
                g.appendChild(trash);
                attachDrag(g, block);
                list.appendChild(g);
            }
        });

        // total (or remaining while running)
        el('autoTotalLabel').textContent = state.running ? 'Remaining' : 'Total';
        el('autoTotal').textContent = fmtDur(remainingRuntime());

        // header
        el('autoHeaderIcon').innerHTML = state.anchorMode === 'end' ? ICON.end : ICON.start;
        el('autoHeader').classList.toggle('end-mode', state.anchorMode === 'end');
        el('autoTimeLabel').textContent = state.anchorMode === 'end' ? 'To' : 'From';
        el('autoTime').textContent = fmtClock(state.anchorTime);
        el('autoPopStart').classList.toggle('active', state.anchorMode === 'start');
        el('autoPopEnd').classList.toggle('active', state.anchorMode === 'end');
        syncPicker();

        // AUTO shows the clocks; MANUAL shows the transport controls.
        el('autoModeAuto').classList.toggle('active', state.mode === 'auto');
        el('autoModeManual').classList.toggle('active', state.mode === 'manual');
        const manual = state.mode === 'manual';
        el('autoAutoArea').hidden = manual;
        el('autoTransport').hidden = !manual;
        el('autoArmed').hidden = state.running; // the clocks show LIVE while playing
        const playing = state.running && state.items[state.playingIndex] && !state.items[state.playingIndex].audio.paused;
        el('autoPlayBtn').innerHTML = playing ? '<i class="ph-fill ph-pause"></i>' : '<i class="ph-fill ph-play"></i>';

        updateTimes();
    }

    function updateTimes() {
        const startsBlock = el('autoStartsBlock');
        el('autoEndAt').textContent = fmtClock(actualEnd());
        if (state.running) {
            startsBlock.classList.remove('imminent');
            startsBlock.classList.add('live');
            startsBlock.querySelector('.auto-times-label').textContent = 'On air';
            el('autoCountdown').textContent = 'NOW';
            return;
        }
        startsBlock.classList.remove('live');
        startsBlock.querySelector('.auto-times-label').textContent = 'Starts in';
        const secs = secsToStart();
        el('autoCountdown').textContent = '-' + fmtCountdown(secs);
        startsBlock.classList.toggle('imminent', secs <= 30);
    }

    // ---- tick -------------------------------------------------------------
    setInterval(() => {
        if (state.items.length === 0) return;
        syncLock();
        if (state.running) { el('autoTotal').textContent = fmtDur(remainingRuntime()); }
        updateTimes();
        if (state.mode === 'auto' && !state.running && secsToStart() <= 0) beginPlayback(0);
    }, 250);

    // ---- toast ------------------------------------------------------------
    let toastTimer = null;
    function toast(msg) {
        let t = el('autoToast');
        if (!t) {
            t = document.createElement('div'); t.id = 'autoToast';
            t.style.cssText = 'position:absolute; left:16px; right:16px; bottom:180px; z-index:6; background:rgba(240,69,63,0.96); color:#fff; padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); transition:opacity .2s;';
            el('automationPanel').appendChild(t);
        }
        t.textContent = msg; t.style.opacity = '1';
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1800);
        return false;
    }

    // ---- wire up ----------------------------------------------------------
    function init() {
        buildPickerGrids();
        initListDragDrop();
        el('autoHeader').addEventListener('click', () => togglePop());
        el('autoPopStart').addEventListener('click', () => setAnchor('start'));
        el('autoPopEnd').addEventListener('click', () => setAnchor('end'));
        el('autoTimeTyped').addEventListener('input', (e) => onTyped(e.target.value));
        el('autoPopOk').addEventListener('click', () => togglePop(false));
        el('autoModeAuto').addEventListener('click', () => setMode('auto'));
        el('autoModeManual').addEventListener('click', () => setMode('manual'));
        el('autoPlayBtn').addEventListener('click', onPlayPause);
        el('autoStopBtn').addEventListener('click', onStop);
        el('autoClearBtn').addEventListener('click', clearAndHide);
        document.addEventListener('click', (e) => {
            if (!el('autoPop').hidden && !e.target.closest('#autoPop') && !e.target.closest('#autoHeader')) togglePop(false);
        });
        loadState();
        render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Automation = {
        addItems,
        addItem: (item) => addItems([item], false),
        isActive: () => state.items.length > 0,
        isRunning: () => state.running,
    };
})();
