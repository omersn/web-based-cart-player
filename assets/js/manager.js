// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Station manager (admin-only overlay): Station | Options | Routing | Maintenance.
 * (Audio lives in its own overlay now — see audio-manager.js.)
 *
 * Station      station name, logo upload, ticker, section labels.
 * Options      feature switches + links.
 * Routing      which simulated output each DJ player/PFL/carts/autoplayer feeds.
 * Maintenance  backup/restore (.cartdb), runtime logs, the danger zone.
 *
 * Station/Options/Routing are edited as a local draft and only committed to
 * the server on Save & Close; Cancel discards it (confirming first if the
 * draft is dirty). Maintenance is unchanged: its actions are one-shot and
 * take effect immediately, so it isn't part of the draft.
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
                    renderRouting(); // keep the Routing tab's player rows in sync live
                });
                host.appendChild(sub);
            }
        });
    }
    function wireOptionsTab() {
        $('optRegenQr').addEventListener('click', () => flash('QR regeneration is parked — coming later'));
    }

    // ---- Routing tab --------------------------------------------------------
    // Assign each DJ player + the PFL (preview) bus to one of the four
    // simulated stereo outs.
    const ROUTES = [
        ['carts',      'Cart board', 'Every cart fired from the wall or the ID windows'],
        ['autoplayer', 'Autoplayer', 'The automation playlist engine (breaks)'],
        ['player1', 'Player 1 (DJ mode)', 'The top deck'],
        ['player2', 'Player 2 (DJ mode)', 'The middle deck'],
        ['player3', 'Player 3 (DJ mode)', 'The bottom deck'],
    ];
    /** One "label + OUT n select" row, bound to draft.routing[key]. */
    function makeRoutingRow(key, label, hint) {
        const row = document.createElement('div');
        row.className = 'opt-row';
        row.innerHTML = `<span class="opt-text"><b></b><small></small></span><select class="ma-select routing-out"></select>`;
        row.querySelector('b').textContent = label;
        row.querySelector('small').textContent = hint;
        const sel = row.querySelector('select');
        for (let n = 1; n <= 4; n++) {
            const o = document.createElement('option');
            o.value = n;
            o.textContent = `OUT ${n} (stereo)`;
            sel.appendChild(o);
        }
        sel.value = draft.routing[key] || 1;
        sel.addEventListener('change', () => { draft.routing[key] = +sel.value; markDirty(); });
        return row;
    }
    /** Same as makeRoutingRow, but with an extra "PFL output" choice (value 0)
        ahead of OUT 1-4 — for things that can ride the PFL bus itself instead
        of only ever feeding INTO it. */
    function makeRoutingRowWithPfl(key, label, hint) {
        const row = document.createElement('div');
        row.className = 'opt-row';
        row.innerHTML = `<span class="opt-text"><b></b><small></small></span><select class="ma-select routing-out"></select>`;
        row.querySelector('b').textContent = label;
        row.querySelector('small').textContent = hint;
        const sel = row.querySelector('select');
        const pflOpt = document.createElement('option');
        pflOpt.value = 0;
        pflOpt.textContent = 'PFL output';
        sel.appendChild(pflOpt);
        for (let n = 1; n <= 4; n++) {
            const o = document.createElement('option');
            o.value = n;
            o.textContent = `OUT ${n} (stereo)`;
            sel.appendChild(o);
        }
        sel.value = draft.routing[key] ?? 0;
        sel.addEventListener('change', () => { draft.routing[key] = +sel.value; markDirty(); });
        return row;
    }
    /** One "label + switch" row, bound to draft.options[key]. */
    function makeSwitchRow(key, label, hint) {
        const row = document.createElement('label');
        row.className = 'opt-row';
        row.innerHTML = `<span class="opt-text"><b></b><small></small></span><input type="checkbox" class="opt-switch">`;
        row.querySelector('b').textContent = label;
        row.querySelector('small').textContent = hint;
        const cb = row.querySelector('input');
        cb.checked = !!draft.options[key];
        cb.addEventListener('change', () => { draft.options[key] = cb.checked ? 1 : 0; markDirty(); });
        return row;
    }
    function renderRouting() {
        const host = $('routingList');
        host.innerHTML = '';
        host.appendChild(makeSwitchRow('show_out_labels', 'Show output labels', 'The "OUT N" badges on DJ decks, PFL and the autoplayer strip'));
        const djPlayers = draft.options.dj_players || 3;
        ROUTES.forEach(([key, label, hint]) => {
            // Disallowed DJ players (per the Options tab's "DJ players" count)
            // drop out of the routing list too — nothing to assign an output to.
            if (key === 'player2' && djPlayers < 2) return;
            if (key === 'player3' && djPlayers < 3) return;
            host.appendChild(makeRoutingRow(key, label, hint));
        });
    }
    // PFL (preview): its own section — allow the player, then (once allowed)
    // a checkbox per surface that can send to it, and the output it carries.
    const PFL_SURFACES = [
        ['pfl_buttons_carts',   'Cart board', 'Hover preview icon on cart-board tiles'],
        ['pfl_buttons_players', 'DJ players', 'Preview button on each DJ deck'],
        ['pfl_buttons_tree',    'DJ library tree', 'Preview button in the DJ library tree'],
        ['pfl_buttons_search',  'Search results', 'Preview button in the topbar search results'],
    ];
    function renderPfl() {
        const host = $('pflOptList');
        host.innerHTML = '';
        const master = makeSwitchRow('pfl_player', 'Allow PFL player', 'The small preview player docked under the DJ library');
        master.querySelector('input').addEventListener('change', renderPfl); // reveal/hide the per-surface checkboxes live
        host.appendChild(master);
        if (draft.options.pfl_player) {
            const group = document.createElement('div');
            group.className = 'opt-subgroup';
            PFL_SURFACES.forEach(([key, label, hint]) => group.appendChild(makeSwitchRow(key, label, hint)));
            host.appendChild(group);
        }
        host.appendChild(makeRoutingRow('pfl', 'PFL channel', 'All single-play preview buttons — planner, audio manager, DJ library'));
        host.appendChild(makeRoutingRowWithPfl('manager_preview', 'Audio manager preview', "The chain editor's own Play button (Audio manager)"));
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
        renderRouting();
        renderPfl();
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
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Manager = { open, close };
})();
