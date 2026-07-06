// License: PolyForm-Strict-1.0.0 (see LICENSE)
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
    // Tags the shared playback log (manager > Maintenance) with which player
    // fired the cart and which (simulated) output it carries — lets the log
    // double as a check that different players are actually routed to
    // different real devices, once there's real multi-output hardware
    // behind OUT 1-5. Runs in the parent document, not grid.php's iframe, so
    // it posts to grid.php explicitly.
    function logPlayback(name, action) {
        const out = (window.ROUTING || {}).autoplayer || 1;
        fetch('grid.php', { method: 'POST', body: `${new Date().toLocaleString()} - ${name} - ${action} - Autoplayer -> OUT ${out}` });
    }

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
        // Panel shown or hidden. The panel may stay open even when EMPTY (to set
        // up upcoming breaks) and is toggled from the topbar; it can only be
        // hidden while empty — never while it holds carts (no surprise audio).
        visible: false,
    };
    let idSeq = 1, groupSeq = 1, progressRaf = null;
    // Planner mode: the panel is temporarily borrowed by the admin's break
    // planner as its playlist editor. The DJ's live queue is pinned to
    // localStorage on entry and restored from it on exit; while in planner
    // mode nothing is persisted and the schedule guards are off.
    let plannerMode = false;
    // Full ORIGINAL definition of every chain in the queue (groupId -> plain
    // item list), captured when the chain is added. Items are removed one by
    // one as they play, so a tab closed mid-chain persists only the chain's
    // tail — on restore, loadState uses this to bring back the WHOLE chain.
    const groupDefs = {};

    // ---- persistence (localStorage) ---------------------------------------
    // Reload restores the queue, its order/colours/names, and the schedule.
    // Playback progress is NOT restored — a fresh load always starts idle; if
    // the scheduled time has already passed, AUTO mode will fire right away.
    const AUTO_STORE = 'cartPlayerAutomation';
    function saveState() {
        if (plannerMode) return; // planner edits must never leak into the live queue
        try {
            // Only chain definitions still referenced by the queue are kept.
            const liveGroups = {};
            state.items.forEach((it) => {
                if (it.groupId != null && groupDefs[it.groupId]) liveGroups[it.groupId] = groupDefs[it.groupId];
            });
            localStorage.setItem(AUTO_STORE, JSON.stringify({
                anchorTime: state.anchorTime.toISOString(),
                anchorMode: state.anchorMode,
                mode: state.mode,
                visible: state.visible,   // keep an empty-but-open panel open across reloads
                items: state.items.map((it) => ({
                    groupId: it.groupId, name: it.name, file: it.file,
                    start: it.start, end: it.end, volume: it.volume, color: it.color, runtime: it.runtime,
                    cartId: it.cartId || null,
                    overlapIn: it.overlapIn || 0, volEdited: !!it.volEdited,
                })),
                groups: liveGroups, // full chain definitions (see loadState)
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
            // Items are removed one by one as they play, so a queue saved
            // mid-chain holds only the chain's TAIL. Where the full chain
            // definition was saved alongside (groups), swap the partial run
            // back for the complete chain — a chain either plays whole or is
            // restored whole, never resumes from its middle.
            const groups = (data.groups && typeof data.groups === 'object') ? data.groups : {};
            const savedPerGroup = {};
            data.items.forEach((d) => { if (d.groupId != null) savedPerGroup[d.groupId] = (savedPerGroup[d.groupId] || 0) + 1; });
            const restore = [];
            const expandedGroups = new Set();
            data.items.forEach((d) => {
                const g = d.groupId;
                if (g != null && Array.isArray(groups[g]) && savedPerGroup[g] < groups[g].length) {
                    if (expandedGroups.has(g)) return; // whole chain inserted at its first member
                    expandedGroups.add(g);
                    groups[g].forEach((full) => restore.push({ ...full, groupId: g }));
                } else {
                    restore.push(d);
                }
            });
            restore.forEach((d) => {
                const audio = new Audio(`uploads/${d.file}`);
                window.AudioEngine.connectAutoplayer(audio);
                audio.preload = 'auto';
                const item = {
                    id: idSeq++, groupId: d.groupId, name: d.name, file: d.file,
                    start: d.start, end: d.end, volume: d.volume, color: d.color, runtime: d.runtime,
                    cartId: d.cartId || null,
                    overlapIn: Math.max(0, Math.round(Number(d.overlapIn) || 0)),
                    volEdited: !!d.volEdited,
                    audio, played: false,
                };
                primeAudio(item);
                state.items.push(item);
            });
            Object.entries(groups).forEach(([g, def]) => { groupDefs[g] = def; }); // keep for future saves
            const maxGroupId = restore.reduce((m, d) => (d.groupId != null ? Math.max(m, Number(d.groupId)) : m), 0);
            groupSeq = Math.max(groupSeq, maxGroupId + 1);
            // Restore visibility: shown if it holds carts, or if it was left open
            // empty (planning an upcoming break) before the reload.
            setVisible(state.items.length > 0 || data.visible === true);
            // A RESTORED schedule that's already stale (elapsed while the tab was
            // closed/idle, with an empty queue so there's nothing to protect)
            // starts fresh, rather than silently blocking the next add forever.
            // This only runs once, right after loading — NOT on every add — so it
            // can't mistake a freshly, deliberately set near-term time (e.g. an
            // "End at" just set a few seconds out) for a stale leftover.
            if (state.items.length === 0 && secsToStart() <= LOCK_LEAD) {
                state.anchorTime = nextFullHour();
                state.anchorMode = 'start';
            }
            // Restored ITEMS whose air time has already passed must NEVER
            // auto-play at startup (e.g. opening in the morning with last
            // night's leftovers still queued: without this, the tick would see
            // AUTO + time-elapsed + not-fired and start them on the spot).
            // Marking the schedule as already-fired and handing off to MANUAL
            // keeps the queue visible for the operator to reuse or clear —
            // the same stale-schedule semantics the tick applies mid-session.
            // A restored FUTURE schedule stays armed: that's the persistence
            // working as intended (reload minutes before a planned break).
            if (state.items.length > 0 && secsToStart() <= 0) {
                state.firedForThisSchedule = true;
                state.mode = 'manual';
            }
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
    // Always shows H:MM:SS (even "0:MM:SS") — symmetric with the HH:MM:SS
    // header/Ends-at readouts rather than dropping the hour when it's zero.
    function fmtCountdown(sec) {
        sec = Math.max(0, Math.round(sec));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    // Total air length: overlapped launches (cross editor) shave their ms off
    // the straight runtime sum. Items only carry overlapIn in planner mode
    // for now, so live schedule math is unchanged until playback learns it.
    function totalRuntime() {
        const sum = state.items.reduce((a, it) => a + it.runtime, 0);
        const lap = state.items.reduce((a, it, i) => a + (i > 0 ? (it.overlapIn || 0) : 0), 0) / 1000;
        return Math.max(0, sum - lap);
    }
    function actualStart() { return state.anchorMode === 'end' ? new Date(state.anchorTime.getTime() - totalRuntime() * 1000) : state.anchorTime; }
    function actualEnd() { return state.anchorMode === 'end' ? state.anchorTime : new Date(state.anchorTime.getTime() + totalRuntime() * 1000); }
    function secsToStart() { return (actualStart().getTime() - Date.now()) / 1000; }
    // Flipping From<->To this close to the batch's own start point can make
    // the OTHER direction impossible to honor without overrunning (e.g.
    // flipping a 30s batch to "To" 5s before its "From" time would need it
    // to have already started 25s ago). LOCK_LEAD (10s) is fine for adding
    // items/reordering, but a lead shorter than the batch itself isn't
    // enough here — freeze the toggle once we're within one full
    // batch-length of the schedule's actual start.
    function anchorToggleLocked() {
        return state.mode === 'auto' && state.items.length > 0 && secsToStart() <= totalRuntime();
    }
    function itemEnd(it) { return (it.end != null ? it.end : (it.audio && it.audio.duration)) || (it.start + it.runtime); }

    function remainingRuntime() {
        if (!state.running) return totalRuntime();
        let rem = 0;
        state.items.forEach((it, i) => {
            if (i < state.playingIndex) return;
            if (i === state.playingIndex) rem += Math.max(0, itemEnd(it) - it.audio.currentTime);
            // Upcoming crossfades shave their overlap off the remaining span —
            // each later item launches overlapIn ms before its predecessor ends.
            else rem += it.runtime - (it.overlapIn || 0) / 1000;
        });
        return Math.max(0, rem);
    }

    // ---- add --------------------------------------------------------------
    function addItems(list, grouped) {
        if (!Array.isArray(list) || list.length === 0) return;
        const sumNew = list.reduce((a, d) => a + (Number(d.runtime) || 0), 0);
        if (state.locked || state.running) return toast('Playlist locked');
        // Schedule guards only mean anything in AUTO mode (they protect a
        // scheduled auto-start from being edited out from under itself) —
        // MANUAL has no start time to guard, so secsToStart() is meaningless
        // there (and can be a stale negative number left over from an old
        // AUTO schedule the tick already flipped us out of), which used to
        // block every add with "Too close to start". Also skipped in the
        // planner: it edits any break, including ones whose air time has
        // already passed today. The hour cap stays on regardless (a break
        // longer than an hour is a mistake in any mode).
        if (!plannerMode && state.mode === 'auto') {
            if (secsToStart() <= LOCK_LEAD) return toast('Too close to start');
            if (sumNew > secsToStart() + FIT_BUFFER) return toast("Won't fit before start");
        }
        if (totalRuntime() + sumNew > HOUR) return toast('Would overrun the hour');

        const gid = grouped && list.length > 1 ? groupSeq++ : null;
        if (gid != null) groupDefs[gid] = []; // capture the chain's full definition
        list.forEach((d) => {
            const audio = new Audio(`uploads/${d.file}`);
            window.AudioEngine.connectAutoplayer(audio);
            audio.preload = 'auto';
            const item = {
                id: idSeq++, groupId: gid, name: d.name || '—', file: d.file,
                start: Number(d.start) || 0,
                end: (d.end != null && d.end !== '') ? Number(d.end) : null,
                volume: (d.volume != null && d.volume !== '') ? Number(d.volume) : 1,
                color: String(d.color || '1'), runtime: Math.max(0, Number(d.runtime) || 0),
                cartId: d.cartId || null, // 1-based carts.txt line, when known (planner adds)
                // Cross editor (planner): ms this item launches BEFORE the
                // previous one ends. 0 = butt joint. Rides with the item, so
                // reordering keeps the early launch it was given.
                overlapIn: Math.max(0, Math.round(Number(d.overlapIn) || 0)),
                // Cross editor volume line: true once the break carries its
                // own volume override for this item (vs the cart's default).
                volEdited: !!d.volEdited,
                audio, played: false,
            };
            if (gid != null) {
                groupDefs[gid].push({
                    name: item.name, file: item.file, start: item.start, end: item.end,
                    volume: item.volume, color: item.color, runtime: item.runtime, cartId: item.cartId,
                });
            }
            primeAudio(item);
            state.items.push(item);
        });
        state.firedForThisSchedule = false; // new material queued -> arm AUTO again
        show();
        saveState();
        render();
        const l = el('autoList'); l.scrollTop = l.scrollHeight; // reveal the just-added item(s) at the bottom
    }

    // Stands a still-in-flight priming cycle down once an item's <audio>
    // element is about to carry REAL, audible playback (on-air advance,
    // resume, or a planner preview). Without this, primeAudio()'s delayed
    // muted-play cleanup can fire after real playback has already started on
    // the same element, silently pausing + rewinding it mid-air — the advance
    // timer is wall-clock/duration-based, not tied to playback events, so it
    // has no idea audio actually stopped and just proceeds on schedule as if
    // nothing happened. Call this before any real .play() on item.audio.
    function cancelPriming(item) {
        item._primeCancelled = true;
        if (item._primeTimer) { clearTimeout(item._primeTimer); item._primeTimer = null; }
    }
    function primeAudio(item) {
        const a = item.audio;
        const onReady = () => {
            a.removeEventListener('canplaythrough', onReady);
            if (item._primeCancelled) return; // real playback already claimed this element
            const vol = a.volume; a.volume = 0;
            try { a.currentTime = item.start; } catch (e) {}
            const p = a.play();
            if (p) p.then(() => {
                if (item._primeCancelled) return;
                item._primeTimer = setTimeout(() => {
                    item._primeTimer = null;
                    if (item._primeCancelled) return;
                    a.pause(); try { a.currentTime = item.start; } catch (e) {} a.volume = vol;
                }, 60);
            }).catch(() => { a.volume = vol; });
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
    // Emptying the queue no longer auto-hides the panel — it can stay open and
    // empty to set up an upcoming break. Reset just restores a fresh default
    // schedule; the panel is hidden only via the topbar toggle or Clear & hide.
    function resetSchedule() {
        state.anchorTime = nextFullHour();
        state.anchorMode = 'start';
        state.mode = 'auto';
        state.firedForThisSchedule = false;
    }
    function removeAt(from, to) {
        if (state.locked || state.running) return;
        resetCross(); // the gap being edited may not survive the removal
        state.items.slice(from, to + 1).forEach(it => { try { it.audio.pause(); } catch (e) {} });
        state.items.splice(from, to - from + 1);
        if (state.items.length === 0) resetSchedule();   // stays open + empty
        saveState();
        render();
        // The planner needs to know its selected break just changed (Save
        // button / unsaved flag) — the live queue never sets plannerMode, so
        // this can't leak into on-air playback.
        if (plannerMode && crossSavedHook) crossSavedHook();
    }
    // Removed automatically ~1s after a cart finishes playing (see playNext).
    // Keeping the list shrinking as it plays is what keeps auto-scroll smooth
    // and leaves an empty (but still open) list once the whole batch is done.
    function removeItemById(id) {
        const i = state.items.findIndex((it) => it.id === id);
        if (i < 0) return;
        try { state.items[i].audio.pause(); } catch (e) {}
        state.items.splice(i, 1);
        if (state.playingIndex > i) state.playingIndex--;
        if (state.items.length === 0) resetSchedule();   // batch done -> empty, but stays open
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
        el('autoList').scrollTop = 0; // snap the queue back to the top as playback begins
    }
    // A crossfading item that has already handed over but is still ringing
    // out its tail while the next one plays. Killed on stop/pause/advance.
    let tailOut = null; // { audio, timer }
    function killTail() {
        if (!tailOut) return;
        clearTimeout(tailOut.timer);
        try { tailOut.audio.pause(); } catch (e) {}
        tailOut = null;
    }
    // The advance to item i fires overlapIn(i) ms BEFORE item i-1 ends (the
    // cross editor's plan): the outgoing item keeps playing its tail while
    // the incoming one is already on, then silences itself at its own end.
    function advanceLeadMs(nextIndex) {
        const nx = state.items[nextIndex];
        return nx ? Math.max(0, nx.overlapIn || 0) : 0;
    }
    function playNext() {
        killTail(); // at most one tail rings at a time
        const prev = state.items[state.playingIndex];
        if (prev) {
            clearTimeout(prev._timer);
            prev.played = true;
            const prevAudio = prev.audio;
            const nextIt = state.items[state.playingIndex + 1];
            const fading = nextIt && (nextIt.overlapIn || 0) > 0;
            let tailMs = 0;
            if (fading) {
                tailMs = Math.max(0, (itemEnd(prev) - prevAudio.currentTime) * 1000);
                tailOut = { audio: prevAudio, timer: setTimeout(() => { try { prevAudio.pause(); } catch (e) {} tailOut = null; logPlayback(prev.name, 'stopped'); }, tailMs) };
            } else {
                try { prevAudio.pause(); } catch (e) {}
                logPlayback(prev.name, 'stopped');
            }
            // Finished items shrink out of the live queue — but the planner's
            // transport is just a PREVIEW: the break keeps its items. Removal
            // waits for the tail (removeItemById pauses the audio).
            if (!plannerMode) {
                const prevId = prev.id;
                setTimeout(() => removeItemById(prevId), Math.max(1000, tailMs + 300));
            }
        }
        state.playingIndex++;
        if (state.playingIndex >= state.items.length) { endPlayback(); render(); return; }
        const it = state.items[state.playingIndex];
        const a = it.audio;
        cancelPriming(it);
        try { a.currentTime = it.start; } catch (e) {}
        a.volume = it.volume;
        a.play().catch(() => {});
        logPlayback(it.name, 'played');
        clearTimeout(it._timer);
        it._timer = setTimeout(() => playNext(), Math.max(0, (itemEnd(it) - it.start) * 1000 - advanceLeadMs(state.playingIndex + 1)));
        render();
        centerCurrent();
        startProgress();
    }
    function pause() {
        killTail(); // a manual pause mid-fade silences the outgoing tail too
        const it = state.items[state.playingIndex];
        if (it) { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); logPlayback(it.name, 'stopped'); }
        render();
    }
    function resume() {
        const it = state.items[state.playingIndex];
        if (!it) { playNext(); return; }
        cancelPriming(it);
        it.audio.play().catch(() => {});
        logPlayback(it.name, 'played');
        it._timer = setTimeout(() => playNext(), Math.max(0, (itemEnd(it) - it.audio.currentTime) * 1000 - advanceLeadMs(state.playingIndex + 1)));
        render();
    }
    function endPlayback() {
        // Interrupted (forceStop) mid-item: playingIndex still points at
        // whatever was on air, so log its stop here. The natural-completion
        // path (queue exhausted, called from inside playNext()) already
        // logged the last item's stop via playNext()'s own prev-handling,
        // and by then playingIndex has moved past the end — nothing to
        // double-log here in that case.
        const cur = state.items[state.playingIndex];
        if (cur) logPlayback(cur.name, 'stopped');
        state.running = false; state.playingIndex = -1;
        killTail();
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        // Planner preview consumed nothing — drop the "played" dimming too.
        if (plannerMode) state.items.forEach(it => { it.played = false; });
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
    // in playNext, does that) — MANUAL keeps its queue so it can be resumed.
    function forceStop() {
        if (!state.running) return;
        endPlayback();
        // AUTO has no "resume" affordance once stopped — leaving the (now
        // stale) items sitting in the queue kept the header's countdown
        // ticking against an interrupted schedule, and firedForThisSchedule
        // being already true meant it could never re-arm. Reset it clean.
        if (state.mode === 'auto') {
            state.items.forEach((it) => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
            state.items = [];
            resetSchedule();
            saveState();
        }
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
    // The popover only edits the TIME (hour + minute) as a DRAFT — nothing takes
    // effect until OK (or Enter) commits it; closing any other way (click
    // outside, re-toggling the header) discards it. From/To (the anchor) is set
    // separately by the header's o-> toggle, so the popover has no mode buttons.
    let draft = null; // { hh, mm } while the popover is open
    function openPop() {
        draft = { hh: state.anchorTime.getHours(), mm: state.anchorTime.getMinutes() };
        el('autoPop').hidden = false;
        syncPicker();
        refreshPickerLive();
    }
    function closePopDiscard() {
        el('autoPop').hidden = true;
        draft = null;
    }
    // The o-> icon in the header: a one-click toggle between From (start-at) and
    // To (end-at). Commits straight to the real schedule (it's NOT part of the
    // draft popover) and re-renders every dependent display. Works in MANUAL
    // too — the header stays interactive there, just muted.
    function toggleAnchor() {
        if (state.locked || state.running) return;
        if (anchorToggleLocked()) return toast('Too close to start — From/To is locked');
        // Deliberately does NOT close an open picker — you can flip From/To with
        // the picker still up (the picker only edits the time; the anchor is
        // independent). Its own listener stopPropagation-s, so the outside-click
        // handler doesn't fire either. render() re-syncs the header + picker.
        state.anchorMode = state.anchorMode === 'end' ? 'start' : 'end';
        state.firedForThisSchedule = false; // new anchor -> re-arm AUTO
        saveState();
        render();
    }
    function togglePop(force) {
        const pop = el('autoPop');
        const openNow = force != null ? force : pop.hidden;
        if (openNow && (state.locked || state.running)) return;
        if (openNow) openPop(); else closePopDiscard();
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
    // Commit the draft to the real schedule (OK / Enter). Rejects (toasts, and
    // leaves the popover open so the operator can adjust) rather than closing
    // on an invalid pick.
    function commitDraft() {
        if (!draft) { closePopDiscard(); return; }
        const d = nextOccurrence(draft.hh, draft.mm);
        if (d.getTime() - Date.now() < 60000) { toast('Must be at least 1 minute away'); return; }
        state.anchorTime = d;
        state.firedForThisSchedule = false; // new schedule -> arm AUTO again
        saveState();
        closePopDiscard();
        render();
    }
    // The hour/minute fields are typeable inputs that ALSO drop down a list of
    // quick picks (custom-built, not native <select>s, so we can colour the
    // next-hour option and grey out past times). Type a precise value, or pick.
    function buildPickerCombos() {
        const hourInput = el('autoHourComboBtn');
        const hourList = el('autoHourComboList');
        const minInput = el('autoMinComboBtn');
        const minList = el('autoMinComboList');

        // Build a dropdown of quick-pick options for one field.
        const buildList = (listEl, inputEl, values, key) => {
            listEl.innerHTML = '';
            values.forEach((v) => {
                const opt = document.createElement('button');
                opt.type = 'button';
                opt.textContent = String(v).padStart(2, '0');
                opt.dataset[key] = String(v);
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!draft) return;
                    if (key === 'h') draft.hh = v; else draft.mm = v;
                    inputEl.value = String(v).padStart(2, '0');
                    listEl.hidden = true;
                    refreshPickerLive();
                });
                listEl.appendChild(opt);
            });
        };
        buildList(hourList, hourInput, [...Array(24).keys()], 'h');
        buildList(minList, minInput, [0, 15, 30, 45], 'm');

        // Open a field's dropdown (closing the other), scrolled to a useful spot.
        const openList = (listEl, otherList, scrollFn) => {
            otherList.hidden = true;
            listEl.hidden = false;
            refreshPickerLive();
            if (scrollFn) scrollFn(listEl);
        };
        // Focusing/clicking a field shows its dropdown; typing edits the draft.
        // Open the hour list scrolled to the CURRENT real-world hour (not the
        // armed one), the minute list centred on the selected quick-pick.
        hourInput.addEventListener('focus', () => openList(hourList, minList, scrollToCurrentHour));
        hourInput.addEventListener('click', (e) => { e.stopPropagation(); openList(hourList, minList, scrollToCurrentHour); });
        hourInput.addEventListener('input', () => onComboType(hourInput, 'h'));
        hourInput.addEventListener('blur', syncDraftUI); // normalise "3" -> "03"
        minInput.addEventListener('focus', () => openList(minList, hourList, centerSelectedCombo));
        minInput.addEventListener('click', (e) => { e.stopPropagation(); openList(minList, hourList, centerSelectedCombo); });
        minInput.addEventListener('input', () => onComboType(minInput, 'm'));
        minInput.addEventListener('blur', syncDraftUI);

        document.addEventListener('click', () => { hourList.hidden = true; minList.hidden = true; });
    }
    // Live-edit a combo field: keep only digits, clamp to range, update the draft.
    function onComboType(inputEl, which) {
        if (!draft) return;
        const digits = inputEl.value.replace(/\D/g, '');
        if (digits !== inputEl.value) inputEl.value = digits; // strip stray non-numerics as typed
        if (digits === '') return;                            // mid-edit; leave the draft until a number lands
        const max = which === 'h' ? 23 : 59;
        let n = parseInt(digits, 10);
        if (n > max) { n = max; inputEl.value = String(n); }
        if (which === 'h') draft.hh = n; else draft.mm = n;
        refreshPickerLive();
    }
    // Opening a combo scrolls its list so the currently selected value is
    // centred, rather than always starting scrolled to the top.
    function centerSelectedCombo(list) {
        const sel = list.querySelector('button.sel');
        if (sel) sel.scrollIntoView({ block: 'center' });
    }
    function scrollToCurrentHour(list) {
        const curH = new Date().getHours();
        const opt = [...list.children].find((o) => parseInt(o.dataset.h, 10) === curH);
        if (opt) opt.scrollIntoView({ block: 'start' });
    }
    // Marks the next top-of-the-hour option (always — so it's the visible
    // default reference point even once something else is picked) and grays
    // out/disables times already in the past today. Re-run every time either
    // combo list opens, since "now" keeps moving.
    function refreshPickerLive() {
        const now = new Date();
        const curH = now.getHours(), curM = now.getMinutes();
        const nextH = nextFullHour().getHours();
        const selHour = draft ? draft.hh : state.anchorTime.getHours();
        const selMin = draft ? draft.mm : state.anchorTime.getMinutes();

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
    // Reflects the DRAFT in the popover's hour/minute fields — the header itself
    // stays showing the last COMMITTED schedule until OK is clicked. Skips a
    // field that's being typed in, so it never clobbers the operator's input.
    function syncPicker() {
        syncDraftUI();
    }
    function syncDraftUI() {
        if (!draft) return;
        const hEl = el('autoHourComboBtn'), mEl = el('autoMinComboBtn');
        if (document.activeElement !== hEl) hEl.value = String(draft.hh).padStart(2, '0');
        if (document.activeElement !== mEl) mEl.value = String(draft.mm).padStart(2, '0');
    }

    // ---- show / clear -----------------------------------------------------
    function updateAutoChip() {
        const chip = el('chip-auto');
        if (chip) chip.classList.toggle('is-active', state.visible);
    }
    function setVisible(v) {
        state.visible = v;
        el('automationPanel').classList.toggle('active', v);
        updateAutoChip();
        saveState();
        // The strip only has real geometry once the panel is shown — re-centre
        // its "next" chip now that offsetWidth/clientWidth are meaningful.
        if (v) centerNextChip();
    }
    function show() { setVisible(true); }
    // Topbar toggle. Can only HIDE while the queue is empty — never with carts
    // loaded (no surprise audio from a panel you can't see). The warning toast
    // carries the shortcut: one click clears AND hides.
    function toggleVisible() {
        if (state.visible) {
            if (state.items.length > 0) {
                if (state.running) return toast('Playlist locked');
                return toast('Playlist is not empty', 'Clear & hide', clearAndHide);
            }
            setVisible(false);
        } else {
            if (state.items.length === 0) resetSchedule(); // open fresh for planning
            render();
            setVisible(true);
        }
    }
    function clearQueue() {
        // Clear always wins — if something is still on air, stop it first
        // rather than silently refusing (that left the header's countdown
        // ticking against a schedule Clear was supposed to wipe).
        if (state.running) forceStop();
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        resetSchedule();
        saveState();
        render();
    }
    function clearAndHide() {
        if (state.running) return;
        clearQueue();
        setVisible(false); // empty now, so hiding is allowed
    }
    // The bottom button is two-stage: with carts queued it reads CLEAR (empties
    // the list, panel stays open); once empty it reads HIDE. Never both at once
    // — clearing is deliberate, hiding an emptied panel is a separate decision.
    function clearOrHide() {
        if (state.items.length > 0) clearQueue();
        else setVisible(false);
    }

    function syncLock() {
        const lock = state.running || (state.mode === 'auto' && state.items.length > 0 && secsToStart() <= LOCK_LEAD);
        state.locked = lock;
        el('automationPanel').classList.toggle('locked', lock);
    }

    // ---- drag & drop reorder (block-aware, container-delegated) -----------
    // Deliberately DOESN'T touch the DOM during the drag — no cloned "ghost"
    // row, no hiding the source. Both of those fight native HTML5 drag: hiding
    // the drag source (or restructuring the list under the cursor on every
    // dragover) makes browsers cancel the drag, so most drags never registered.
    // Instead: dim the source in place, draw a drop-line with a CSS class only
    // (no reflow, no node moves), and do the actual reorder + re-render once on
    // drop (mouse release). Delegating dragover/drop to the LIST CONTAINER lets
    // a drop still register in the empty space below the last row.
    let dragBlock = null, dropBlocks = [], dropIdx = -1;
    // Insertion index (a position BETWEEN blocks, 0..N) for a given pointer Y,
    // from the midpoint of each rendered block. The dragged source stays in
    // place (just dimmed), so it's included — consistent with dropBlocks.
    function insertionIndexAt(list, clientY) {
        const nodes = [...list.children].filter((n) => n.dataset.from !== undefined);
        for (let i = 0; i < nodes.length; i++) {
            const rect = nodes[i].getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) return i;
        }
        return nodes.length; // past the last row -> end of the list
    }
    function clearDropMarks() {
        el('autoList').querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    }
    // Paint the drop-line at insertion index `idx` (before that block, or after
    // the last one when idx is past the end) using inset box-shadow — no layout
    // change, so it can't disturb the in-flight drag.
    function paintDropLine(list, idx) {
        clearDropMarks();
        const nodes = [...list.children].filter((n) => n.dataset.from !== undefined);
        if (!nodes.length) return;
        if (idx >= nodes.length) nodes[nodes.length - 1].classList.add('drop-after');
        else nodes[idx].classList.add('drop-before');
    }
    function reorderBlock(src, insertBlockIndex) {
        resetCross(); // an open cross editor's gap index is meaningless after a move
        const srcCount = src.to - src.from + 1;
        // insertBlockIndex counts blocks BEFORE removal; translate to an item index.
        let insertAt = insertBlockIndex >= dropBlocks.length
            ? state.items.length
            : dropBlocks[insertBlockIndex].from;
        const moved = state.items.splice(src.from, srcCount);
        if (src.from < insertAt) insertAt -= srcCount;
        state.items.splice(insertAt, 0, ...moved);
        // Safety: a crossfade was tuned for one specific PAIR — any reorder
        // voids the whole crossfade plan. Volume overrides ride their item
        // and survive the move.
        state.items.forEach((it) => { it.overlapIn = 0; });
        saveState();
        render();
        if (plannerMode && crossSavedHook) crossSavedHook(); // see removeAt()'s note
    }
    function attachDrag(node, block) {
        node.dataset.from = block.from;
        node.draggable = !(state.locked || state.running);
        node.addEventListener('dragstart', (e) => {
            // Native drag should only ever start from the primary (left)
            // button — guards against a right-click (which shouldn't drag at
            // all) being misread as a drag start on some browser/OS combos.
            if (e.button !== 0) { e.preventDefault(); return; }
            dragBlock = block; dropBlocks = blocks(); dropIdx = -1;
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', ''); } catch (x) {}
            node.classList.add('dragging'); // dim only — stays in place & in the DOM
        });
        node.addEventListener('dragend', () => {
            node.classList.remove('dragging');
            clearDropMarks();
            dragBlock = null; dropIdx = -1;
        });
    }
    function initListDragDrop() {
        const list = el('autoList');
        list.addEventListener('dragover', (e) => {
            if (!dragBlock) return;
            e.preventDefault();
            const idx = insertionIndexAt(list, e.clientY);
            if (idx === dropIdx) return; // only repaint when the target actually moves
            dropIdx = idx;
            paintDropLine(list, idx);
        });
        list.addEventListener('drop', (e) => {
            if (!dragBlock) return;
            e.preventDefault();
            const idx = insertionIndexAt(list, e.clientY);
            clearDropMarks();
            reorderBlock(dragBlock, idx);
        });
    }

    // ---- render -----------------------------------------------------------
    function render() {
        stopRowPreview(); // rows (and their play-button refs) are about to be rebuilt
        // A structural change may have invalidated the gap/item being edited.
        if (crossGap >= 0 && crossGap >= state.items.length - 1) resetCross();
        if (crossSolo >= 0 && crossSolo >= state.items.length) resetCross();
        const list = el('autoList');
        list.innerHTML = '';
        const blockList = blocks();
        blockList.forEach((block, bi) => {
            const makeItemRow = (it, idx) => {
                const row = document.createElement('div');
                row.className = 'auto-item' + (idx === state.playingIndex ? ' playing' : '') + (it.played ? ' played' : '');
                row.dataset.id = it.id;
                row.style.setProperty('--item-color', CAT[it.color] || CAT['1']);
                row.innerHTML =
                    `<span class="auto-progress"></span>` +
                    (plannerMode ? `<button class="auto-item-play" title="Preview"><i class="ph-fill ph-play"></i></button>` : '') +
                    `<span class="auto-name"></span>` +
                    // V badge on every planner row: gray = cart volume, yellow
                    // = this break attenuates it. Click -> solo volume editor.
                    (plannerMode ? `<button class="auto-vol-flag${it.volEdited ? ' on' : ''}" title="${it.volEdited ? 'Volume edited — click to adjust' : 'Adjust the volume of this item'}">V</button>` : '') +
                    `<span class="auto-runtime">${fmtDur(it.runtime)}</span>` +
                    (block.groupId == null ? `<button class="auto-remove" title="Remove"><i class="ph ph-trash"></i></button>` : '');
                row.querySelector('.auto-name').textContent = it.name;
                const rm = row.querySelector('.auto-remove');
                if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); removeAt(block.from, block.to); });
                const pv = row.querySelector('.auto-item-play');
                if (pv) pv.addEventListener('click', (e) => { e.stopPropagation(); toggleRowPreview(it, pv); });
                const vf = row.querySelector('.auto-vol-flag');
                if (vf) vf.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (crossSolo === idx) closeCross(); else openVolume(idx);
                });
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
            // Planner only: a thin cross(fade) button in every gap between two
            // items — opens the overlap editor at the panel's bottom. (No
            // data-from attr, so the drag & drop index math skips these.)
            if (plannerMode && bi < blockList.length - 1) list.appendChild(makeGapButton(block.to));
        });
        if (plannerMode && crossActive()) updateCrossUI();

        // total (or remaining while running) — reads like the on-air countdown
        // bars elsewhere (red background, white text) while playing.
        el('autoTotalLabel').textContent = state.running ? 'Remaining' : 'Total';
        el('autoTotal').textContent = fmtDur(remainingRuntime());
        el('autoTotalRow').classList.toggle('running', state.running);

        // header. MANUAL = "hand mode": the From/To assembly is replaced by a
        // green hand, the time reads —:— (see updateTimes) and the whole header
        // is disabled — there's no schedule to edit until AUTO comes back.
        const hand = state.mode === 'manual';
        el('autoHeaderRow').classList.toggle('hand-mode', hand);
        // The toggle's own .locked class (batch-length-aware) is kept in sync
        // inside updateTimes() instead — that one runs every tick, not just
        // when render() happens to fire, so it freezes in real time.
        el('autoHeaderIcon').innerHTML = hand ? '<i class="ph ph-hand-tap"></i>' : (state.anchorMode === 'end' ? ICON.end : ICON.start);
        el('autoHeaderRow').classList.toggle('end-mode', !hand && state.anchorMode === 'end');
        el('autoTimeLabel').textContent = hand ? '' : (state.anchorMode === 'end' ? 'To' : 'From');
        // autoTime itself is set inside updateTimes() (below), since it needs
        // to fall back to "—:—" for a stale/elapsed schedule.
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

        // Two-stage bottom button: CLEAR while carts are queued, HIDE once empty.
        el('autoClearBtn').innerHTML = state.items.length > 0
            ? '<i class="ph ph-trash"></i> Clear'
            : '<i class="ph ph-eye-slash"></i> Hide';

        updateTimes();
        updateLoadedName();
    }

    // The "what did I just load?" box above the queue: shows the loaded
    // break's name, gains "(modified)" once content or time diverge from what
    // was loaded, and clears (with the chip's residual yellow) once the queue
    // empties. Frozen while ON AIR — items disappearing as they play would
    // otherwise read as "(modified)" noise.
    function updateLoadedName() {
        const box = el('autoLoadedName');
        if (!box) return;
        if (!plannerMode && loadedBreak && state.items.length === 0) {
            loadedBreak = null;
            renderStrip(); // drop the yellow mark too
        }
        if (!loadedBreak || plannerMode) { box.hidden = true; return; }
        const modified = !state.running &&
            (queueSig() !== loadedBreak.sig ||
             (loadedBreak.schedSig != null && scheduleSig() !== loadedBreak.schedSig));
        box.textContent = loadedBreak.name + (modified ? ' (modified)' : '');
        box.hidden = false;
    }

    // A schedule counts as "stale" once it's elapsed without firing and won't
    // fire this tick either (already in MANUAL, or AUTO already fired once for
    // it) — e.g. the operator never pressed play. Rather than show a bogus
    // long countdown (or worse, look armed for ~24h because it quietly rolled
    // to "tomorrow"), the header just goes blank and hands off to MANUAL.
    function scheduleIsStale() {
        return !state.running && secsToStart() < 0 && (state.mode === 'manual' || state.firedForThisSchedule);
    }
    function updateTimes() {
        const startsBlock = el('autoStartsBlock');
        // Hand mode (MANUAL): no time target at all.
        el('autoTime').textContent = (state.mode === 'manual' || scheduleIsStale()) ? '—:—' : fmtClockSec(state.anchorTime);
        el('autoEndAt').textContent = fmtClockSec(actualEnd());
        if (state.running) {
            startsBlock.classList.remove('imminent');
            startsBlock.classList.add('live');
            startsBlock.querySelector('.auto-times-label').textContent = 'On air';
            el('autoCountdown').textContent = 'NOW';
        } else {
            startsBlock.classList.remove('live');
            startsBlock.querySelector('.auto-times-label').textContent = 'Starts in';
            const secs = secsToStart();
            el('autoCountdown').textContent = '-' + fmtCountdown(secs);
            startsBlock.classList.toggle('imminent', secs <= 30);
        }
        fitTimes();
        // Runs every tick (unlike render()) so the toggle visibly freezes in
        // real time as the countdown crosses into the batch-length window,
        // not just the next time some other action happens to repaint.
        el('autoAnchorToggle').classList.toggle('locked', anchorToggleLocked());
    }
    // Both "Starts in" / "Ends at" read-outs share ONE font size, shrunk just
    // enough that the WIDER of the two fits its half-box (a countdown with hours
    // and a leading "-", e.g. -23:35:41, is wider than a plain 20:00:00). Keeps
    // them equal-sized and non-overflowing at any panel width. Cached on the
    // two strings + box width so the common case (no change) skips the reflow.
    let lastFitKey = '';
    function fitTimes() {
        const a = el('autoCountdown'), b = el('autoEndAt');
        const blockA = a.parentElement, blockB = b.parentElement;
        if (!blockA.clientWidth) return; // hidden (MANUAL) / not laid out yet
        const key = a.textContent + '|' + b.textContent + '|' + blockA.clientWidth;
        if (key === lastFitKey) return;
        lastFitKey = key;
        const BASE = 26, MIN = 13; // compact clocks — the strip above needs the room
        a.style.fontSize = b.style.fontSize = BASE + 'px';
        let scale = 1;
        [[a, blockA], [b, blockB]].forEach(([v, block]) => {
            const cs = getComputedStyle(block);
            const avail = block.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            if (v.scrollWidth > 0 && avail > 0) scale = Math.min(scale, avail / v.scrollWidth);
        });
        const size = Math.max(MIN, Math.min(BASE, Math.floor(BASE * scale)));
        a.style.fontSize = b.style.fontSize = size + 'px';
    }

    // ---- tick -------------------------------------------------------------
    setInterval(() => {
        syncLock();
        updateStrip();   // advance/pulse the breaks strip's "next" chip
        // Watchdog: the playback advance rides setTimeout chains, which
        // browsers clamp/drift in background tabs — a break could finish
        // with the panel stuck "playing" and locked. The tick is the
        // authority: if the item that should be on air has actually finished
        // (audio ended, or past its end trim), force the advance its timer
        // owed us — playNext() clears the stale timer itself, and on the
        // last item it lands in endPlayback(), releasing the lock. A manual
        // PAUSE is untouched: a paused item's clock stays short of its end.
        if (state.running) {
            const cur = state.items[state.playingIndex];
            if (!cur) { endPlayback(); render(); }
            else if (cur.audio.ended || cur.audio.currentTime >= itemEnd(cur) - 0.05) playNext();
        }
        if (state.running) { el('autoTotal').textContent = fmtDur(remainingRuntime()); }

        if (state.items.length === 0) {
            // Empty but open (an operator holding the panel for an upcoming
            // break): the "Starts in" countdown keeps running for planning and
            // for consistency with a loaded queue. There's nothing to fire, so
            // an elapsed AUTO anchor just rolls to the next full hour — the same
            // fresh reset loadState() does — rather than sitting at a stale
            // negative. ("Ends at" is pinned to the anchor, so with a zero-length
            // queue it naturally stays put.)
            if (state.mode === 'auto' && secsToStart() <= 0) {
                state.anchorTime = nextFullHour();
                state.anchorMode = 'start';
                state.firedForThisSchedule = false;
                saveState();
            }
            updateTimes();
            return;
        }

        // A stale schedule (elapsed, already fired once, still sitting there)
        // hands off to the operator instead of quietly staying "armed".
        if (scheduleIsStale() && state.mode !== 'manual') { state.mode = 'manual'; saveState(); }

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
    // Overlays the header row itself (inset within .auto-header-wrap's own
    // box) — right where the time selector is, replacing it for the ~1.8s
    // the warning shows. Two other positions were tried and both lost:
    // - A negative top (floating above the panel, into the topbar's space)
    //   silently painted BEHIND the topbar: the topbar is a flex item with
    //   z-index:1002 to stay above the board, a different stacking context
    //   than the panel, and nothing here can out-rank that once outside the
    //   panel's own bounds.
    // - Sitting just below the header (top:100%, the same spot the popover
    //   itself uses safely) put it over .auto-list's scrolling rows instead,
    //   and lost to them despite a much higher z-index — scrollable overflow
    //   containers get their own compositing layer in practice, and that
    //   painted over a sibling's absolutely-positioned z-index in this case.
    // Staying fully inside the header's own box sidesteps both: no overlap
    // with the topbar above or the list below, so there's nothing to lose to.
    // pointer-events:none is essential: a merely-invisible (opacity:0) element
    // is still hit-tested and would silently eat clicks meant for whatever
    // sits underneath/behind it once faded (this is what made the header's
    // time area unclickable — the old fixed-position toast never went away).
    let toastTimer = null;
    // Optional action: toast(msg, label, fn) renders a button inside the toast
    // (e.g. "Load anyway" on a passed break) and stays up longer. The toast
    // container keeps pointer-events:none; only the button itself is live.
    function toast(msg, actionLabel, actionFn) {
        let t = el('autoToast');
        if (!t) {
            t = document.createElement('div'); t.id = 'autoToast';
            t.style.cssText = 'position:absolute; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; gap:10px; background:rgba(240,69,63,0.96); color:#fff; padding:10px 16px; font-size:13px; font-weight:700; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); transition:opacity .2s; pointer-events:none;';
            el('autoHeader').parentElement.appendChild(t);
        }
        t.textContent = msg;
        if (actionLabel && actionFn) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = actionLabel;
            btn.style.cssText = 'pointer-events:auto; border:none; border-radius:6px; padding:4px 10px; cursor:pointer; background:#fff; color:#b3221d; font-weight:800; font-size:12px; font-family:inherit; flex-shrink:0;';
            btn.addEventListener('click', () => { clearTimeout(toastTimer); t.style.opacity = '0'; actionFn(); });
            t.appendChild(btn);
        }
        t.style.opacity = '1';
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, actionLabel ? 5000 : 1800);
        return false;
    }

    // ---- commercial-breaks strip -------------------------------------------
    // Renders window.BREAKS (the planner's daily plan) as a chip rail pinned
    // above the time header. Break items are REFERENCES into window.CARTS
    // (1-based carts.txt lines), resolved fresh at render/load time — so a
    // re-trim in the admin changes a break's length everywhere at once.
    // Clicking a chip loads that break into the queue below (schedule + items
    // + arm AUTO); a break never loads itself.
    const durCache = {};   // file -> duration secs (only needed when a cart has no end trim)
    function resolveCart(id) {
        return (window.CARTS || []).find((c) => c.i === id - 1) || null;
    }
    function cartRuntime(c) {
        if (!c) return 0;
        let end = c.end;
        if (end == null) {
            end = durCache[c.file];
            if (end === undefined) loadDuration(c.file); // async; strip re-renders when known
            if (end == null) return 0;
        }
        return Math.max(0, end - (c.start || 0));
    }
    function loadDuration(file) {
        durCache[file] = null;   // marks "in flight" so we only fetch once
        const a = new Audio(`uploads/${file}`);
        a.preload = 'metadata';
        a.addEventListener('loadedmetadata', () => { durCache[file] = a.duration || 0; renderStrip(); });
    }
    function breakLength(b) {
        const sum = b.items.reduce((s, id) => s + cartRuntime(resolveCart(id)), 0);
        const lap = (b.overlaps || []).reduce((s, ms) => s + (ms || 0), 0) / 1000;
        return Math.max(0, sum - lap);
    }
    // Seconds from now to the break's HH:MM today; negative once it has passed.
    function secsToBreak(b) {
        const [hh, mm] = b.time.split(':').map(Number);
        const t = new Date(); t.setHours(hh, mm, 0, 0);
        return (t.getTime() - Date.now()) / 1000;
    }
    // The strip shows only ENABLED breaks, split into SCHEDULED (time-driven)
    // and MANUAL (DJ fires them by hand — holiday batches etc.). The category
    // wrapper headers appear only when BOTH kinds exist.
    function stripScheduled() { return (window.BREAKS || []).filter((b) => b.enabled !== false && !b.manual); }
    function stripManual() { return (window.BREAKS || []).filter((b) => b.enabled !== false && b.manual); }
    // "Next" = first scheduled break still ahead of the wall clock. Once the
    // whole day has passed, wrap to the first (it's tomorrow's first break).
    function nextBreakIndex() {
        const list = stripScheduled();
        if (!list.length) return -1;
        const i = list.findIndex((b) => secsToBreak(b) > 0);
        return i < 0 ? 0 : i;
    }
    let stripNext = -1;      // index (into stripScheduled) rendered as "next"
    let stripTab = 'sched';  // active tab when both categories exist
    // What the queue was loaded FROM: lets the strip keep a residual yellow
    // mark on that chip and the panel show the batch's name (+ "(modified)"
    // once content or time diverge). Cleared when the queue empties.
    let loadedBreak = null;  // { key, name, sig, schedSig|null }
    const breakKey = (b) => `${b.time}|${b.name}`;
    const itemsSig = (list) => list.map((d) => `${d.file}@${d.start}-${d.end}`).join(',');
    function queueSig() { return itemsSig(state.items); }
    function scheduleSig() { return `${fmtClock(state.anchorTime)}|${state.anchorMode}`; }
    function renderStrip() {
        const strip = el('breaksStrip');
        if (!strip) return;
        const sched = stripScheduled(), man = stripManual();
        // Feature unused (or everything parked/disabled): zero footprint.
        strip.hidden = sched.length + man.length === 0;
        strip.innerHTML = '';
        if (strip.hidden) return;
        stripNext = nextBreakIndex();
        // Tabs are ALWAYS there (an empty tab just shows an empty list), and
        // the list below them is a fixed-height scroller — switching tabs
        // never resizes the panel or makes the header jump.
        const tabs = document.createElement('div');
        tabs.className = 'breaks-tabs';
        [['sched', 'Scheduled'], ['manual', 'Manual']].forEach(([key, label]) => {
            const tb = document.createElement('button');
            tb.type = 'button';
            tb.className = 'breaks-tab' + (stripTab === key ? ' active' : '');
            tb.textContent = label;
            tb.addEventListener('click', () => { stripTab = key; renderStrip(); });
            tabs.appendChild(tb);
        });
        strip.appendChild(tabs);
        const list = document.createElement('div');
        list.className = 'breaks-list';
        strip.appendChild(list);
        const showSched = stripTab === 'sched';
        (showSched ? sched : man).forEach((b, i) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            if (showSched) {
                // Passed breaks gray out — unless "next" wrapped around to it
                // (then it's tomorrow's break, not a stale one).
                const passed = secsToBreak(b) <= 0 && i !== stripNext;
                chip.className = 'break-chip' + (i === stripNext ? ' next' : '') + (passed ? ' passed' : '');
                chip.title = `${b.name || 'Break'} — click to load into the playlist`;
                chip.innerHTML =
                    (b.anchor === 'end' ? ICON.end : ICON.start) +
                    `<span class="bc-time">${b.time}</span>` +
                    `<span class="bc-len">${fmtDur(breakLength(b))}</span>` +
                    `<span class="bc-name"></span>`;
            } else {
                chip.className = 'break-chip manual';
                chip.title = `${b.name || 'Break'} — click to load, then press play`;
                chip.innerHTML =
                    `<i class="ph ph-hand-tap"></i>` +
                    `<span class="bc-len">${fmtDur(breakLength(b))}</span>` +
                    `<span class="bc-name"></span>`;
            }
            chip.querySelector('.bc-name').textContent = b.name || 'Break';
            if (loadedBreak && breakKey(b) === loadedBreak.key) chip.classList.add('loaded');
            chip.addEventListener('click', () => loadBreak(b));
            list.appendChild(chip);
        });
        centerNextChip();
        updateStripUrgency();
    }
    // The list keeps the NEXT break centred — but only while nothing is
    // loaded: once a chip carries the yellow "loaded" mark, the view stays
    // put so the DJ never loses sight of what they picked. The DJ can also
    // scroll freely; a few seconds after the last manual scroll (and with
    // nothing loaded) the list drifts back to centre the blinking one.
    let stripUserScrollAt = 0, stripSuppressUntil = 0;
    function centerNextChip() {
        if (loadedBreak) return;
        const list = el('breaksStrip') && el('breaksStrip').querySelector('.breaks-list');
        const chip = list && list.querySelector('.break-chip.next');
        if (!chip || !list.clientHeight) return; // hidden panel: nothing to centre yet
        const target = Math.max(0, chip.offsetTop - list.offsetTop - (list.clientHeight - chip.offsetHeight) / 2);
        if (Math.abs(list.scrollTop - target) < 2) return; // already centred
        stripSuppressUntil = Date.now() + 300; // our own scroll isn't "user scroll"
        list.scrollTop = target;
    }
    // Every tick: advance "next" as breaks pass (the SELECTOR moves on its own;
    // the playlist itself is never auto-loaded), pulse when close to air, and
    // drift back to centre once the DJ stops scrolling.
    function updateStrip() {
        if (!(window.BREAKS || []).length) return;
        if (nextBreakIndex() !== stripNext) { renderStrip(); return; }
        updateStripUrgency();
        if (Date.now() - stripUserScrollAt > 4000) centerNextChip();
    }
    function updateStripUrgency() {
        const strip = el('breaksStrip');
        const chip = strip && strip.querySelector('.break-chip.next');
        const b = stripScheduled()[stripNext];
        if (!chip || !b) return;
        const secs = secsToBreak(b);
        chip.classList.toggle('soon', secs > 60 && secs <= 300);
        chip.classList.toggle('urgent', secs > 0 && secs <= 60);
    }
    // Load a planned break into the queue: resolve its cart references, set its
    // schedule, and hand the items to addItems — whose guards all still apply
    // (locked, too close to start, won't fit, would overrun the hour). Any idle
    // queue content is REPLACED: loading a break means preparing that break.
    function resolveBreakItems(b) {
        // The break's per-item volume overrides AND per-gap overlaps (cross
        // editor) ride into the live queue — indexed BEFORE dropping dead
        // references so a missing cart can't shift its neighbours' values.
        // A fade whose partner cart is gone is meaningless: it resets to 0.
        const out = [];
        let prevValid = false;
        b.items.forEach((id, k) => {
            const c = resolveCart(id);
            if (!c) { prevValid = false; return; }
            const vol = b.volumes && b.volumes[k] != null && b.volumes[k] >= 0 ? b.volumes[k] : null;
            const lap = k > 0 && prevValid && b.overlaps ? Math.max(0, b.overlaps[k - 1] || 0) : 0;
            out.push({
                name: c.name, file: c.file, start: c.start, end: c.end,
                volume: vol != null ? vol : c.volume, volEdited: vol != null,
                overlapIn: out.length > 0 ? lap : 0,
                color: c.color, runtime: cartRuntime(c),
            });
            prevValid = true;
        });
        return out;
    }
    // Record what was just loaded (for the yellow chip + the name box), but
    // only if the whole batch actually made it in — a refused addItems leaves
    // the queue unchanged and must not claim the break was loaded.
    function markLoaded(b, items, manual) {
        if (queueSig() !== itemsSig(items)) return;
        loadedBreak = {
            key: breakKey(b),
            name: b.name || 'Break',
            sig: queueSig(),
            schedSig: manual ? null : scheduleSig(),
        };
        renderStrip();
        updateLoadedName();
    }
    // Load a batch with NO schedule: panel to MANUAL, transport ready for the
    // DJ. Used by manual breaks — and by "Load anyway" on a passed one.
    function loadAsManual(b, items) {
        state.items.forEach((it) => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        state.anchorTime = nextFullHour(); // inert placeholder, keeps guards sane
        state.anchorMode = 'start';
        state.mode = 'manual';
        state.firedForThisSchedule = false;
        addItems(items, false);
        markLoaded(b, items, true);
    }
    function loadBreak(b) {
        if (plannerMode) return; // the planner edits breaks; it never arms them
        if (state.locked || state.running) return toast('Playlist locked');
        const items = resolveBreakItems(b);
        if (!items.length) return toast('Break has no valid carts');
        // MANUAL break: no time trigger, ever.
        if (b.manual) return loadAsManual(b, items);
        const [hh, mm] = b.time.split(':').map(Number);
        const t = new Date(); t.setHours(hh, mm, 0, 0);
        // Fit-check BEFORE touching the queue, so a refused load changes nothing.
        const sumNew = items.reduce((a, d) => a + d.runtime, 0);
        const startAt = b.anchor === 'end' ? t.getTime() - sumNew * 1000 : t.getTime();
        if ((startAt - Date.now()) / 1000 <= LOCK_LEAD) {
            // Passed — but someone recording tomorrow's show may still want the
            // batch: the override loads it without a schedule, in MANUAL mode.
            return toast('Break time already passed', 'Load anyway', () => loadAsManual(b, items));
        }
        state.items.forEach((it) => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        state.anchorTime = t;
        state.anchorMode = b.anchor === 'end' ? 'end' : 'start';
        state.mode = 'auto';
        state.firedForThisSchedule = false;
        addItems(items, false);   // guards + show() + save + render live inside
        markLoaded(b, items, false);
    }

    // ---- planner mode -------------------------------------------------------
    // The admin's break planner borrows this panel as its playlist editor
    // (the DOM node is moved into the overlay by planner.js). Entering pins
    // the DJ's live queue to localStorage and empties the panel; leaving
    // restores it from that same snapshot via loadState(). While in planner
    // mode: nothing persists (saveState is a no-op), the schedule guards are
    // off (see addItems), and the panel is forced MANUAL so the transport is
    // the preview control.
    function setPlannerMode(on) {
        if (!!on === plannerMode) return true;
        const panel = el('automationPanel');
        if (on) {
            if (state.running) { toast('Stop playback first'); return false; }
            saveState();          // pin the live queue NOW…
            plannerMode = true;   // …then freeze persistence
            state.items.forEach((it) => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
            state.items = [];
            state.mode = 'manual';
            panel.classList.add('planner-mode', 'active');
            render();
        } else {
            resetCross();         // the editor (and its gap) belong to the planner
            state.items.forEach((it) => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
            state.items = [];
            plannerMode = false;
            resetSchedule();      // defaults; loadState() overwrites from the pin
            loadState();          // restore the live queue, schedule + visibility
            panel.classList.remove('planner-mode');
            panel.classList.toggle('active', state.visible);
            render();
            updateAutoChip();
        }
        return true;
    }
    // Per-item preview (planner mode): each queue row gets a small play button
    // that auditions just that item (trim-aware), one at a time. Uses the
    // item's own (already primed) audio element; never touches playback state.
    let rowPreview = null; // { item, btn, onTime }
    function stopRowPreview() {
        if (!rowPreview) return;
        const { item, btn, onTime } = rowPreview;
        rowPreview = null;
        item.audio.removeEventListener('timeupdate', onTime);
        try { item.audio.pause(); item.audio.currentTime = item.start; } catch (e) {}
        if (btn.isConnected) btn.innerHTML = '<i class="ph-fill ph-play"></i>';
    }
    function toggleRowPreview(it, btn) {
        if (rowPreview && rowPreview.item === it) { stopRowPreview(); return; }
        stopRowPreview();
        const a = it.audio;
        cancelPriming(it);
        try { a.currentTime = it.start; } catch (e) {}
        a.volume = it.volume != null ? it.volume : 1;
        const onTime = () => { if (a.currentTime >= itemEnd(it)) stopRowPreview(); };
        a.addEventListener('timeupdate', onTime);
        a.addEventListener('ended', stopRowPreview, { once: true });
        rowPreview = { item: it, btn, onTime };
        btn.innerHTML = '<i class="ph-fill ph-stop"></i>';
        a.play().catch(stopRowPreview);
    }

    // Replace the editor's content (planner selects a break). No schedule
    // involved — the break's air time is edited in the planner's list, not
    // here. `overlaps` (optional) is the break's per-gap ms list; each value
    // lands on the FOLLOWING item as its overlapIn. `volumes` (optional) is
    // the break's per-item override list; >= 0 replaces the cart's volume.
    function loadPlaylist(list, overlaps, volumes) {
        resetCross();
        stopRowPreview();
        state.items.forEach((it) => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        state.playingIndex = -1;
        if (Array.isArray(list) && list.length) {
            const ov = Array.isArray(overlaps) ? overlaps : [];
            const vol = Array.isArray(volumes) ? volumes : [];
            addItems(list.map((d, k) => ({
                ...d,
                overlapIn: k > 0 ? (ov[k - 1] || 0) : 0,
                volume: (vol[k] != null && vol[k] >= 0) ? vol[k] : d.volume,
                volEdited: vol[k] != null && vol[k] >= 0,
            })), false);
        } else render();
    }
    /** Current queue as plain data (incl. cartId where known) for the planner. */
    function getItems() {
        return state.items.map((it) => ({
            cartId: it.cartId || null, name: it.name, file: it.file,
            start: it.start, end: it.end, volume: it.volume, color: it.color, runtime: it.runtime,
        }));
    }
    /** Per-gap overlap ms values (count = items - 1), for the planner's save. */
    function getOverlaps() {
        return state.items.slice(1).map((it) => Math.max(0, Math.round(it.overlapIn || 0)));
    }
    /** Per-item volume overrides (-1 = none) for the planner's save. */
    function getVolumes() {
        return state.items.map((it) => it.volEdited ? Math.round((it.volume != null ? it.volume : 1) * 100) / 100 : -1);
    }

    // ---- cross (overlap) editor ---------------------------------------------
    // Planner-only. Every gap between two queue items gets a thin full-width
    // button (an elongated ✕ — two fades crossing; plain green once a saved
    // overlap exists). Clicking one floats this editor as a 1:1 square
    // anchored over the gap (overlapping the rows above/below): two lanes
    // show the END of the upper item (its last ≤10 s) and the START of the
    // lower one (its first ≤10 s) as real decoded waveforms; dragging the
    // lower lane (⇄) LEFT launches it before the upper one ends. Play
    // previews the joint with a read-only playhead — touching the lanes
    // stops it. Save commits the ms onto the item (overlapIn) and closes;
    // Clear commits a 0 and closes; Cancel closes without committing.
    const CROSS_WINDOW = 10; // seconds of tail/head shown per lane
    const GAP_X = '<svg viewBox="0 0 30 10" width="30" height="10" aria-hidden="true"><path d="M3 1.5 L27 8.5 M3 8.5 L27 1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    let crossGap = -1;      // index of the gap being edited (items[gap] -> items[gap+1])
    let crossSolo = -1;     // item index in single-track VOLUME mode (V badge); -1 = cross mode
    let crossMs = 0;        // editor's current value
    let crossSavedMs = 0;   // last value committed onto the item
    let crossDrag = null;   // { startX, startMs, msPerPx, maxMs } while dragging
    let crossVol = null;    // volume-line drafts { a, b, aEd, bEd, openA, openB }
    let crossVolDrag = null; // 'a' | 'b' while dragging a volume handle
    let crossSavedHook = null; // planner: re-commit + refresh meta after a save
    const crossActive = () => crossGap >= 0 || crossSolo >= 0;
    function resetCross() {
        // Restore the header FIRST, while crossActive() still reflects "was
        // this actually open" — every forced reset (item removed/reordered,
        // gap invalidated, a different break loaded) runs through here, so
        // this one check covers all of them without each site needing to
        // remember to undo setEditorHeaderHidden(true) itself.
        if (crossActive()) setEditorHeaderHidden(false);
        crossStopPreview();
        crossGap = -1;
        crossSolo = -1;
        crossDrag = null;
        crossVolDrag = null;
        crossVol = null;
        const ce = el('crossEditor');
        if (ce) { ce.hidden = true; ce.classList.remove('solo'); }
    }
    // Hiding the planner's "what am I working on" header (a flex sibling
    // ABOVE this panel, outside it — never touched by sizeCrossEditor()'s own
    // math) lets the panel's own flex:1 1 auto grow to fill that freed space,
    // so the cross editor — sized to fill the panel, below — ends up
    // covering the WHOLE pane, header included, with one obvious Save (its
    // own) instead of two competing ones. Only ever reachable in planner
    // mode (the gap/volume buttons that open this only render there), and a
    // break is always selected while it's open, so unconditionally
    // restoring the header on close is safe.
    function setEditorHeaderHidden(on) {
        if (!plannerMode) return;
        const header = document.getElementById('plannerEditorHeader');
        if (header) header.hidden = on;
    }
    function makeGapButton(i) {
        const ms = Math.round(state.items[i + 1].overlapIn || 0);
        // Green means a CROSSFADE exists — volume-only edits show as the V
        // badge on the item row instead. Always present, always clickable.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.gap = i;
        btn.className = 'auto-gap' + (crossGap === i ? ' editing' : (ms > 0 ? ' set' : ''));
        btn.title = ms > 0 ? `Overlap: ${(ms / 1000).toFixed(2)} s — click to edit` : 'Edit this joint (overlap / volume)';
        btn.innerHTML = GAP_X;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (crossGap === i) closeCross(); else openCross(i);
        });
        return btn;
    }
    function openCross(i) {
        crossStopPreview();
        crossGap = i;
        crossSolo = -1;
        crossSavedMs = Math.round(state.items[i + 1].overlapIn || 0);
        crossMs = crossSavedMs;
        // Volume-line drafts: start from each item's current effective volume
        // (the cart's own, or the break's committed override).
        const a = state.items[i], b = state.items[i + 1];
        crossVol = {
            a: a.volume != null ? a.volume : 1, aEd: !!a.volEdited,
            b: b.volume != null ? b.volume : 1, bEd: !!b.volEdited,
            openA: a.volume != null ? a.volume : 1, openB: b.volume != null ? b.volume : 1,
        };
        const ed = el('crossEditor');
        ed.hidden = false;
        ed.classList.remove('solo');
        setEditorHeaderHidden(true);
        crossLoadWaves();
        render(); // repaint gap highlights + editor geometry
    }
    // Single-track VOLUME mode (the item row's yellow V badge): the same
    // window with just one lane — the whole trimmed item — and its volume
    // line. No overlap here; Clear resets the override to the cart's volume.
    function openVolume(i) {
        crossStopPreview();
        crossGap = -1;
        crossSolo = i;
        const it = state.items[i];
        const v = it.volume != null ? it.volume : 1;
        crossVol = { a: v, aEd: !!it.volEdited, b: 1, bEd: false, openA: v, openB: 1 };
        const ed = el('crossEditor');
        ed.hidden = false;
        ed.classList.add('solo');
        setEditorHeaderHidden(true);
        crossDrawKey = '';
        crossBuffer(it.file).then(() => { if (crossSolo === i) crossDrawWaves(); });
        render();
    }
    function closeCross() {
        if (!crossActive()) return;
        resetCross(); // restores the header too, see its own comment
        render();
    }
    // Lane windows: never longer than the item itself (a 3 s sting shows 3 s).
    // runtime is the TRIMMED length (end - start), so trims are respected.
    const crossTail = (a) => Math.min(CROSS_WINDOW, Math.max(0.5, a.runtime));
    const crossHead = (b) => Math.min(CROSS_WINDOW, Math.max(0.5, b.runtime));
    // Safety cap: an overlap may never exceed 30% of the SHORTER item's
    // trimmed length (nor the visible tail) — a deep crossfade into a short
    // sting is always a mistake on air.
    const crossMaxMs = (a, b) => Math.round(Math.min(
        crossTail(a) * 1000,
        0.3 * Math.min(a.runtime, b.runtime) * 1000
    ));
    // The editor covers the playlist view AND everything below it — all the
    // way down over the transport (its play button must not be reachable
    // while a joint or a volume line is being edited).
    function sizeCrossEditor() {
        const panel = el('automationPanel');
        const ed = el('crossEditor');
        const pr = panel.getBoundingClientRect();
        const lr = el('autoList').getBoundingClientRect();
        const top = Math.max(0, Math.round(lr.top - pr.top));
        ed.style.left = '0px';
        ed.style.width = panel.clientWidth + 'px';
        ed.style.top = top + 'px';
        ed.style.height = (panel.clientHeight - top) + 'px';
    }
    // Volume line helper: 0 dB at the top of the block, silence at the
    // bottom; the handle rides the line at the block's horizontal centre.
    function setVolLine(blk, vol) {
        const y = ((1 - vol) * 100).toFixed(1) + '%';
        blk.querySelector('.cross-vol-line').style.top = y;
        const hd = blk.querySelector('.cross-vol-handle');
        hd.style.top = y;
        hd.querySelector('span').textContent = Math.round(vol * 100) + '%';
    }
    // Single-track volume mode: one full-width lane (the whole trimmed item).
    function updateSoloUI() {
        const it = state.items[crossSolo];
        if (!it) { resetCross(); return; }
        sizeCrossEditor();
        const lanes = el('crossLanes');
        const blkA = el('crossBlockA');
        blkA.style.left = '0px';
        blkA.style.width = (lanes.clientWidth || 1) + 'px';
        blkA.style.setProperty('--blk', CAT[it.color] || CAT['1']);
        blkA.querySelector('.cross-name').textContent = it.name;
        if (crossVol) setVolLine(blkA, crossVol.a);
        el('crossTitle').textContent = it.name;
        el('crossScaleTail').textContent = '0:00';
        el('crossScaleHead').textContent = fmtDur(it.runtime);
        el('crossReadout').textContent = `volume ${Math.round((crossVol ? crossVol.a : 1) * 100)}%`;
        el('crossReadout').classList.toggle('on', !!(crossVol && (crossVol.aEd || crossVol.a !== crossVol.openA)));
        el('crossClear').title = 'Reset to the cart volume and close';
        const dirty = crossVol && crossVol.a !== crossVol.openA;
        el('crossSave').disabled = !dirty;
        el('crossSave').classList.toggle('dirty', !!dirty);
        crossDrawWaves();
    }
    function updateCrossUI() {
        if (crossSolo >= 0) { updateSoloUI(); return; }
        const a = state.items[crossGap], b = state.items[crossGap + 1];
        if (!a || !b) { resetCross(); return; }
        sizeCrossEditor();
        el('crossClear').title = 'Remove the overlap and close';

        const tail = crossTail(a), head = crossHead(b), win = tail + head;
        crossMs = Math.min(crossMs, crossMaxMs(a, b));
        const lanes = el('crossLanes');
        const w = lanes.clientWidth || 1;
        const px = (secs) => Math.round((secs / win) * w);
        const blkA = el('crossBlockA'), blkB = el('crossBlockB');
        blkA.style.left = '0px';
        blkA.style.width = px(tail) + 'px';
        blkA.style.setProperty('--blk', CAT[a.color] || CAT['1']);
        blkA.querySelector('.cross-name').textContent = a.name;
        blkB.style.left = px(tail - crossMs / 1000) + 'px';
        blkB.style.width = px(head) + 'px';
        blkB.style.setProperty('--blk', CAT[b.color] || CAT['1']);
        blkB.querySelector('.cross-name').textContent = b.name;
        if (crossVol) { setVolLine(blkA, crossVol.a); setVolLine(blkB, crossVol.b); }
        el('crossJunction').style.left = px(tail) + 'px';
        // Gray track between the two lanes spanning exactly the overlap
        // region (B's launch to A's end); collapses to nothing at 0 overlap.
        const trk = el('crossOverlapTrack');
        trk.style.left = px(tail - crossMs / 1000) + 'px';
        trk.style.width = Math.max(0, px(tail) - px(tail - crossMs / 1000)) + 'px';
        el('crossTitle').textContent = `${a.name} → ${b.name}`;
        el('crossScaleTail').textContent = `end −${tail.toFixed(1)}s`;
        el('crossScaleHead').textContent = `start +${head.toFixed(1)}s`;
        el('crossReadout').textContent = crossMs > 0 ? `overlap ${(crossMs / 1000).toFixed(2)} s (${crossMs} ms)` : 'no overlap';
        el('crossReadout').classList.toggle('on', crossMs > 0);
        const dirty = crossMs !== crossSavedMs ||
            (crossVol && (crossVol.a !== crossVol.openA || crossVol.b !== crossVol.openB));
        el('crossSave').disabled = !dirty;
        el('crossSave').classList.toggle('dirty', !!dirty);
        crossDrawWaves(); // canvases track the block boxes; cheap when unchanged
    }
    // Commit onto the items and close. Save lands the overlap AND the volume
    // lines; Clear commits only a 0 overlap (volumes stay as committed);
    // Cancel skips this entirely.
    function commitCross(ms, withVolumes) {
        if (crossGap < 0) return;
        const a = state.items[crossGap], b = state.items[crossGap + 1];
        if (withVolumes && crossVol) {
            if (crossVol.a !== crossVol.openA) { a.volume = crossVol.a; a.volEdited = true; }
            if (crossVol.b !== crossVol.openB) { b.volume = crossVol.b; b.volEdited = true; }
        }
        b.overlapIn = ms;
        closeCross(); // render() repaints the gap button green/gray
        if (crossSavedHook) crossSavedHook();
    }
    // Solo (volume) mode commits: Save lands the line as this break's
    // override; Clear (reset=true) drops the override — back to the cart's
    // own volume — and the V badge disappears.
    function commitSolo(reset) {
        const it = state.items[crossSolo];
        if (!it) { resetCross(); return; }
        if (reset) {
            const base = it.cartId ? resolveCart(it.cartId) : null;
            it.volume = base && base.volume != null ? base.volume : 1;
            it.volEdited = false;
        } else if (crossVol) {
            it.volume = crossVol.a;
            it.volEdited = true;
        }
        closeCross();
        if (crossSavedHook) crossSavedHook();
    }

    // -- waveforms: decode once per file (shared ctx), draw the visible
    //    window (item A's tail / item B's head) into each block's canvas.
    let waveCtx = null;                 // one shared AudioContext for decoding
    const waveBufs = {};                // file -> AudioBuffer | Promise
    let crossDrawKey = '';              // skip redraws when nothing changed
    function crossBuffer(file) {
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
    function crossLoadWaves() {
        const a = state.items[crossGap], b = state.items[crossGap + 1];
        if (!a || !b) return;
        crossDrawKey = ''; // force a redraw once the buffers land
        Promise.all([crossBuffer(a.file), crossBuffer(b.file)]).then(() => {
            if (crossGap >= 0) crossDrawWaves();
        });
    }
    function drawWaveSegment(canvas, buffer, fromSec, toSec) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr; canvas.height = h * dpr;
        const g = canvas.getContext('2d');
        g.scale(dpr, dpr);
        if (!buffer) return; // decode failed: block stays a plain colour
        const data = buffer.getChannelData(0);
        const sr = buffer.sampleRate;
        const s0 = Math.max(0, Math.floor(fromSec * sr));
        const s1 = Math.min(data.length, Math.max(s0 + 1, Math.floor(toSec * sr)));
        const bars = Math.max(1, Math.floor(w / 3));
        const per = Math.max(1, Math.floor((s1 - s0) / bars));
        g.fillStyle = 'rgba(255, 255, 255, 0.75)';
        for (let i = 0; i < bars; i++) {
            let peak = 0;
            const from = s0 + i * per, to = Math.min(s1, from + per);
            for (let j = from; j < to; j += 16) peak = Math.max(peak, Math.abs(data[j]));
            const bh = Math.max(1, peak * (h - 6));
            g.fillRect(i * 3, (h - bh) / 2, 2, bh);
        }
    }
    function crossDrawWaves() {
        // Solo (volume) mode: one lane showing the WHOLE trimmed item.
        if (crossSolo >= 0) {
            const it = state.items[crossSolo];
            if (!it) return;
            const buf = waveBufs[it.file] instanceof AudioBuffer ? waveBufs[it.file] : null;
            const cv = el('crossBlockA').querySelector('canvas');
            const key = `solo|${it.file}|${cv.clientWidth}x${cv.clientHeight}|${!!buf}`;
            if (key === crossDrawKey) return;
            crossDrawKey = key;
            drawWaveSegment(cv, buf, it.start, itemEnd(it));
            return;
        }
        const a = state.items[crossGap], b = state.items[crossGap + 1];
        if (!a || !b) return;
        const bufA = waveBufs[a.file] instanceof AudioBuffer ? waveBufs[a.file] : null;
        const bufB = waveBufs[b.file] instanceof AudioBuffer ? waveBufs[b.file] : null;
        const cvA = el('crossBlockA').querySelector('canvas');
        const cvB = el('crossBlockB').querySelector('canvas');
        const key = `${a.file}|${b.file}|${cvA.clientWidth}x${cvA.clientHeight}|${cvB.clientWidth}|${!!bufA}|${!!bufB}`;
        if (key === crossDrawKey) return;
        crossDrawKey = key;
        const endA = itemEnd(a);
        drawWaveSegment(cvA, bufA, Math.max(a.start, endA - crossTail(a)), endA);
        drawWaveSegment(cvB, bufB, b.start, b.start + crossHead(b));
    }

    // -- preview: play the joint as it would air — item A's tail, item B
    //    launching crossMs early. The playhead is scrubbable: dragging or
    //    clicking the lanes seeks both items to the clicked point instead
    //    of stopping playback.
    let crossPrev = null; // { audA, audB?, t0, timer, ts0, ts1, win, vu nodes }
    let crossScrub = false; // true while the pointer is down scrubbing a live preview
    function crossStopPreview() {
        if (!crossPrev) return;
        const p = crossPrev;
        crossPrev = null;
        clearInterval(p.timer);
        clearTimeout(p.startBTimer);
        clearInterval(p.vuTimer);
        [p.audA, p.audB].forEach((aud) => { try { aud && aud.pause(); } catch (e) {} });
        // Tear the VU graph down so the next preview starts a fresh one.
        [...(p.srcs || []), p.analyser].forEach((n) => { try { n && n.disconnect(); } catch (e) {} });
        const vu = el('crossVuFill');
        if (vu) vu.style.width = '0%';
        const ph = el('crossPlayhead');
        if (ph) ph.hidden = true;
        const btn = el('crossPlay');
        if (btn) btn.innerHTML = '<i class="ph-fill ph-play"></i> Play';
    }
    // Feed the given audio elements through ONE analyser (via the shared
    // decode context, resumed here — the Play click is our gesture) and
    // drive the green VU strip. +25% fake gain keeps it lively (demo clips
    // sit well under full scale). setInterval, not rAF — rAF freezes when
    // the tab loses focus (same reason the item progress bars use one).
    function wireVu(p, auds) {
        try {
            waveCtx = waveCtx || new (window.AudioContext || window.webkitAudioContext)();
            waveCtx.resume();
            p.analyser = waveCtx.createAnalyser();
            p.analyser.fftSize = 512;
            p.srcs = auds.map((aud) => {
                const s = waveCtx.createMediaElementSource(aud);
                s.connect(p.analyser);
                return s;
            });
            p.analyser.connect(waveCtx.destination);
            const buf = new Uint8Array(p.analyser.fftSize);
            p.vuTimer = setInterval(() => {
                p.analyser.getByteTimeDomainData(buf);
                let peak = 0;
                for (let i = 0; i < buf.length; i++) {
                    const v = Math.abs(buf[i] - 128) / 128;
                    if (v > peak) peak = v;
                }
                el('crossVuFill').style.width = Math.min(100, Math.round(peak * 125)) + '%';
            }, 33);
        } catch (e) { /* no VU is never fatal — audio still plays */ }
    }
    function crossPlayToggle() {
        if (crossPrev) { crossStopPreview(); return; }
        stopRowPreview(); // one preview at a time
        // Solo (volume) mode: audition the whole trimmed item at the draft
        // volume, playhead sweeping the single lane.
        if (crossSolo >= 0) {
            const it = state.items[crossSolo];
            if (!it) return;
            const win = Math.max(0.5, it.runtime);
            const aud = new Audio('uploads/' + it.file);
            aud.volume = crossVol ? crossVol.a : (it.volume != null ? it.volume : 1);
            try { aud.currentTime = it.start; } catch (e) {}
            const p = { audA: aud, t0: performance.now(), ts0: 0, ts1: win, win };
            wireVu(p, [aud]);
            aud.play().catch(() => {});
            p.timer = setInterval(() => {
                const t = p.ts0 + (performance.now() - p.t0) / 1000;
                if (t >= p.ts1) { crossStopPreview(); return; }
                const ph = el('crossPlayhead');
                ph.hidden = false;
                ph.style.left = Math.round((t / p.win) * (el('crossLanes').clientWidth || 1)) + 'px';
            }, 40);
            crossPrev = p;
            el('crossPlay').innerHTML = '<i class="ph-fill ph-stop"></i> Stop';
            return;
        }
        const a = state.items[crossGap], b = state.items[crossGap + 1];
        if (!a || !b) return;
        const tail = crossTail(a), head = crossHead(b), win = tail + head;
        const overlap = crossMs / 1000;
        const startB = tail - overlap;                       // window-seconds where B launches
        const endB = startB + head;
        // Smart start: 1.5 s before the active overlap begins (B's launch) —
        // skips the boring lead-in of A's tail instead of making every
        // preview sit through it. It used to ALSO auto-stop 1.5 s after the
        // joint (a "just the joint" window), but that left as little as ~3 s
        // to click/drag before the preview died on its own — effectively
        // impossible to scrub. Now it plays through to the true end; a scrub
        // (crossSeekTo) already widens ts1 to the full window anyway, so this
        // just means untouched playback gets the same room.
        const PAD = 1.5;
        const ts0 = Math.max(0, startB - PAD);
        const ts1 = win;
        const audA = new Audio('uploads/' + a.file);
        const audB = new Audio('uploads/' + b.file);
        // Volume-line drafts apply to the preview — that's what they're for.
        audA.volume = crossVol ? crossVol.a : (a.volume != null ? a.volume : 1);
        audB.volume = crossVol ? crossVol.b : (b.volume != null ? b.volume : 1);
        const endA = itemEnd(a);
        try { audA.currentTime = Math.max(a.start, endA - tail) + ts0; } catch (e) {}
        try { audB.currentTime = b.start; } catch (e) {}
        const p = { audA, audB, t0: performance.now(), ts0, ts1, win };
        wireVu(p, [audA, audB]); // combined meter — the joint exactly as it airs
        if (ts0 < tail) audA.play().catch(() => {});
        p.startBTimer = setTimeout(() => { if (crossPrev === p) audB.play().catch(() => {}); }, Math.max(0, (startB - ts0) * 1000));
        p.timer = setInterval(() => {
            const t = p.ts0 + (performance.now() - p.t0) / 1000; // window-seconds (p.ts0 tracks seeks; the local ts0 above is only the initial value)
            if (t >= p.ts1) { crossStopPreview(); return; }
            if (t >= tail) { try { audA.pause(); } catch (e) {} }             // A's window is over
            if (t >= endB) { try { audB.pause(); } catch (e) {} }
            const lanes = el('crossLanes');
            const ph = el('crossPlayhead');
            ph.hidden = false;
            ph.style.left = Math.round((t / p.win) * (lanes.clientWidth || 1)) + 'px';
        }, 40);
        crossPrev = p;
        el('crossPlay').innerHTML = '<i class="ph-fill ph-stop"></i> Stop';
    }
    // Reposition a live preview to window-seconds tSec: re-times both items'
    // currentTime/play state as if playback had reached tSec naturally, and
    // hands the rest of the window over to the user (ts1 -> win, so a manual
    // seek is never immediately cut short by the joint's ±1.5s auto-stop pad).
    function crossSeekTo(tSec) {
        if (!crossPrev) return;
        const p = crossPrev;
        tSec = Math.max(0, Math.min(p.win, tSec));
        clearTimeout(p.startBTimer);
        p.ts0 = tSec;
        p.ts1 = p.win;
        p.t0 = performance.now();
        if (crossSolo >= 0) {
            try { p.audA.currentTime = tSec; } catch (e) {}
            p.audA.play().catch(() => {});
            return;
        }
        const a = state.items[crossGap], b = state.items[crossGap + 1];
        if (!a || !b) return;
        const tail = crossTail(a), head = crossHead(b);
        const startB = tail - crossMs / 1000, endB = startB + head;
        const endA = itemEnd(a);
        if (tSec < tail) {
            try { p.audA.currentTime = Math.max(a.start, endA - tail) + tSec; } catch (e) {}
            p.audA.play().catch(() => {});
        } else {
            try { p.audA.pause(); } catch (e) {}
        }
        if (tSec >= startB && tSec < endB) {
            try { p.audB.currentTime = b.start + (tSec - startB); } catch (e) {}
            p.audB.play().catch(() => {});
        } else {
            try { p.audB.pause(); } catch (e) {}
            if (tSec < startB) {
                try { p.audB.currentTime = b.start; } catch (e) {}
                p.startBTimer = setTimeout(() => { if (crossPrev === p) p.audB.play().catch(() => {}); }, (startB - tSec) * 1000);
            }
        }
    }
    // Window-seconds for a given clientX over #crossLanes.
    function crossXToTime(clientX) {
        if (!crossPrev) return 0;
        const lanes = el('crossLanes');
        const r = lanes.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
        return frac * crossPrev.win;
    }

    function wireCross() {
        const blkB = el('crossBlockB');
        if (!blkB) return; // markup not present (shouldn't happen, but never fatal)
        // Touching the lanes while previewing scrubs the playhead instead of
        // starting a fade/volume drag (both of those handlers already bail
        // out while crossPrev is set, so there's no conflict).
        el('crossLanes').addEventListener('pointerdown', (e) => {
            if (!crossPrev) return;
            e.preventDefault();
            crossScrub = true;
            crossSeekTo(crossXToTime(e.clientX));
        }, true);
        blkB.addEventListener('pointerdown', (e) => {
            if (crossGap < 0 || crossPrev) return;
            e.preventDefault();
            const a = state.items[crossGap], b = state.items[crossGap + 1];
            if (!a || !b) return;
            const win = crossTail(a) + crossHead(b);
            crossDrag = {
                startX: e.clientX,
                startMs: crossMs,
                msPerPx: (win * 1000) / (el('crossLanes').clientWidth || 1),
                maxMs: crossMaxMs(a, b),
            };
        });
        // Volume handles: vertical drag, top = 100%, bottom = silent. The
        // pointerdown must not fall through to block B's overlap drag.
        [['crossBlockA', 'a'], ['crossBlockB', 'b']].forEach(([blockId, key]) => {
            el(blockId).querySelector('.cross-vol-handle').addEventListener('pointerdown', (e) => {
                if (!crossActive() || crossPrev) return;
                e.preventDefault();
                e.stopPropagation();
                crossVolDrag = key;
            });
        });
        document.addEventListener('pointermove', (e) => {
            if (crossScrub) { crossSeekTo(crossXToTime(e.clientX)); return; }
            if (!crossActive()) return;
            if (crossVolDrag && crossVol) {
                const blk = el(crossVolDrag === 'a' ? 'crossBlockA' : 'crossBlockB');
                const r = blk.getBoundingClientRect();
                const vol = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / (r.height || 1)));
                crossVol[crossVolDrag] = Math.round(vol * 100) / 100;
                updateCrossUI();
                return;
            }
            if (!crossDrag) return;
            // Dragging LEFT increases the overlap (item 2 launches earlier).
            const val = crossDrag.startMs + (crossDrag.startX - e.clientX) * crossDrag.msPerPx;
            crossMs = Math.round(Math.max(0, Math.min(crossDrag.maxMs, val)));
            updateCrossUI();
        });
        document.addEventListener('pointerup', () => { crossDrag = null; crossVolDrag = null; crossScrub = false; });
        el('crossPlay').addEventListener('click', crossPlayToggle);
        el('crossClear').addEventListener('click', () => { if (crossSolo >= 0) commitSolo(true); else commitCross(0, false); });
        el('crossSave').addEventListener('click', () => { if (crossSolo >= 0) commitSolo(false); else commitCross(crossMs, true); });
        el('crossCancel').addEventListener('click', closeCross);
        window.addEventListener('resize', () => { if (crossActive()) updateCrossUI(); });
    }

    // ---- wire up ----------------------------------------------------------
    function init() {
        buildPickerCombos();
        initListDragDrop();
        wireCross();
        // Assigned output (manager > Routing; simulated for now).
        const outBadge = el('autoOutBadge');
        if (outBadge) outBadge.textContent = 'OUT ' + ((window.ROUTING || {}).autoplayer || 1);
        el('autoHeader').addEventListener('click', () => togglePop());
        el('autoAnchorToggle').addEventListener('click', (e) => { e.stopPropagation(); toggleAnchor(); });
        el('autoPopOk').addEventListener('click', () => commitDraft());
        el('autoModeAuto').addEventListener('click', () => setMode('auto'));
        el('autoModeManual').addEventListener('click', () => setMode('manual'));
        el('autoPlayBtn').addEventListener('click', onPlayPause);
        el('autoStopBtn').addEventListener('click', forceStop);
        el('autoStopAutoBtn').addEventListener('click', forceStop);
        el('autoClearBtn').addEventListener('click', clearOrHide);
        // No context menu inside the panel — there's nothing for it to do here,
        // and a stray native menu is the likeliest way a right-click could end
        // up interacting with a queue row (e.g. interrupting an accidental
        // right-click-triggered drag) instead of just being a no-op.
        el('automationPanel').addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('click', (e) => {
            if (!el('autoPop').hidden && !e.target.closest('#autoPop') && !e.target.closest('#autoHeaderRow')) closePopDiscard();
        });
        // Enter, anywhere inside the open picker, commits it (same as OK).
        el('autoPop').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitDraft(); }
        });
        // Re-fit the two time read-outs when the panel width changes.
        window.addEventListener('resize', fitTimes);
        // Track manual scrolling in the breaks strip: the auto-recentre backs
        // off for a few seconds, then jumps back to the blinking break.
        // (Capture phase: the scrolling element is the inner .breaks-list,
        // which is rebuilt on every render — scroll events don't bubble.)
        el('breaksStrip').addEventListener('scroll', () => {
            if (Date.now() > stripSuppressUntil) stripUserScrollAt = Date.now();
        }, true);
        loadState();
        render();
        updateAutoChip();
        renderStrip();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Automation = {
        addItems,
        addItem: (item) => addItems([item], false),
        isActive: () => state.items.length > 0,
        isRunning: () => state.running,
        stop: forceStop, // used by the shell's "Stop all"
        toggle: toggleVisible, // topbar playlist button
        isVisible: () => state.visible,
        loadBreak, // breaks-strip chips load a break through here
        refreshBreaks: renderStrip, // planner calls this after saving a new plan
        // Planner-editor API (see "planner mode" above):
        setPlannerMode,
        loadPlaylist,
        getItems,
        getOverlaps,
        getVolumes,
        // The planner re-commits the selected break (and refreshes its meta
        // line) whenever a cross-editor save lands.
        onOverlapSaved: (fn) => { crossSavedHook = fn; },
        clear: () => loadPlaylist([]),
        isPlannerMode: () => plannerMode,
    };
})();
