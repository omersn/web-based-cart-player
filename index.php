<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Player shell. A full-screen background cart wall (grid.php in an iframe) plus
 * a draggable "Station ID" window, a draggable clock, the keep-alive heartbeat,
 * a top toolbar, a status ticker, and QR / credits popups.
 *
 * Visual design: the "studio" dark design system (see
 * design_handoff_cartwall_player/README.md for the original token spec).
 */
require_once __DIR__ . '/auth.php';            // session + is_admin()/is_dj()
require_once __DIR__ . '/includes/helpers.php'; // load_section_labels(), data_path()

header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

ensure_session();

$labels     = load_section_labels();
$statusFile = data_path('status.txt');
$statusText = file_exists($statusFile) ? trim(file_get_contents($statusFile)) : '';

// Split "Demo Radio Station" -> "DEMO RADIO" / "STATION" for the two-line brand mark.
$nameWords = preg_split('/\s+/', trim(STATION_NAME));
$brandSub  = strtoupper(array_pop($nameWords));
$brandMain = strtoupper(implode(' ', $nameWords)) ?: $brandSub;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <title>Cart Player &mdash; <?= htmlspecialchars(STATION_NAME) ?></title>
    <link rel="stylesheet" href="assets/css/player.css">
</head>
<body>

    <!-- Top bar -->
    <nav class="topbar">
        <div class="topbar-identity">
            <div class="topbar-brand" id="responsiveDiv">
                <i class="ph-fill ph-broadcast"></i>
                <div class="wordmark">
                    <div class="line1"><?= htmlspecialchars($brandMain) ?></div>
                    <div class="line2"><?= htmlspecialchars($brandSub) ?></div>
                </div>
            </div>
            <div class="topbar-select-wrap">
                <select id="section-select" class="topbar-select">
                    <option value="grid.php?from=10&to=35&pagination=0"><?= htmlspecialchars($labels[0]) ?></option>
                    <option value="grid.php?from=35&to=60&pagination=0"><?= htmlspecialchars($labels[1]) ?></option>
                    <option value="grid.php?from=60&to=85&pagination=0"><?= htmlspecialchars($labels[2]) ?></option>
                    <option value="grid.php?from=85&to=110&pagination=0"><?= htmlspecialchars($labels[3]) ?></option>
                    <option value="grid.php?from=120&to=145&pagination=0"><?= htmlspecialchars($labels[4]) ?></option>
                    <option value="grid.php?from=145&to=170&pagination=0"><?= htmlspecialchars($labels[5]) ?></option>
                    <option value="grid.php?from=170&to=195&pagination=0"><?= htmlspecialchars($labels[6]) ?></option>
                    <option value="grid.php?from=195&to=220&pagination=0"><?= htmlspecialchars($labels[7]) ?></option>
                    <option value="grid.php?from=220&to=245&pagination=0"><?= htmlspecialchars($labels[8]) ?></option>
                    <option value="grid.php?from=245&to=270&pagination=0"><?= htmlspecialchars($labels[9]) ?></option>
                </select>
                <i class="ph ph-caret-down"></i>
            </div>
        </div>

        <span class="topbar-divider"></span>

        <div class="topbar-search-zone">
            <form id="searchForm" class="topbar-search">
                <i class="ph ph-magnifying-glass"></i>
                <input type="text" id="searchInput" placeholder="Search jingle&hellip;" autocomplete="off">
                <kbd>&#8984;K</kbd>
                <button type="submit" title="Search"></button>
            </form>
        </div>

        <span class="topbar-divider"></span>

        <div class="topbar-end">
            <div class="icon-cluster">
                <button type="button" class="icon-btn" id="chip-ids" onclick="toggleIdsWindow();" title="Station IDs">
                    <i class="ph ph-radio"></i><span class="status-dot amber"></span>
                </button>
                <a class="icon-btn" id="chip-download" href="download.php" title="Download">
                    <i class="ph ph-download-simple"></i>
                </a>
                <button type="button" class="icon-btn" id="qr-chip" onclick="showQR();" title="Mobile access">
                    <i class="ph ph-device-mobile"></i>
                </button>
                <button type="button" class="icon-btn" id="chip-clock" onclick="toggleClockWindow();" title="Clock">
                    <i class="ph ph-clock"></i><span class="status-dot red"></span>
                </button>
                <button type="button" class="icon-btn" id="chip-credits" onclick="showCredits();" title="Credits">
                    <i class="ph ph-info"></i>
                </button>
            </div>

            <div class="transport-cluster">
                <span class="status-pill" id="connectionPill"><span class="pulse-dot"></span><span id="connectionLabel">CONNECTED</span></span>
                <button type="button" class="btn-stop" onclick="stopAll();"><i class="ph-fill ph-stop"></i>Stop all</button>
                <span class="clock-anchor" id="clockAnchor" onclick="toggleClockWindow();" title="Open clock">
                    <span class="hm" id="clockHm">00:00</span><span class="sec" id="clockSec">:00</span>
                </span>
                <a class="btn-admin" href="admin.php"><i class="ph ph-gear"></i>Admin</a>
            </div>
        </div>
    </nav>

    <!-- Draggable clock window -->
    <div class="floating-container-0002" id="floatingDiv2">
        <div class="title-bar-0002" id="titleBar2">
            <div class="window-select-wrap">
                <select id="clock-select" class="window-select">
                    <option value="clock.php">Clock</option>
                    <option value="clock-progress.php">Time to end of hour</option>
                    <option value="clock-both.php">Clock + countdown</option>
                </select>
                <i class="ph ph-caret-down"></i>
            </div>
            <div class="window-controls">
                <button class="window-minimize" onclick="toggleMinimize('floatingDiv2')" title="Minimize">&minus;</button>
                <button class="window-dot" onclick="closeFloatingDiv2()" title="Close"></button>
            </div>
        </div>
        <div class="iframe-content-0002">
            <iframe id="floater2" src="clock.php" scrolling="no" style="width: 100%; height: 100%; border: none;"></iframe>
        </div>
    </div>

    <!-- Draggable "Station ID" window -->
    <div class="floating-container-0001" id="floatingDiv">
        <div class="title-bar-0001" id="titleBar">
            <div class="window-select-wrap">
                <select id="ids-select" class="window-select">
                    <option value="grid.php?from=0&to=10&pagination=0&smalltext=15&smallbacktimer=1&btnh=76">Station IDs</option>
                    <option value="grid.php?from=110&to=120&pagination=0&smalltext=15&smallbacktimer=1&btnh=76">Sweepers &amp; Effects</option>
                </select>
                <i class="ph ph-caret-down"></i>
            </div>
            <div class="window-controls">
                <button class="window-minimize" onclick="toggleMinimize('floatingDiv')" title="Minimize">&minus;</button>
                <button class="window-dot" onclick="closeFloatingDiv()" title="Close"></button>
            </div>
        </div>
        <div class="iframe-content-0001">
            <iframe id="floater" src="grid.php?from=0&to=10&pagination=0&smalltext=15&smallbacktimer=1&btnh=76" scrolling="no" style="width: 100%; height: 100%; border: none;"></iframe>
        </div>
    </div>

    <!-- Keep-alive heartbeat (tiny indicator, bottom-right; also drives the Connected/Standby pill) -->
    <iframe id="keepAliveFrame" src="keep-alive.php" frameborder="0" scrolling="no"
            style="position: fixed; bottom: 54px; right: 10px; width: 10px; height: 10px; z-index: 9900; clip-path: circle(40%); opacity: 0.35;"></iframe>

    <!-- Main content area: flexes to fill the space between the topbar and the
         ticker (both normal flow now, not position:fixed — see player.css). -->
    <div class="main-content">
        <iframe width="100%" height="100%" id="cartgrid" name="cartgrid"
                src="grid.php?from=10&to=75&pagination=0&timestamp=<?= time() ?>"
                frameborder="0" scrolling="no" allowfullscreen></iframe>
    </div>

    <!-- AGPL: offer the Corresponding Source to network users (section 13). -->
    <a href="<?= htmlspecialchars(SOURCE_URL) ?>" target="_blank" rel="noopener"
       style="position: fixed; bottom: 52px; left: 9px; z-index: 1002110; font-size: 10px; color: #5a6b75; text-decoration: none;">
        Source (<?= htmlspecialchars(LICENSE_NAME) ?>)
    </a>

    <!-- Loading overlay -->
    <div class="overlay" id="loadingOverlay">
        <div class="message">Loading</div>
        <div class="progress-bar"><div class="progress" id="progressBar"></div></div>
    </div>

    <!-- Ticker -->
    <div class="statuses-bar">
        <?php if (is_admin() || is_dj()): ?>
            <span class="ticker-chip">
                <span class="avatar"><i class="ph-fill ph-user"></i></span>
                <?= is_admin() ? 'Admin' : 'DJ' ?>
                <a class="logout-link" href="logout.php">Log out</a>
            </span>
        <?php else: ?>
            <a class="ticker-chip" href="login.php">
                <span class="avatar"><i class="ph-fill ph-user"></i></span>
                Sign in
            </a>
        <?php endif; ?>
        <span><?= $statusText !== '' ? htmlspecialchars($statusText, ENT_QUOTES, 'UTF-8') : 'Welcome to the Web-based Cart Player demo &mdash; right-click a cart to schedule it for the top of the hour.' ?></span>
    </div>

    <script>
        // --- Loading overlay + first-load preload kick.
        // The audio preload hack doesn't reliably prime the carts on the very
        // first grid load. Flipping each grid to another section and back —
        // behind the loading overlay — forces a reload that primes every cart.
        // (Restores the original production trick of "switch page and come back".)
        (() => {
            const overlay = document.getElementById('loadingOverlay');
            const progressBar = document.getElementById('progressBar');
            const grid = document.getElementById('cartgrid');
            const floater = document.getElementById('floater');
            const gridSrc = grid.src;
            const floaterSrc = floater.src;

            let progress = 0;
            const interval = setInterval(() => {
                progress += 12;
                progressBar.style.width = `${Math.min(progress, 100)}%`;
                if (progress >= 100) clearInterval(interval);
            }, 280);

            // Switch the grids away…
            setTimeout(() => {
                grid.src = 'grid.php?from=35&to=60&pagination=0&timestamp=' + Date.now();
                floater.src = 'grid.php?from=110&to=120&pagination=0&smalltext=15&smallbacktimer=1&btnh=76&timestamp=' + Date.now();
            }, 800);
            // …and back to the original views, which primes their carts.
            setTimeout(() => { grid.src = gridSrc; floater.src = floaterSrc; }, 1900);
            // Reveal once the kick has completed.
            setTimeout(() => { overlay.style.display = 'none'; }, 2900);
        })();

        // --- Live topbar clock (mono HH:MM + dim :SS), always LTR.
        (() => {
            const hm = document.getElementById('clockHm');
            const sec = document.getElementById('clockSec');
            const tick = () => {
                const now = new Date();
                hm.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                sec.textContent = `:${String(now.getSeconds()).padStart(2, '0')}`;
            };
            tick();
            setInterval(tick, 1000);
        })();

        // --- Connected/Standby pill, driven by the keep-alive iframe's heartbeat.
        // keep-alive.js posts its online/offline state up to us via postMessage.
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.source !== 'keep-alive') return;
            const pill = document.getElementById('connectionPill');
            const label = document.getElementById('connectionLabel');
            if (event.data.status === 'online') {
                pill.classList.remove('standby');
                label.textContent = 'CONNECTED';
            } else {
                pill.classList.add('standby');
                label.textContent = 'STANDBY';
            }
        });

        // --- iframe section selectors.
        document.getElementById('section-select').addEventListener('change', (e) => {
            document.getElementById('cartgrid').src = e.target.value;
        });
        document.getElementById('ids-select').addEventListener('change', (e) => {
            document.getElementById('floater').src = e.target.value;
        });
        document.getElementById('clock-select').addEventListener('change', (e) => {
            const floatingContainer = document.querySelector('.floating-container-0002');
            document.getElementById('floater2').src = e.target.value;
            const sizes = [[300, 300], [420, 300], [420, 420]];
            const [w, h] = sizes[e.target.selectedIndex] || sizes[0];
            floatingContainer.style.width = `${w}px`;
            floatingContainer.style.height = `${h}px`;
        });

        // --- Search: open matching carts in the shared popup overlay. ⌘K / Ctrl+K focuses it.
        document.getElementById('searchForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const term = document.getElementById('searchInput').value.trim();
            if (!term) return;
            showPopup((c) => {
                const frame = document.createElement('iframe');
                frame.src = `search.php?search=${encodeURIComponent(term)}`;
                frame.width = 640;
                frame.height = 460;
                frame.style.cssText = 'border:2px solid gray; border-radius:6px; background:#000;';
                c.appendChild(frame);
            });
        });
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                document.getElementById('searchInput').focus();
            }
        });

        // --- Toolbar actions.
        function stopAll() {
            ['cartgrid', 'floater'].forEach(id => {
                const iframe = document.getElementById(id);
                if (iframe) iframe.src = iframe.src;
            });
        }
        function toggleIdsWindow() { toggleDisplay('.floating-container-0001', 'chip-ids'); }
        function toggleClockWindow() { toggleDisplay('.floating-container-0002', 'chip-clock'); }
        function closeFloatingDiv() { document.querySelector('.floating-container-0001').style.display = 'none'; document.getElementById('chip-ids').classList.remove('is-active'); }
        function closeFloatingDiv2() { document.querySelector('.floating-container-0002').style.display = 'none'; document.getElementById('chip-clock').classList.remove('is-active'); }
        function toggleMinimize(containerId) {
            document.getElementById(containerId).classList.toggle('minimized');
        }
        function toggleDisplay(selector, iconId) {
            const el = document.querySelector(selector);
            if (!el) return;
            const hidden = window.getComputedStyle(el).display === 'none';
            el.style.display = hidden ? 'block' : 'none';
            const icon = iconId && document.getElementById(iconId);
            if (icon) icon.classList.toggle('is-active', hidden);
        }

        // --- Make the two floating windows draggable by their title bars.
        // A transparent full-screen overlay is shown only while dragging; it sits
        // above the iframes so fast mouse moves keep firing on the parent document
        // instead of being swallowed by an iframe. The title bar's look is unchanged.
        const dragOverlay = document.createElement('div');
        dragOverlay.className = 'drag-overlay';
        document.body.appendChild(dragOverlay);

        function makeDraggable(containerSelector, titleSelector) {
            const container = document.querySelector(containerSelector);
            const title = document.querySelector(titleSelector);
            if (!container || !title) return;
            let offsetX = 0, offsetY = 0;

            const onMove = (e) => {
                container.style.left = `${e.clientX - offsetX}px`;
                container.style.top = `${e.clientY - offsetY}px`;
            };
            const stop = () => {
                dragOverlay.classList.remove('active');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', stop);
            };
            title.addEventListener('mousedown', (e) => {
                // Don't start a drag when interacting with the title-bar controls
                // (the section/clock dropdown and the close/minimize buttons).
                if (e.target.closest('select, option, button')) return;
                e.preventDefault();
                offsetX = e.clientX - container.offsetLeft;
                offsetY = e.clientY - container.offsetTop;
                dragOverlay.classList.add('active');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', stop);
            });
        }
        makeDraggable('.floating-container-0001', '.title-bar-0001');
        makeDraggable('.floating-container-0002', '.title-bar-0002');
        // The page is non-scrollable vertically; keep it pinned to the top so the
        // toolbar stays reachable. (CSS already positions the floating windows on-screen.)
        window.scrollTo(0, 0);
        window.addEventListener('resize', () => window.scrollTo(0, 0));

        // --- QR + credits popups.
        function showPopup(buildInner) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.8); display:flex; justify-content:center; align-items:center; z-index:9000;';
            const container = document.createElement('div');
            container.style.cssText = 'position:relative; text-align:center;';
            const close = document.createElement('button');
            close.textContent = 'X';
            close.style.cssText = 'position:absolute; top:-20px; right:-20px; padding:10px 15px; color:#fff; background:red; border:none; cursor:pointer; border-radius:50%;';
            close.onclick = () => document.body.removeChild(overlay);
            buildInner(container);
            container.appendChild(close);
            overlay.appendChild(container);
            document.body.appendChild(overlay);
        }
        function showQR() {
            showPopup((c) => {
                const img = document.createElement('img');
                img.src = 'assets/img/qr.png';
                img.alt = 'QR code';
                img.style.cssText = 'max-width:300px; max-height:300px; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.5);';
                c.appendChild(img);
            });
        }
        function showCredits() {
            showPopup((c) => {
                const frame = document.createElement('iframe');
                frame.src = `credits.php?t=${Date.now()}`;
                frame.width = 700;
                frame.height = 600;
                frame.style.cssText = 'border:none; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.5);';
                c.appendChild(frame);
            });
        }
    </script>
</body>
</html>
