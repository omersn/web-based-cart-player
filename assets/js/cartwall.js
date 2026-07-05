// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Cart wall — load mechanism & playback
 * =====================================
 * This is the heart of the player. It reads the cart list, builds the grid of
 * buttons, and talks to the persistent audio engine (assets/js/audio-engine.js,
 * living in the PARENT document — this file runs inside grid.php's <iframe>)
 * for actual playback.
 *
 * Why the engine, not a local <audio> element per button (like this file used
 * to do)
 * ------------------------------------------------------------------------
 * A real <audio> DOM element can't cross the iframe boundary via postMessage
 * (structured clone can't carry DOM nodes), so this file never calls into the
 * engine directly — it can't, it's a different document. Instead it sends
 * plain metadata commands and reacts to lightweight state broadcasts:
 *
 *   iframe -> engine   { source:'cart-engine-cmd', cmd:'play'|'stop', cartId, ... }
 *                      { source:'cart-engine-cmd', cmd:'prime', carts:[...] }
 *   engine -> iframe   { source:'cart-engine-state', type:'tick', voices:[...] }
 *                      { source:'cart-engine-state', type:'cart-lead'|'cart-ended', cartId }
 *
 * `cartId` is the absolute 1-based carts.txt line number (sectionFrom +
 * boxNumber) — stable across which UI surface (main board, Station IDs
 * floater) happens to be rendering it, unlike the section-relative boxNumber.
 *
 * This is what makes playback survive an iframe reload (switching board
 * sections, "Stop all," a Station Manager save): the real <audio> element and
 * its timers live in the engine, in the parent document, which never reloads
 * for any of those. A reloaded iframe just rebuilds its buttons and picks up
 * whatever's still playing from the next state tick it receives (~200ms) —
 * no special "give me current state" handshake needed.
 *
 * Other pieces, unchanged by any of the above:
 *  - Chaining (data/cross.txt): a "chained" button auto-clicks the next one —
 *    still driven by this file's own DOM-walk of the chain (nextCartButton()
 *    etc.), just triggered by a 'cart-lead'/'cart-ended' broadcast instead of
 *    a local setTimeout.
 *  - A large "back-timer" overlay shows the remaining time of the current item
 *    (or the whole chained sequence) — same math as before, now sourced from
 *    the engine's broadcasts instead of a local audio element's .currentTime.
 *  - PFL preview and right-click-to-schedule/right-click-to-automation are
 *    entirely separate, untouched code paths — see their own comments below.
 *  - Per-button VU bars are gone (the engine owns the real audio now, and a
 *    per-cart level feed wasn't worth the added broadcast traffic) — buttons
 *    keep only their "playing" pulse.
 *
 * Config is injected by grid.php via window.CARTWALL_CONFIG.
 */
(() => {
    const CONFIG = window.CARTWALL_CONFIG || { dataUrl: 'data', itemsPerPage: 25 };
    const DATA_URL = CONFIG.dataUrl;
    const itemsPerPage = CONFIG.itemsPerPage;

    // Cart colour code -> category class (see grid.php's .cat-N rules for the
    // actual gradient/base-colour values, kept in one place per the design tokens).
    const categoryClass = {
        '1': 'cat-1', // blue
        '2': 'cat-2', // green
        '3': 'cat-3', // magenta
        '4': 'cat-4', // amber
        '5': 'cat-5', // cyan
    };

    const urlParams = new URLSearchParams(window.location.search);

    // Cache-busted data URLs.
    const fileUrl = `${DATA_URL}/carts.txt?v=${Date.now()}`;
    const pageNamesUrl = `${DATA_URL}/page_names.txt?v=${Date.now()}`;
    const crossFileUrl = `${DATA_URL}/cross.txt?v=${Date.now()}`;
    const enabledFileUrl = `${DATA_URL}/enabled.txt?v=${Date.now()}`;

    // Columns come from ?line (defaults to 5).
    const columns = parseInt(urlParams.get('line'), 10) || 5;
    document.documentElement.style.setProperty('--columns', columns);

    // Report on-air state up to the parent shell: how many carts are playing here
    // (used to lock layout while anything is on air) plus the shared countdown
    // string (used to drive the big slide-up countdown bar over the ticker).
    // Harmless when there's no parent (grid opened standalone).
    const reportState = (playing, countdown) => {
        try { window.parent.postMessage({ source: 'cartwall', playing, countdown }, '*'); } catch (e) { /* no parent */ }
    };
    // Clear our contribution before the frame is torn down / reloaded — the
    // engine keeps playing regardless (that's the whole point), this just
    // stops OUR lock/countdown contribution from going stale.
    window.addEventListener('pagehide', () => reportState(0, null));

    // The main board reports its countdown to the parent (the big bar over the
    // ticker); sub-windows (Station IDs, dock) show their own internal bar.
    const isMainBoard = urlParams.get('mainbar') === '1';

    // Send a plain-data playback command to the engine (parent document).
    function sendToEngine(payload) {
        try { window.parent.postMessage({ source: 'cart-engine-cmd', ...payload }, '*'); } catch (e) { /* no parent */ }
    }
    function fmtTime(seconds) {
        const s = Math.max(0, seconds || 0);
        return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
    }

    // Tags every playback-log line with which player fired it and which
    // (simulated) output it carries — lets the log double as a check that
    // different players are actually routed to different real devices, once
    // there's real multi-output hardware behind OUT 1-5.
    const outputLabel = () => `Cart Wall -> OUT ${(window.ROUTING || {}).carts || 1}`;

    // Log a page refresh.
    window.addEventListener('load', () => {
        fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - page refreshed` });
    });


    function logToPanel(message) {
        const panel = document.getElementById('messagelog');
        if (panel) panel.innerHTML += `<br>${message}`;
    }

    // cross.txt -> which boxes (within the current from/to range) auto-chain.
    let specialBoxes = [];
    async function loadCrossFile() {
        try {
            const response = await fetch(crossFileUrl);
            if (!response.ok) throw new Error(`Failed to fetch cross.txt: ${response.status}`);
            const text = await response.text();

            const from = parseInt(urlParams.get('from'), 10) || 0;
            const to = parseInt(urlParams.get('to'), 10) || 100;

            specialBoxes = text
                .split(/\n/)
                .map((line, index) => {
                    const [flag, seconds] = line.split('|').map(part => part.trim());
                    if (index < from || index > to) return null;
                    return {
                        boxNumber: index - from + 1,
                        flag: parseInt(flag, 10),
                        seconds: parseFloat(seconds) || 0,
                    };
                })
                .filter(box => box !== null && !isNaN(box.flag));
        } catch (error) {
            console.error(`Error fetching cross.txt: ${error.message}`);
        }
    }

    // enabled.txt -> per-cart on/off (manager Audio tab). Raw, unsliced array
    // (one entry per carts.txt line) so lookups use the same absolute index
    // as carts.txt/cross.txt; missing entries default to enabled.
    let enabledStates = [];
    async function loadEnabledFile() {
        try {
            const text = await (await fetch(enabledFileUrl)).text();
            enabledStates = text.split(/\n/).map((l) => l.trim() !== '0');
        } catch (error) {
            console.error(`Error fetching enabled.txt: ${error.message}`);
        }
    }

    // Every real (non-empty, non-disabled) cart built this load, queued for
    // ONE batched 'prime' command once the page is built — see loadCartwall().
    let primeQueue = [];

    async function loadCartwall() {
        const from = parseInt(urlParams.get('from'), 10) || 0;
        const to = parseInt(urlParams.get('to'), 10) || Infinity;

        try {
            await loadCrossFile();
            await loadEnabledFile();

            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
            const cartLines = (await response.text()).split('\n').filter(line => line.trim() !== '');
            const filteredCartLines = cartLines.slice(from, to);

            const totalPages = Math.ceil(filteredCartLines.length / itemsPerPage);
            const cartwall = document.getElementById('cartwall');
            const pagination = document.getElementById('pagination');

            // Page names sliced to the visible range.
            let pageNames = [];
            try {
                const namesText = await (await fetch(pageNamesUrl)).text();
                if (namesText) {
                    const all = namesText.split('\n').map(n => n.trim()).filter(n => n !== '');
                    const startIndex = Math.floor((from || 0) / itemsPerPage);
                    const endIndex = Math.ceil((to || filteredCartLines.length) / itemsPerPage);
                    pageNames = all.slice(startIndex, endIndex);
                }
            } catch (error) {
                console.error('Error fetching page names:', error);
            }

            cartwall.innerHTML = '';
            pagination.innerHTML = '';
            primeQueue = [];

            for (let i = 0; i < totalPages; i++) {
                const pageDiv = document.createElement('div');
                pageDiv.classList.add('page');
                if (i === 0) pageDiv.classList.add('active');

                filteredCartLines.slice(i * itemsPerPage, (i + 1) * itemsPerPage).forEach((line, index) => {
                    // Stagger button creation slightly to spread out the work.
                    setTimeout(() => buildButton(line, i, index, pageDiv, from), index * 25);
                });

                cartwall.appendChild(pageDiv);

                const pageButton = document.createElement('button');
                pageButton.textContent = pageNames[i] || `Page ${i + 1}`;
                if (i === 0) pageButton.classList.add('active');
                pageButton.onclick = () => {
                    document.querySelectorAll('.page').forEach((div, idx) => div.classList.toggle('active', idx === i));
                    document.querySelectorAll('.pagination button').forEach((btn, idx) => btn.classList.toggle('active', idx === i));
                };
                pagination.appendChild(pageButton);
            }

            // Buttons are appended on a small stagger; once they're all in
            // place, compact empty rows and ask the engine to prime every
            // real cart this iframe renders (one batched command, not one
            // per button — the engine does its own internal staggering).
            setTimeout(() => {
                applyRowCompaction();
                if (primeQueue.length) sendToEngine({ cmd: 'prime', carts: primeQueue });
            }, itemsPerPage * 25 + 120);
        } catch (error) {
            console.error(`Error loading cartwall: ${error.message}`);
        }
    }

    // In fit mode, collapse any row whose carts are ALL empty to ~20% height so
    // the populated rows get the reclaimed vertical space.
    function applyRowCompaction() {
        if (urlParams.get('fit') !== '1') return;
        const page = document.querySelector('.page.active');
        if (!page) return;
        const buttons = [...page.children];
        if (buttons.length === 0) return;
        const rowCount = Math.ceil(buttons.length / columns);
        const rows = [];
        for (let r = 0; r < rowCount; r++) {
            const rowButtons = buttons.slice(r * columns, (r + 1) * columns);
            const allEmpty = rowButtons.every(b => b.classList.contains('empty'));
            rows.push(allEmpty ? '0.2fr' : '1fr');
        }
        page.style.gridTemplateRows = rows.join(' ');
    }

    // ---- PFL (preview) mini-player -------------------------------------------
    // Entirely separate, dry audio path — unaffected by the engine migration.
    // One shared preview slot per cartwall instance, independent of the real
    // on-air buttons: hovering a tile reveals a sliding bottom strip
    // (suppressed on tiles too small to fit it — see the ResizeObserver in
    // buildButton) that plays its cart here instead of on the board. Docked
    // to the bottom of this document. Gated entirely by
    // window.SETTINGS.pfl_player/pfl_buttons_carts (manager Routing tab).
    const pflAllowed = () => !!(window.SETTINGS && window.SETTINGS.pfl_player);
    const pflButtonsAllowed = () => pflAllowed() && !!(window.SETTINGS && window.SETTINGS.pfl_buttons_carts);
    let pflState = null; // { cart, btn, audio, timer, tileBtn }
    function pflStop() {
        if (!pflState) return;
        const { btn, audio, timer, tileBtn } = pflState;
        clearInterval(timer);
        try { audio.pause(); } catch (e) {}
        if (btn) btn.classList.remove('active');
        if (tileBtn) tileBtn.classList.remove('pfl-shrunk'); // let the tile relax back to full height
        pflState = null;
        const box = document.getElementById('cartPfl');
        if (box) {
            box.querySelector('.cart-pfl-name').textContent = '-';
            box.querySelector('.cart-pfl-bar > i').style.width = '0%';
            box.querySelector('.cart-pfl-stop').disabled = true;
            box.hidden = true;
        }
    }
    function sendToPFL(cart, btn, tileBtn) {
        if (!pflAllowed()) return;
        if (pflState && pflState.btn === btn) { pflStop(); return; } // same icon again -> unload
        pflStop(); // only one thing plays in PFL at a time
        const box = document.getElementById('cartPfl');
        const audio = new Audio(`uploads/${cart.file}`);
        audio.currentTime = cart.start || 0;
        audio.volume = cart.volume != null ? cart.volume : 1;
        const dur = () => (cart.end != null ? cart.end : (audio.duration || 0)) - (cart.start || 0);
        const finish = () => pflStop();
        audio.addEventListener('ended', finish);
        if (cart.end != null) audio.addEventListener('timeupdate', () => { if (audio.currentTime >= cart.end) finish(); });
        audio.play().catch(finish);
        const timer = setInterval(() => {
            const d = dur();
            const done = Math.max(0, audio.currentTime - (cart.start || 0));
            box.querySelector('.cart-pfl-bar > i').style.width = (d > 0 ? Math.min(100, (done / d) * 100) : 0) + '%';
        }, 100);
        if (box) {
            box.querySelector('.cart-pfl-name').textContent = cart.name;
            box.querySelector('.cart-pfl-stop').disabled = false;
            box.hidden = false;
        }
        btn.classList.add('active');
        // Keeps the tile contracted (and the strip lit/visible) while it's
        // actually the one playing, not just while hovered.
        if (tileBtn) tileBtn.classList.add('pfl-shrunk');
        pflState = { cart, btn, audio, timer, tileBtn };
    }
    document.addEventListener('DOMContentLoaded', () => {
        const stopBtn = document.getElementById('cartPflStop');
        if (stopBtn) stopBtn.addEventListener('click', pflStop);
    });

    const chainedAt = (bn) => specialBoxes.some(box => box.boxNumber === bn && box.flag === 1);
    // Chain-crossfade ms (cross.txt's second field, set by the audio manager's
    // chain editor): how early the NEXT cart launches while this one's tail
    // rings out to its own end point.
    const chainFadeAt = (bn) => {
        const box = specialBoxes.find(b => b.boxNumber === bn && b.flag === 1);
        return box ? Math.max(0, box.seconds || 0) : 0;
    };
    // A PFL-eligible cart is wrapped in a .cart-slot (see buildButton) — the
    // slot, not the button itself, is then the actual grid sibling. Every
    // chain traversal below walks grid-level neighbours (slot-or-bare-button)
    // and drills back into the slot to get the real .button/.buttonext, so
    // chaining works the same whether or not PFL wrapped a given tile.
    const cartButton = (gridChild) => {
        if (!gridChild) return null;
        return gridChild.classList.contains('cart-slot') ? gridChild.querySelector('.button, .buttonext') : gridChild;
    };
    const gridChildOf = (btn) => btn.closest('.cart-slot') || btn;
    const nextCartButton = (btn) => cartButton(gridChildOf(btn).nextElementSibling);
    const prevCartButton = (btn) => cartButton(gridChildOf(btn).previousElementSibling);

    // Tiles stay visually separate (each keeps its own border/name/colour),
    // but a chain plays as one unit: the run's first tile, and every member
    // of the run walked from it via .chain/.chain-end classes.
    const chainStart = (btn) => {
        let s = btn;
        while (!s.classList.contains('chain-start')) {
            const prev = prevCartButton(s);
            if (!prev || !prev.classList.contains('chain')) break;
            s = prev;
        }
        return s;
    };
    const chainMembers = (btn) => {
        const run = [];
        let node = chainStart(btn);
        while (node && node.classList.contains('chain')) {
            run.push(node);
            if (node.classList.contains('chain-end')) break;
            node = nextCartButton(node);
        }
        return run;
    };

    // ---- Playback state, sourced from the engine's broadcasts ------------------
    // cartId -> { playing, remainingSec, fullSec }, refreshed by every 'tick'
    // (see handleTick below) and by this iframe's own optimistic updates when
    // IT sends a play/stop command (so its own clicks feel instant, same as
    // before, rather than waiting on a broadcast round-trip).
    const voiceState = new Map();
    const buttonByCartId = new Map();

    // Applies the exact same visual/logging side effects the old play/pause
    // <audio> event listeners used to — now driven by an explicit playing
    // transition instead. No-ops if the button is already in that state, so
    // repeated ticks while something's playing don't re-log or re-flash.
    function setPlaying(button, playing) {
        if (button.classList.contains('playing') === playing) return;
        button.classList.toggle('playing', playing);
        const duration = button.querySelector('.duration');
        const progress = button.querySelector('.progress');
        if (playing) {
            duration.style.backgroundColor = 'black';
            duration.style.color = 'white';
            duration.style.fontWeight = 'bold';
            duration.style.padding = '0 8px';
            duration.classList.add('active');
            progress.style.display = 'block';
            fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - ${button._cart.name} - played - ${outputLabel()}` });
        } else {
            duration.style.backgroundColor = 'transparent';
            duration.style.color = 'white';
            duration.style.fontWeight = 'normal';
            duration.style.padding = '0';
            duration.classList.remove('active');
            progress.style.width = '0';
            progress.style.display = 'none';
            duration.textContent = fmtTime(fullDuration(button));
            fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - ${button._cart.name} - stopped - ${outputLabel()}` });
        }
    }

    function handleTick(voices) {
        (voices || []).forEach((v) => {
            voiceState.set(v.cartId, v);
            const button = buttonByCartId.get(v.cartId);
            if (!button) return;
            setPlaying(button, v.playing);
            const duration = button.querySelector('.duration');
            if (v.playing) {
                const full = v.fullSec != null ? v.fullSec : fullDuration(button);
                const elapsed = Math.max(0, full - v.remainingSec);
                button.querySelector('.progress').style.width = `${Math.min(100, Math.max(0, (elapsed / Math.max(0.001, full)) * 100))}%`;
                duration.textContent = fmtTime(v.remainingSec);
            } else if (!duration.classList.contains('active')) {
                duration.textContent = fmtTime(v.fullSec != null ? v.fullSec : fullDuration(button));
            }
        });
        refreshBackTimer();
    }
    // Chain crossfade launches EARLY (fade ms before this cart's own end,
    // while its tail keeps ringing) — mirrors the old chainTimer, just
    // triggered by the engine's broadcast instead of a local setTimeout.
    function handleCartLead(cartId) {
        const button = buttonByCartId.get(cartId);
        if (!button || button._chainFired) return;
        button._chainFired = true;
        const nextButton = nextCartButton(button);
        if (nextButton && nextButton.tagName === 'BUTTON') nextButton.click();
    }
    // Hit its trimmed end or natural end — mirrors the old 'ended' listener
    // (chain-advance fallback if the lead event didn't already fire one).
    function handleCartEnded(cartId) {
        const button = buttonByCartId.get(cartId);
        if (!button) return;
        setPlaying(button, false);
        if (button.classList.contains('buttonext') && !button._chainFired) {
            button._chainFired = true;
            const nextButton = nextCartButton(button);
            if (nextButton && nextButton.tagName === 'BUTTON') nextButton.click();
        }
    }
    window.addEventListener('message', (event) => {
        const d = event.data;
        if (!d || d.source !== 'cart-engine-state') return;
        if (d.type === 'tick') handleTick(d.voices);
        else if (d.type === 'cart-lead') handleCartLead(d.cartId);
        else if (d.type === 'cart-ended') handleCartEnded(d.cartId);
    });

    function buildButton(line, pageIndex, index, pageDiv, sectionFrom) {
        const boxNumber = pageIndex * itemsPerPage + index + 1;
        const isChained = chainedAt(boxNumber);
        const chainFadeMs = chainFadeAt(boxNumber);
        const buttonClass = isChained ? 'buttonext' : 'button';

        const [name, audioPath, startPoint, colorCode, endPoint, volumePoint] = line.split('|').map(part => part.trim());
        const startAt = parseFloat(startPoint) || 0;
        const endAt = parseFloat(endPoint) || null;
        const volume = (volumePoint !== undefined && volumePoint !== '') ? parseFloat(volumePoint) : 1;
        const catClass = categoryClass[colorCode] || 'cat-1';

        const button = document.createElement('button');
        button.classList.add(buttonClass);
        button.classList.add('button');
        button.classList.add(catClass);
        button.dataset.box = boxNumber; // 1-based position within this section (used by search to scroll/flash a specific cart)

        const progress = document.createElement('div');
        progress.classList.add('progress');

        const span = document.createElement('span');
        span.classList.add('title');
        span.textContent = name;

        const duration = document.createElement('div');
        duration.classList.add('duration');
        duration.textContent = 'Loading...';

        const audioFilename = audioPath.trim();

        if (audioFilename === '0.mp3') {
            // Empty placeholder slot: dashed, unlabeled tile per the design spec.
            button.disabled = true;
            button.classList.remove(catClass);
            button.classList.add('empty');
            pageDiv.appendChild(button);
            return;
        }

        // Disabled (manager Audio tab): darkened, unclickable, no audio wiring
        // at all — same static-tile treatment as an empty slot, but keeps its
        // name/colour visible so it still reads as "this cart, turned off"
        // rather than "nothing here".
        const absoluteIndex = sectionFrom + boxNumber - 1;
        if (enabledStates[absoluteIndex] === false) {
            button.disabled = true;
            button.classList.add('button-off');
            button.appendChild(span);
            pageDiv.appendChild(button);
            return;
        }

        // Absolute carts.txt line number (1-based) — stable across whichever
        // UI surface renders this cart, unlike boxNumber (section-relative).
        // This is the id the engine and every other iframe correlate on.
        const cartId = sectionFrom + boxNumber;

        // Chained run membership -> one border around the whole block (I).
        // A run is a chained cart, its chained successors, and the terminal cart
        // they play into. Only the run's outer edges get a border (see grid.php).
        const inChainRun = chainedAt(boxNumber) || chainedAt(boxNumber - 1);
        if (inChainRun) {
            button.classList.add('chain');
            if (chainedAt(boxNumber) && !chainedAt(boxNumber - 1)) {
                button.classList.add('chain-start');
            } else if (!chainedAt(boxNumber) && chainedAt(boxNumber - 1)) {
                button.classList.add('chain-end');
            } else {
                button.classList.add('chain-mid');
            }
        }

        // Hover PFL (preview) strip — slides up from the bottom of the tile,
        // only when settings allow it. This is a SIBLING of the button (see
        // the wrapping .cart-slot at the end of this function), never a
        // descendant: a nested control would sit inside the button's own
        // native :active chain, so pressing it would visually depress the
        // whole tile too. A ResizeObserver hides it again on tiles too small
        // to fit it (e.g. the Station-IDs window).
        let pflStrip = null;
        if (pflButtonsAllowed()) {
            pflStrip = document.createElement('div');
            pflStrip.className = 'cart-pfl-strip';
            pflStrip.title = 'Preview (PFL)';
            pflStrip.innerHTML = '<span class="pfl-icon"><i class="ph ph-speaker-simple-high"></i></span>';
            pflStrip.addEventListener('click', (e) => {
                e.stopPropagation();
                sendToPFL({ name, file: audioFilename, start: startAt, end: endAt, volume }, pflStrip, button);
            });
            const MIN_PFL_TILE_H = 110;
            const MIN_PFL_TILE_W = 90;
            const ro = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const { height, width } = entry.contentRect;
                    button.classList.toggle('pfl-eligible', height >= MIN_PFL_TILE_H && width >= MIN_PFL_TILE_W);
                }
            });
            ro.observe(button);
        }

        button._cartId = cartId;
        button._endAt = endAt;       // hard stop point, for the shared countdown
        button._startAt = startAt;   // start point, for chain-total durations
        button._fadeMs = chainFadeMs; // chain-crossfade into the NEXT cart
        // Full cart record, used when right-clicking to send it to automation.
        button._cart = { name, file: audioFilename, start: startAt, end: endAt, color: colorCode, volume };
        buttonByCartId.set(cartId, button);
        primeQueue.push({ cartId, file: audioFilename, start: startAt, end: endAt });

        button.onclick = () => {
            // A chain plays as one unit — tiles stay visually separate, but
            // firing ANY of them (while the run is idle) starts the WHOLE
            // chain from its first item, never a partial chain. Once
            // something in the run is already on air, each tile keeps its
            // normal individual stop/toggle behaviour (unchanged below).
            if (button.classList.contains('chain')) {
                const members = chainMembers(button);
                const anyPlaying = members.some((b) => b.classList.contains('playing'));
                if (!anyPlaying && members[0] !== button) { members[0].click(); return; }
            }

            if (button.classList.contains('playing')) {
                sendToEngine({ cmd: 'stop', cartId });
                setPlaying(button, false);
            } else {
                button._chainFired = false;
                sendToEngine({ cmd: 'play', cartId, file: audioFilename, start: startAt, end: endAt, volume, chainFadeMs });
                setPlaying(button, true);
            }
            refreshBackTimer();
        };

        button.appendChild(progress);
        button.appendChild(span);
        button.appendChild(duration);
        // The PFL strip is a SIBLING of the button, wrapped together in a
        // slot — never a child (see the comment above pflStrip's creation).
        if (pflStrip) {
            const slot = document.createElement('div');
            slot.className = 'cart-slot';
            // The slot, not the button, is the real grid cell now — the
            // negative margin that pulls a chain-mid/chain-end tile flush
            // against its predecessor has to move there too, or it just
            // shifts the button around INSIDE its own (already-flush) slot.
            // A dedicated class, not a copy of chain-mid/chain-end: the
            // button keeps those (chainStart/chainMembers/gatherChain and
            // the border-radius/overlay rules all still key off the button).
            if (button.classList.contains('chain-mid')) slot.classList.add('cart-slot-chain-mid');
            if (button.classList.contains('chain-end')) slot.classList.add('cart-slot-chain-end');
            slot.appendChild(button);
            slot.appendChild(pflStrip);
            pageDiv.appendChild(slot);
        } else {
            pageDiv.appendChild(button);
        }
    }

    // Refresh the shared countdown from EVERYTHING on air. Fixes the old bug
    // where one cart ending hid the countdown while others were still playing:
    // we look at ALL .button.playing and show the longest remaining time, so the
    // countdown stays up until the last cart finishes.
    // Full playable length of a cart (end point minus start point) — prefers
    // the engine's resolved fullSec (accurate even for an untrimmed cart,
    // where only the real audio file's natural length can tell you this);
    // falls back to the cart's own trim metadata if the engine hasn't
    // reported yet (e.g. never primed/played).
    function fullDuration(btn) {
        const rec = voiceState.get(btn._cartId);
        if (rec && rec.fullSec != null) return Math.max(0, rec.fullSec);
        return Math.max(0, (btn._endAt != null ? btn._endAt : 0) - (btn._startAt || 0));
    }
    // Remaining time for a playing cart. For a chained cart the countdown covers
    // the WHOLE chain: this cart's remaining plus the full length of every cart it
    // auto-plays into, up to and including the terminal cart.
    function computeRemaining(btn) {
        const rec = voiceState.get(btn._cartId);
        let total = rec ? Math.max(0, rec.remainingSec) : 0;
        let node = btn;
        while (node && node.classList.contains('buttonext')) {
            // Each hop's crossfade overlaps the join, shortening the chain total.
            const fade = (node._fadeMs || 0) / 1000;
            node = nextCartButton(node);
            if (!node || node.tagName !== 'BUTTON') break;
            total += fullDuration(node) - fade;
        }
        return Math.max(0, total);
    }
    function refreshBackTimer() {
        const backtimer = document.getElementById('backtimer');
        const playing = [...document.querySelectorAll('.button.playing')];
        if (playing.length === 0) {
            if (backtimer) backtimer.classList.remove('show');
            reportState(0, null);
            return;
        }
        let maxRemaining = 0;
        for (const b of playing) maxRemaining = Math.max(maxRemaining, computeRemaining(b));
        const text = fmtTime(maxRemaining);
        // Sub-windows (Station IDs, dock) show their own bottom status bar; the
        // main board reports to the parent, which shows the big bar over the ticker.
        if (backtimer && !isMainBoard) {
            backtimer.textContent = text;
            backtimer.classList.add('show');
        }
        reportState(playing.length, text);
    }

    // Right-click context menu: schedule a cart to fire at the top of the hour.
    function initContextMenu() {
        const contextMenu = document.getElementById('context-menu');
        const playAtButton = document.getElementById('play-at-button');
        const cancelTimersButton = document.getElementById('cancel-timers-button');
        if (!contextMenu || !playAtButton) return;

        let selectedButton = null;
        let timerActiveButton = null;
        const activeTimers = new Map();
        const countdownIntervals = new Map();

        const formatTime = (ms) => {
            const total = Math.floor(ms / 1000);
            return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
        };

        // Cancel every scheduled "play at top of hour" timer at once.
        const cancelAllTimers = () => {
            activeTimers.forEach((t) => clearTimeout(t));
            countdownIntervals.forEach((i) => clearInterval(i));
            activeTimers.clear();
            countdownIntervals.clear();
            timerActiveButton = null;
            document.querySelectorAll('.clock-icon').forEach((el) => el.remove());
        };
        if (cancelTimersButton) {
            cancelTimersButton.addEventListener('click', () => {
                cancelAllTimers();
                contextMenu.style.display = 'none';
            });
        }

        // Right-click a cart -> send it straight to the automation playlist (in
        // the parent shell). Right-clicking any cart of a CHAIN queues the whole
        // chain as one group. Replaces the old "play at top of hour" menu.
        function itemFor(button) {
            const c = button._cart;
            let runtime = c.end != null ? Math.max(0, c.end - (c.start || 0)) : fullDuration(button);
            if (!runtime) {
                const dEl = button.querySelector('.duration');
                if (dEl) { const [m, s] = dEl.textContent.split(':').map(Number); runtime = (m * 60 + s) || 0; }
            }
            return { name: c.name, file: c.file, start: c.start, end: c.end, color: c.color, volume: c.volume, runtime };
        }
        function gatherChain(button) {
            if (!button.classList.contains('chain')) return [button];
            let start = button;
            while (!start.classList.contains('chain-start')) {
                const prev = prevCartButton(start);
                if (!prev || !prev.classList.contains('chain')) break;
                start = prev;
            }
            const run = [];
            let node = start;
            while (node && node.classList.contains('chain')) {
                if (node._cart && !node.classList.contains('empty')) run.push(node);
                if (node.classList.contains('chain-end')) break;
                node = nextCartButton(node);
            }
            return run.length ? run : [button];
        }
        document.addEventListener('contextmenu', (event) => {
            const button = event.target.closest('.button, .buttonext');
            contextMenu.style.display = 'none';
            if (!button || button.classList.contains('empty') || !button._cart) return;
            event.preventDefault();
            const buttons = gatherChain(button);
            const grouped = buttons.length > 1;
            try {
                // Each item carries the chain-crossfade INTO it (stored on the
                // PREVIOUS button's line) so the autoplayer keeps the plan.
                const items = buttons.map((b, k) => ({
                    ...itemFor(b),
                    overlapIn: k > 0 ? (buttons[k - 1]._fadeMs || 0) : 0,
                }));
                window.parent.postMessage({ source: 'cartwall', cmd: 'automation-add', items, grouped }, '*');
            } catch (e) { /* no parent */ }
        });

        playAtButton.addEventListener('click', () => {
            if (!selectedButton || playAtButton.disabled) return;

            const now = new Date();
            const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
            const delay = nextHour - now;

            const timerButton = selectedButton;
            const timer = setTimeout(() => {
                timerButton.click();
                activeTimers.delete(timerButton);
                timerActiveButton = null;
                const icon = timerButton.querySelector('.clock-icon');
                if (icon) icon.style.display = 'none';
            }, delay);

            activeTimers.set(timerButton, timer);
            timerActiveButton = timerButton;

            let clockIcon = timerButton.querySelector('.clock-icon');
            if (!clockIcon) {
                clockIcon = document.createElement('div');
                clockIcon.classList.add('clock-icon');
                clockIcon.style.display = 'flex';
                clockIcon.innerHTML = `
                    <span class="emoji" style="animation: blink 0.5s step-start infinite;">🕒</span>
                    <span class="countdown" style="color: red;">${formatTime(delay)} -</span>`;
                timerButton.appendChild(clockIcon);

                const interval = setInterval(() => {
                    const remaining = nextHour - new Date();
                    if (remaining <= 0) {
                        clearInterval(interval);
                        countdownIntervals.delete(timerButton);
                    } else {
                        clockIcon.querySelector('.countdown').textContent = `${formatTime(remaining)} -`;
                    }
                }, 1000);
                countdownIntervals.set(timerButton, interval);
            }

            contextMenu.style.display = 'none';
        });

        document.addEventListener('click', () => { contextMenu.style.display = 'none'; });
    }

    document.addEventListener('DOMContentLoaded', initContextMenu);
    loadCartwall();
})();
