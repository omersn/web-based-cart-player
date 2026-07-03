// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Station manager (admin-only overlay): Station | Options | Maintenance.
 * (Audio lives in its own overlay now — see audio-manager.js.)
 *
 * Station      station name, logo upload, ticker, section labels.
 * Options      live feature switches + links.
 * Maintenance  backup/restore (.cartdb), runtime logs, the danger zone.
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
    async function post(url, body) {
        try {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const resp = await r.json();
            if (!resp.ok) { flash(resp.error || 'Save failed'); return null; }
            flash('Saved', true);
            return resp;
        } catch (e) { flash('Save failed — server unreachable'); return null; }
    }

    // ---- Station tab ----------------------------------------------------------
    function renderStation() {
        $('stName').value = M().stationName || '';
        $('stTicker').value = M().ticker || '';
        const host = $('stLabels');
        host.innerHTML = '';
        for (let i = 0; i < 10; i++) {
            const inp = document.createElement('input');
            inp.type = 'text'; inp.maxLength = 40; inp.autocomplete = 'off';
            inp.value = M().labels[i] || '';
            inp.dataset.i = i;
            host.appendChild(inp);
        }
        const idNames = M().idSectionNames || ['Station IDs', 'Sweepers & FX'];
        $('stIdName1').value = idNames[0] || '';
        $('stIdName2').value = idNames[1] || '';
    }
    function wireStationTab() {
        $('stSave').addEventListener('click', async () => {
            const labels = [...$('stLabels').querySelectorAll('input')].map((i) => i.value);
            const idSectionNames = [$('stIdName1').value, $('stIdName2').value];
            const resp = await post('save-station.php', {
                stationName: $('stName').value,
                ticker: $('stTicker').value,
                labels,
                idSectionNames,
            });
            if (resp) {
                M().stationName = resp.stationName; M().labels = labels; M().ticker = $('stTicker').value;
                M().idSectionNames = resp.idSectionNames;
                flash('Saved — reload the player to see the ID window names change', true);
            }
        });
        $('stLogoUpload').addEventListener('click', () => $('stLogoFile').click());
        $('stLogoFile').addEventListener('change', async () => {
            const f = $('stLogoFile').files[0];
            if (!f) return;
            const fd = new FormData();
            fd.append('logo', f);
            try {
                const r = await fetch('save-logo.php', { method: 'POST', body: fd });
                const resp = await r.json();
                if (!resp.ok) { flash(resp.error || 'Upload failed'); return; }
                $('stLogoPreview').src = resp.logo + '?t=' + Date.now();
                flash('Logo saved — reload to see it', true);
            } catch (e) { flash('Upload failed'); }
        });
        $('stLogoReset').addEventListener('click', async () => {
            const resp = await post('save-logo.php', { reset: 1 });
            if (resp) $('stLogoPreview').src = resp.logo + '?t=' + Date.now();
        });
    }

    // ---- Options tab ------------------------------------------------------------
    const SWITCHES = [
        ['ids_window', 'Station IDs / sweepers window', 'The floating ID-wall toggle in the topbar'],
        ['automation', 'Automation playlist & planner', 'The playlist toggle and the break planner'],
        ['dj_mode',    'DJ mode', 'The Carts/DJ layout toggle beside the page selector'],
        ['download',   'Download button', 'Bulk audio download from the topbar'],
        ['mobile',     'Mobile access (QR)', 'The QR popup for phones on the LAN'],
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
    async function saveSwitch(key, on) {
        const resp = await post('save-settings.php', { settings: { [key]: on ? 1 : 0 } });
        if (resp) { window.SETTINGS = resp.settings; applyChips(); }
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
            cb.checked = !!(window.SETTINGS && window.SETTINGS[key]);
            cb.addEventListener('change', () => saveSwitch(key, cb.checked));
            host.appendChild(row);
        });
    }
    function wireOptionsTab() {
        $('optRegenQr').addEventListener('click', () => flash('QR regeneration is parked — coming later'));
    }

    // ---- Routing tab --------------------------------------------------------
    // Assign each DJ player + the PFL (preview) bus to one of the four
    // simulated stereo outs. Saved immediately; the DJ decks' OUT badges
    // follow live.
    const ROUTES = [
        ['carts',      'Cart board', 'Every cart fired from the wall or the ID windows'],
        ['autoplayer', 'Autoplayer', 'The automation playlist engine (breaks)'],
        ['player1', 'Player 1 (DJ mode)', 'The top deck'],
        ['player2', 'Player 2 (DJ mode)', 'The middle deck'],
        ['player3', 'Player 3 (DJ mode)', 'The bottom deck'],
        ['pfl',     'PFL channel', 'All single-play preview buttons — planner, audio manager, DJ library'],
    ];
    async function saveRoute(key, out) {
        const resp = await post('save-routing.php', { routing: { [key]: out } });
        if (resp) {
            window.ROUTING = resp.routing;
            if (window.DJMode) window.DJMode.applyRouting();
            const badge = $('autoOutBadge');
            if (badge) badge.textContent = 'OUT ' + (window.ROUTING.autoplayer || 1);
        }
    }
    function renderRouting() {
        const host = $('routingList');
        host.innerHTML = '';
        ROUTES.forEach(([key, label, hint]) => {
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
            sel.value = (window.ROUTING || {})[key] || 1;
            sel.addEventListener('change', () => saveRoute(key, +sel.value));
            host.appendChild(row);
        });
    }

    // ---- Maintenance tab --------------------------------------------------------
    const LOG_TITLES = { keepalive: 'Keep-alive log', playback: 'Playback log' };
    let mntLogKey = 'keepalive';
    async function loadLog() {
        $('mntLogView').textContent = 'Loading…';
        try {
            const r = await fetch(`maintenance-logs.php?log=${mntLogKey}`);
            const resp = await r.json();
            if (!resp.ok) { $('mntLogView').textContent = resp.error || 'Could not load log'; return; }
            $('mntLogView').textContent = resp.lines.length ? resp.lines.join('\n') : '(empty)';
        } catch (e) { $('mntLogView').textContent = 'Could not load log'; }
    }
    function openLogModal(key) {
        mntLogKey = key;
        $('mntLogTitle').textContent = LOG_TITLES[key] || 'Log';
        $('mntLogModal').hidden = false;
        loadLog();
    }
    function closeLogModal() { $('mntLogModal').hidden = true; }
    function wireMaintenanceTab() {
        // Each tab OPENS the log as its own modal (over the whole manager) —
        // the small inline scroller this replaced read as cramped/jittery.
        document.querySelectorAll('.mnt-log-tab').forEach((t) => t.addEventListener('click', () => openLogModal(t.dataset.log)));
        $('mntLogClose').addEventListener('click', closeLogModal);
        $('mntLogClear').addEventListener('click', async () => {
            const resp = await post('maintenance-logs.php', { log: mntLogKey, action: 'clear' });
            if (resp) loadLog();
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

    // ---- shell ------------------------------------------------------------------
    function showTab(name) {
        document.querySelectorAll('.mgr-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
        $('mgrPaneStation').hidden = name !== 'station';
        $('mgrPaneOptions').hidden = name !== 'options';
        $('mgrPaneRouting').hidden = name !== 'routing';
        $('mgrPaneMaintenance').hidden = name !== 'maintenance';
        if (name !== 'maintenance') closeLogModal();
    }
    function open() {
        renderOptions();
        renderRouting();
        renderStation();
        showTab('station'); // Station is the manager's home tab (Audio moved to its own window)
        $('managerOverlay').hidden = false;
        document.addEventListener('keydown', onKey);
    }
    function close() {
        closeLogModal();
        $('managerOverlay').hidden = true;
        document.removeEventListener('keydown', onKey);
        // Station name/logo/labels or a feature switch may have changed —
        // refresh what's behind (board, ID windows, clock), holding the
        // opaque overlay 2.5s longer so it's fully settled on reveal.
        if (window.refreshPlayerWindows) window.refreshPlayerWindows(2500);
    }
    function onKey(e) {
        if (e.key !== 'Escape' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (!$('mntLogModal').hidden) { closeLogModal(); return; } // one Esc closes the log first
        close();
    }

    function init() {
        const openBtn = $('chip-gear');
        if (openBtn) openBtn.addEventListener('click', open);
        $('managerClose').addEventListener('click', close);
        document.querySelectorAll('.mgr-tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
        wireStationTab();
        wireOptionsTab();
        wireMaintenanceTab();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Manager = { open, close };
})();
