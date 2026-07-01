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
        // Panel shown or hidden. The panel may stay open even when EMPTY (to set
        // up upcoming breaks) and is toggled from the topbar; it can only be
        // hidden while empty — never while it holds carts (no surprise audio).
        visible: false,
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
                visible: state.visible,   // keep an empty-but-open panel open across reloads
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
        const l = el('autoList'); l.scrollTop = l.scrollHeight; // reveal the just-added item(s) at the bottom
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
        state.items.slice(from, to + 1).forEach(it => { try { it.audio.pause(); } catch (e) {} });
        state.items.splice(from, to - from + 1);
        if (state.items.length === 0) resetSchedule();   // stays open + empty
        saveState();
        render();
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
    }
    function show() { setVisible(true); }
    // Topbar toggle. Can only HIDE while the queue is empty — never with carts
    // loaded (no surprise audio from a panel you can't see).
    function toggleVisible() {
        if (state.visible) {
            if (state.items.length > 0) { toast('Clear the playlist before hiding it'); return; }
            setVisible(false);
        } else {
            if (state.items.length === 0) resetSchedule(); // open fresh for planning
            render();
            setVisible(true);
        }
    }
    function clearAndHide() {
        if (state.running) return;
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        resetSchedule();
        render();
        setVisible(false); // empty now, so hiding is allowed
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
        el('autoHeaderRow').classList.toggle('end-mode', state.anchorMode === 'end');
        // MANUAL: mute the schedule header (it isn't actively counting down) but
        // keep it clickable — see the .sched-muted rule (opacity only).
        el('autoHeaderRow').classList.toggle('sched-muted', state.mode === 'manual');
        el('autoTimeLabel').textContent = state.anchorMode === 'end' ? 'To' : 'From';
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

        updateTimes();
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
        el('autoTime').textContent = scheduleIsStale() ? '—:—' : fmtClockSec(state.anchorTime);
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
        const BASE = 32, MIN = 13;
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
        if (state.items.length === 0) return;
        syncLock();
        if (state.running) { el('autoTotal').textContent = fmtDur(remainingRuntime()); }

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
    function toast(msg) {
        let t = el('autoToast');
        if (!t) {
            t = document.createElement('div'); t.id = 'autoToast';
            t.style.cssText = 'position:absolute; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; background:rgba(240,69,63,0.96); color:#fff; padding:10px 16px; font-size:13px; font-weight:700; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); transition:opacity .2s; pointer-events:none;';
            el('autoHeader').parentElement.appendChild(t);
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
        el('autoAnchorToggle').addEventListener('click', (e) => { e.stopPropagation(); toggleAnchor(); });
        el('autoPopOk').addEventListener('click', () => commitDraft());
        el('autoModeAuto').addEventListener('click', () => setMode('auto'));
        el('autoModeManual').addEventListener('click', () => setMode('manual'));
        el('autoPlayBtn').addEventListener('click', onPlayPause);
        el('autoStopBtn').addEventListener('click', forceStop);
        el('autoStopAutoBtn').addEventListener('click', forceStop);
        el('autoClearBtn').addEventListener('click', clearAndHide);
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
        loadState();
        render();
        updateAutoChip();
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
    };
})();
