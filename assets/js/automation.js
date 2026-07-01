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
    const LOCK_LEAD = 10;  // seconds before start (and while running) that the panel locks
    const FIT_BUFFER = 5;  // seconds of slack allowed when checking "will this fit before start"
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
        // Set once AUTO has fired for the current schedule, so the tick loop
        // doesn't immediately re-trigger playback after the queue finishes (the
        // anchor time stays in the past forever once it's passed). Cleared
        // whenever the schedule actually changes (new items, new anchor time).
        firedForThisSchedule: false,
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
    // Radio timing runs on seconds — the header and "Ends at" show them too.
    // (fmtClock, above, stays minute-only for the typed field, which only ever
    // lets you edit down to the minute.)
    function fmtClockSec(d) { return `${fmtClock(d)}:${String(d.getSeconds()).padStart(2, '0')}`; }
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
        // Starting a brand-new queue (nothing in it yet): if the anchor time is
        // a stale leftover (e.g. restored from a previous session, now in the
        // past or about to pass), there's no existing schedule to protect —
        // just default it fresh rather than perpetually rejecting every add.
        if (state.items.length === 0 && secsToStart() <= LOCK_LEAD) {
            state.anchorTime = nextFullHour();
            state.anchorMode = 'start';
            state.firedForThisSchedule = false;
        }
        if (secsToStart() <= LOCK_LEAD) return toast('Too close to start');
        if (sumNew > secsToStart() + FIT_BUFFER) return toast("Won't fit before start");
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
        state.firedForThisSchedule = false; // new material queued -> arm AUTO again
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
    // The panel can never show an empty, dangling queue: either it has at
    // least one item, or it's gone. Reset clears the schedule back to a fresh
    // default and drops the persisted state, so the NEXT queue starts clean.
    function resetSchedule() {
        state.anchorTime = nextFullHour();
        state.anchorMode = 'start';
        state.mode = 'auto';
        state.firedForThisSchedule = false;
        try { localStorage.removeItem(AUTO_STORE); } catch (e) { /* ignore */ }
    }
    function removeAt(from, to) {
        if (state.locked || state.running) return;
        state.items.slice(from, to + 1).forEach(it => { try { it.audio.pause(); } catch (e) {} });
        state.items.splice(from, to - from + 1);
        if (state.items.length === 0) {
            // Removed the last item by hand: the panel disappears immediately.
            resetSchedule();
            render();
            el('automationPanel').classList.remove('active');
            return;
        }
        saveState();
        render();
    }
    // Removed automatically ~1s after a cart finishes playing (see playNext).
    // Keeping the list shrinking as it plays is what keeps auto-scroll smooth
    // and leaves an empty list once the whole batch is done.
    function removeItemById(id) {
        const i = state.items.findIndex((it) => it.id === id);
        if (i < 0) return;
        try { state.items[i].audio.pause(); } catch (e) {}
        state.items.splice(i, 1);
        if (state.playingIndex > i) state.playingIndex--;
        if (state.items.length === 0) {
            // The batch just finished: hold on the empty list for a beat so the
            // operator can register it's done, then the panel goes away.
            resetSchedule();
            render();
            setTimeout(() => el('automationPanel').classList.remove('active'), 1000);
            return;
        }
        saveState();
        render();
        centerCurrent();
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
        if (prev) {
            try { prev.audio.pause(); } catch (e) {}
            clearTimeout(prev._timer);
            prev.played = true;
            const prevId = prev.id;
            setTimeout(() => removeItemById(prevId), 1000);
        }
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
        // The tick loop skips syncLock() entirely once the queue is empty (see
        // below), so if playback finishes and drains to 0 items before the tick
        // runs again, state.locked would otherwise stay frozen at "true" forever
        // — bricking automation until a hard reload. Recompute right now.
        syncLock();
    }
    // Stop reachable from either mode (the dedicated AUTO-mode Stop button, the
    // MANUAL transport's Stop, or the shell's "Stop all"). Interrupting like
    // this does NOT auto-remove the interrupted item (only natural completion,
    // in playNext, does that).
    function forceStop() {
        if (!state.running) return;
        endPlayback();
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
    function setMode(m) { state.mode = m; saveState(); render(); }
    function onPlayPause() {
        if (state.mode !== 'manual') return;
        if (!state.running) beginPlayback(0);
        else { const it = state.items[state.playingIndex]; if (it && it.audio.paused) resume(); else pause(); }
    }

    // ---- header popover / anchor / big time picker -----------------------
    function togglePop(force) {
        const pop = el('autoPop');
        const openNow = force != null ? force : pop.hidden;
        if (openNow && (state.locked || state.running)) return;
        pop.hidden = !openNow;
        if (openNow) { syncPicker(); refreshPickerLive(); }
    }
    function setAnchor(mode) {
        state.anchorMode = mode;
        state.firedForThisSchedule = false; // From/To flip changes the actual start -> new schedule
        saveState(); render();
    }
    // The next occurrence of hh:mm — today, unless that time has ALREADY
    // passed today, in which case tomorrow. (Bug fix: the old check used a 60s
    // FUTURE look-ahead here, which wrongly rolled picks like "1 minute from
    // now" a full day forward instead of keeping them today.)
    function nextOccurrence(hh, mm) {
        const d = new Date(); d.setHours(hh, mm, 0, 0);
        // Only roll to TOMORROW if this time-of-day clearly already elapsed
        // today (more than a minute ago) — e.g. picking an early hour that's
        // passed, meaning "tomorrow morning". A pick that's merely seconds in
        // the past (picked the current minute) is NOT rolled a day forward;
        // it falls through to the 1-minute-away rejection below instead, so
        // it's a clean refusal rather than a silently-scheduled next day.
        if (d.getTime() < Date.now() - 60000) d.setDate(d.getDate() + 1);
        return d;
    }
    function setAnchorHM(h, m) {
        const cur = state.anchorTime;
        const hh = h != null ? h : cur.getHours();
        const mm = m != null ? m : cur.getMinutes();
        const d = nextOccurrence(hh, mm);
        // Safety: refuse (don't apply) anything less than a minute away.
        if (d.getTime() - Date.now() < 60000) { toast('Must be at least 1 minute away'); syncPicker(); return; }
        state.anchorTime = d;
        state.firedForThisSchedule = false; // new schedule -> arm AUTO again
        saveState(); render();
    }
    // Custom-built combo widgets (not native <select>s) — full control over
    // colouring the next-hour option and greying out past times, without the
    // OS's own picker chrome/appearance leaking through.
    function buildPickerCombos() {
        const hourBtn = el('autoHourComboBtn');
        const hourList = el('autoHourComboList');
        const minBtn = el('autoMinComboBtn');
        const minList = el('autoMinComboList');

        hourList.innerHTML = '';
        for (let h = 0; h < 24; h++) {
            const opt = document.createElement('button');
            opt.type = 'button'; opt.textContent = String(h).padStart(2, '0'); opt.dataset.h = String(h);
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                setAnchorHM(h, null);
                hourList.hidden = true;
                refreshPickerLive();
            });
            hourList.appendChild(opt);
        }
        hourBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            minList.hidden = true;
            hourList.hidden = !hourList.hidden;
            if (!hourList.hidden) { refreshPickerLive(); centerSelectedCombo(hourList); }
        });

        minList.innerHTML = '';
        for (let m = 0; m < 60; m += 15) {
            const opt = document.createElement('button');
            opt.type = 'button'; opt.textContent = String(m).padStart(2, '0'); opt.dataset.m = String(m);
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                setAnchorHM(null, m);
                minList.hidden = true;
            });
            minList.appendChild(opt);
        }
        minBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hourList.hidden = true;
            minList.hidden = !minList.hidden;
            if (!minList.hidden) { refreshPickerLive(); centerSelectedCombo(minList); }
        });

        document.addEventListener('click', () => { hourList.hidden = true; minList.hidden = true; });
    }
    // Opening a combo scrolls its list so the currently selected value is
    // centred, rather than always starting scrolled to the top.
    function centerSelectedCombo(list) {
        const sel = list.querySelector('button.sel');
        if (sel) sel.scrollIntoView({ block: 'center' });
    }
    // Marks the next top-of-the-hour option (always — so it's the visible
    // default reference point even once something else is picked) and grays
    // out/disables times already in the past today. Re-run every time either
    // combo list opens, since "now" keeps moving.
    function refreshPickerLive() {
        const now = new Date();
        const curH = now.getHours(), curM = now.getMinutes();
        const nextH = nextFullHour().getHours();
        const selHour = state.anchorTime.getHours();
        const selMin = state.anchorTime.getMinutes();

        [...el('autoHourComboList').children].forEach((opt) => {
            const h = parseInt(opt.dataset.h, 10);
            opt.disabled = h < curH;
            opt.classList.toggle('next-hour', h === nextH);
            opt.classList.toggle('sel', h === selHour);
        });
        [...el('autoMinComboList').children].forEach((opt) => {
            const m = parseInt(opt.dataset.m, 10);
            opt.disabled = selHour === curH && m <= curM;
            opt.classList.toggle('next-hour', m === 0);
            opt.classList.toggle('sel', m === selMin);
        });
    }
    function syncPicker() {
        const hh = state.anchorTime.getHours(), mm = state.anchorTime.getMinutes();
        el('autoHourComboBtn').textContent = String(hh).padStart(2, '0');
        el('autoMinComboBtn').textContent = String(mm).padStart(2, '0'); // shows the exact minute, even off the 15-step grid
        const typed = el('autoTimeTyped');
        if (document.activeElement !== typed) typed.value = fmtClock(state.anchorTime);
    }
    // Also visually clamps the field as you type (fixes "99" staying on screen
    // for the hour — it was clamped internally but the field kept showing the
    // raw digits since it doesn't rewrite itself while focused).
    function onTyped(e) {
        const raw = e.target.value;
        const parts = raw.match(/^(\d{1,2}):?(\d{0,2})$/);
        if (!parts) return;
        const hRaw = parts[1], mRaw = parts[2];
        const h = Math.min(23, parseInt(hRaw, 10) || 0);
        const m = mRaw ? Math.min(59, parseInt(mRaw, 10)) : 0;
        if (hRaw.length === 2 && parseInt(hRaw, 10) > 23) {
            const rest = raw.includes(':') ? raw.slice(raw.indexOf(':')) : '';
            e.target.value = String(h).padStart(2, '0') + rest;
        }
        if (mRaw && mRaw.length === 2 && parseInt(mRaw, 10) > 59) {
            e.target.value = raw.slice(0, raw.indexOf(':') + 1) + String(m).padStart(2, '0');
        }
        setAnchorHM(h, m);
    }

    // ---- show / clear -----------------------------------------------------
    function show() { el('automationPanel').classList.add('active'); }
    function clearAndHide() {
        if (state.running) return;
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        resetSchedule();
        render();
        // Brief pause on the now-empty list — just long enough to register that
        // it's cleared — before the panel closes.
        setTimeout(() => el('automationPanel').classList.remove('active'), 700);
    }

    function syncLock() {
        const lock = state.running || (state.mode === 'auto' && state.items.length > 0 && secsToStart() <= LOCK_LEAD);
        state.locked = lock;
        el('automationPanel').classList.toggle('locked', lock);
    }

    // ---- drag & drop reorder (block-aware, container-delegated) -----------
    // Delegating dragover/drop to the LIST CONTAINER (rather than each row) is
    // what lets a drop register in the empty space below the last item — and
    // using the exact same "insertion index" for both the ghost preview and the
    // actual move keeps the two perfectly in sync.
    let dragBlock = null, dropGhost = null, dropBlocks = [];
    function removeDropGhost() { if (dropGhost && dropGhost.parentNode) dropGhost.parentNode.removeChild(dropGhost); dropGhost = null; }
    // Insertion index (a position BETWEEN blocks, 0..dropBlocks.length) for a
    // given pointer Y, based on the midpoint of each rendered block's node
    // (the ghost preview itself is excluded — it carries no data-from).
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
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', ''); } catch (x) {}
            // A translucent clone of what's being dragged, previewed at the
            // insertion point — reads more like a real reorder than a bare line.
            dropGhost = node.cloneNode(true);
            dropGhost.classList.remove('dragging');
            dropGhost.classList.add('auto-ghost');
            dropGhost.removeAttribute('draggable');
            delete dropGhost.dataset.from;
            // Hide the original a tick later — hiding it synchronously here
            // risks the browser cancelling the drag before it captures its
            // native drag-image snapshot.
            setTimeout(() => node.classList.add('dragging'), 0);
        });
        node.addEventListener('dragend', () => { node.classList.remove('dragging'); removeDropGhost(); dragBlock = null; });
    }
    function initListDragDrop() {
        const list = el('autoList');
        list.addEventListener('dragover', (e) => {
            if (!dragBlock || !dropGhost) return;
            e.preventDefault();
            const idx = insertionIndexAt(list, e.clientY);
            const nodes = [...list.children].filter((n) => n.dataset.from !== undefined);
            if (idx >= nodes.length) list.appendChild(dropGhost); else nodes[idx].before(dropGhost);
        });
        list.addEventListener('drop', (e) => {
            if (!dragBlock) return;
            e.preventDefault();
            const idx = insertionIndexAt(list, e.clientY);
            removeDropGhost();
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

        // total (or remaining while running) — reads like the on-air countdown
        // bars elsewhere (red background, white text) while playing.
        el('autoTotalLabel').textContent = state.running ? 'Remaining' : 'Total';
        el('autoTotal').textContent = fmtDur(remainingRuntime());
        el('autoTotalRow').classList.toggle('running', state.running);

        // header
        el('autoHeaderIcon').innerHTML = state.anchorMode === 'end' ? ICON.end : ICON.start;
        el('autoHeader').classList.toggle('end-mode', state.anchorMode === 'end');
        el('autoTimeLabel').textContent = state.anchorMode === 'end' ? 'To' : 'From';
        el('autoTime').textContent = fmtClockSec(state.anchorTime);
        el('autoPopStart').classList.toggle('active', state.anchorMode === 'start');
        el('autoPopEnd').classList.toggle('active', state.anchorMode === 'end');
        syncPicker();

        // AUTO shows the clocks (+ a Stop button once it's actually playing);
        // MANUAL shows the full transport (Play/Pause + Stop).
        el('autoModeAuto').classList.toggle('active', state.mode === 'auto');
        el('autoModeManual').classList.toggle('active', state.mode === 'manual');
        const manual = state.mode === 'manual';
        el('autoAutoArea').hidden = manual;
        el('autoTransport').hidden = !manual;
        el('autoStopAutoBtn').hidden = !(state.mode === 'auto' && state.running);
        el('autoPlayBtn').disabled = !manual;
        el('autoStopBtn').disabled = !state.running;
        const playing = state.running && state.items[state.playingIndex] && !state.items[state.playingIndex].audio.paused;
        el('autoPlayBtn').innerHTML = playing ? '<i class="ph-fill ph-pause"></i>' : '<i class="ph-fill ph-play"></i>';

        updateTimes();
    }

    function updateTimes() {
        const startsBlock = el('autoStartsBlock');
        el('autoEndAt').textContent = fmtClockSec(actualEnd());
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
        // firedForThisSchedule guards against re-triggering the instant the
        // batch finishes: the anchor time is a fixed point in the past by then,
        // so secsToStart()<=0 stays true forever until a new schedule is set.
        if (state.mode === 'auto' && !state.running && !state.firedForThisSchedule && secsToStart() <= 0) {
            state.firedForThisSchedule = true;
            beginPlayback(0);
        }
    }, 250);

    // ---- toast ------------------------------------------------------------
    // Fixed to the viewport, right next to the time selector (not nested
    // inside the panel — so a rejection is never silently swallowed by a
    // still-hidden panel — and not centred on the whole screen either).
    let toastTimer = null;
    function toast(msg) {
        let t = el('autoToast');
        if (!t) {
            t = document.createElement('div'); t.id = 'autoToast';
            t.style.cssText = 'position:fixed; top:82px; right:16px; z-index:20000; background:rgba(240,69,63,0.96); color:#fff; padding:10px 16px; border-radius:8px; font-size:13px; font-weight:700; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); transition:opacity .2s; max-width:380px;';
            document.body.appendChild(t);
        }
        t.textContent = msg; t.style.opacity = '1';
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1800);
        return false;
    }

    // ---- wire up ----------------------------------------------------------
    function init() {
        buildPickerCombos();
        initListDragDrop();
        el('autoHeader').addEventListener('click', () => togglePop());
        el('autoPopStart').addEventListener('click', () => setAnchor('start'));
        el('autoPopEnd').addEventListener('click', () => setAnchor('end'));
        el('autoTimeTyped').addEventListener('input', onTyped);
        el('autoPopOk').addEventListener('click', () => togglePop(false));
        el('autoModeAuto').addEventListener('click', () => setMode('auto'));
        el('autoModeManual').addEventListener('click', () => setMode('manual'));
        el('autoPlayBtn').addEventListener('click', onPlayPause);
        el('autoStopBtn').addEventListener('click', forceStop);
        el('autoStopAutoBtn').addEventListener('click', forceStop);
        el('autoClearBtn').addEventListener('click', clearAndHide);
        document.addEventListener('click', (e) => {
            if (!el('autoPop').hidden && !e.target.closest('#autoPop') && !e.target.closest('#autoHeader')) togglePop(false);
        });
        // Enter, anywhere inside the open picker, closes it (same as OK).
        el('autoPop').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); togglePop(false); }
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
        stop: forceStop, // used by the shell's "Stop all"
    };
})();
