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

    // ---- time helpers -----------------------------------------------------
    function nextFullHour() { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; }
    function fmtClock(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
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
    function setMode(m) { if (state.running) return; state.mode = m; render(); }
    function onPlayPause() {
        if (state.mode !== 'manual') return;
        if (!state.running) beginPlayback(0);
        else { const it = state.items[state.playingIndex]; if (it && it.audio.paused) resume(); else pause(); }
    }
    function onStop() { if (state.mode === 'manual') stopAll(); }

    // ---- header popover / anchor / time ----------------------------------
    function togglePop(force) {
        const pop = el('autoPop');
        const openNow = force != null ? force : pop.hidden;
        if (openNow && (state.locked || state.running)) return;
        pop.hidden = !openNow;
        if (openNow) el('autoTimeInput').value = fmtClock(state.anchorTime);
    }
    function setAnchor(mode) { state.anchorMode = mode; render(); }
    function setTime(hhmm) {
        const [h, m] = hhmm.split(':').map(Number);
        if (Number.isNaN(h)) return;
        const d = new Date(); d.setHours(h, m, 0, 0);
        if (d.getTime() < Date.now() + 60000) d.setDate(d.getDate() + 1);
        state.anchorTime = d; render();
    }

    // ---- show / clear -----------------------------------------------------
    function show() { el('automationPanel').classList.add('active'); }
    function clearAndHide() {
        if (state.running) return;
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        render();
        setTimeout(() => el('automationPanel').classList.remove('active'), 2000);
    }

    function syncLock() {
        const lock = state.running || (state.mode === 'auto' && state.items.length > 0 && secsToStart() <= 5);
        state.locked = lock;
        el('automationPanel').classList.toggle('locked', lock);
    }

    // ---- drag & drop reorder (block-aware) --------------------------------
    let dragBlock = null;
    function attachDrag(node, block) {
        node.draggable = !(state.locked || state.running);
        node.addEventListener('dragstart', (e) => { dragBlock = block; node.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        node.addEventListener('dragend', () => { node.classList.remove('dragging'); dragBlock = null; });
        node.addEventListener('dragover', (e) => { e.preventDefault(); });
        node.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!dragBlock || dragBlock === block) return;
            const moved = state.items.splice(dragBlock.from, dragBlock.to - dragBlock.from + 1);
            // recompute target insertion index after removal
            let target = block.from;
            if (dragBlock.from < block.from) target -= moved.length;
            state.items.splice(target, 0, ...moved);
            render();
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

        // mode switch + transport
        el('autoModeAuto').classList.toggle('active', state.mode === 'auto');
        el('autoModeManual').classList.toggle('active', state.mode === 'manual');
        el('autoArmed').hidden = state.mode !== 'auto';
        const manual = state.mode === 'manual';
        el('autoPlayBtn').disabled = !manual;
        el('autoStopBtn').disabled = !manual;
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
            el('autoCountdown').textContent = 'LIVE';
            return;
        }
        startsBlock.classList.remove('live');
        startsBlock.querySelector('.auto-times-label').textContent = 'Starts in';
        const secs = secsToStart();
        el('autoCountdown').textContent = '-' + fmtDur(secs);
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
        el('autoHeader').addEventListener('click', () => togglePop());
        el('autoPopStart').addEventListener('click', () => setAnchor('start'));
        el('autoPopEnd').addEventListener('click', () => setAnchor('end'));
        el('autoTimeInput').addEventListener('change', (e) => setTime(e.target.value));
        el('autoModeAuto').addEventListener('click', () => setMode('auto'));
        el('autoModeManual').addEventListener('click', () => setMode('manual'));
        el('autoPlayBtn').addEventListener('click', onPlayPause);
        el('autoStopBtn').addEventListener('click', onStop);
        el('autoClearBtn').addEventListener('click', clearAndHide);
        document.addEventListener('click', (e) => {
            if (!el('autoPop').hidden && !e.target.closest('#autoPop') && !e.target.closest('#autoHeader')) togglePop(false);
        });
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
