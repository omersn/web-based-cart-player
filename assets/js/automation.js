// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Automation Playlist
 * ===================
 * A scheduled auto-playback queue, shown as a docked panel on the right. Carts
 * are sent here by right-clicking them on the board; they play back-to-back
 * (FIFO) at a scheduled time, honouring each cart's trim (start/end) + volume.
 *
 * It has its OWN playback engine (hidden <audio> per queued item), independent
 * of the board iframe, so it keeps working no matter what section is on screen.
 *
 * Anchor toggle:
 *   start-mode (O→): the set time is the START; end = start + total runtime.
 *   end-mode   (→O): the set time is the END (top of hour); start is back-timed.
 *
 * Two modes: automatic (fires at the start time) and manual (operator drives a
 * play/pause button; the countdown is just a suggestion).
 *
 * Exposes window.Automation for the shell (right-click adds items; the layout
 * lock consults isActive()).
 */
(() => {
    const HOUR = 3600; // seconds
    const CAT_COLORS = { '1': '#2f6fd6', '2': '#2f9e5f', '3': '#b0479e', '4': '#c98a2b', '5': '#2aa7bf' };

    const el = (id) => document.getElementById(id);

    const state = {
        items: [],            // {id,name,file,start,end,volume,color,runtime,audio,_timer}
        anchorTime: nextFullHour(),
        anchorMode: 'start',  // 'start' (O→, set time is start) | 'end' (→O, set time is end)
        mode: 'auto',         // 'auto' | 'manual'
        running: false,
        playingIndex: -1,
        locked: false,        // within 5s of start, or running
    };
    let idSeq = 1;

    // ---- time helpers -----------------------------------------------------
    function nextFullHour() { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; }
    function fmtClock(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60); const s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; }
    function totalRuntime() { return state.items.reduce((a, it) => a + it.runtime, 0); }
    function actualStart() { return state.anchorMode === 'end' ? new Date(state.anchorTime.getTime() - totalRuntime() * 1000) : state.anchorTime; }
    function actualEnd() { return state.anchorMode === 'end' ? state.anchorTime : new Date(state.anchorTime.getTime() + totalRuntime() * 1000); }
    function secsToStart() { return (actualStart().getTime() - Date.now()) / 1000; }

    // ---- add / remove -----------------------------------------------------
    function addItem(data) {
        const runtime = Math.max(0, Number(data.runtime) || 0);
        if (state.locked || state.running) return toast('Playlist locked');
        if (secsToStart() <= 5) return toast('Too close to start');
        if (runtime > secsToStart() + 5) return toast("Won't fit before start");
        if (totalRuntime() + runtime > HOUR) return toast('Would overrun the hour');

        const audio = new Audio(`uploads/${data.file}`);
        audio.preload = 'auto';
        const item = {
            id: idSeq++, name: data.name || '—', file: data.file,
            start: Number(data.start) || 0,
            end: (data.end != null && data.end !== '') ? Number(data.end) : null,
            volume: (data.volume != null && data.volume !== '') ? Number(data.volume) : 1,
            color: String(data.color || '1'), runtime, audio,
        };
        primeAudio(item);
        state.items.push(item);
        show();
        render();
        return true;
    }

    function removeItem(id) {
        if (state.locked || state.running) return;
        const i = state.items.findIndex(it => it.id === id);
        if (i < 0) return;
        try { state.items[i].audio.pause(); } catch (e) { /* ignore */ }
        state.items.splice(i, 1);
        render();
    }

    // Prime the clip so its first real play is instant (mirrors the board).
    function primeAudio(item) {
        const a = item.audio;
        const onReady = () => {
            a.removeEventListener('canplaythrough', onReady);
            const vol = a.volume; a.volume = 0;
            try { a.currentTime = item.start; } catch (e) { /* not seekable yet */ }
            const p = a.play();
            if (p) p.then(() => setTimeout(() => { a.pause(); try { a.currentTime = item.start; } catch (e) {} a.volume = vol; }, 60)).catch(() => { a.volume = vol; });
        };
        a.addEventListener('canplaythrough', onReady);
        a.load();
    }

    // ---- playback engine --------------------------------------------------
    function beginPlayback() {
        if (state.items.length === 0 || state.running) return;
        state.running = true;
        state.playingIndex = -1;
        syncLock();
        playNext();
    }
    function playNext() {
        const prev = state.items[state.playingIndex];
        if (prev) { try { prev.audio.pause(); } catch (e) {} clearTimeout(prev._timer); }
        state.playingIndex++;
        if (state.playingIndex >= state.items.length) { endPlayback(); return; }
        const item = state.items[state.playingIndex];
        const a = item.audio;
        try { a.currentTime = item.start; } catch (e) {}
        a.volume = item.volume;
        a.play().catch(() => {});
        const end = (item.end != null ? item.end : a.duration) || (item.start + item.runtime);
        clearTimeout(item._timer);
        item._timer = setTimeout(() => playNext(), Math.max(0, (end - item.start) * 1000));
        render();
    }
    function pausePlayback() {
        const item = state.items[state.playingIndex];
        if (item) { try { item.audio.pause(); } catch (e) {} clearTimeout(item._timer); }
    }
    function resumePlayback() {
        const item = state.items[state.playingIndex];
        if (!item) { playNext(); return; }
        const a = item.audio;
        a.play().catch(() => {});
        const end = (item.end != null ? item.end : a.duration) || (item.start + item.runtime);
        item._timer = setTimeout(() => playNext(), Math.max(0, (end - a.currentTime) * 1000));
    }
    function endPlayback() {
        state.running = false; state.playingIndex = -1;
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        syncLock(); render();
    }

    // ---- modes ------------------------------------------------------------
    function setMode(mode) {
        if (state.running) return;
        state.mode = mode;
        render();
    }
    function onModeBtn() {
        if (state.mode === 'auto') { setMode('manual'); return; }
        // manual: play/pause toggle
        if (!state.running) { beginPlayback(); }
        else {
            const item = state.items[state.playingIndex];
            if (item && item.audio.paused) resumePlayback(); else pausePlayback();
        }
        render();
    }

    // ---- time picker ------------------------------------------------------
    let timeInput = null;
    function openTimePicker() {
        if (state.locked || state.running) return;
        if (!timeInput) {
            timeInput = document.createElement('input');
            timeInput.type = 'time';
            timeInput.style.cssText = 'position:fixed; opacity:0; pointer-events:none; left:-9999px;';
            document.body.appendChild(timeInput);
            timeInput.addEventListener('change', () => {
                const [h, m] = timeInput.value.split(':').map(Number);
                if (Number.isNaN(h)) return;
                const d = new Date(); d.setHours(h, m, 0, 0);
                if (d.getTime() < Date.now() + 60000) d.setDate(d.getDate() + 1); // next occurrence
                state.anchorTime = d;
                render();
            });
        }
        timeInput.value = fmtClock(state.anchorTime);
        if (timeInput.showPicker) { try { timeInput.showPicker(); return; } catch (e) {} }
        timeInput.focus(); timeInput.click();
    }

    function toggleAnchor() {
        if (state.locked || state.running) return;
        state.anchorMode = state.anchorMode === 'start' ? 'end' : 'start';
        render();
    }

    // ---- panel show/hide/clear -------------------------------------------
    function show() { el('automationPanel').classList.add('active'); }
    function clearAndHide() {
        if (state.running) return;
        state.items.forEach(it => { try { it.audio.pause(); } catch (e) {} clearTimeout(it._timer); });
        state.items = [];
        render();
        setTimeout(() => { el('automationPanel').classList.remove('active'); }, 2000);
    }

    // ---- lock -------------------------------------------------------------
    function syncLock() {
        const lock = state.running || (state.mode === 'auto' && secsToStart() <= 5 && state.items.length > 0);
        state.locked = lock;
        el('automationPanel').classList.toggle('locked', lock);
    }

    // ---- render -----------------------------------------------------------
    function render() {
        const list = el('autoList');
        list.innerHTML = '';
        state.items.forEach((it, idx) => {
            const row = document.createElement('div');
            row.className = 'auto-item' + (idx === state.playingIndex ? ' playing' : '');
            row.dataset.id = it.id;
            row.innerHTML =
                `<span class="auto-swatch" style="background:${CAT_COLORS[it.color] || CAT_COLORS['1']}"></span>` +
                `<span class="auto-name"></span>` +
                `<span class="auto-runtime">${fmtDur(it.runtime)}</span>` +
                `<button class="auto-remove" title="Remove"><i class="ph ph-x"></i></button>`;
            row.querySelector('.auto-name').textContent = it.name;
            row.querySelector('.auto-remove').addEventListener('click', () => removeItem(it.id));
            list.appendChild(row);
        });

        el('autoTotal').textContent = fmtDur(totalRuntime());

        // time header
        el('autoTimeLabel').textContent = state.anchorMode === 'end' ? 'To' : 'From';
        el('autoTime').textContent = fmtClock(state.anchorTime);
        el('autoAnchor').classList.toggle('end-mode', state.anchorMode === 'end');
        el('autoAnchor').innerHTML = state.anchorMode === 'end'
            ? '<i class="ph ph-arrow-circle-left"></i>'
            : '<i class="ph ph-arrow-circle-right"></i>';

        // mode controls
        const modeBtn = el('autoModeBtn');
        const setAutoBtn = el('autoSetAutoBtn');
        if (state.mode === 'auto') {
            modeBtn.className = 'auto-mode-btn';
            modeBtn.textContent = 'AUTO START';
            setAutoBtn.hidden = true;
        } else {
            modeBtn.className = 'auto-mode-btn manual';
            const playing = state.running && state.items[state.playingIndex] && !state.items[state.playingIndex].audio.paused;
            modeBtn.innerHTML = playing ? '<i class="ph-fill ph-pause"></i> PAUSE' : '<i class="ph-fill ph-play"></i> PLAY';
            setAutoBtn.hidden = false;
        }
        updateCountdown();
    }

    function updateCountdown() {
        const box = el('autoCountdownBox');
        if (state.running) {
            box.classList.remove('imminent');
            el('autoCountdownLabel').textContent = 'On air';
            el('autoCountdown').textContent = 'LIVE';
            return;
        }
        const secs = secsToStart();
        el('autoCountdownLabel').textContent = 'Starts in';
        el('autoCountdown').textContent = fmtDur(secs);
        box.classList.toggle('imminent', secs <= 30);
    }

    // ---- tick -------------------------------------------------------------
    setInterval(() => {
        if (state.items.length === 0) return;
        syncLock();
        updateCountdown();
        if (state.mode === 'auto' && !state.running && secsToStart() <= 0) beginPlayback();
    }, 250);

    // ---- toast (brief rejection message) ----------------------------------
    let toastTimer = null;
    function toast(msg) {
        let t = el('autoToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'autoToast';
            t.style.cssText = 'position:absolute; left:16px; right:16px; bottom:96px; z-index:5; background:rgba(240,69,63,0.95); color:#fff; padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.4);';
            el('automationPanel').appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1800);
        return false;
    }

    // ---- wire up ----------------------------------------------------------
    function init() {
        el('autoTime').addEventListener('click', openTimePicker);
        el('autoAnchor').addEventListener('click', toggleAnchor);
        el('autoModeBtn').addEventListener('click', onModeBtn);
        el('autoSetAutoBtn').addEventListener('click', () => setMode('auto'));
        el('autoClearBtn').addEventListener('click', clearAndHide);
        render();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.Automation = {
        addItem,
        isActive: () => state.items.length > 0,
        isRunning: () => state.running,
    };
})();
