// License: PolyForm-Strict-1.0.0 (see LICENSE)
/*
 * Cart wall — load mechanism & playback
 * =====================================
 * This is the heart of the player. It reads the cart list, builds the grid of
 * buttons, and works around a handful of browser audio quirks so that the very
 * first click on a freshly loaded jingle plays instantly and cleanly.
 *
 * The "preload hack" (see preloadHack below)
 * ------------------------------------------
 * <audio> elements do not actually decode/buffer their data until something
 * forces them to. The first play() therefore often has audible latency or a
 * clipped attack — fatal for on-air jingles. To prime each clip we play it once
 * muted (volume 0) and immediately pause it, at a small staggered delay so the
 * browser is not asked to decode 25 files at the same instant. If a clip is not
 * ready yet we retry a few times with a growing delay. After this priming pass,
 * the first real click is instant.
 *
 * Other pieces:
 *  - A "PLAYING" pulsing tag + a 2-bar VU indicator on the now-playing cart.
 *    The VU is audio-reactive: each cart taps a shared AudioContext through its
 *    own AnalyserNode and the two bars follow the real signal level. Using a
 *    single shared context (created once, lazily) avoids the per-context cap a
 *    browser enforces once more than a handful of carts are on a page.
 *  - Chaining (data/cross.txt): a "chained" button auto-clicks the next one when
 *    it finishes, so several carts play back-to-back as one sequence.
 *  - A large "back-timer" overlay shows the remaining time of the current item
 *    (or the whole chained sequence).
 *  - Right-click a cart to schedule it to fire at the top of the next hour.
 *  - Every play/stop is POSTed back to the page for the playback log.
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
    // Clear our contribution before the frame is torn down / reloaded, so a
    // reload mid-playback (e.g. Stop all) doesn't leave a stale lock/countdown.
    window.addEventListener('pagehide', () => reportState(0, null));

    // The main board reports its countdown to the parent (the big bar over the
    // ticker); sub-windows (Station IDs, dock) show their own internal bar.
    const isMainBoard = urlParams.get('mainbar') === '1';

    // One AudioContext shared by every cart. Created lazily on first use so we
    // don't spin one up before there's any audio, and so a single context backs
    // all the per-cart AnalyserNodes that feed the VU meters (see buildButton).
    let sharedAudioContext = null;
    const getAudioContext = () => {
        if (!sharedAudioContext) {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return sharedAudioContext;
    };

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

            for (let i = 0; i < totalPages; i++) {
                const pageDiv = document.createElement('div');
                pageDiv.classList.add('page');
                if (i === 0) pageDiv.classList.add('active');

                filteredCartLines.slice(i * itemsPerPage, (i + 1) * itemsPerPage).forEach((line, index) => {
                    // Stagger button creation slightly to spread out audio decoding.
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

            // Buttons are appended on a small stagger; compact empty rows once
            // they're all in place.
            setTimeout(applyRowCompaction, itemsPerPage * 25 + 120);
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

        // Disabled (manager Audio tab): darkened, unclickable, no audio/VU
        // wiring at all — same static-tile treatment as an empty slot, but
        // keeps its name/colour visible so it still reads as "this cart,
        // turned off" rather than "nothing here".
        const absoluteIndex = sectionFrom + boxNumber - 1;
        if (enabledStates[absoluteIndex] === false) {
            button.disabled = true;
            button.classList.add('button-off');
            button.appendChild(span);
            pageDiv.appendChild(button);
            return;
        }

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

        const audio = new Audio(`uploads/${audioFilename}`);
        button._audio = audio;
        button._endAt = endAt;       // hard stop point, for the shared countdown
        button._startAt = startAt;   // start point, for chain-total durations
        button._fadeMs = chainFadeMs; // chain-crossfade into the NEXT cart
        // Full cart record, used when right-clicking to send it to automation.
        button._cart = { name, file: audioFilename, start: startAt, end: endAt, color: colorCode, volume };

        // --- The preload hack: prime each clip so its first real play is instant.
        audio.addEventListener('canplaythrough', () => {
            if (audio._preloadCompleted) return;

            let attempts = 0;
            const maxAttempts = 5;

            const preloadHack = async () => {
                try {
                    if (audioContext.state === 'suspended') {
                        await audioContext.resume();
                    }

                    audio.currentTime = startAt;
                    audio.volume = 0; // muted while priming

                    let playbackStarted = false;
                    const onPlaying = () => {
                        playbackStarted = true;
                        audio.removeEventListener('playing', onPlaying);
                    };
                    audio.addEventListener('playing', onPlaying);

                    await audio.play();

                    setTimeout(() => {
                        if (!playbackStarted) {
                            // Did not actually start — reset and retry with a growing delay.
                            audio.currentTime = 0;
                            audio._preloadCompleted = false;
                            attempts++;
                            if (attempts < maxAttempts) {
                                setTimeout(preloadHack, 10 * attempts);
                            } else {
                                logToPanel(`[WARN] Skipped '${name}' after ${maxAttempts} attempts.`);
                            }
                            return;
                        }
                        if (audio.paused) return;

                        audio.pause();
                        audio.currentTime = startAt;
                        audio._preloadCompleted = true;
                        logToPanel(`[INFO] Successfully primed '${name}'`);
                        audio.volume = 1.0;
                    }, 100);
                } catch (error) {
                    if (attempts < maxAttempts) {
                        attempts++;
                        setTimeout(preloadHack, 10 * attempts);
                    } else {
                        logToPanel(`[ERROR] Priming failed for '${name}': ${error.message}`);
                    }
                }
            };

            setTimeout(preloadHack, index * 25); // staggered per button
        });

        audio.addEventListener('error', (e) => console.error(`[ERROR] Failed to load audio '${audioFilename}':`, e));
        audio.load();
        logToPanel(`[INFO] Audio file '${audioFilename}' loaded: ${name}`);

        // The shared AudioContext nudges the preload hack past the autoplay gate
        // AND feeds this cart's VU meter. Route the clip through an AnalyserNode
        // so the two bars can follow the real signal level while it plays.
        const audioContext = getAudioContext();
        let analyser = null;
        let vuData = null;
        try {
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.75;
            vuData = new Uint8Array(analyser.frequencyBinCount);
            const mediaSource = audioContext.createMediaElementSource(audio);
            mediaSource.connect(analyser);
            analyser.connect(audioContext.destination);
        } catch (error) {
            // Metering is best-effort; playback still works without it.
            console.warn(`VU meter unavailable for '${name}': ${error.message}`);
        }

        const vu = document.createElement('div');
        vu.classList.add('vu');
        vu.innerHTML = '<span></span><span></span>';
        const vuBars = vu.querySelectorAll('span');

        // Drive both bars from the same overall level so they share a scale:
        // bar 1 follows the signal instantly, bar 2 is a smoothed trailing copy.
        // (A raw low/high-band split looked lopsided — bass always dwarfs treble.)
        let vuRaf = null;
        let vuAvg = 0;
        const driveVu = () => {
            if (!analyser) return;
            analyser.getByteFrequencyData(vuData);
            let sum = 0;
            for (let i = 0; i < vuData.length; i++) sum += vuData[i];
            const level = sum / vuData.length / 255;   // overall loudness, 0..1
            vuAvg = vuAvg * 0.72 + level * 0.28;        // smoothed trailing level
            const h = (v) => `${Math.max(10, Math.min(100, v * 165))}%`;
            vuBars[0].style.height = h(level);
            vuBars[1].style.height = h(vuAvg);
            vuRaf = requestAnimationFrame(driveVu);
        };
        const stopVu = () => {
            if (vuRaf) { cancelAnimationFrame(vuRaf); vuRaf = null; }
            vuAvg = 0;
            vuBars[0].style.height = '10%';
            vuBars[1].style.height = '10%';
        };

        // The cart's own trimmed span — endAt falls back to the file's natural
        // end once metadata is known. Progress and the countdown both measure
        // against THIS span, not the raw file duration, so a trimmed cart's
        // bar reaches 100% (and its readout hits 0:00) exactly at its own end
        // point rather than the untrimmed tail of the audio file.
        let effectiveEnd = endAt;
        audio.addEventListener('loadedmetadata', () => {
            if (effectiveEnd == null) effectiveEnd = audio.duration;
            const trimmed = effectiveEnd - startAt;
            duration.textContent = `${Math.floor(trimmed / 60)}:${Math.floor(trimmed % 60).toString().padStart(2, '0')}`;
        });

        // One timeupdate listener per cart (not one added on every play). Updates
        // this cart's own readout + progress, then refreshes the SHARED countdown,
        // which reflects whatever is on air — not just this cart.
        audio.addEventListener('timeupdate', () => {
            if (audio.paused) return;
            const end = effectiveEnd != null ? effectiveEnd : audio.duration;
            const span = Math.max(0.001, end - startAt);
            const remainingTime = Math.max(0, end - audio.currentTime);
            progress.style.width = `${Math.min(100, Math.max(0, ((audio.currentTime - startAt) / span) * 100))}%`;
            const minutes = Math.floor(remainingTime / 60);
            const seconds = Math.floor(remainingTime % 60).toString().padStart(2, '0');
            duration.textContent = `${minutes}:${seconds}`;
            duration.classList.add('active');
            refreshBackTimer();
        });

        audio.addEventListener('play', () => {
            duration.style.backgroundColor = 'black';
            duration.style.color = 'white';
            duration.style.fontWeight = 'bold';
            duration.style.padding = '0 8px';
            audioContext.resume();
            driveVu();
            progress.style.display = 'block';
            refreshBackTimer();
            fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - ${name} - played - ${outputLabel()}` });
        });

        audio.addEventListener('pause', () => {
            stopVu();
            duration.style.backgroundColor = 'transparent';
            duration.style.color = 'white';
            duration.style.fontWeight = 'normal';
            duration.style.padding = '0';
            audio.currentTime = startAt;
            progress.style.width = '0';
            progress.style.display = 'none';
            const end = effectiveEnd != null ? effectiveEnd : audio.duration;
            const trimmed = end - startAt;
            duration.textContent = `${Math.floor(trimmed / 60)}:${Math.floor(trimmed % 60).toString().padStart(2, '0')}`;
            duration.classList.remove('active');
            refreshBackTimer();
            fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - ${name} - stopped - ${outputLabel()}` });
        });

        // Fire the chained successor exactly once per play — with a crossfade
        // the launch happens EARLY (fade ms before this cart's end, while its
        // tail keeps ringing), so both the hard-stop timer and the 'ended'
        // listener must know the handover already happened.
        const clickNext = () => {
            const nextButton = nextCartButton(button);
            if (nextButton && nextButton.tagName === 'BUTTON') nextButton.click();
        };
        audio.addEventListener('ended', () => {
            stopVu();
            button.classList.remove('playing');
            progress.style.width = '0';
            progress.style.display = 'none';
            const end = effectiveEnd != null ? effectiveEnd : audio.duration;
            const trimmed = end - startAt;
            duration.textContent = `${Math.floor(trimmed / 60)}:${Math.floor(trimmed % 60).toString().padStart(2, '0')}`;
            duration.classList.remove('active');

            // Chain: auto-play the next button (which adds its own .playing before
            // we refresh, so the countdown carries straight over without a blink).
            if (button.classList.contains('buttonext') && !button._chainFired) clickNext();
            refreshBackTimer();
        });

        let playbackTimer = null;
        let chainTimer = null;
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

            const playDuration = endAt - startAt;

            if (audio.paused) {
                audio.currentTime = startAt;
                audio.play();
                button.classList.add('playing');
                button._chainFired = false;

                if (playbackTimer) clearTimeout(playbackTimer);
                if (chainTimer) clearTimeout(chainTimer);

                // Crossfade: launch the next cart fade-ms early; this one keeps
                // playing its tail until its own hard stop below.
                if (button.classList.contains('buttonext') && chainFadeMs > 0) {
                    chainTimer = setTimeout(() => {
                        button._chainFired = true;
                        clickNext();
                    }, Math.max(0, playDuration * 1000 - chainFadeMs));
                }
                // Hard stop at the end point, then chain if it didn't already.
                playbackTimer = setTimeout(() => {
                    audio.pause();
                    button.classList.remove('playing');
                    if (button.classList.contains('buttonext') && !button._chainFired) clickNext();
                }, playDuration * 1000);
            } else {
                audio.pause();
                button.classList.remove('playing');
                if (playbackTimer) {
                    clearTimeout(playbackTimer);
                    playbackTimer = null;
                }
                if (chainTimer) {
                    clearTimeout(chainTimer);
                    chainTimer = null;
                }
            }
        };

        button.appendChild(progress);
        button.appendChild(vu);
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
    // Full playable length of a cart (end point minus start point).
    function fullDuration(btn) {
        const a = btn._audio;
        if (!a) return 0;
        const end = (btn._endAt != null ? btn._endAt : a.duration) || 0;
        return Math.max(0, end - (btn._startAt || 0));
    }
    // Remaining time for a playing cart. For a chained cart the countdown covers
    // the WHOLE chain: this cart's remaining plus the full length of every cart it
    // auto-plays into, up to and including the terminal cart.
    function computeRemaining(btn) {
        const a = btn._audio;
        if (!a) return 0;
        const end = (btn._endAt != null ? btn._endAt : a.duration) || 0;
        let total = Math.max(0, end - a.currentTime);
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
        const mm = Math.floor(maxRemaining / 60);
        const ss = Math.floor(maxRemaining % 60).toString().padStart(2, '0');
        const text = `${mm}:${ss}`;
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
            const a = button._audio;
            const c = button._cart;
            const end = (c.end != null ? c.end : (a ? a.duration : 0)) || 0;
            let runtime = Math.max(0, end - (c.start || 0));
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
