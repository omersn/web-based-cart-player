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

// Real (non-placeholder) carts, with their 0-based index. One island feeds
// both the live search AND the planner/breaks strip (which references carts
// by 1-based carts.txt line = i + 1). The index maps to a board section by
// the same from/to ranges the section selectors use, so a result can show
// its page and jump there.
$allCarts = [];
foreach (load_carts() as $i => $line) {
    $p    = explode('|', $line);
    $name = trim($p[0] ?? '');
    $file = trim($p[1] ?? '');
    if ($name === '' || $name === '-' || $file === '' || $file === '0.mp3') continue;
    $allCarts[] = [
        'i'      => $i,
        'name'   => $name,
        'file'   => $file,
        'start'  => (float) ($p[2] ?? 0),
        'color'  => trim($p[3] ?? '1'),
        'end'    => (isset($p[4]) && $p[4] !== '') ? (float) $p[4] : null,
        'volume' => (isset($p[5]) && $p[5] !== '') ? (float) $p[5] : 1,
    ];
}

// The daily commercial-breaks plan (planner-editable, admin-gated on save).
$breaks = load_breaks();

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
    <link rel="icon" type="image/svg+xml" href="assets/img/favicon.svg">
    <link rel="stylesheet" href="assets/css/player.css">
    <script>
        // Stable per-machine ID, generated once and kept in localStorage. Shared
        // with the keep-alive iframe (same origin), so every frontend stamps its
        // own ID on the server heartbeat log and one machine can tell itself
        // apart from the others. Seeded here in <head> so it exists before the
        // keep-alive iframe's first heartbeat.
        window.MACHINE_ID = (() => {
            try {
                let id = localStorage.getItem('cartPlayerMachineId');
                if (!id) { id = 'PL-' + Math.random().toString(36).slice(2, 6).toUpperCase(); localStorage.setItem('cartPlayerMachineId', id); }
                return id;
            } catch (e) { return 'PL-????'; }
        })();
    </script>
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
            <form id="searchForm" class="topbar-search" autocomplete="off" role="search">
                <i class="ph ph-magnifying-glass"></i>
                <input type="text" id="searchInput" placeholder="Search jingle&hellip;" autocomplete="off" aria-label="Search jingles">
                <kbd id="searchKbd">&#8984;K</kbd>
                <button type="button" class="search-clear" id="searchClear" title="Clear" aria-label="Clear search" hidden><i class="ph ph-x"></i></button>
            </form>
            <!-- Live (Spotlight-style) results — populated on every keystroke. -->
            <div class="search-results" id="searchResults" role="listbox" hidden></div>
        </div>

        <span class="topbar-divider"></span>

        <div class="topbar-end">
            <div class="icon-cluster">
                <!-- Window toggles, grouped together and separated from the actions. -->
                <button type="button" class="icon-btn is-active" id="chip-ids" onclick="toggleIdsWindow();" title="Station IDs">
                    <i class="ph ph-radio"></i><span class="status-dot red"></span>
                </button>
                <button type="button" class="icon-btn is-active" id="chip-clock" onclick="toggleClockWindow();" title="Clock">
                    <i class="ph ph-clock"></i><span class="status-dot red"></span>
                </button>
                <button type="button" class="icon-btn" id="chip-auto" onclick="window.Automation && window.Automation.toggle();" title="Automation playlist">
                    <i class="ph ph-playlist"></i><span class="status-dot amber"></span>
                </button>
                <?php if (is_admin()): ?>
                <!-- Break planner (admin): edits the daily plan the strip shows. -->
                <button type="button" class="icon-btn" id="chip-planner" title="Break planner">
                    <i class="ph ph-calendar-check"></i>
                </button>
                <?php endif; ?>
                <?php if (SHOW_UTILITY_CHIPS): ?>
                <span class="icon-sep"></span>
                <!-- One-shot actions. Temporarily hidden via SHOW_UTILITY_CHIPS
                     (config.php) while the product direction shifts; flip that
                     flag to true to bring them back. -->
                <a class="icon-btn" id="chip-download" href="download.php" title="Download">
                    <i class="ph ph-download-simple"></i>
                </a>
                <button type="button" class="icon-btn" id="qr-chip" onclick="showQR();" title="Mobile access">
                    <i class="ph ph-device-mobile"></i>
                </button>
                <button type="button" class="icon-btn" id="chip-credits" onclick="showCredits();" title="Credits">
                    <i class="ph ph-info"></i>
                </button>
                <?php endif; ?>
            </div>

            <div class="transport-cluster">
                <button type="button" class="btn-stop" onclick="stopAll();"><i class="ph-fill ph-stop"></i>Stop all</button>
            </div>
        </div>
    </nav>

    <!-- Draggable clock window -->
    <div class="floating-container-0002" id="floatingDiv2">
        <button class="window-restore" onclick="toggleMinimize('floatingDiv2')" title="Expand clock"><i class="ph ph-arrows-out-simple"></i></button>
        <!-- When minimized (small clock), the whole area is a drag handle — the
             iframe would otherwise swallow mousedown. -->
        <div class="clock-mini-drag" id="clockMiniDrag"></div>
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
                <button class="window-dock" onclick="dock('clock')" title="Dock to bottom"><i class="ph ph-arrow-line-down"></i></button>
                <button class="window-minimize" onclick="toggleMinimize('floatingDiv2')" title="Minimize">&minus;</button>
                <button class="window-close" onclick="closeFloatingDiv2()" title="Close"><i class="ph ph-x"></i></button>
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
                <button class="window-dock" onclick="dock('ids')" title="Dock to bottom"><i class="ph ph-arrow-line-down"></i></button>
                <button class="window-minimize" onclick="toggleMinimize('floatingDiv')" title="Minimize">&minus;</button>
                <button class="window-close" onclick="closeFloatingDiv()" title="Close"><i class="ph ph-x"></i></button>
            </div>
        </div>
        <div class="iframe-content-0001">
            <iframe id="floater" src="grid.php?from=0&to=10&pagination=0&smalltext=15&smallbacktimer=1&btnh=76" scrolling="no" style="width: 100%; height: 100%; border: none;"></iframe>
        </div>
    </div>

    <!-- Keep-alive heartbeat: runs the server ping + silent audio clip that drive
         the CONNECTED / AUDIO STBY pills in the ticker. Kept invisible (the pills
         are the UI now) but present in the DOM so its ping/audio keep running. -->
    <iframe id="keepAliveFrame" src="keep-alive.php" frameborder="0" scrolling="no" aria-hidden="true"
            style="position: fixed; bottom: 0; right: 0; width: 2px; height: 2px; z-index: 0; opacity: 0; pointer-events: none;"></iframe>

    <!-- Stage: the board (+ bottom dock) on the left, the Automation Playlist
         panel on the right (33%, shown only while automation is active). -->
    <div class="stage">
        <div class="stage-left">
            <!-- Main content area: flexes to fill the space between the topbar
                 and the ticker (normal flow, not position:fixed — see player.css). -->
            <div class="main-content">
                <iframe width="100%" height="100%" id="cartgrid" name="cartgrid"
                        src="grid.php?from=10&to=75&pagination=0&fit=1&mainbar=1&timestamp=<?= time() ?>"
                        frameborder="0" scrolling="no" allowfullscreen></iframe>
            </div>

            <!-- Bottom dock: the clock and/or Station-ID views can be docked here.
                 The layout adapts to what's docked (see renderDock below). -->
            <div class="dock-bar" id="dockBar">
                <div class="dock-pane dock-clock" id="dockClock" style="display:none;">
                    <button class="dock-undock" onclick="undock('clock')" title="Pop back out"><i class="ph ph-arrow-line-up"></i></button>
                    <iframe class="dock-clock-time" id="dockClockTime" scrolling="no"></iframe>
                    <iframe class="dock-clock-count" id="dockClockCount" scrolling="no"></iframe>
                </div>
                <div class="dock-pane dock-ids" id="dockIds" style="display:none;">
                    <button class="dock-undock" onclick="undock('ids')" title="Pop back out"><i class="ph ph-arrow-line-up"></i></button>
                    <button class="dock-nav" onclick="dockIdsNav(-1)" title="Previous section"><i class="ph ph-caret-left"></i></button>
                    <iframe class="dock-ids-frame" id="dockIdsFrame" scrolling="no"></iframe>
                    <button class="dock-nav" onclick="dockIdsNav(1)" title="Next section"><i class="ph ph-caret-right"></i></button>
                </div>
            </div>
        </div>

        <!-- Automation Playlist: scheduled auto-playback queue. Hidden until an
             item is sent here (right-click a cart); managed by automation.js. -->
        <aside class="automation-panel" id="automationPanel">
            <!-- Daily commercial-breaks strip (from the planner): one chip per
                 planned break — [from/to] HH:MM · length · name. The NEXT
                 upcoming break stays highlighted/centred and pulses as air time
                 approaches; clicking a chip loads that break into the queue
                 below (it does NOT auto-load). Hidden when no breaks exist. -->
            <div class="breaks-strip" id="breaksStrip" hidden></div>
            <!-- Time header, centred as one unit. The o-> toggle carries the
                 From/To label (one click flips start-at <-> end-at); the time
                 opens the picker. A fixed-width label keeps the time from
                 shifting when From <-> To flips. -->
            <div class="auto-header-wrap">
                <div class="auto-header" id="autoHeaderRow">
                    <button type="button" class="auto-anchor-toggle" id="autoAnchorToggle" title="Toggle start / end (From ↔ To)">
                        <span class="auto-header-label" id="autoTimeLabel">From</span>
                        <span class="auto-header-icon" id="autoHeaderIcon"></span>
                    </button>
                    <button type="button" class="auto-header-main" id="autoHeader" title="Set time">
                        <span class="auto-header-time" id="autoTime">--:--</span>
                        <i class="ph ph-caret-down auto-header-caret"></i>
                    </button>
                </div>
                <!-- Picker: type directly in the hour/minute boxes, or pick from
                     each box's dropdown. (From/To is set by the header toggle.) -->
                <div class="auto-pop" id="autoPop" hidden>
                    <div class="auto-pop-selects">
                        <div class="auto-combo" id="autoHourCombo">
                            <input type="text" class="auto-combo-btn" id="autoHourComboBtn" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="Hour" value="00">
                            <div class="auto-combo-list" id="autoHourComboList" hidden></div>
                        </div>
                        <span class="auto-pop-colon">:</span>
                        <div class="auto-combo" id="autoMinCombo">
                            <input type="text" class="auto-combo-btn" id="autoMinComboBtn" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="Minute" value="00">
                            <div class="auto-combo-list" id="autoMinComboList" hidden></div>
                        </div>
                    </div>
                    <button class="auto-pop-ok" id="autoPopOk">OK</button>
                </div>
            </div>

            <!-- Which break is sitting in the queue right now (from the strip);
                 gains "(modified)" when content/time diverge, clears on empty. -->
            <div class="auto-loaded-name" id="autoLoadedName" hidden></div>

            <div class="auto-list" id="autoList"></div>

            <div class="auto-total" id="autoTotalRow"><span id="autoTotalLabel">Total</span><span id="autoTotal">0:00</span></div>

            <!-- Playback control area: mode switch always; AUTO shows the clocks,
                 MANUAL shows the transport controls. -->
            <div class="auto-controls">
                <div class="auto-mode-switch" id="autoModeSwitch">
                    <button data-mode="auto" id="autoModeAuto" class="active"><span class="auto-armed-dot" id="autoArmedDot"></span>AUTO</button>
                    <button data-mode="manual" id="autoModeManual">MANUAL</button>
                </div>

                <div class="auto-auto-area" id="autoAutoArea">
                    <div class="auto-times">
                        <div class="auto-times-block" id="autoStartsBlock">
                            <div class="auto-times-label">Starts in</div>
                            <div class="auto-times-value" id="autoCountdown">-0:00</div>
                        </div>
                        <div class="auto-times-block">
                            <div class="auto-times-label">Ends at</div>
                            <div class="auto-times-value" id="autoEndAt">--:--</div>
                        </div>
                    </div>
                    <button class="auto-stop-auto" id="autoStopAutoBtn" hidden title="Stop"><i class="ph-fill ph-stop"></i> STOP</button>
                </div>

                <div class="auto-transport" id="autoTransport" hidden>
                    <button class="auto-play" id="autoPlayBtn" title="Play / pause"><i class="ph-fill ph-play"></i></button>
                    <button class="auto-stop" id="autoStopBtn" title="Stop" disabled><i class="ph-fill ph-stop"></i></button>
                </div>

                <button class="auto-clear-btn" id="autoClearBtn"><i class="ph ph-trash"></i> Clear &amp; hide</button>
            </div>
        </aside>
    </div>

    <!-- AGPL: offer the Corresponding Source to network users (section 13). -->
    <a href="<?= htmlspecialchars(SOURCE_URL) ?>" target="_blank" rel="noopener"
       style="position: fixed; bottom: 52px; left: 9px; z-index: 1002110; font-size: 10px; color: #5a6b75; text-decoration: none;">
        Source (<?= htmlspecialchars(LICENSE_NAME) ?>)
    </a>

    <!-- Start gate: browsers block audio autoplay until a user gesture, so the
         first click unlocks audio and kicks off the preload. Skipped in kiosk
         mode (?kiosk=1, where the browser runs with the autoplay flag). -->
    <div class="start-overlay" id="startOverlay">
        <button class="start-button" id="startButton"><i class="ph-fill ph-play"></i>START</button>
        <div class="start-hint">Click START to enable audio and load the cart wall</div>
    </div>

    <!-- Loading overlay -->
    <div class="overlay" id="loadingOverlay">
        <div class="message">Loading</div>
        <div class="progress-bar"><div class="progress" id="progressBar"></div></div>
    </div>

    <!-- Big on-air countdown: a red bar that slides up over the ticker while the
         board is playing (driven by the main board iframe — see the message
         handler). Stays up as long as ANYTHING on the board is playing. -->
    <div class="countdown-bar" id="countdownBar">
        <span class="countdown-value" id="countdownValue">0:00</span>
    </div>

    <!-- Ticker -->
    <div class="statuses-bar">
        <?php if (is_admin() || is_dj()): ?>
            <span class="ticker-chip is-auth">
                <a class="chip-main" href="<?= is_admin() ? 'admin.php' : 'dj.php' ?>" title="Open management">
                    <span class="avatar"><i class="ph-fill ph-user"></i></span>
                    <span class="chip-reveal"><?= is_admin() ? 'Admin' : 'DJ' ?> <i class="ph ph-gear"></i></span>
                </a>
                <a class="logout-link chip-reveal" href="logout.php">Log out</a>
            </span>
        <?php else: ?>
            <a class="ticker-chip is-guest" href="login.php">
                <span class="avatar"><i class="ph-fill ph-user"></i></span>
                <span class="chip-reveal">Sign in</span>
            </a>
        <?php endif; ?>
        <span class="status-pill" id="connectionPill" role="button" tabindex="0"><span class="pulse-dot"></span><span class="status-label" id="connectionLabel">CONNECTED</span></span>
        <span class="status-pill audio" id="audioPill" role="button" tabindex="0"><span class="pulse-dot"></span><span class="status-label" id="audioLabel">AUDIO ENGINE KEEP-ALIVE ON</span></span>
        <span class="ticker-msg"><?= $statusText !== '' ? htmlspecialchars($statusText, ENT_QUOTES, 'UTF-8') : 'Welcome to the Web-based Cart Player demo &mdash; right-click a cart to schedule it for the top of the hour.' ?></span>
    </div>

    <!-- Small log popups opened by clicking the footer status dots. -->
    <div class="log-popup" id="pingLog" hidden>
        <div class="log-popup-head"><span class="log-popup-title">Server ping</span><button type="button" class="log-popup-x" aria-label="Close"><i class="ph ph-x"></i></button></div>
        <div class="log-popup-body" id="pingLogBody"></div>
    </div>
    <div class="log-popup" id="heartbeatLog" hidden>
        <div class="log-popup-head"><span class="log-popup-title">Audio keep-alive &middot; heartbeat log</span><button type="button" class="log-popup-x" aria-label="Close"><i class="ph ph-x"></i></button></div>
        <div class="log-popup-body" id="heartbeatLogBody"></div>
    </div>

    <?php if (is_admin()): ?>
    <!-- Break planner overlay (admin). LEFT: pages>carts tree (preview + add).
         RIGHT: the breaks list above the playlist editor — the editor is the
         automation panel itself, moved in here (and back) by planner.js. -->
    <div class="planner-overlay" id="plannerOverlay" hidden>
        <div class="planner-frame">
            <header class="planner-head">
                <h2><i class="ph ph-calendar-check"></i> Break planner</h2>
                <div class="planner-head-actions">
                    <span class="planner-msg" id="plannerMsg"></span>
                    <button type="button" class="planner-save" id="plannerSave"><i class="ph ph-floppy-disk"></i> Save &amp; Close</button>
                    <button type="button" class="planner-cancel" id="plannerCancel" title="Discard changes (Esc)">Cancel</button>
                </div>
            </header>
            <!-- Styled discard-confirmation (replaces the native confirm()). -->
            <div class="planner-confirm" id="plannerConfirm" hidden>
                <div class="planner-confirm-box">
                    <i class="ph ph-warning-circle"></i>
                    <p>Discard unsaved changes to the break plan?</p>
                    <div class="planner-confirm-actions">
                        <button type="button" id="plannerConfirmDiscard" class="pc-discard">Discard changes</button>
                        <button type="button" id="plannerConfirmKeep" class="pc-keep">Keep editing</button>
                    </div>
                </div>
            </div>
            <div class="planner-body">
                <div class="planner-tree" id="plannerTree">
                    <div class="ptree-toolbar">
                        <input type="text" class="ptree-search" id="ptreeSearch" placeholder="Search carts&hellip;" autocomplete="off">
                        <button type="button" class="ptree-fav-filter" id="ptreeFavFilter" title="Show favourites only"><i class="ph ph-star"></i></button>
                    </div>
                    <div class="ptree-scroller" id="ptreeScroller"></div>
                </div>
                <div class="planner-right">
                    <div class="planner-breaks" id="plannerBreaks"></div>
                    <div class="planner-editor" id="plannerEditor"></div>
                </div>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <script>
        // Real carts (name/file/trim/colour/volume + 0-based index). Shared by
        // the live search and the planner/breaks strip; a break references a
        // cart by its 1-based carts.txt line, i.e. the entry with i === id - 1.
        window.CARTS = <?= json_encode($allCarts, JSON_UNESCAPED_UNICODE) ?>;

        // Daily commercial-breaks plan ({time, anchor, name, items[]}, sorted
        // by time). Edited by the planner overlay; saved via save-breaks.php.
        window.BREAKS = <?= json_encode($breaks, JSON_UNESCAPED_UNICODE) ?>;

        // Gates the planner UI client-side (the save endpoint re-checks).
        window.IS_ADMIN = <?= is_admin() ? 'true' : 'false' ?>;

        // Planner favourites: starred cart ids, station-wide (data/favorites.txt).
        window.FAVORITES = <?= json_encode(load_favorites()) ?>;

        // --- Start gate + loading overlay + first-load preload kick.
        // Browsers block audio autoplay until a user gesture, and the preload
        // hack has to play each clip once. A START button gates everything: its
        // click unlocks audio, then we run the "switch section away and back"
        // trick (behind the loading overlay) that primes every cart. Kiosk mode
        // (?kiosk=1, browser launched with the autoplay flag) skips the button.
        function runLoadingKick() {
            const overlay = document.getElementById('loadingOverlay');
            const progressBar = document.getElementById('progressBar');
            const grid = document.getElementById('cartgrid');
            const floater = document.getElementById('floater');
            const dockIds = document.getElementById('dockIdsFrame');
            const gridSrc = grid.src;
            const floaterSrc = floater.src;
            // The visible ID grid may be the floating window OR the dock; prime
            // whichever has real content (the other is about:blank).
            const dockIdsLive = dockIds.src && !dockIds.src.includes('about:blank');
            const dockIdsSrc = dockIds.src;

            // Nudge the keep-alive clip now that we have a gesture so AUDIO STBY
            // lights up immediately instead of waiting for the next 30s beat.
            const ka = document.getElementById('keepAliveFrame');
            if (ka && ka.contentWindow) ka.contentWindow.postMessage({ source: 'player', cmd: 'keepalive-play' }, '*');

            let progress = 0;
            const interval = setInterval(() => {
                progress += 12;
                progressBar.style.width = `${Math.min(progress, 100)}%`;
                if (progress >= 100) clearInterval(interval);
            }, 280);

            // Switch the grids away…
            setTimeout(() => {
                grid.src = 'grid.php?from=35&to=60&pagination=0&fit=1&mainbar=1&timestamp=' + Date.now();
                floater.src = 'grid.php?from=110&to=120&pagination=0&smalltext=15&smallbacktimer=1&btnh=76&timestamp=' + Date.now();
                if (dockIdsLive) dockIds.src = 'grid.php?from=35&to=45&pagination=0&smalltext=15&btnh=76&fit=1&timestamp=' + Date.now();
            }, 800);
            // …and back to the original views, which primes their carts.
            setTimeout(() => {
                grid.src = gridSrc;
                floater.src = floaterSrc;
                if (dockIdsLive) dockIds.src = dockIdsSrc;
            }, 1900);
            // Reveal once the kick has completed.
            setTimeout(() => { overlay.style.display = 'none'; }, 2900);
        }
        (() => {
            const startOverlay = document.getElementById('startOverlay');
            if (new URLSearchParams(location.search).has('kiosk')) {
                startOverlay.style.display = 'none';
                runLoadingKick();
                return;
            }
            document.getElementById('startButton').addEventListener('click', () => {
                startOverlay.style.display = 'none';
                runLoadingKick();
            }, { once: true });
        })();

        // --- Bottom status pills, driven by the keep-alive iframe.
        // keep-alive.js posts two independent signals up to us via postMessage:
        //   connection: 'online'|'offline' — result of pinging the server.
        //   audio:      'active'|'idle'    — whether the silent keep-alive clip
        //                                    is playing (audio device kept warm).
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || data.source !== 'keep-alive') return;
            if (data.connection) {
                const pill = document.getElementById('connectionPill');
                const online = data.connection === 'online';
                pill.classList.toggle('standby', !online);
                document.getElementById('connectionLabel').textContent = online ? 'CONNECTED' : 'OFFLINE';
            }
            if (data.audio) {
                const pill = document.getElementById('audioPill');
                const active = data.audio === 'active';
                pill.classList.toggle('standby', !active);
                document.getElementById('audioLabel').textContent = active ? 'AUDIO ENGINE KEEP-ALIVE ON' : 'AUDIO ENGINE KEEP-ALIVE OFF';
            }
        });

        // --- Status log popups. Clicking a footer dot drops up a small log:
        //   CONNECTED    -> the client-side server-ping results (with latency).
        //   AUDIO K-ALIVE -> the server "heartbeat" log (log-keep-alive.php GET).
        (() => {
            const MAX = 60;
            const pings = [];          // rolling client-side ping buffer
            let hbTimer = null;        // heartbeat-log refresh while its popup is open
            const p2 = (n) => String(n).padStart(2, '0');
            const clock = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
            const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            const isHidden = (id) => document.getElementById(id).hidden;

            function renderPing() {
                const body = document.getElementById('pingLogBody');
                if (!pings.length) { body.innerHTML = '<div class="log-popup-empty">Waiting for the first ping&hellip;</div>'; return; }
                body.innerHTML = pings.slice().reverse().map((e) =>
                    `<div class="log-popup-row ${e.online ? 'ok' : 'fail'}"><span class="t">${clock(e.ts)}</span>` +
                    `<span class="s">${e.online ? (e.latency != null ? e.latency + ' ms' : 'online') : 'unreachable'}</span></div>`
                ).join('');
            }
            async function loadHeartbeat() {
                const body = document.getElementById('heartbeatLogBody');
                try {
                    const r = await fetch('log-keep-alive.php?tail=60', { cache: 'no-store' });
                    const entries = (await r.json()).entries || [];
                    if (!entries.length) { body.innerHTML = '<div class="log-popup-empty">No heartbeats logged yet&hellip;</div>'; return; }
                    body.innerHTML = entries.slice().reverse().map((e) => {
                        const fail = /fail/i.test(e.message);
                        const d = new Date(e.timestamp);
                        const t = isNaN(d.getTime()) ? esc(e.timestamp) : clock(d.getTime());
                        const mine = e.machineId && e.machineId === window.MACHINE_ID;
                        const id = esc(e.machineId || '—') + (mine ? ' (me)' : '');
                        return `<div class="log-popup-row ${fail ? 'fail' : 'ok'}${mine ? ' mine' : ''}">` +
                            `<span class="t">${t}</span><span class="mid">${id}</span><span class="s">${esc(e.message)}</span></div>`;
                    }).join('');
                } catch (err) {
                    body.innerHTML = '<div class="log-popup-empty">Could not load the heartbeat log.</div>';
                }
            }
            function closeAll() {
                document.getElementById('pingLog').hidden = true;
                document.getElementById('heartbeatLog').hidden = true;
                if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
            }
            function toggle(id) {
                const wasOpen = !isHidden(id);
                closeAll();
                if (wasOpen) return;                       // clicking the same dot closes it
                document.getElementById(id).hidden = false;
                if (id === 'pingLog') renderPing();
                if (id === 'heartbeatLog') { loadHeartbeat(); hbTimer = setInterval(loadHeartbeat, 5000); }
            }

            const connPill = document.getElementById('connectionPill');
            const audioPill = document.getElementById('audioPill');
            connPill.addEventListener('click', () => toggle('pingLog'));
            audioPill.addEventListener('click', () => toggle('heartbeatLog'));
            [connPill, audioPill].forEach((el) => el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
            }));
            document.querySelectorAll('.log-popup-x').forEach((b) => b.addEventListener('click', closeAll));
            document.addEventListener('click', (e) => {
                if (e.target.closest('.log-popup') || e.target.closest('#connectionPill') || e.target.closest('#audioPill')) return;
                closeAll();
            });

            // Buffer each ping (the parent already receives these every 10s).
            window.addEventListener('message', (event) => {
                const d = event.data;
                if (!d || d.source !== 'keep-alive' || !d.connection) return;
                pings.push({ ts: Date.now(), online: d.connection === 'online', latency: d.latencyMs });
                if (pings.length > MAX) pings.shift();
                if (!isHidden('pingLog')) renderPing();
            });
        })();

        // --- iframe section selectors.
        // Keep the main board in fit mode (responsive + empty-row compaction +
        // big countdown bar) no matter which section is chosen — the option URLs
        // don't carry those params.
        document.getElementById('section-select').addEventListener('change', (e) => {
            let url = e.target.value;
            if (!/[?&]fit=1/.test(url)) url += '&fit=1&mainbar=1';
            document.getElementById('cartgrid').src = url;
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

        // --- Live search (Spotlight-style). Filters window.CARTS on every
        // keystroke; each result shows its board section (breadcrumb, click to
        // jump there) and a preview button. ⌘K / Ctrl+K focuses it.
        (() => {
            const CAT = { '1': '#2f6fd6', '2': '#2f9e5f', '3': '#b0479e', '4': '#c98a2b', '5': '#2aa7bf' };
            const input = document.getElementById('searchInput');
            const box = document.getElementById('searchResults');
            const carts = window.CARTS || [];
            let sel = -1, rows = [];
            let preview = null, previewBtn = null;

            // Section registry: each board/floating section's index range + label
            // + how to navigate to it. Derived from the two <select>s so it tracks
            // any relabelling/re-ranging automatically.
            const sections = [];
            const addFrom = (selectId, board) => {
                const s = document.getElementById(selectId);
                if (!s) return;
                [...s.options].forEach((o) => {
                    const m = o.value.match(/from=(\d+)&to=(\d+)/);
                    if (m) sections.push({ from: +m[1], to: +m[2], label: o.textContent.trim(), value: o.value, selectId, board });
                });
            };
            addFrom('section-select', true);   // main board pages
            addFrom('ids-select', false);      // Station-ID window pages
            const sectionFor = (i) => sections.find((s) => i >= s.from && i < s.to) || null;

            function navigate(sec, cart) {
                if (!sec) return;
                if (sec.board) {                                   // main board
                    const grid = document.getElementById('cartgrid');
                    const cur = grid.src.match(/from=(\d+)&to=(\d+)/);
                    // If the cart is already on the page in view, don't reload —
                    // just flash it (box is relative to whatever's loaded now).
                    if (cur && cart.i >= +cur[1] && cart.i < +cur[2]) {
                        flashCart(grid, cart.i - (+cur[1]) + 1, false);
                    } else {                                        // else load its section and flash
                        document.getElementById('section-select').value = sec.value; // keep the dropdown in sync
                        grid.src = `${sec.value}&fit=1&mainbar=1&timestamp=${Date.now()}`;
                        flashCart(grid, cart.i - sec.from + 1, true);
                    }
                } else {                                           // ID-window page -> reveal it THERE, never on the board
                    revealInIdWindow(sec, cart.i - sec.from + 1);
                }
            }
            // Scroll to a cart button (by its data-box) inside an iframe and flash
            // it. Buttons build asynchronously (staggered), so poll for the
            // target; wait for the frame's load first if it's (re)loading.
            function flashCart(iframe, box, needLoad) {
                const run = () => {
                    let tries = 60;                                 // ~7s window: the grid builds buttons + fit-reflows over a couple seconds
                    const attempt = () => {
                        let btn = null;
                        try { btn = iframe.contentDocument && iframe.contentDocument.querySelector(`.button[data-box="${box}"]`); } catch (e) {}
                        if (btn) {
                            btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                            btn.classList.remove('search-flash'); void btn.offsetWidth; btn.classList.add('search-flash');
                            setTimeout(() => btn.classList.remove('search-flash'), 5600); // ~5.4s flash, clears after
                        } else if (tries-- > 0) { setTimeout(attempt, 120); }
                    };
                    attempt();
                };
                if (needLoad) { iframe.addEventListener('load', run, { once: true }); } else { run(); }
            }
            // Bring the ID window forward on the right panel (Station IDs /
            // Sweepers & FX) and flash the cart — in whichever surface the ID
            // window currently lives (floating window or bottom dock).
            function revealInIdWindow(sec, box) {
                if (!winState.ids.visible) { winState.ids.visible = true; saveWinState(); renderWindows(); }
                const opts = [...document.getElementById('ids-select').options];
                const secIndex = opts.findIndex((o) => o.value.includes(`from=${sec.from}&to=${sec.to}`));
                if (secIndex < 0) return;
                const here = (fr) => fr.src.includes(`from=${sec.from}&to=${sec.to}`);
                let iframe, needLoad = false;
                if (winState.ids.docked) {
                    iframe = document.getElementById('dockIdsFrame');
                    if (!here(iframe)) { dockIdsIndex = secIndex; iframe.src = idSectionUrls[secIndex]; needLoad = true; }
                } else {
                    iframe = document.getElementById('floater');
                    if (!here(iframe)) {
                        const sel = document.getElementById('ids-select');
                        sel.value = opts[secIndex].value; sel.dispatchEvent(new Event('change'));
                        needLoad = true;
                    }
                }
                flashCart(iframe, box, needLoad);
            }
            function stopPreview() {
                if (preview) { try { preview.pause(); } catch (e) {} preview = null; }
                if (previewBtn) { previewBtn.classList.remove('playing'); previewBtn.innerHTML = '<i class="ph-fill ph-play"></i>'; previewBtn = null; }
            }
            function togglePreview(cart, btn) {
                if (previewBtn === btn) { stopPreview(); return; }  // same one -> stop
                stopPreview();
                preview = new Audio(`uploads/${cart.file}`);
                try { preview.currentTime = cart.start || 0; } catch (e) {}
                preview.play().catch(() => {});
                previewBtn = btn; btn.classList.add('playing'); btn.innerHTML = '<i class="ph-fill ph-pause"></i>';
                preview.addEventListener('timeupdate', () => { if (cart.end != null && preview && preview.currentTime >= cart.end) stopPreview(); });
                preview.addEventListener('ended', stopPreview);
            }

            const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            function render(q) {
                stopPreview();
                const needle = q.toLowerCase();
                const hits = carts.filter((c) => c.name.toLowerCase().includes(needle)).slice(0, 12);
                sel = -1;
                if (!hits.length) { box.innerHTML = '<div class="search-empty">No matching jingles</div>'; box.hidden = false; rows = []; return; }
                box.innerHTML = hits.map((c) => {
                    const sec = sectionFor(c.i);
                    const crumb = sec ? esc(sec.label) : '&mdash;';
                    return `<div class="search-row" data-i="${c.i}" role="option">` +
                        `<span class="search-dot" style="background:${CAT[c.color] || CAT['1']}"></span>` +
                        `<span class="search-name">${esc(c.name)}</span>` +
                        `<span class="search-crumb">${crumb}</span>` +
                        `<button type="button" class="search-play" title="Preview"><i class="ph-fill ph-play"></i></button></div>`;
                }).join('');
                box.hidden = false;
                rows = [...box.querySelectorAll('.search-row')];
                rows.forEach((row) => {
                    const cart = carts.find((c) => c.i === +row.dataset.i);
                    const playBtn = row.querySelector('.search-play');
                    playBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePreview(cart, playBtn); });
                    row.addEventListener('click', () => { navigate(sectionFor(cart.i), cart); close(); });
                });
            }
            function close() { box.hidden = true; box.innerHTML = ''; sel = -1; rows = []; stopPreview(); }
            function highlight(n) {
                if (!rows.length) return;
                sel = (n + rows.length) % rows.length;
                rows.forEach((r, k) => r.classList.toggle('sel', k === sel));
                rows[sel].scrollIntoView({ block: 'nearest' });
            }

            // Swap the ⌘K hint for an X-to-clear box whenever the field has text.
            const kbd = document.getElementById('searchKbd');
            const clearBtn = document.getElementById('searchClear');
            const updateHint = () => { const has = input.value.length > 0; kbd.hidden = has; clearBtn.hidden = !has; };
            clearBtn.addEventListener('click', () => { input.value = ''; updateHint(); close(); input.focus(); });

            input.addEventListener('input', () => { updateHint(); const q = input.value.trim(); q ? render(q) : close(); });
            input.addEventListener('focus', () => { const q = input.value.trim(); if (q) render(q); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); highlight(sel + 1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(sel - 1); }
                else if (e.key === 'Enter') { e.preventDefault(); const r = rows[sel] || rows[0]; if (r) { const ci = +r.dataset.i; navigate(sectionFor(ci), carts.find((c) => c.i === ci)); close(); input.blur(); } }
                else if (e.key === 'Escape') { close(); input.blur(); }
            });
            document.getElementById('searchForm').addEventListener('submit', (e) => e.preventDefault());
            document.addEventListener('click', (e) => { if (!e.target.closest('.topbar-search-zone')) close(); });
            document.addEventListener('keydown', (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
            });
        })();

        // --- Toolbar actions.
        function stopAll() {
            ['cartgrid', 'floater', 'dockIdsFrame'].forEach(id => {
                const iframe = document.getElementById(id);
                if (iframe && iframe.src && !iframe.src.includes('about:blank')) iframe.src = iframe.src;
            });
            if (window.Automation) window.Automation.stop();
        }
        // --- Window manager -------------------------------------------------
        // Each of the two views (clock / Station IDs) carries two independent
        // bits: docked (floating vs. in the bottom dock) and visible (shown vs.
        // hidden via its toggle chip or close button). Both persist in
        // localStorage so a docked layout survives a reload. Toggle/close only
        // change visibility; dock/undock only change the docked bit. The dock
        // adapts to whichever docked views are currently visible:
        //   clock only -> time + "time to end of hour" side by side, full width
        //   IDs only   -> the IDs grid stretches full width
        //   both       -> clock 33% (ring only) left, IDs 66% right
        const WIN_STORE = 'cartPlayerWindows';
        const WIN = {
            clock: { floatSel: '.floating-container-0002', chip: 'chip-clock' },
            ids:   { floatSel: '.floating-container-0001', chip: 'chip-ids' },
        };
        const DOCK_SRC = {
            clockTime:  'clock.php?dock=1',
            clockCount: 'clock-progress.php?dock=1',
        };
        // Docked Station-ID sections mirror the floating window's dropdown, so the
        // dock's < > buttons cycle the same sections (there's no dropdown once
        // docked). fit=1 makes the grid fill the dock pane.
        const idSectionUrls = [...document.getElementById('ids-select').options].map(o => o.value + '&fit=1');
        let dockIdsIndex = 0;
        function dockIdsNav(dir) {
            if (layoutLocked) return; // don't reload the grid mid-playback
            dockIdsIndex = (dockIdsIndex + dir + idSectionUrls.length) % idSectionUrls.length;
            document.getElementById('dockIdsFrame').src = idSectionUrls[dockIdsIndex];
        }
        const winState = (() => {
            // First visit (no saved state) starts with BOTH views docked.
            const def = { clock: { docked: true, visible: true }, ids: { docked: true, visible: true } };
            try {
                const saved = JSON.parse(localStorage.getItem(WIN_STORE));
                if (saved && saved.clock && saved.ids) return saved;
            } catch (e) { /* ignore corrupt storage */ }
            return def;
        })();
        const saveWinState = () => {
            try { localStorage.setItem(WIN_STORE, JSON.stringify(winState)); } catch (e) { /* ignore */ }
        };

        function renderWindows() {
            for (const key of ['clock', 'ids']) {
                const s = winState[key];
                const floatEl = document.querySelector(WIN[key].floatSel);
                const floating = s.visible && !s.docked;
                floatEl.style.display = floating ? 'block' : 'none';
                // Restore a remembered floating position (saved on drag).
                if (floating && s.pos) {
                    floatEl.style.left = s.pos.left;
                    floatEl.style.top = s.pos.top;
                }
                const chip = document.getElementById(WIN[key].chip);
                if (chip) chip.classList.toggle('is-active', s.visible);
            }
            const clockDock = winState.clock.visible && winState.clock.docked;
            const idsDock   = winState.ids.visible && winState.ids.docked;

            // Lazy-load / release the dock iframes so nothing runs while undocked/hidden.
            document.getElementById('dockClockTime').src  = clockDock ? DOCK_SRC.clockTime  : 'about:blank';
            document.getElementById('dockClockCount').src = clockDock ? DOCK_SRC.clockCount : 'about:blank';
            document.getElementById('dockIdsFrame').src   = idsDock   ? idSectionUrls[dockIdsIndex] : 'about:blank';

            document.getElementById('dockClock').style.display = clockDock ? 'flex' : 'none';
            document.getElementById('dockIds').style.display   = idsDock   ? 'flex' : 'none';
            const bar = document.getElementById('dockBar');
            bar.classList.toggle('clock-only', clockDock && !idsDock);
            bar.classList.toggle('ids-only',   idsDock && !clockDock);
            bar.classList.toggle('both',       clockDock && idsDock);
            bar.style.display = (clockDock || idsDock) ? 'flex' : 'none';
        }

        // Layout operations are locked while any cart is on air (see below).
        let layoutLocked = false;
        function toggleWindow(which) { if (layoutLocked) return; winState[which].visible = !winState[which].visible; saveWinState(); renderWindows(); }
        function closeWindow(which)  { if (layoutLocked) return; winState[which].visible = false; saveWinState(); renderWindows(); }
        function dock(which)   { if (layoutLocked) return; winState[which].docked = true; winState[which].visible = true; saveWinState(); renderWindows(); }
        function undock(which) { if (layoutLocked) return; winState[which].docked = false; saveWinState(); renderWindows(); }

        // Names kept for the inline onclick handlers in the markup.
        function toggleIdsWindow()   { toggleWindow('ids'); }
        function toggleClockWindow() { toggleWindow('clock'); }
        function closeFloatingDiv()  { closeWindow('ids'); }
        function closeFloatingDiv2() { closeWindow('clock'); }
        function toggleMinimize(containerId) {
            if (layoutLocked) return;
            const el = document.getElementById(containerId);
            el.classList.toggle('minimized');
            // The minimized clock shows the compact ring only; restore returns to
            // whatever view its dropdown had selected.
            if (containerId === 'floatingDiv2') {
                const minimized = el.classList.contains('minimized');
                document.getElementById('floater2').src = minimized
                    ? 'clock.php?dock=1'
                    : document.getElementById('clock-select').value;
            }
        }

        renderWindows(); // apply persisted window state on load

        // --- Live-safety lock: disable layout ops while any cart is on air.
        // Each cart-wall iframe reports how many of its carts are playing; if the
        // total is > 0 we lock docking / minimize / close / toggle / drag so the
        // layout can't be disturbed mid-jingle. (Stop all still works — it stops
        // playback, which clears the lock.)
        const framePlaying = new Map();
        // Layout is locked while any cart is on air OR the automation playlist is
        // actually RUNNING — not merely queued/scheduled. While automation is
        // idle (armed but not yet firing), the ID/Clock windows can still be
        // docked/toggled/dragged freely; the lock only bites once it's live.
        function recomputeLock() {
            const anyPlaying = [...framePlaying.values()].some((n) => n > 0);
            const autoRunning = !!(window.Automation && window.Automation.isRunning());
            const locked = anyPlaying || autoRunning;
            if (locked !== layoutLocked) {
                layoutLocked = locked;
                document.body.classList.toggle('layout-locked', layoutLocked);
            }
        }
        setInterval(recomputeLock, 300); // catches automation start/stop
        window.addEventListener('message', (event) => {
            const d = event.data;
            if (!d || d.source !== 'cartwall') return;

            // Right-click on a cart -> send it (or its whole chain) to automation.
            if (d.cmd === 'automation-add') {
                if (window.Automation) window.Automation.addItems(d.items, d.grouped);
                return;
            }

            framePlaying.set(event.source, d.playing | 0);
            recomputeLock();

            // Big countdown bar over the ticker — driven by the MAIN board only.
            // It stays up while ANY board cart is playing (d.playing > 0).
            const boardWin = document.getElementById('cartgrid').contentWindow;
            if (event.source === boardWin) {
                const bar = document.getElementById('countdownBar');
                const on = (d.playing | 0) > 0 && !!d.countdown;
                bar.classList.toggle('show', on);
                if (on) document.getElementById('countdownValue').textContent = d.countdown;
            }
        });

        // Show the correct search shortcut hint for this platform (⌘K on Mac, Ctrl K elsewhere).
        (() => {
            const kbd = document.getElementById('searchKbd');
            const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || '');
            if (kbd) kbd.textContent = isMac ? '⌘K' : 'Ctrl K';
        })();

        // --- Make the two floating windows draggable by their title bars.
        // A transparent full-screen overlay is shown only while dragging; it sits
        // above the iframes so fast mouse moves keep firing on the parent document
        // instead of being swallowed by an iframe. The title bar's look is unchanged.
        const dragOverlay = document.createElement('div');
        dragOverlay.className = 'drag-overlay';
        document.body.appendChild(dragOverlay);

        function makeDraggable(containerSelector, titleSelector, key) {
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
                // Remember the floating window's position across reloads.
                if (key && winState[key]) {
                    winState[key].pos = { left: container.style.left, top: container.style.top };
                    saveWinState();
                }
            };
            title.addEventListener('mousedown', (e) => {
                if (layoutLocked) return; // no re-layout while on air
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
        makeDraggable('.floating-container-0001', '.title-bar-0001', 'ids');
        makeDraggable('.floating-container-0002', '.title-bar-0002', 'clock');
        // Minimized clock: the whole small-clock area is a drag handle too.
        makeDraggable('.floating-container-0002', '.clock-mini-drag', 'clock');
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
    <script src="assets/js/automation.js"></script>
    <?php if (is_admin()): ?><script src="assets/js/planner.js"></script><?php endif; ?>
</body>
</html>
