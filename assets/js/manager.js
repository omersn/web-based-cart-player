// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Station manager (admin-only overlay): Station | Options | Audio | Maintenance.
 * (Per-cart audio editing lives in its own, DIFFERENT overlay — the Audio
 * Library Manager, audio-manager.js — renamed specifically so it wouldn't
 * collide with this tab's name.)
 *
 * Station      station name, logo upload, ticker, section labels.
 * Options      feature switches + links.
 * Audio        (data-tab/pane id still say "routing" — internal only) which
 *              simulated output each DJ player/PFL/carts/autoplayer feeds,
 *              plus the persistent audio engine's master DSP type + on/off.
 * Maintenance  backup/restore (.cartdb), runtime logs, the danger zone.
 *
 * Station/Options/(routing assignments in) Audio are edited as a local draft
 * and only committed to the server on Save & Close; Cancel discards it
 * (confirming first if the draft is dirty). Maintenance is unchanged: its
 * actions are one-shot and take effect immediately, so it isn't part of the
 * draft — DSP (also in the Audio tab) follows Maintenance's model instead of
 * Routing's: it calls AudioEngine directly and applies live, since gating an
 * audible A/B comparison behind Save & Close would make it clunky to use.
 */
(() => {
    if (!window.IS_ADMIN) return;
    const $ = (id) => document.getElementById(id);
    const M = () => window.MANAGER_DATA || { carts: [], labels: [], ticker: '', stationName: '', logo: '', idSectionNames: [] };

    let msgTimer = null;
    function flash(msg, ok) {
        const m = $('managerMsg');
        m.textContent = msg;
        m.classList.toggle('ok', !!ok);
        m.classList.add('show');
        clearTimeout(msgTimer);
        msgTimer = setTimeout(() => m.classList.remove('show'), 2200);
    }
    async function post(url, body, silent) {
        try {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const resp = await r.json();
            if (!resp.ok) { flash(resp.error || 'Save failed'); return null; }
            if (!silent) flash('Saved', true);
            return resp;
        } catch (e) { flash('Save failed — server unreachable'); return null; }
    }

    // ---- draft ------------------------------------------------------------------
    // Built fresh from the server-confirmed state every time the overlay opens;
    // every field edit below mutates this object, not the server, until Save &
    // Close. `dirty` (rather than a deep diff) tracks unsaved changes — the
    // logo picker holds a File object that doesn't serialize cleanly.
    let draft = null;
    let dirty = false;
    function markDirty() { dirty = true; }
    function isDirty() { return dirty; }
    function buildDraft() {
        const cur = M();
        const labels = [];
        for (let i = 0; i < 10; i++) labels.push(cur.labels[i] || '');
        const idNames = cur.idSectionNames || ['Station IDs', 'Sweepers & FX'];
        draft = {
            station: {
                stationName: cur.stationName || '',
                ticker: cur.ticker || '',
                labels,
                idSectionNames: [idNames[0] || '', idNames[1] || ''],
            },
            logo: cur.logo || '',
            logoFile: null,   // File picked this session, if any
            logoReset: false, // "Default" clicked this session
            options: { ...(window.SETTINGS || {}) },
            routing: { ...(window.ROUTING || {}) },
        };
    }

    // ---- Station tab ----------------------------------------------------------
    function logoPreviewSrc() {
        if (draft.logoFile) return URL.createObjectURL(draft.logoFile);
        if (draft.logoReset) return 'assets/img/logo.svg'; // the static default path
        return draft.logo;
    }
    function renderStation() {
        $('stName').value = draft.station.stationName;
        $('stTicker').value = draft.station.ticker;
        $('stShowTicker').checked = !!draft.options.show_ticker;
        const host = $('stLabels');
        host.innerHTML = '';
        for (let i = 0; i < 10; i++) {
            const inp = document.createElement('input');
            inp.type = 'text'; inp.maxLength = 40; inp.autocomplete = 'off';
            inp.value = draft.station.labels[i];
            inp.dataset.i = i;
            inp.addEventListener('input', () => { draft.station.labels[i] = inp.value; markDirty(); });
            host.appendChild(inp);
        }
        $('stIdName1').value = draft.station.idSectionNames[0];
        $('stIdName2').value = draft.station.idSectionNames[1];
        $('stLogoPreview').src = logoPreviewSrc();
    }
    function wireStationTab() {
        $('stName').addEventListener('input', () => { draft.station.stationName = $('stName').value; markDirty(); });
        $('stTicker').addEventListener('input', () => { draft.station.ticker = $('stTicker').value; markDirty(); });
        $('stShowTicker').addEventListener('change', () => { draft.options.show_ticker = $('stShowTicker').checked ? 1 : 0; markDirty(); });
        $('stIdName1').addEventListener('input', () => { draft.station.idSectionNames[0] = $('stIdName1').value; markDirty(); });
        $('stIdName2').addEventListener('input', () => { draft.station.idSectionNames[1] = $('stIdName2').value; markDirty(); });
        $('stLogoUpload').addEventListener('click', () => $('stLogoFile').click());
        $('stLogoFile').addEventListener('change', () => {
            const f = $('stLogoFile').files[0];
            if (!f) return;
            draft.logoFile = f;
            draft.logoReset = false;
            $('stLogoPreview').src = logoPreviewSrc();
            markDirty();
        });
        $('stLogoReset').addEventListener('click', () => {
            draft.logoFile = null;
            draft.logoReset = true;
            $('stLogoPreview').src = logoPreviewSrc();
            markDirty();
        });
    }

    // ---- Options tab ------------------------------------------------------------
    const SWITCHES = [
        ['ids_window', 'Station IDs / sweepers window', 'The floating ID-wall toggle in the topbar'],
        ['automation', 'Automation playlist & planner', 'The playlist toggle and the break planner'],
        ['dj_mode',    'DJ mode', 'The Carts/DJ layout toggle beside the page selector'],
        ['download',   'Download button', 'Bulk audio download from the topbar'],
        ['mobile',     'Mobile access (QR)', 'The QR popup for phones on the LAN'],
        ['dock_resize',  'Allow dock resize', 'Let users drag the bottom dock (Clock/Station IDs) taller or shorter'],
        ['panel_resize', 'Allow panel resize', 'Let users widen the DJ library tree and the automation sidebar'],
    ];
    function applyChips() {
        const s = window.SETTINGS || {};
        const set = (id, on) => { const e = $(id); if (e) e.disabled = !on; };
        set('chip-ids', s.ids_window);
        set('chip-auto', s.automation);
        set('chip-planner', s.automation); // admin's planner rides the automation switch
        set('chip-djmode', s.dj_mode);
        // Download/Mobile hide outright (not gray out) when off, and the
        // separator bracketing them follows so it's never doubled up.
        const hide = (id, on) => { const e = $(id); if (e) e.hidden = !on; };
        hide('chip-download', s.download);
        hide('qr-chip', s.mobile);
        const sep = $('groupCSep');
        if (sep) sep.hidden = !(s.download || s.mobile);
    }
    function renderOptions() {
        const host = $('optList');
        host.innerHTML = '';
        SWITCHES.forEach(([key, label, hint]) => {
            const row = document.createElement('label');
            row.className = 'opt-row';
            row.innerHTML = `<span class="opt-text"><b></b><small></small></span><input type="checkbox" class="opt-switch">`;
            row.querySelector('b').textContent = label;
            row.querySelector('small').textContent = hint;
            const cb = row.querySelector('input');
            cb.checked = !!draft.options[key];
            cb.addEventListener('change', () => { draft.options[key] = cb.checked ? 1 : 0; markDirty(); });
            host.appendChild(row);
            // Right under "DJ mode": how many of the 3 decks are shown/allowed
            // — disallowed slots also drop out of the Routing tab's dropdowns.
            if (key === 'dj_mode') {
                const sub = document.createElement('div');
                sub.className = 'opt-row';
                sub.innerHTML = `<span class="opt-text"><b>DJ players</b><small>How many of the 3 DJ decks are shown</small></span>` +
                    `<select class="ma-select" id="optDjPlayers"><option value="1">1 player</option><option value="2">2 players</option><option value="3">3 players</option></select>`;
                const sel = sub.querySelector('select');
                sel.value = draft.options.dj_players || 3;
                sel.addEventListener('change', () => {
                    draft.options.dj_players = +sel.value;
                    markDirty();
                    // Player 2/3 matrix columns depend on this count too —
                    // renderRoutingMatrix() reads it from the draft, same as
                    // this whole tab does, so no premature settings.txt write.
                    if (window.AudioEngine.getAudioMode() === 'multichannel') renderRoutingMatrix();
                });
                host.appendChild(sub);
            }
        });
    }
    function wireOptionsTab() {
        $('optRegenQr').addEventListener('click', () => flash('QR regeneration is parked — coming later'));
    }

    // ---- Audio mode (stereo / multichannel) — action-based, not part of the
    // draft: everything below applies to AudioEngine immediately and persists
    // straight to settings.txt/routing.txt as each control changes. Content
    // is a full redefinition per the user's own explicit spec, not additive
    // to what used to be here:
    //   STEREO   — nothing routing-related at all (one shared chain, nothing
    //              to assign); the ONLY control is a "disable PFL entirely"
    //              switch, so there's no possible path for cue audio to reach
    //              the on-air signal when there's just one output to leak
    //              into (reuses the existing pfl_player flag — same one the
    //              Options tab's own "Allow PFL player" switch used to expose
    //              here, now inverted/reframed as a safety control).
    //   MULTI    — a (today: one, simulated) device list, each with its own
    //              on/off and channel count, feeding a routing MATRIX: one
    //              column per on-air source (including PFL now — it's a
    //              real routable source in this mode, not a special case),
    //              one row per available output. Exactly one radio checked
    //              per column (a source can only go to one output).
    // The OLD per-source dropdown list and the OLD standalone "PFL (preview)"
    // section (its 4 granular "which surface shows a preview button"
    // checkboxes, and the "Show output labels" switch) are gone from here —
    // the user's redefinition didn't mention them and was explicit about
    // "only" for stereo mode. Their settings are untouched on disk, just not
    // editable from this tab anymore.
    // Positively framed on purpose: checking a box labeled "Disable X" but
    // seeing the switch turn GREEN (checked = this component's own on/off
    // convention everywhere else) read as backwards. "Allow PFL," checked =
    // green = allowed, is the same switch but now unchecked (red, this
    // component's native "off" color) honestly means "PFL is blocked" —
    // no separate red badge needed, the existing switch already reads right
    // once the label's polarity matches its color convention.
    function renderPflEnabledSwitch() {
        $('pflEnabledToggle').checked = !!(window.SETTINGS || {}).pfl_player;
        renderPflSurfaces();
    }
    function wirePflEnabledSwitch() {
        $('pflEnabledToggle').addEventListener('change', (e) => {
            window.SETTINGS.pfl_player = e.target.checked ? 1 : 0;
            post('save-settings.php', { settings: { pfl_player: e.target.checked ? 1 : 0 } }, true);
            renderPflSurfaces();
        });
    }
    // Which UI surfaces show a PFL preview button — orthogonal to stereo vs
    // multichannel (kept visible in both, per the user's own call: "why
    // not"), hidden entirely while PFL itself is disabled since it's moot.
    const PFL_SURFACES = [
        ['pfl_buttons_carts',   'Cart board', 'Hover preview icon on cart-board tiles'],
        ['pfl_buttons_players', 'DJ players', 'Preview button on each DJ deck'],
        ['pfl_buttons_tree',    'DJ library tree', 'Preview button in the DJ library tree'],
        ['pfl_buttons_search',  'Search results', 'Preview button in the topbar search results'],
    ];
    function makePflSurfaceRow(key, label, hint) {
        const row = document.createElement('label');
        row.className = 'opt-row';
        row.innerHTML = `<span class="opt-text"><b></b><small></small></span><input type="checkbox" class="opt-switch">`;
        row.querySelector('b').textContent = label;
        row.querySelector('small').textContent = hint;
        const cb = row.querySelector('input');
        cb.checked = !!(window.SETTINGS || {})[key];
        cb.addEventListener('change', () => {
            window.SETTINGS[key] = cb.checked ? 1 : 0;
            post('save-settings.php', { settings: { [key]: cb.checked ? 1 : 0 } }, true);
        });
        return row;
    }
    function renderPflSurfaces() {
        const section = $('pflSurfacesSection');
        const enabled = !!(window.SETTINGS || {}).pfl_player;
        section.hidden = !enabled;
        if (!enabled) return;
        const host = $('pflSurfacesList');
        host.innerHTML = '';
        PFL_SURFACES.forEach(([key, label, hint]) => host.appendChild(makePflSurfaceRow(key, label, hint)));
    }
    function makeDeviceRow(id, label, hint) {
        const row = document.createElement('label');
        row.className = 'opt-row';
        row.innerHTML = `<span class="opt-text"><b></b><small></small></span><input type="checkbox" class="opt-switch">`;
        row.querySelector('b').textContent = label;
        row.querySelector('small').textContent = hint;
        const cb = row.querySelector('input');
        cb.checked = window.AudioEngine.isDeviceEnabled(id);
        cb.addEventListener('change', () => {
            window.AudioEngine.setDeviceEnabled(id, cb.checked);
            post('save-settings.php', { settings: { ['device_' + id + '_enabled']: cb.checked ? 1 : 0 } }, true);
            renderRoutingMatrix(); // available output count just changed
        });
        return row;
    }
    function renderDeviceList() {
        const host = $('deviceList');
        host.innerHTML = '';
        host.appendChild(makeDeviceRow('sim4', 'Simulated Multi-Output Device', '4 discrete stereo outputs — real device detection is planned, not wired up yet'));
    }
    // Matrix columns: every on-air source, PFL included. Player 2/3 drop out
    // when the Options tab's "DJ players" count doesn't allow them — same
    // guard the old per-source dropdown list used to apply.
    const MATRIX_SOURCES = [
        ['player1', 'PLAYER 1'],
        ['player2', 'PLAYER 2'],
        ['player3', 'PLAYER 3'],
        ['carts', 'CARTWALL'],
        ['autoplayer', 'AUTOPLAYER'],
        ['pfl', 'PFL'],
    ];
    function renderRoutingMatrix() {
        const host = $('routingMatrix');
        const djPlayers = draft.options.dj_players || 3;
        const cols = MATRIX_SOURCES.filter(([key]) => {
            if (key === 'player2' && djPlayers < 2) return false;
            if (key === 'player3' && djPlayers < 3) return false;
            return true;
        });
        const rows = window.AudioEngine.availableOutputCount();
        host.innerHTML = '';
        if (rows === 0) {
            host.style.gridTemplateColumns = '';
            host.innerHTML = '<p class="mgr-stub-text">No outputs available &mdash; enable a device above.</p>';
            return;
        }
        host.style.gridTemplateColumns = `70px repeat(${cols.length}, 1fr)`;
        host.appendChild(document.createElement('div')).className = 'dsp-matrix-corner';
        cols.forEach(([, label]) => {
            const el = document.createElement('div');
            el.className = 'dsp-matrix-col-label';
            el.textContent = label;
            host.appendChild(el);
        });
        for (let n = 1; n <= rows; n++) {
            const rowLabel = document.createElement('div');
            rowLabel.className = 'dsp-matrix-row-label';
            rowLabel.textContent = 'OUT ' + n;
            host.appendChild(rowLabel);
            cols.forEach(([key]) => {
                const cell = document.createElement('label');
                cell.className = 'dsp-matrix-cell';
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'matrix-' + key;
                radio.value = n;
                radio.checked = (window.ROUTING[key] || 1) === n;
                radio.addEventListener('change', () => {
                    window.ROUTING[key] = n;
                    post('save-routing.php', { routing: { [key]: n } }, true);
                    window.AudioEngine.refreshRouting();
                });
                cell.appendChild(radio);
                cell.insertAdjacentHTML('beforeend', '<span class="dsp-matrix-check">&#10003;</span>');
                host.appendChild(cell);
            });
        }
    }
    function renderAudioMode() {
        const mode = window.AudioEngine.getAudioMode();
        $('audioModeStereo').classList.toggle('active', mode === 'stereo');
        $('audioModeMulti').classList.toggle('active', mode === 'multichannel');
        $('stereoPflSection').hidden = mode !== 'stereo';
        $('multiChannelSection').hidden = mode !== 'multichannel';
        if (mode === 'stereo') {
            renderPflEnabledSwitch(); // also renders the surfaces list below it
        } else {
            renderDeviceList();
            renderRoutingMatrix();
            renderPflSurfaces(); // the switch itself only lives in stereo mode's section, but the surfaces list stays visible in both
        }
    }
    function wireAudioMode() {
        function choose(mode) {
            window.AudioEngine.setAudioMode(mode);
            post('save-settings.php', { settings: { audio_mode: mode } }, true);
            renderAudioMode();
        }
        $('audioModeStereo').addEventListener('click', () => choose('stereo'));
        $('audioModeMulti').addEventListener('click', () => choose('multichannel'));
        wirePflEnabledSwitch();
    }

    // ---- DSP (Audio tab, action-based like Maintenance — not part of the
    // draft; see the header comment for why). One shared chain for every
    // on-air source: a Style select, a master Enabled switch, and a separate
    // PFL switch (dry by default — see audio-engine.js's connectPfl()).
    // Every change applies to AudioEngine immediately AND persists straight
    // to settings.txt via save-settings.php (one key at a time). Controls
    // are wired ONCE (static HTML, unlike the per-output rows this replaced);
    // renderDsp() just re-syncs their displayed values + the params readout
    // each time the overlay opens. ----
    const STAGE_LABELS = { agc: 'AGC', compressor: 'Compressor', limiter: 'Limiter' };
    /** The real, currently-configured numbers for `name` (or whatever's
     *  selected right now) — NOT a live meter reading. Rendered as one row
     *  per active stage so there's no ambiguity about what's actually applied. */
    // Always renders exactly 3 rows (AGC/Compressor/Limiter) PLUS the 2 flow
    // arrows between them, whether or not the selected style actually uses
    // each stage AND whether Processing is even on — an inactive/disabled
    // stage still takes up its row, just showing a "not used"/"disabled"
    // placeholder instead of numbers, so the panel's height never jumps
    // around, whether you're switching styles or flipping Processing itself.
    const ALL_STAGES = ['agc', 'compressor', 'limiter'];
    function renderDspParams(name) {
        const host = $('dspParams');
        const preset = window.AudioEngine.typeParams(name || $('dspTypeSelect').value);
        const dspOn = window.AudioEngine.isEnabled();
        const rows = ALL_STAGES.map((key) => {
            const p = dspOn ? preset[key] : null;
            if (!p) {
                const why = dspOn ? 'Not used in this style' : 'Processing disabled';
                return `<div class="dsp-param-row inactive"><b>${STAGE_LABELS[key]}</b><span class="dsp-param-unused">${why}</span></div>`;
            }
            return `<div class="dsp-param-row"><b>${STAGE_LABELS[key]}</b>` +
                `<span>threshold ${p.threshold} dB</span>` +
                `<span>ratio ${p.ratio}:1</span>` +
                `<span>knee ${p.knee} dB</span>` +
                `<span>attack ${Math.round(p.attack * 1000)} ms</span>` +
                `<span>release ${Math.round(p.release * 1000)} ms</span></div>`;
        });
        // Signal always runs AGC -> Compressor -> Limiter, top to bottom —
        // the arrow is just showing that fixed order, not whether a
        // particular stage is currently active.
        host.innerHTML = rows.join('<div class="dsp-flow-arrow">&#8595;</div>');
    }
    function renderDsp() {
        $('dspEnabledToggle').checked = window.AudioEngine.isEnabled();
        $('dspTypeSelect').value = window.AudioEngine.getType();
        renderDspParams();
    }
    function wireDspTab() {
        $('dspEnabledToggle').addEventListener('change', (e) => {
            window.AudioEngine.setEnabled(e.target.checked);
            renderDspParams();
            post('save-settings.php', { settings: { dsp_enabled: e.target.checked ? 1 : 0 } }, true);
        });
        $('dspTypeSelect').addEventListener('change', (e) => {
            window.AudioEngine.setType(e.target.value);
            renderDspParams();
            post('save-settings.php', { settings: { dsp_type: e.target.value } }, true);
        });
        // Preset explanations: tucked behind a "?", same reveal as Maintenance's
        // Backup & restore info button.
        $('dspInfoBtn').addEventListener('click', (e) => {
            const shown = !$('dspInfo').hidden;
            $('dspInfo').hidden = shown;
            e.currentTarget.classList.toggle('active', !shown);
        });
    }

    // ---- Maintenance tab (action-based, not part of the draft) -----------------
    // Two small always-on panes (keepalive/playback) — no popover to open/close,
    // just a scrollable box with its own size readout and "Clear now".
    function fmtBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }
    async function loadLog(key) {
        $(`mntLogView-${key}`).textContent = 'Loading…';
        try {
            const r = await fetch(`maintenance-logs.php?log=${key}`);
            const resp = await r.json();
            if (!resp.ok) { $(`mntLogView-${key}`).textContent = resp.error || 'Could not load log'; return; }
            $(`mntLogView-${key}`).textContent = resp.lines.length ? resp.lines.join('\n') : '(empty)';
            $(`mntLogSize-${key}`).textContent = fmtBytes(resp.size);
        } catch (e) { $(`mntLogView-${key}`).textContent = 'Could not load log'; }
    }
    function wireMaintenanceTab() {
        document.querySelectorAll('.mnt-log-pane .ma-btn[data-log]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const key = btn.dataset.log;
                const resp = await post('maintenance-logs.php', { log: key, action: 'clear' });
                if (resp) loadLog(key);
            });
        });
        // Retention takes effect immediately (like the rest of Maintenance) —
        // no Save & Close needed. The actual purge runs once per page load
        // (index.php -> purge_old_logs()), not from here. open() sets the
        // select's initial value from window.SETTINGS.
        $('mntLogRetention').addEventListener('change', async () => {
            const resp = await post('save-settings.php', { settings: { log_retention: +$('mntLogRetention').value } });
            if (resp) window.SETTINGS = resp.settings;
        });
        // Backup/restore explanation: tucked behind a "?" — hidden by default
        // so the panel doesn't open with a wall of text (productization: keep
        // it simple until someone actually asks what it means).
        $('mntBackupInfoBtn').addEventListener('click', (e) => {
            const shown = !$('mntBackupInfo').hidden;
            $('mntBackupInfo').hidden = shown;
            e.currentTarget.classList.toggle('active', !shown);
        });
        // Danger zone: the typed word arms the buttons; the server re-checks it.
        const confirmIn = $('optClearConfirm');
        const arm = () => {
            const armed = confirmIn.value.trim().toLowerCase() === 'clear';
            $('optClearPlanner').disabled = !armed;
            $('optClearAll').disabled = !armed;
        };
        confirmIn.addEventListener('input', arm);
        const wipe = (mode) => async () => {
            const resp = await post('clear-data.php', { mode, confirm: confirmIn.value.trim().toLowerCase() });
            if (resp) {
                flash(mode === 'all' ? 'Database cleared — reloading' : 'Planner data cleared — reloading', true);
                setTimeout(() => location.reload(), 900);
            }
        };
        $('optClearPlanner').addEventListener('click', wipe('planner'));
        $('optClearAll').addEventListener('click', wipe('all'));
    }

    // ---- save / shell ------------------------------------------------------------
    /** Commit the draft (Station + Options + Routing); returns true on success. */
    async function save() {
        const labels = draft.station.labels;
        const idSectionNames = draft.station.idSectionNames;
        const stResp = await post('save-station.php', {
            stationName: draft.station.stationName,
            ticker: draft.station.ticker,
            labels,
            idSectionNames,
        }, true);
        if (!stResp) return false;
        M().stationName = stResp.stationName; M().labels = labels; M().ticker = draft.station.ticker;
        M().idSectionNames = stResp.idSectionNames;

        if (draft.logoFile) {
            const fd = new FormData();
            fd.append('logo', draft.logoFile);
            try {
                const r = await fetch('save-logo.php', { method: 'POST', body: fd });
                const resp = await r.json();
                if (!resp.ok) { flash(resp.error || 'Logo upload failed'); return false; }
                M().logo = resp.logo;
            } catch (e) { flash('Logo upload failed'); return false; }
        } else if (draft.logoReset) {
            const resp = await post('save-logo.php', { reset: 1 }, true);
            if (!resp) return false;
            M().logo = resp.logo;
        }

        const optResp = await post('save-settings.php', { settings: draft.options }, true);
        if (!optResp) return false;
        window.SETTINGS = optResp.settings;
        applyChips();
        document.body.classList.toggle('hide-out-labels', !window.SETTINGS.show_out_labels);
        document.body.classList.toggle('hide-ticker', !window.SETTINGS.show_ticker);
        document.body.classList.toggle('dock-resize-off', !window.SETTINGS.dock_resize);
        document.body.classList.toggle('panel-resize-off', !window.SETTINGS.panel_resize);
        if (window.updatePanelResizeHandles) window.updatePanelResizeHandles();
        if (window.DJMode) window.DJMode.applyPlayerCount();
        if (window.DJMode) window.DJMode.applyPflSettings();

        const routeResp = await post('save-routing.php', { routing: draft.routing }, true);
        if (!routeResp) return false;
        window.ROUTING = routeResp.routing;
        if (window.DJMode) window.DJMode.applyRouting();
        const badge = $('autoOutBadge');
        if (badge) badge.textContent = 'OUT ' + (window.ROUTING.autoplayer || 1);
        // Multichannel mode: new assignments mean sources may now feed a
        // different independent channel — re-patch immediately. A no-op in
        // stereo mode (nothing there depends on ROUTING).
        window.AudioEngine.refreshRouting();

        draft.logoFile = null;
        draft.logoReset = false;
        dirty = false;
        flash('Saved', true);
        return true;
    }

    function showTab(name) {
        document.querySelectorAll('.mgr-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
        $('mgrPaneStation').hidden = name !== 'station';
        $('mgrPaneOptions').hidden = name !== 'options';
        $('mgrPaneRouting').hidden = name !== 'routing';
        $('mgrPaneMaintenance').hidden = name !== 'maintenance';
        if (name === 'maintenance') { loadLog('keepalive'); loadLog('playback'); }
    }
    function open() {
        buildDraft();
        dirty = false;
        renderOptions();
        renderAudioMode();
        renderDsp();
        renderStation();
        $('mntLogRetention').value = String((window.SETTINGS || {}).log_retention != null ? window.SETTINGS.log_retention : 90);
        showTab('station'); // Station is the manager's home tab (Audio moved to its own window)
        $('managerOverlay').hidden = false;
        document.addEventListener('keydown', onKey);
    }
    // Closing with unsaved changes asks first — via a styled in-overlay
    // dialog (not the browser's native confirm). Cancelling never touched the
    // server, so it never needs to refresh what's behind — only a successful
    // Save & Close does.
    function close(didSave) {
        if (isDirty()) { $('managerConfirm').hidden = false; return; }
        doClose(didSave);
    }
    function doClose(didSave) {
        $('managerConfirm').hidden = true;
        $('managerOverlay').hidden = true;
        document.removeEventListener('keydown', onKey);
        // Station name/logo/labels or a feature switch changed — refresh
        // what's behind (board, ID windows, clock), holding the opaque
        // overlay 2.5s longer so it's fully settled on reveal.
        if (didSave && window.refreshPlayerWindows) window.refreshPlayerWindows(2500);
    }
    function onKey(e) {
        if (e.key !== 'Escape' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (!$('managerConfirm').hidden) { $('managerConfirm').hidden = true; return; } // the discard dialog
        close(false);
    }

    function init() {
        const openBtn = $('chip-gear');
        if (openBtn) openBtn.addEventListener('click', open);
        $('managerCancel').addEventListener('click', () => close(false)); // discard (confirms if dirty)
        $('managerConfirmDiscard').addEventListener('click', () => doClose(false));
        $('managerConfirmKeep').addEventListener('click', () => { $('managerConfirm').hidden = true; });
        // Save & Close: after a successful save the draft matches the server,
        // so close() proceeds without the discard prompt; a failed save stays
        // open with the error showing.
        $('managerSave').addEventListener('click', async () => { if (await save()) close(true); });
        document.querySelectorAll('.mgr-tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
        wireStationTab();
        wireOptionsTab();
        wireMaintenanceTab();
        wireDspTab();
        wireAudioMode();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Manager = { open, close };
})();
