// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Station manager (admin-only overlay): Audio | Station | Options.
 *
 * Audio    every slot (incl. empty placeholders) in a sections list + ONE
 *          detail panel: rename, colour, volume, chain, trim (the proven
 *          trimmer pages embedded in an iframe), preview, move, clear-slot.
 *          Fields save on change through save-cart.php; moves remap the
 *          break plan's references server-side.
 * Station  station name, logo upload, ticker, section labels, page names.
 * Options  live feature switches + links + the typed-"clear" danger zone.
 */
(() => {
    if (!window.IS_ADMIN) return;
    const $ = (id) => document.getElementById(id);
    const CAT = { '1': '#2f6fd6', '2': '#2f9e5f', '3': '#b0479e', '4': '#c98a2b', '5': '#2aa7bf' };
    const M = () => window.MANAGER_DATA || { carts: [], labels: [], pageNames: [], ticker: '', stationName: '', logo: '' };

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

    // ---- Audio tab ----------------------------------------------------------
    // Sections mirror the player's fixed ranges: id-window pages first would
    // reorder ids — the manager shows TRUE file order, so the board pages come
    // in carts.txt order with their labels, and every slot is visible.
    function audioSections() {
        const L = M().labels, out = [
            { label: 'Station IDs (window)', from: 0, to: 10 },
            { label: L[0] || '1', from: 10, to: 35 }, { label: L[1] || '2', from: 35, to: 60 },
            { label: L[2] || '3', from: 60, to: 85 }, { label: L[3] || '4', from: 85, to: 110 },
            { label: 'Sweepers & FX (window)', from: 110, to: 120 },
            { label: L[4] || '5', from: 120, to: 145 }, { label: L[5] || '6', from: 145, to: 170 },
            { label: L[6] || '7', from: 170, to: 195 }, { label: L[7] || '8', from: 195, to: 220 },
            { label: L[8] || '9', from: 220, to: 245 }, { label: L[9] || '10', from: 245, to: 270 },
        ];
        return out.filter((s) => s.from < M().carts.length);
    }
    let selId = 0, maQuery = '';
    function renderAudioList() {
        const host = $('maList');
        host.innerHTML = '';
        const q = maQuery.trim().toLowerCase();
        audioSections().forEach((sec) => {
            let slots = M().carts.slice(sec.from, Math.min(sec.to, M().carts.length));
            if (q) slots = slots.filter((c) => !c.empty && c.name.toLowerCase().includes(q));
            if (!slots.length) return;
            const open = q !== '' || slots.some((c) => c.id === selId);
            const box = document.createElement('div');
            box.className = 'ptree-section' + (open ? '' : ' collapsed');
            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'ptree-head';
            head.innerHTML = `<span class="ptree-exp">${open ? '−' : '+'}</span><span></span><em>${slots.filter((c) => !c.empty).length}</em>`;
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
                row.className = 'ptree-cart ma-item' + (c.id === selId ? ' sel' : '') + (c.empty ? ' emptyslot' : '');
                row.innerHTML =
                    `<span class="ma-slot">${c.id}</span>` +
                    `<span class="ptree-dot" style="background:${c.empty ? 'transparent' : (CAT[c.color] || CAT['1'])}"></span>` +
                    `<span class="ptree-name"></span>` +
                    (c.cross ? '<i class="ph ph-link ma-linked" title="Chained to the next cart"></i>' : '');
                row.querySelector('.ptree-name').textContent = c.empty ? '(empty)' : c.name;
                row.addEventListener('click', () => selectCart(c.id));
                list.appendChild(row);
            });
            box.appendChild(list);
            host.appendChild(box);
        });
    }
    function cart(id) { return M().carts.find((c) => c.id === id); }
    function selectCart(id) {
        selId = id;
        stopMaPreview();
        $('maTrimHost').hidden = true; $('maTrimHost').innerHTML = '';
        const c = cart(id);
        $('maEmptyHint').hidden = true;
        $('maForm').hidden = false;
        $('maName').value = c.empty ? '' : c.name;
        $('maVolume').value = Math.round((c.volume != null ? c.volume : 1) * 100);
        $('maVolVal').textContent = $('maVolume').value + '%';
        $('maChain').checked = !!c.cross;
        renderSwatches(c.color);
        renderMoveSlots(id);
        // No audio yet in an empty slot: only naming makes sense (uploading
        // audio into slots still goes through the legacy admin for now).
        ['maPreview', 'maTrimStart', 'maTrimEnd'].forEach((b) => { $(b).disabled = c.empty; });
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
    // Trim: embed the battle-tested trimmer pages; hideParentDiv (their close
    // signal) collapses the host and refreshes the slot's trim values.
    function openTrim(kind) {
        const c = cart(selId);
        const host = $('maTrimHost');
        host.innerHTML = `<iframe src="${kind === 'start' ? 'trimmer-div.php' : 'trimmer-endpoint-div.php'}?file=${encodeURIComponent(c.file)}"></iframe>`;
        host.hidden = false;
        window.hideParentDiv = () => { host.hidden = true; host.innerHTML = ''; flash('Trim saved', true); };
    }
    let maAudio = null, maPlaying = false;
    function stopMaPreview() {
        if (maAudio) { try { maAudio.pause(); } catch (e) {} maAudio = null; }
        maPlaying = false;
        const b = $('maPreview');
        if (b) b.innerHTML = '<i class="ph-fill ph-play"></i> Preview';
    }
    function toggleMaPreview() {
        if (maPlaying) { stopMaPreview(); return; }
        const c = cart(selId);
        maAudio = new Audio('uploads/' + c.file);
        maAudio.currentTime = c.start || 0;
        maAudio.volume = c.volume != null ? c.volume : 1;
        if (c.end != null) maAudio.addEventListener('timeupdate', () => { if (maAudio && maAudio.currentTime >= c.end) stopMaPreview(); });
        maAudio.addEventListener('ended', stopMaPreview);
        maAudio.play().catch(stopMaPreview);
        maPlaying = true;
        $('maPreview').innerHTML = '<i class="ph-fill ph-stop"></i> Stop';
    }
    function wireAudioTab() {
        $('maSearch').addEventListener('input', (e) => { maQuery = e.target.value; renderAudioList(); });
        $('maName').addEventListener('change', async () => {
            const name = $('maName').value.trim();
            if (await post('save-cart.php', { op: 'update', id: selId, name })) {
                cart(selId).name = name || '-';
                renderAudioList();
            }
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
        $('maPreview').addEventListener('click', toggleMaPreview);
        $('maTrimStart').addEventListener('click', () => openTrim('start'));
        $('maTrimEnd').addEventListener('click', () => openTrim('end'));
        // Upload new audio into the slot (or replace what's there). Trims
        // reset server-side — they belonged to the old file.
        $('maAudioUpload').addEventListener('click', () => $('maAudioFile').click());
        $('maAudioFile').addEventListener('change', async () => {
            const f = $('maAudioFile').files[0];
            if (!f) return;
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
                // The file order changed under us: re-sync from a fresh reload
                // of the board later; locally, splice the model the same way.
                const carts = M().carts;
                const moved = carts.splice(selId - 1, 1)[0];
                carts.splice(to - 1, 0, moved);
                carts.forEach((c, i) => { c.id = i + 1; });
                selectCart(to);
            }
        });
        $('maDelete').addEventListener('click', async () => {
            if (await post('save-cart.php', { op: 'delete', id: selId })) {
                Object.assign(cart(selId), { name: '-', file: '0.mp3', start: 0, end: null, volume: 1, color: '1', cross: 0, empty: true });
                selectCart(selId);
            }
        });
    }

    // ---- Station tab --------------------------------------------------------
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
        $('stPageNames').value = (M().pageNames || []).join('\n');
    }
    function wireStationTab() {
        $('stSave').addEventListener('click', async () => {
            const labels = [...$('stLabels').querySelectorAll('input')].map((i) => i.value);
            const resp = await post('save-station.php', {
                stationName: $('stName').value,
                ticker: $('stTicker').value,
                labels,
                pageNames: $('stPageNames').value.split('\n').map((s) => s.trim()).filter((s) => s !== ''),
            });
            if (resp) { M().stationName = resp.stationName; M().labels = labels; M().ticker = $('stTicker').value; }
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

    // ---- Options tab --------------------------------------------------------
    const SWITCHES = [
        ['ids_window', 'Station IDs / sweepers window', 'The floating ID-wall toggle in the topbar'],
        ['automation', 'Automation playlist & planner', 'The playlist toggle and the break planner'],
        ['dj_mode',    'DJ mode', 'Placeholder — the layout itself is coming'],
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
        set('qr-chip', s.mobile);
        const dl = $('chip-download');
        if (dl) dl.classList.toggle('off', !s.download);
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

    // ---- shell --------------------------------------------------------------
    function showTab(name) {
        document.querySelectorAll('.mgr-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
        $('mgrPaneAudio').hidden = name !== 'audio';
        $('mgrPaneStation').hidden = name !== 'station';
        $('mgrPaneOptions').hidden = name !== 'options';
        if (name !== 'audio') stopMaPreview();
    }
    function open() {
        renderOptions();
        renderStation();
        renderAudioList();
        $('managerOverlay').hidden = false;
        document.addEventListener('keydown', onKey);
    }
    function close() {
        stopMaPreview();
        $('managerOverlay').hidden = true;
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') close(); }

    function init() {
        $('managerClose').addEventListener('click', close);
        document.querySelectorAll('.mgr-tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
        wireAudioTab();
        wireStationTab();
        wireOptionsTab();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Manager = { open, close };
})();
