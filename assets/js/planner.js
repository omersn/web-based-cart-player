// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Break planner (admin-only overlay).
 *
 * Edits the daily commercial-breaks plan (window.BREAKS <-> data/breaks.txt):
 *  - LEFT: a pages>carts tree (every board + Station-ID section), with
 *    preview and one-click add into the editor.
 *  - RIGHT: the breaks list ABOVE the playlist editor, separated by a bar.
 *    The editor is the live automation panel itself, borrowed for the
 *    overlay's lifetime (its DOM node is moved here and back), forced MANUAL
 *    so its transport becomes the preview control and its drag-&-drop
 *    reorder just works. Automation.setPlannerMode pins the DJ's real queue
 *    and restores it on close — planning never touches what's on air.
 *
 * A break's items are cart-id REFERENCES (1-based carts.txt lines), resolved
 * against window.CARTS at display/load time — so a re-trim in the admin
 * changes every break that uses the cart. Saving POSTs the whole plan to
 * save-breaks.php (admin-guarded, validates server-side) and refreshes the
 * live strip.
 */
(() => {
    if (!window.IS_ADMIN) return;
    const $ = (id) => document.getElementById(id);
    const CAT = { '1': '#2f6fd6', '2': '#2f9e5f', '3': '#b0479e', '4': '#c98a2b', '5': '#2aa7bf' };

    let plan = [];          // working copy of the breaks (committed editor included)
    let sel = -1;           // selected break index in `plan`
    let draft = null;       // pending duplicate: { after: srcIndex, b: {...} } (OK commits, Cancel drops)
    let panelHome = null;   // where to put the automation panel back on close

    const cartById = (id) => (window.CARTS || []).find((c) => c.i === id - 1) || null;
    const byIndex = (i) => (window.CARTS || []).find((c) => c.i === i);
    const cartRuntime = (c) => (c && c.end != null) ? Math.max(0, c.end - (c.start || 0)) : 0;
    const fmtDur = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    // The fade INTO the following chain member (ms) — only meaningful when
    // this cart actually chains onward. Same convention as dj.js/cartwall.js.
    const fadeAfter = (c) => (c.cross ? Math.max(0, c.chainFade || 0) : 0);
    // Always the WHOLE run, from its true first item — adding any cart that
    // belongs to a chain (even a middle one) must add the complete run, same
    // as firing one on the board or in DJ mode. A chain can never be added
    // partially.
    function chainRun(c) {
        let start = c;
        while (true) {
            const prev = byIndex(start.i - 1);
            if (!prev || !prev.cross) break;
            start = prev;
        }
        const run = [start];
        let cur = start;
        while (cur.cross && run.length < 5) { // chains cap at 5 items
            const next = byIndex(cur.i + 1);
            if (!next) break;
            run.push(next);
            cur = next;
        }
        return run;
    }
    // Overlapped launches (cross editor) shave their ms off the runtime sum.
    const breakLength = (b) => Math.max(0,
        b.items.reduce((s, id) => s + cartRuntime(cartById(id)), 0) -
        (b.overlaps || []).reduce((s, ms) => s + (ms || 0), 0) / 1000);
    const asItem = (c, overlapIn) => ({
        cartId: c.i + 1, name: c.name, file: c.file, start: c.start, end: c.end,
        volume: c.volume, color: c.color, runtime: cartRuntime(c), overlapIn: overlapIn || 0,
    });

    // ---- sections tree ------------------------------------------------------
    // ID-window pages come FIRST (they're the planner's bread and butter),
    // pre-expanded and tinted; the main-board pages follow, collapsed.
    function sections() {
        const out = [];
        const grab = (selectId, ids) => {
            const s = $(selectId);
            if (!s) return;
            [...s.options].forEach((o) => {
                const m = o.value.match(/from=(\d+)&to=(\d+)/);
                if (m) out.push({ from: +m[1], to: +m[2], label: o.textContent.trim(), ids });
            });
        };
        grab('ids-select', true);      // Station IDs / Sweepers & FX first
        grab('section-select', false); // board pages after
        return out;
    }
    // Search + favourites filter state (toolbar pinned above the tree).
    let treeQuery = '', favOnly = false;
    const favSet = new Set(window.FAVORITES || []);
    async function pushFavorites() {
        window.FAVORITES = [...favSet];
        try {
            const r = await fetch('save-favorites.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [...favSet] }),
            });
            const resp = await r.json();
            if (!resp.ok) flashSaveMsg(resp.error || 'Could not save favourites');
        } catch (e) { flashSaveMsg('Could not save favourites'); }
    }
    function renderTree() {
        const tree = $('ptreeScroller');
        tree.innerHTML = '';
        const q = treeQuery.trim().toLowerCase();
        const filtering = q !== '' || favOnly;
        sections().forEach((sec) => {
            let carts = (window.CARTS || []).filter((c) => c.i >= sec.from && c.i < sec.to);
            if (q) carts = carts.filter((c) => c.name.toLowerCase().includes(q));
            if (favOnly) carts = carts.filter((c) => favSet.has(c.i + 1));
            if (!carts.length) return;
            const box = document.createElement('div');
            // ID sections start open; board sections closed — unless a filter
            // is active, in which case every section with hits opens up.
            const open = sec.ids || filtering;
            box.className = 'ptree-section' + (sec.ids ? ' ids' : '') + (open ? '' : ' collapsed');
            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'ptree-head';
            head.innerHTML = `<span class="ptree-exp">${open ? '−' : '+'}</span><span></span><em>${carts.length}</em>`;
            head.querySelectorAll('span')[1].textContent = sec.label;
            head.addEventListener('click', () => {
                const closed = box.classList.toggle('collapsed');
                head.querySelector('.ptree-exp').textContent = closed ? '+' : '−';
            });
            box.appendChild(head);
            const list = document.createElement('div');
            list.className = 'ptree-list';
            carts.forEach((c) => {
                const row = document.createElement('div');
                row.className = 'ptree-cart';
                const faved = favSet.has(c.i + 1);
                row.innerHTML =
                    `<span class="ptree-dot" style="background:${CAT[c.color] || CAT['1']}"></span>` +
                    `<span class="ptree-name"></span>` +
                    `<span class="ptree-len">${c.end != null ? fmtDur(cartRuntime(c)) : '—'}</span>` +
                    `<button type="button" class="ptree-btn ptree-play" title="Preview"><i class="ph-fill ph-play"></i></button>` +
                    `<button type="button" class="ptree-btn ptree-add" title="Add to break"${sel < 0 ? ' disabled' : ''}><i class="ph ph-plus"></i></button>` +
                    `<button type="button" class="ptree-star${faved ? ' faved' : ''}" title="Favourite"><i class="${faved ? 'ph-fill' : 'ph'} ph-star"></i></button>`;
                row.querySelector('.ptree-name').textContent = c.name;
                row.querySelector('.ptree-play').addEventListener('click', (e) => togglePreview(c, e.currentTarget));
                row.querySelector('.ptree-add').addEventListener('click', () => addToEditor(c));
                row.querySelector('.ptree-star').addEventListener('click', (e) => {
                    const id = c.i + 1;
                    if (favSet.has(id)) favSet.delete(id); else favSet.add(id);
                    pushFavorites();
                    const btn = e.currentTarget;
                    const on = favSet.has(id);
                    btn.classList.toggle('faved', on);
                    btn.innerHTML = `<i class="${on ? 'ph-fill' : 'ph'} ph-star"></i>`;
                    if (favOnly) renderTree(); // un-starring under the filter removes the row
                });
                list.appendChild(row);
            });
            box.appendChild(list);
            tree.appendChild(box);
        });
    }
    function addToEditor(c) {
        if (sel < 0) { flashSaveMsg('Select or add a break first'); return; }
        const run = chainRun(c);
        const items = run.map((cc, k) => asItem(cc, k > 0 ? fadeAfter(run[k - 1]) : 0));
        window.Automation.addItems(items, items.length > 1);
        commitEditor();
        renderBreaks(); // live-update the selected row's "N items · length"
    }

    // ---- tree preview (trim-aware, one at a time) --------------------------
    let preview = null, previewBtn = null;
    function stopPreview() {
        if (preview) { try { preview.pause(); } catch (e) {} preview = null; }
        if (previewBtn) { previewBtn.innerHTML = '<i class="ph-fill ph-play"></i>'; previewBtn = null; }
    }
    function togglePreview(c, btn) {
        if (previewBtn === btn) { stopPreview(); return; }
        stopPreview();
        preview = new Audio(`uploads/${c.file}`);
        preview.currentTime = c.start || 0;
        preview.volume = c.volume != null ? c.volume : 1;
        if (c.end != null) preview.addEventListener('timeupdate', () => { if (preview && preview.currentTime >= c.end) stopPreview(); });
        preview.addEventListener('ended', stopPreview);
        preview.play().catch(() => stopPreview());
        previewBtn = btn;
        btn.innerHTML = '<i class="ph-fill ph-stop"></i>';
    }

    // ---- breaks list --------------------------------------------------------
    // The o-> start/end glyphs, matching the automation header's language.
    const AICON = {
        start: '<svg viewBox="0 0 40 22" width="26" height="15"><circle cx="8" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 11V6.6M8 11h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18 11h16M30 7l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        end:   '<svg viewBox="0 0 40 22" width="26" height="15"><path d="M4 11h16M16 7l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M32 11V6.6M32 11h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    };
    // Two ENABLED SCHEDULED breaks may never share a time slot, and an
    // enabled scheduled break must carry a real time (a manual/parked one may
    // hold NOTIME). Returns the set of plan indexes in conflict — marked red;
    // save refuses while any exist.
    const hasTime = (b) => /^\d\d:\d\d$/.test(b.time);
    function conflicts() {
        const seen = {}, bad = new Set();
        plan.forEach((b, i) => {
            if (b.enabled === false || b.manual) return;
            if (!hasTime(b)) { bad.add(i); return; } // moved to scheduled without a time
            if (seen[b.time] !== undefined) { bad.add(i); bad.add(seen[b.time]); }
            else seen[b.time] = i;
        });
        return bad;
    }
    function buildBreakRow(b, i, bad) {
        const isManual = !!b.manual;
        const isOff = b.enabled === false;
        const row = document.createElement('div');
        row.className = 'pbreak' + (i === sel ? ' selected' : '') + (isManual ? ' manual' : '') +
            (isOff ? ' off' : '') + (bad.has(i) ? ' conflict' : '');
        row.innerHTML =
            `<input class="pbreak-time" type="time" value="${hasTime(b) ? b.time : ''}" title="${isManual ? 'No time trigger (kept for later)' : 'Air time'}">` +
            `<button type="button" class="pbreak-anchor" title="Toggle: starts at / must end by">${b.anchor === 'end' ? AICON.end : AICON.start}<span>${b.anchor === 'end' ? 'To' : 'From'}</span></button>` +
            `<span class="pbreak-name-text"></span>` +
            `<button type="button" class="pbreak-edit" title="Rename"><i class="ph ph-pencil-simple"></i></button>` +
            `<span class="pbreak-meta">${b.items.length} items · ${fmtDur(breakLength(b))}</span>` +
            `<button type="button" class="pbreak-copy" title="Duplicate break"><i class="ph ph-copy"></i></button>` +
            `<button type="button" class="pbreak-mode" title="${isManual ? 'Manual — DJ fires it by hand. Click for scheduled' : 'Scheduled — fires on its time. Click for manual'}"><i class="ph ${isManual ? 'ph-hand-tap' : 'ph-clock'}"></i></button>` +
            `<button type="button" class="pbreak-power" title="${isOff ? 'Enable' : 'Disable (park as template)'}"><i class="ph ph-power"></i></button>` +
            `<button type="button" class="pbreak-del" title="Delete break"><i class="ph ph-trash"></i></button>`;
        row.querySelector('.pbreak-name-text').textContent = b.name || 'Break';
        // Touching the time area pops the picker right away (no tiny-icon hunting).
        // An emptied field stores as NOTIME (legal for manual/parked breaks;
        // rings red on a scheduled one until a time is set).
        const timeIn = row.querySelector('.pbreak-time');
        timeIn.addEventListener('input', (e) => { b.time = e.target.value || 'NOTIME'; });
        timeIn.addEventListener('change', () => { commitEditor(); renderBreaks(); }); // re-check conflicts
        timeIn.addEventListener('click', () => { try { timeIn.showPicker && timeIn.showPicker(); } catch (e) {} });
        timeIn.addEventListener('focus', () => { try { timeIn.showPicker && timeIn.showPicker(); } catch (e) {} });
        // From (start-at) <-> To (end-by). Inert (grayed) while the break is
        // manual, but the value is kept for when it goes back to scheduled.
        row.querySelector('.pbreak-anchor').addEventListener('click', () => {
            b.anchor = b.anchor === 'end' ? 'start' : 'end';
            commitEditor(); renderBreaks();
        });
        // Clock/hand: scheduled (fires on its time) <-> manual (DJ-fired).
        // Time + From/To gray out but keep their values for restore.
        row.querySelector('.pbreak-mode').addEventListener('click', (e) => {
            e.stopPropagation();
            b.manual = !b.manual;
            commitEditor(); renderBreaks();
        });
        // Pencil: swap the name for an inline input; Enter/blur commits.
        row.querySelector('.pbreak-edit').addEventListener('click', (e) => {
            e.stopPropagation();
            const span = row.querySelector('.pbreak-name-text');
            const input = document.createElement('input');
            input.className = 'pbreak-name';
            input.type = 'text'; input.maxLength = 60; input.value = b.name;
            span.replaceWith(input);
            input.focus(); input.select();
            const commit = () => { b.name = input.value.trim() || b.name; renderBreaks(); };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                if (ev.key === 'Escape') { ev.stopPropagation(); input.removeEventListener('blur', commit); renderBreaks(); }
            });
        });
        row.querySelector('.pbreak-power').addEventListener('click', (e) => {
            e.stopPropagation();
            b.enabled = b.enabled === false; // toggle (missing/undefined counts as enabled)
            commitEditor(); renderBreaks();
        });
        // Copy: opens a draft duplicate right below (same items/anchor/mode,
        // name + " (copy)"). Scheduled drafts need a time before OK; a manual
        // draft may stay time-less (stored as NOTIME, shown --:--).
        row.querySelector('.pbreak-copy').addEventListener('click', (e) => {
            e.stopPropagation();
            draftError = false; // a fresh draft starts "new" (blue), not red
            draft = {
                after: i,
                b: {
                    time: 'NOTIME', anchor: b.anchor, name: (b.name || 'Break') + ' (copy)',
                    items: [...b.items], enabled: b.enabled !== false, manual: !!b.manual,
                    overlaps: [...(b.overlaps || [])], volumes: [...(b.volumes || [])],
                },
            };
            renderBreaks();
        });
        row.querySelector('.pbreak-del').addEventListener('click', (e) => { e.stopPropagation(); removeBreak(i); });
        // Clicking the row (not its inputs/buttons) selects the break.
        row.addEventListener('click', (e) => {
            if (e.target.closest('input, button')) return;
            select(i);
        });
        return row;
    }
    // Draft duplicate row: only [time] [name] [items] [OK] [Cancel]. OK stays
    // disabled for a scheduled draft until a FREE time is chosen; a manual
    // draft may be OK'd time-less (stored as NOTIME, shown --:--).
    // Drafts are "new" (blue ring) while being set up; they only turn red if
    // a save is attempted with the draft still unsettled.
    let draftError = false;
    function buildDraftRow() {
        const d = draft.b;
        const hasT = hasTime(d);
        const slotTaken = hasT && !d.manual && plan.some((p) => p.enabled !== false && !p.manual && p.time === d.time);
        const okOk = d.manual || (hasT && !slotTaken);
        const row = document.createElement('div');
        row.className = 'pbreak pdraft' + (draftError ? ' conflict' : '') + (d.manual ? ' manual' : '');
        row.innerHTML =
            `<input class="pbreak-time" type="time" value="${hasT ? d.time : ''}" title="${d.manual ? 'Optional for a manual break' : 'Pick a free time'}">` +
            `<button type="button" class="pbreak-anchor" title="Toggle: starts at / must end by">${d.anchor === 'end' ? AICON.end : AICON.start}<span>${d.anchor === 'end' ? 'To' : 'From'}</span></button>` +
            `<span class="pbreak-name-text"></span>` +
            `<span class="pbreak-meta">${d.items.length} items · ${fmtDur(breakLength(d))}</span>` +
            `<button type="button" class="pdraft-ok" ${okOk ? '' : 'disabled'}>OK</button>` +
            `<button type="button" class="pdraft-cancel">Cancel</button>`;
        row.querySelector('.pbreak-name-text').textContent = d.name;
        const timeIn = row.querySelector('.pbreak-time');
        timeIn.addEventListener('input', (e) => { d.time = e.target.value || 'NOTIME'; });
        timeIn.addEventListener('change', () => renderBreaks()); // re-evaluate OK/red
        timeIn.addEventListener('click', () => { try { timeIn.showPicker && timeIn.showPicker(); } catch (e) {} });
        timeIn.addEventListener('focus', () => { try { timeIn.showPicker && timeIn.showPicker(); } catch (e) {} });
        row.querySelector('.pbreak-anchor').addEventListener('click', () => {
            d.anchor = d.anchor === 'end' ? 'start' : 'end';
            renderBreaks();
        });
        row.querySelector('.pdraft-ok').addEventListener('click', () => {
            commitEditor();
            plan.splice(draft.after + 1, 0, draft.b);
            if (sel > draft.after) sel++;
            draft = null;
            draftError = false;
            renderBreaks();
        });
        row.querySelector('.pdraft-cancel').addEventListener('click', () => { draft = null; draftError = false; renderBreaks(); });
        return row;
    }
    function renderBreaks() {
        const host = $('plannerBreaks');
        host.innerHTML = '';
        const bad = conflicts();
        const withIdx = plan.map((b, i) => [b, i]);
        // Three display groups. Scheduled/Manual headers appear only when both
        // exist; Disabled gets its header whenever it has content.
        const sched = withIdx.filter(([b]) => b.enabled !== false && !b.manual);
        const man   = withIdx.filter(([b]) => b.enabled !== false && b.manual);
        const off   = withIdx.filter(([b]) => b.enabled === false);
        const needHeads = (sched.length > 0 && man.length > 0) || off.length > 0;
        const emit = (label, rows) => {
            if (!rows.length) return;
            if (needHeads) {
                const h = document.createElement('div');
                h.className = 'pbreak-group-head';
                h.textContent = label;
                host.appendChild(h);
            }
            rows.forEach(([b, i]) => {
                host.appendChild(buildBreakRow(b, i, bad));
                if (draft && draft.after === i) host.appendChild(buildDraftRow());
            });
        };
        emit('Scheduled', sched);
        emit('Manual', man);
        emit('Disabled', off);
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'pbreak-add';
        add.innerHTML = '<i class="ph ph-plus"></i> Add break';
        add.addEventListener('click', addBreak);
        host.appendChild(add);
    }
    // Reflects `sel` in the tree's Add buttons (grayed out with nothing
    // selected — there's nowhere to add into) and the editor's empty-state
    // hint (shown only until a break is picked).
    function updateSelectionUi() {
        document.querySelectorAll('.ptree-add').forEach((b) => { b.disabled = sel < 0; });
        const hint = $('plannerEditorHint');
        if (hint) hint.hidden = sel >= 0;
    }
    function select(i) {
        if (i === sel) return;
        commitEditor();
        sel = i;
        const items = (plan[i] ? plan[i].items : []).map(cartById).filter(Boolean).map(asItem);
        window.Automation.loadPlaylist(items, plan[i] ? plan[i].overlaps || [] : [], plan[i] ? plan[i].volumes || [] : []);
        renderBreaks();
        updateSelectionUi();
    }
    function addBreak() {
        commitEditor();
        // Start from a FREE slot — a fresh break must never collide with an
        // existing one (slots are unique among enabled scheduled breaks).
        const pad = (n) => String(n).padStart(2, '0');
        const taken = new Set(plan.filter((b) => b.enabled !== false && !b.manual).map((b) => b.time));
        let h = 12, m = 0;
        while (taken.has(`${pad(h)}:${pad(m)}`)) { m += 5; if (m >= 60) { m = 0; h = (h + 1) % 24; } }
        plan.push({ time: `${pad(h)}:${pad(m)}`, anchor: 'start', name: 'New break', items: [], enabled: true, manual: false, overlaps: [], volumes: [] });
        sel = plan.length - 1;
        window.Automation.loadPlaylist([]);
        renderBreaks();
        updateSelectionUi();
    }
    function removeBreak(i) {
        commitEditor();
        draft = null; // indexes are about to shift
        plan.splice(i, 1);
        if (sel === i) { sel = -1; window.Automation.loadPlaylist([]); }
        else if (sel > i) sel--;
        renderBreaks();
        updateSelectionUi();
    }
    // Pull the editor's current queue back into the selected break (as ids),
    // along with the per-gap overlaps and per-item volume overrides the
    // cross editor set.
    function commitEditor() {
        if (sel < 0 || !plan[sel]) return;
        plan[sel].items = window.Automation.getItems().map((it) => it.cartId).filter(Boolean);
        plan[sel].overlaps = window.Automation.getOverlaps();
        plan[sel].volumes = window.Automation.getVolumes();
    }
    function isDirty() {
        commitEditor();
        return JSON.stringify(plan) !== JSON.stringify(window.BREAKS || []);
    }

    // ---- open / close / save ------------------------------------------------
    function open() {
        if (!window.Automation.setPlannerMode(true)) return; // refused while playing
        plan = (window.BREAKS || []).map((b) => ({ ...b, items: [...b.items], overlaps: [...(b.overlaps || [])], volumes: [...(b.volumes || [])] }));
        sel = -1;
        draft = null;
        treeQuery = ''; favOnly = false; // fresh filters each session
        $('ptreeSearch').value = '';
        $('ptreeFavFilter').classList.remove('active');
        const panel = $('automationPanel');
        panelHome = {
            parent: panel.parentElement, next: panel.nextElementSibling,
            // The panel carries its own resize-saved inline width (see
            // index.php's panel-resize handles) — an inline style beats the
            // planner's ".planner-editor .automation-panel { max-width: none }"
            // override, leaving the editor stranded at its sidebar width
            // instead of filling the pane. Clear it here; doClose() restores
            // it for the live sidebar.
            flexBasis: panel.style.flexBasis, maxWidth: panel.style.maxWidth,
        };
        panel.style.flexBasis = '';
        panel.style.maxWidth = '';
        $('plannerEditor').appendChild(panel);
        $('plannerOverlay').hidden = false;
        renderTree();
        renderBreaks();
        // Nothing pre-selected: the editor starts empty until a break is picked.
        window.Automation.loadPlaylist([]);
        updateSelectionUi();
        document.addEventListener('keydown', onKey);
    }
    // Closing with unsaved changes asks first — via a styled in-overlay
    // dialog (not the browser's native confirm).
    function close() {
        if (isDirty()) { $('plannerConfirm').hidden = false; return; }
        doClose();
    }
    function doClose() {
        stopPreview();
        document.removeEventListener('keydown', onKey);
        $('plannerConfirm').hidden = true;
        $('plannerOverlay').hidden = true;
        const panel = $('automationPanel');
        panelHome.parent.insertBefore(panel, panelHome.next);
        panel.style.flexBasis = panelHome.flexBasis;
        panel.style.maxWidth = panelHome.maxWidth;
        window.Automation.setPlannerMode(false);
    }
    function onKey(e) {
        if (e.key !== 'Escape') return;
        // First Esc dismisses the discard dialog (keep editing); otherwise close.
        if (!$('plannerConfirm').hidden) { $('plannerConfirm').hidden = true; return; }
        close();
    }

    let saveMsgTimer = null;
    function flashSaveMsg(msg, ok) {
        const m = $('plannerMsg');
        m.textContent = msg;
        m.classList.toggle('ok', !!ok);
        m.classList.add('show');
        clearTimeout(saveMsgTimer);
        saveMsgTimer = setTimeout(() => m.classList.remove('show'), 2400);
    }
    /** POST the plan; returns true when the server accepted it. */
    async function save() {
        commitEditor();
        // A pending duplicate must be OK'd or cancelled first — trying to save
        // around it flips its ring from "new" blue to error red.
        if (draft) {
            draftError = true;
            renderBreaks();
            flashSaveMsg('Finish the new break first — OK it or cancel it');
            return false;
        }
        if (conflicts().size) {
            flashSaveMsg('Fix the red breaks first — a scheduled break needs its own free time');
            renderBreaks(); // make sure the red conflict rings are showing
            return false;
        }
        const selBreak = plan[sel];
        try {
            const r = await fetch('save-breaks.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ breaks: plan }),
            });
            const resp = await r.json();
            if (!resp.ok) { flashSaveMsg(resp.error || 'Save failed'); return false; }
            // Adopt the server's normalised, time-sorted list as the new truth.
            window.BREAKS = resp.breaks;
            draft = null; // indexes just shifted; an un-OK'd draft dies with them
            plan = resp.breaks.map((b) => ({ ...b, items: [...b.items] }));
            sel = selBreak ? plan.findIndex((b) => b.time === selBreak.time && b.name === selBreak.name) : -1;
            renderBreaks();
            window.Automation.refreshBreaks(); // live strip picks the plan up now
            return true;
        } catch (e) {
            flashSaveMsg('Save failed — server unreachable');
            return false;
        }
    }

    function init() {
        const openBtn = $('chip-planner');
        if (openBtn) openBtn.addEventListener('click', open);
        // A cross-editor save changes the selected break's overlaps (and its
        // real length) — pull it into the plan and refresh the meta line.
        window.Automation.onOverlapSaved(() => { commitEditor(); renderBreaks(); });
        // Tree toolbar: live search + favourites-only filter.
        $('ptreeSearch').addEventListener('input', (e) => { treeQuery = e.target.value; renderTree(); });
        $('ptreeFavFilter').addEventListener('click', (e) => {
            favOnly = !favOnly;
            e.currentTarget.classList.toggle('active', favOnly);
            renderTree();
        });
        $('plannerCancel').addEventListener('click', close); // discard (confirms if dirty)
        $('plannerConfirmDiscard').addEventListener('click', doClose);
        $('plannerConfirmKeep').addEventListener('click', () => { $('plannerConfirm').hidden = true; });
        // Save & Close: after a successful save the plan matches the server,
        // so close() proceeds without the discard prompt; a failed save stays
        // open with the error showing.
        $('plannerSave').addEventListener('click', async () => { if (await save()) close(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.Planner = { open, close };
})();
