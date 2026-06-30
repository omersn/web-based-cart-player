<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Player shell. A full-screen background cart wall (grid.php in an iframe) plus
 * a draggable "Station ID" window, a draggable clock, the keep-alive heartbeat,
 * a top toolbar, a status ticker, and QR / credits popups.
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

    <?php if (is_admin()): ?>
        <div class="statusbar">Logged in as admin <a href="logout.php">(log out)</a></div>
    <?php elseif (is_dj()): ?>
        <div class="statusbar">Logged in as DJ <a href="logout.php">(log out)</a></div>
    <?php endif; ?>

    <!-- Draggable clock window -->
    <div class="floating-container-0002" id="floatingDiv2">
        <div class="title-bar-0002" id="titleBar2">
            <span>
                <select id="clock-select" style="width: 150px; border-radius: 5px; border: 1px solid lightgray; text-align: center;">
                    <option value="clock.php">Clock</option>
                    <option value="clock-progress.php">Time to end of hour</option>
                    <option value="clock-both.php">Clock + countdown</option>
                </select>
            </span>
            <button class="close-button-0002" onclick="closeFloatingDiv2()"></button>
        </div>
        <div class="iframe-content-0002" style="zoom: 58%;">
            <iframe id="floater2" src="clock.php" scrolling="no" style="width: 100%; height: 100%; border: none;"></iframe>
        </div>
    </div>

    <!-- Draggable "Station ID" window -->
    <div class="floating-container-0001" id="floatingDiv">
        <div class="title-bar-0001" id="titleBar">
            <span>
                <select id="ids-select" style="width: 120px; border-radius: 5px; border: 1px solid lightgray; text-align: center;">
                    <option value="grid.php?from=0&to=10&pagination=0&smalltext=23&smallbacktimer=1&btnh=90">Station IDs</option>
                    <option value="grid.php?from=110&to=120&pagination=0&smalltext=23&smallbacktimer=1&btnh=90">Sweepers &amp; Effects</option>
                </select>
            </span>
            <span>
                <button class="close-button-1001" onclick="toggleSize()" id="toggleSizeButton"></button>
                <button class="close-button-0001" onclick="closeFloatingDiv()"></button>
            </span>
        </div>
        <div class="iframe-content-0001" style="zoom: 58%;">
            <iframe id="floater" src="grid.php?from=0&to=10&pagination=0&smalltext=23&smallbacktimer=1&btnh=90" scrolling="no" style="width: 100%; height: 100%; border: none;"></iframe>
        </div>
    </div>

    <!-- Keep-alive heartbeat (tiny indicator, bottom-right) -->
    <iframe src="keep-alive.php" frameborder="0" scrolling="no"
            style="position: fixed; bottom: 7px; right: 10px; width: 10px; height: 10px; z-index: 9900; clip-path: circle(40%);"></iframe>

    <!-- Main cart wall -->
    <iframe style="padding-top: 45px;" width="100%" height="100%" id="cartgrid" name="cartgrid"
            src="grid.php?from=10&to=75&pagination=0&timestamp=<?= time() ?>"
            frameborder="0" scrolling="no" allowfullscreen></iframe>

    <!-- Toolbar. Optional chips carry ids and are hidden in priority order on
         narrow screens (see the media queries in player.css). -->
    <div class="toolbar-chip" style="right: 6px; width: 60px;"><a href="admin.php">Admin</a></div>
    <div class="toolbar-chip" id="chip-credits" style="right: 75px; width: 90px;"><a href="#" onclick="showCredits(); return false;">Credits</a></div>
    <div class="toolbar-chip" id="qr-chip" style="right: 170px; width: 110px;"><a href="#" onclick="showQR(); return false;">Mobile access</a></div>
    <div class="toolbar-chip" id="chip-clock" style="right: 285px; width: 140px;"><a href="#" onclick="toggleClockWindow(); return false;">Clock window</a></div>
    <div class="toolbar-chip" style="right: 430px; width: 150px;"><a href="#" onclick="toggleIdsWindow(); return false;">Station ID window <span style="color:orange;">█</span></a></div>
    <div class="toolbar-chip" style="right: 585px; width: 90px;"><a href="#" onclick="stopAll(); return false;">Stop all 🛑</a></div>
    <div class="toolbar-chip" id="chip-download" style="right: 680px; width: 130px;"><a href="download.php">Download clip 💾</a></div>

    <!-- Search -->
    <form id="searchForm" class="toolbar-chip" style="right: 945px; width: 165px; padding: 0 4px; display: flex; align-items: center; gap: 2px;">
        <input type="text" id="searchInput" placeholder="Search jingle…" autocomplete="off"
               style="width: 130px; border: none; background: transparent; font-size: 13px; outline: none;">
        <button type="submit" style="background: transparent; border: none; cursor: pointer;">🔍</button>
    </form>

    <!-- Section selector for the main grid -->
    <div style="position: absolute; top: 8px; right: 815px; z-index: 2000;">
        <select id="section-select" style="width: 120px; height: 23px; border-radius: 5px; border: 1px solid lightgray; text-align: center;">
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
    </div>

    <!-- Logo -->
    <div style="z-index: 1002110; position: absolute; top: 9px; left: 9px;" id="responsiveDiv">
        <img src="assets/img/logo.svg" height="30" alt="<?= htmlspecialchars(STATION_NAME) ?>">
    </div>

    <!-- AGPL: offer the Corresponding Source to network users (section 13). -->
    <a href="<?= htmlspecialchars(SOURCE_URL) ?>" target="_blank" rel="noopener"
       style="position: fixed; top: 40px; left: 9px; z-index: 1002110; font-size: 10px; color: #5a6b75; text-decoration: none;">
        Source (<?= htmlspecialchars(LICENSE_NAME) ?>)
    </a>

    <!-- Loading overlay -->
    <div class="overlay" id="loadingOverlay">
        <div class="message">Loading</div>
        <div class="progress-bar"><div class="progress" id="progressBar"></div></div>
    </div>

    <!-- Status ticker -->
    <div class="statuses-bar" <?= $statusText === '' ? 'style="display:none;"' : '' ?>>
        <?= htmlspecialchars($statusText, ENT_QUOTES, 'UTF-8') ?>
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
                floater.src = 'grid.php?from=110&to=120&pagination=0&smalltext=23&smallbacktimer=1&btnh=90&timestamp=' + Date.now();
            }, 800);
            // …and back to the original views, which primes their carts.
            setTimeout(() => { grid.src = gridSrc; floater.src = floaterSrc; }, 1900);
            // Reveal once the kick has completed.
            setTimeout(() => { overlay.style.display = 'none'; }, 2900);
        })();

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
            const sizes = [[310, 310], [450, 310], [450, 450]];
            const [w, h] = sizes[e.target.selectedIndex] || sizes[0];
            floatingContainer.style.width = `${w}px`;
            floatingContainer.style.height = `${h}px`;
        });

        // --- Search: open matching carts in the shared popup overlay.
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

        // --- Toolbar actions.
        function stopAll() {
            ['cartgrid', 'floater'].forEach(id => {
                const iframe = document.getElementById(id);
                if (iframe) iframe.src = iframe.src;
            });
        }
        function toggleIdsWindow() { toggleDisplay('.floating-container-0001'); }
        function toggleClockWindow() { toggleDisplay('.floating-container-0002'); }
        function closeFloatingDiv() { document.querySelector('.floating-container-0001').style.display = 'none'; }
        function closeFloatingDiv2() { document.querySelector('.floating-container-0002').style.display = 'none'; }
        function toggleSize() {
            const el = document.getElementById('floatingDiv');
            el.style.height = el.style.height === '109px' ? '165px' : '109px';
        }
        function toggleDisplay(selector) {
            const el = document.querySelector(selector);
            if (!el) return;
            el.style.display = window.getComputedStyle(el).display === 'none' ? 'block' : 'none';
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
                // (the section/clock dropdown and the close/resize buttons).
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
        document.getElementById('floatingDiv').style.top = '580px';
        document.getElementById('floatingDiv').style.left = '220px';

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
