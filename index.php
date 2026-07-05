<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
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

// Shown in the "Server ping" log popup header so an operator checking
// connectivity across several frontends can tell which backend they're
// actually hitting. SERVER_ADDR/SERVER_PORT are what PHP's own built-in
// server (or whatever's fronting it) reports itself as; HTTP_HOST is a
// fallback for setups where SERVER_ADDR isn't populated.
$serverAddr = $_SERVER['SERVER_ADDR'] ?? '';
$serverPort = $_SERVER['SERVER_PORT'] ?? '';
$serverLabel = $serverAddr !== '' ? $serverAddr . ($serverPort !== '' ? ':' . $serverPort : '') : ($_SERVER['HTTP_HOST'] ?? '');

$labels     = load_section_labels();
$settings   = load_settings();   // feature switches (manager Options tab)
purge_old_logs();                // drop log lines past the configured retention (Maintenance > Logs)
$idSectionNames = load_id_section_names(); // the two ID-window section names (manager Station tab)
$statusFile = data_path('status.txt');
$statusText = file_exists($statusFile) ? trim(file_get_contents($statusFile)) : '';

// Real (non-placeholder, ENABLED) carts, with their 0-based index. One island
// feeds both the live search AND the planner/breaks strip (which references
// carts by 1-based carts.txt line = i + 1). A disabled cart is excluded here
// entirely — it can't be found, previewed, or queued from anywhere in the
// player. The index maps to a board section by the same from/to ranges the
// section selectors use, so a result can show its page and jump there.
$allCarts  = [];
$enabledStates = load_enabled_states();
$crossStates   = load_cross_states();
$chainFades    = load_chain_fades();
foreach (load_carts() as $i => $line) {
    $p    = explode('|', $line);
    $name = trim($p[0] ?? '');
    $file = trim($p[1] ?? '');
    if ($name === '' || $name === '-' || $file === '' || $file === '0.mp3') continue;
    if (($enabledStates[$i] ?? 1) === 0) continue;
    $allCarts[] = [
        'i'      => $i,
        'name'   => $name,
        'file'   => $file,
        'start'  => (float) ($p[2] ?? 0),
        'color'  => trim($p[3] ?? '1'),
        'end'    => (isset($p[4]) && $p[4] !== '') ? (float) $p[4] : null,
        'volume' => (isset($p[5]) && $p[5] !== '') ? (float) $p[5] : 1,
        // Chain flag + the crossfade INTO the next cart (chain editor) —
        // DJ decks and the board both honour these at playout.
        'cross'     => (int) ($crossStates[$i] ?? 0),
        'chainFade' => (int) ($chainFades[$i] ?? 0),
    ];
}

// The daily commercial-breaks plan (planner-editable, admin-gated on save).
$breaks = load_breaks();

// Manager (admin) needs EVERY slot — including empty and disabled ones —
// plus the chain flags, so the Audio tab can edit, toggle and place items
// anywhere.
$managerCarts = [];
if (is_admin()) {
    foreach (load_carts() as $i => $line) {
        $p = array_pad(explode('|', $line), 6, '');
        $name = trim($p[0]); $file = trim($p[1]);
        $managerCarts[] = [
            'id'      => $i + 1,
            'name'    => $name,
            'file'    => $file,
            'start'   => (float) $p[2],
            'color'   => trim($p[3]) !== '' ? trim($p[3]) : '1',
            'end'     => trim($p[4]) !== '' ? (float) $p[4] : null,
            'volume'  => trim($p[5]) !== '' ? (float) $p[5] : 1,
            'cross'   => (int) ($crossStates[$i] ?? 0),
            'chainFade' => (int) ($chainFades[$i] ?? 0),
            'enabled' => (int) ($enabledStates[$i] ?? 1),
            'empty'   => ($name === '' || $name === '-' || $file === '' || $file === '0.mp3'),
        ];
    }
}

// Split the station name -> "DEMO RADIO" / "STATION" for the two-line brand mark.
$nameWords = preg_split('/\s+/', trim(station_name()));
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
    <link rel="stylesheet" href="<?= asset_v('assets/css/player.css') ?>">
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
            <!-- Carts mode <-> DJ mode toggle. Sits BEFORE the page dropdown
                 (which hides in DJ mode) so toggling never moves the button
                 under the cursor. -->
            <button type="button" class="icon-btn" id="chip-djmode" title="DJ mode / Carts mode" <?= $settings['dj_mode'] ? '' : 'disabled' ?>>
                <i class="ph ph-squares-four"></i><span class="status-dot red"></span>
            </button>
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
                <!-- Group A: the three always-on window/playlist toggles.
                     Feature switches (manager Options tab) disable buttons;
                     they stay visible even when off. -->
                <button type="button" class="icon-btn is-active" id="chip-clock" onclick="toggleClockWindow();" title="Clock">
                    <!-- A small LCD "12:00" — distinct from the autoplayer's
                         clock-with-a-note glyph. -->
                    <svg class="icon-digiclock" viewBox="0 0 30 20" width="24" height="17" aria-hidden="true"><rect x="1.5" y="1.5" width="27" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><text x="15" y="14" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="800" letter-spacing="0.5" fill="currentColor">12:00</text></svg>
                    <span class="status-dot red"></span>
                </button>
                <button type="button" class="icon-btn is-active" id="chip-ids" onclick="toggleIdsWindow();" title="Station IDs" <?= $settings['ids_window'] ? '' : 'disabled' ?>>
                    <i class="ph ph-radio"></i><span class="status-dot red"></span>
                </button>
                <button type="button" class="icon-btn" id="chip-auto" onclick="window.Automation && window.Automation.toggle();" title="Automation playlist" <?= $settings['automation'] ? '' : 'disabled' ?>>
                    <span class="icon-clocknote"><i class="ph ph-clock"></i><i class="ph-fill ph-music-note"></i></span><span class="status-dot red"></span>
                </button>
                <span class="icon-sep"></span>
                <!-- Group B: admin tools, each its own overlay/window. Logged
                     out they stay visible (grayed) and open the login page
                     instead of vanishing. -->
                <?php if (is_admin()): ?>
                <button type="button" class="icon-btn" id="chip-planner" title="Break planner" <?= $settings['automation'] ? '' : 'disabled' ?>>
                    <i class="ph ph-calendar-check"></i>
                </button>
                <button type="button" class="icon-btn" id="chip-audiomgr" title="Audio manager">
                    <i class="ph ph-waveform"></i>
                </button>
                <?php else: ?>
                <button type="button" class="icon-btn locked" id="chip-planner" title="Break planner — sign in" onclick="location.href='login.php';">
                    <i class="ph ph-calendar-check"></i>
                </button>
                <button type="button" class="icon-btn locked" id="chip-audiomgr" title="Audio manager — sign in" onclick="location.href='login.php';">
                    <i class="ph ph-waveform"></i>
                </button>
                <?php endif; ?>
                <!-- Group C: feature-gated one-shot actions, HIDDEN (not
                     grayed) when their switch is off — individually, so this
                     leading separator only appears when there's something
                     for it to separate (never two in a row). -->
                <span class="icon-sep" id="groupCSep" <?= ($settings['download'] || $settings['mobile']) ? '' : 'hidden' ?>></span>
                <a class="icon-btn" id="chip-download" href="download.php" title="Download" <?= $settings['download'] ? '' : 'hidden' ?>>
                    <i class="ph ph-download-simple"></i>
                </a>
                <button type="button" class="icon-btn" id="qr-chip" onclick="showQR();" title="Mobile access" <?= $settings['mobile'] ? '' : 'hidden' ?>>
                    <i class="ph ph-device-mobile"></i>
                </button>
                <span class="icon-sep"></span>
                <!-- Group D: settings (Station manager). Admin-button
                     convention — visible, grayed, and opens the login page
                     when logged out. -->
                <?php if (is_admin()): ?>
                <button type="button" class="icon-btn" id="chip-gear" title="Settings">
                    <i class="ph ph-gear"></i>
                </button>
                <?php else: ?>
                <button type="button" class="icon-btn locked" id="chip-gear" title="Settings — sign in" onclick="location.href='login.php';">
                    <i class="ph ph-gear"></i>
                </button>
                <?php endif; ?>
                <?php if (SHOW_UTILITY_CHIPS): ?>
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
                    <option value="grid.php?from=0&to=10&pagination=0&smalltext=15&smallbacktimer=1&btnh=76"><?= htmlspecialchars($idSectionNames[0]) ?></option>
                    <option value="grid.php?from=110&to=120&pagination=0&smalltext=15&smallbacktimer=1&btnh=76"><?= htmlspecialchars($idSectionNames[1]) ?></option>
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
            <!-- Masks the grid's responsive reflow when this window reloads. -->
            <div class="win-reload-mask" id="floatIdsMask"><div class="win-reload-bar"><i></i></div></div>
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
                <!-- Masks the board's responsive reflow on a forced reload (Stop all). -->
                <div class="win-reload-mask" id="boardMask"><div class="win-reload-bar"><i></i></div></div>

                <!-- DJ mode: replaces the board (which stays loaded, just
                     hidden) with a 60/40 split — the library tree on the
                     left, two fully MANUAL player decks on the right. Built
                     and driven by assets/js/dj.js from window.CARTS. -->
                <div class="dj-mode" id="djMode" hidden>
                    <div class="dj-tree">
                        <div class="ptree-toolbar dj-toolbar">
                            <div class="ma-search-wrap">
                                <input type="text" class="ptree-search" id="djSearch" placeholder="Search carts&hellip;" autocomplete="off">
                                <button type="button" class="ma-search-clear" id="djSearchClear" title="Clear" hidden><i class="ph ph-x"></i></button>
                            </div>
                            <button type="button" class="ptree-fav-filter" id="djFavFilter" title="Show favourites only"><i class="ph ph-star"></i></button>
                        </div>
                        <div class="ptree-scroller dj-tree-scroller" id="djTree"></div>
                        <!-- Small full-width PFL (preview) player, docked under the
                             tree: the library's per-row preview button and each
                             deck's PFL button both send a single cart here. Gated
                             by the manager Routing tab's "Allow PFL player" switch. -->
                        <div class="dj-pfl" id="djPfl">
                            <span class="dj-pfl-label">PFL</span>
                            <span class="dj-pfl-name">-</span>
                            <div class="dj-pfl-bar"><i></i></div>
                            <span class="dj-pfl-out" title="Assigned output (manager &rsaquo; Routing)"></span>
                            <button type="button" class="dj-pfl-stop" id="djPflStop" disabled title="Stop"><i class="ph-fill ph-stop"></i></button>
                        </div>
                    </div>
                    <!-- Drag to widen the library tree (Options tab's "Allow
                         panel resize", off by default). Severely capped span —
                         min is the tree's own default width, can't shrink it. -->
                    <div class="panel-resize-handle" id="treeResizeHandle" title="Drag to resize" hidden></div>
                    <div class="dj-decks">
                        <?php foreach ([1, 2, 3] as $deckNo): ?>
                        <div class="dj-deck" id="djDeck<?= $deckNo ?>" data-deck="<?= $deckNo ?>">
                            <div class="dj-deck-head">
                                <span class="dj-deck-num"><?= $deckNo ?></span>
                                <span class="dj-deck-name"></span>
                                <span class="dj-deck-onair">ON AIR</span>
                                <span class="dj-deck-endtime" title="Wall-clock time the whole load will end"></span>
                                <span class="dj-deck-out" title="Assigned output (manager &rsaquo; Routing)"></span>
                            </div>
                            <div class="dj-deck-mid">
                                <!-- Big square transport: THE button of the deck. -->
                                <button type="button" class="dj-deck-play" disabled title="Play / pause"><i class="ph-fill ph-play"></i></button>
                                <span class="dj-deck-empty">Fire a cart from the library</span>
                                <!-- Waveform of the item on deck; the progress
                                     wash sweeps OVER it while playing. -->
                                <div class="dj-deck-wavebox" hidden>
                                    <canvas class="dj-deck-wave"></canvas>
                                    <div class="dj-deck-wash"></div>
                                    <span class="dj-deck-chainpos" hidden></span>
                                </div>
                                <!-- Audio-reactive VU meter, full height of the player area. -->
                                <div class="dj-deck-vu"><div class="dj-deck-vu-fill"></div></div>
                            </div>
                            <div class="dj-deck-foot">
                                <div class="dj-deck-btns">
                                    <button type="button" class="dj-deck-stop" disabled title="Stop"><i class="ph-fill ph-stop"></i></button>
                                    <button type="button" class="dj-deck-repeat" disabled title="Repeat"><i class="ph ph-repeat"></i></button>
                                    <button type="button" class="dj-deck-eject" disabled title="Unload"><i class="ph ph-eject"></i></button>
                                    <button type="button" class="dj-deck-pfl" disabled title="PREVIEW (PFL)"><span class="pfl-icon"><i class="ph ph-speaker-simple-high"></i></span></button>
                                </div>
                                <!-- Countdown: big, and red for the last 4 seconds. -->
                                <span class="dj-deck-time"><b class="dj-deck-remain">0:00</b><span class="dj-deck-total">/ <span class="dj-deck-len">0:00</span></span></span>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>
            </div>

            <!-- Bottom dock resize handle: drag to resize the dock's height. A
                 ghost line previews the drop point without live-resizing;
                 it turns red past the min/max and snaps to that limit if
                 released there. -->
            <div class="dock-resize-handle" id="dockResizeHandle" title="Drag to resize" hidden></div>
            <div class="dock-resize-ghost" id="dockResizeGhost" hidden></div>
            <!-- Shared vertical ghost line for the DJ tree / automation
                 sidebar width-resize handles (see panel-resize-handle below). -->
            <div class="panel-resize-ghost" id="panelResizeGhost" hidden></div>
            <!-- Bottom dock: the clock and/or Station-ID views can be docked here.
                 The layout adapts to what's docked (see renderDock below). -->
            <div class="dock-bar" id="dockBar">
                <div class="dock-pane dock-clock" id="dockClock" style="display:none;">
                    <div class="dock-header">
                        <div class="dock-header-select-wrap">
                            <select id="dockClockSelect" class="dock-header-select">
                                <option value="0">Clock</option>
                                <option value="1">Time to end of hour</option>
                            </select>
                            <i class="ph ph-caret-down"></i>
                        </div>
                        <button class="dock-undock" onclick="undock('clock')" title="Pop back out"><i class="ph ph-arrow-line-up"></i></button>
                    </div>
                    <!-- Shared-dock (clock + IDs): one view, per the dropdown. -->
                    <iframe class="dock-clock-frame" id="dockClockFrame" scrolling="no"></iframe>
                    <!-- Clock ALONE (carts mode): the full trio — big digital
                         clock with seconds | the ring | time to end of hour —
                         with the dropdown locked on "Clock" as the header.
                         DJ mode slims it back to the ring (see player.css). -->
                    <div class="dock-clock-multi" id="dockClockMulti" hidden>
                        <div class="dock-clock-digital" id="dockClockDigital">--:--:--</div>
                        <span class="dock-vsep"></span>
                        <iframe class="dock-clock-ring" id="dockClockRing" scrolling="no"></iframe>
                        <span class="dock-vsep"></span>
                        <iframe class="dock-clock-count" id="dockClockCount2" scrolling="no"></iframe>
                    </div>
                </div>
                <div class="dock-pane dock-ids" id="dockIds" style="display:none;">
                    <div class="dock-header">
                        <div class="dock-header-select-wrap">
                            <select id="dockIdsSelect" class="dock-header-select"></select>
                            <i class="ph ph-caret-down"></i>
                        </div>
                        <button class="dock-undock" onclick="undock('ids')" title="Pop back out"><i class="ph ph-arrow-line-up"></i></button>
                    </div>
                    <iframe class="dock-ids-frame" id="dockIdsFrame" scrolling="no"></iframe>
                    <!-- Masks the grid's responsive reflow when this window reloads. -->
                    <div class="win-reload-mask" id="dockIdsMask"><div class="win-reload-bar"><i></i></div></div>
                </div>
            </div>
        </div>

        <!-- Meter bridge: master + per-source level/GR/limiting readouts, driven
             directly by audio-engine.js's analysers (same document, no
             postMessage) — see the inline script right after that engine's
             <script> tag near the end of this file. Cart Wall stays idle until
             Stage 2 of the persistent-audio-engine work connects cart playback
             through the engine; Autoplayer/Player 1-3 light up once Stage 1's
             connectAutoplayer()/connectDeck() calls land. -->
        <div class="meter-bridge" id="meterBridge">
            <div class="meter-ch" data-ch="cartwall"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label">CART WALL</span></div>
            <div class="meter-ch" data-ch="auto"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label">AUTO</span></div>
            <div class="meter-ch" data-ch="player1"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label">PLAYER 1</span></div>
            <div class="meter-ch" data-ch="player2"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label">PLAYER 2</span></div>
            <div class="meter-ch" data-ch="player3"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label">PLAYER 3</span></div>
            <span class="meter-sep"></span>
            <div class="meter-ch meter-master" data-ch="master"><div class="meter-track"><div class="meter-fill"></div></div><span class="meter-label">MASTER</span></div>
            <div class="meter-ch meter-gr" data-ch="agc"><div class="meter-track meter-track-gr"><div class="meter-fill"></div></div><span class="meter-label">AGC</span></div>
            <div class="meter-ch meter-gr" data-ch="comp"><div class="meter-track meter-track-gr"><div class="meter-fill"></div></div><span class="meter-label">COMP</span></div>
            <div class="meter-ch meter-gr" data-ch="limit"><div class="meter-track meter-track-gr"><div class="meter-fill"></div></div><span class="meter-label">LIMIT</span></div>
        </div>

        <!-- Drag to widen the automation sidebar (Options tab's "Allow panel
             resize", off by default). Severely capped span — min is the
             panel's own default width, can't shrink it. -->
        <div class="panel-resize-handle" id="autoResizeHandle" title="Drag to resize" hidden></div>

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

            <!-- Cross (overlap) editor — opened by the thin ✕ gap buttons the
                 planner renders between queue items. A floating square window
                 anchored over its gap (overlapping the rows above/below). Top
                 lane: the END of the item above; bottom lane: the START of the
                 item below (drag ⇄ left to launch before the top one ends),
                 both with real decoded waveforms. Play previews the joint with
                 a read-only playhead — touching the lanes stops it. -->
            <div class="cross-editor" id="crossEditor" hidden>
                <div class="cross-head">
                    <span class="cross-title" id="crossTitle"></span>
                    <span class="cross-readout" id="crossReadout">no overlap</span>
                </div>
                <div class="cross-lanes" id="crossLanes">
                    <div class="cross-junction" id="crossJunction"></div>
                    <div class="cross-playhead" id="crossPlayhead" hidden></div>
                    <!-- Gray strip between the lanes marking the overlap span. -->
                    <div class="cross-overlap-track" id="crossOverlapTrack"></div>
                    <!-- Each block: waveform canvas + a single flat volume-
                         automation line (no nodes) with its drag handle at the
                         block's centre — up = louder, top = 100%. -->
                    <div class="cross-block cross-block-a" id="crossBlockA">
                        <canvas class="cross-wave"></canvas>
                        <div class="cross-vol-line"></div>
                        <div class="cross-vol-handle" title="Volume"><span></span></div>
                        <span class="cross-name"></span>
                    </div>
                    <div class="cross-block cross-block-b" id="crossBlockB">
                        <canvas class="cross-wave"></canvas>
                        <div class="cross-vol-line"></div>
                        <div class="cross-vol-handle" title="Volume"><span></span></div>
                        <span class="cross-name"></span>
                        <i class="ph ph-arrows-left-right cross-drag-hint"></i>
                    </div>
                </div>
                <div class="cross-scale">
                    <span id="crossScaleTail"></span>
                    <span class="cross-scale-mid">item boundary</span>
                    <span id="crossScaleHead"></span>
                </div>
                <div class="cross-btns">
                    <button type="button" class="cross-btn" id="crossPlay" title="Preview the joint"><i class="ph-fill ph-play"></i> Play</button>
                    <button type="button" class="cross-btn cross-clear" id="crossClear" title="Remove the overlap and close"><i class="ph ph-arrow-counter-clockwise"></i> Clear</button>
                    <button type="button" class="cross-btn cross-save" id="crossSave" disabled><i class="ph ph-floppy-disk"></i> Save</button>
                    <button type="button" class="cross-btn" id="crossCancel">Cancel</button>
                </div>
                <!-- Combined VU (both items summed) while the preview runs. -->
                <div class="cross-vu"><div class="cross-vu-fill" id="crossVuFill"></div></div>
            </div>

            <div class="auto-total" id="autoTotalRow"><span id="autoTotalLabel">Total</span><span id="autoTotal">0:00</span></div>

            <!-- Playback control area: mode switch always; AUTO shows the clocks,
                 MANUAL shows the transport controls. -->
            <div class="auto-controls">
                <div class="auto-mode-switch" id="autoModeSwitch">
                    <button data-mode="auto" id="autoModeAuto" class="active"><span class="auto-armed-dot" id="autoArmedDot"></span>AUTO</button>
                    <button data-mode="manual" id="autoModeManual">MANUAL</button>
                    <span class="auto-out-badge" id="autoOutBadge" title="Assigned output (manager &rsaquo; Routing)"></span>
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

    <!-- Attribution link back to the source repo (view-only license — see
         LICENSE). Sits just above the footer ticker; when the ticker is
         hidden (see .source-link below) it moves to the opposite corner
         instead of crowding the minimized status pill. -->
    <a href="<?= htmlspecialchars(SOURCE_URL) ?>" target="_blank" rel="noopener" class="source-link">
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
                <!-- Admin's management lives behind the topbar gearwheel now
                     (not this chip); DJ still opens its own page from here. -->
                <?php if (is_admin()): ?>
                <span class="chip-main">
                    <span class="avatar"><i class="ph-fill ph-user"></i></span>
                    <span class="chip-reveal">Admin</span>
                </span>
                <?php else: ?>
                <a class="chip-main" href="dj.php" title="Open DJ page">
                    <span class="avatar"><i class="ph-fill ph-user"></i></span>
                    <span class="chip-reveal">DJ</span>
                </a>
                <?php endif; ?>
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
        <span class="ticker-msg" id="tickerMsg"><?= $statusText !== '' ? htmlspecialchars($statusText, ENT_QUOTES, 'UTF-8') : 'Welcome to the Web-based Cart Player demo &mdash; right-click a cart to schedule it for the top of the hour.' ?></span>
        <?php if (is_admin()): ?>
        <!-- In-GUI ticker edit (admin-only): pencil swaps the message for a
             single-line input; Enter/blur saves, Escape discards. -->
        <input type="text" class="ticker-edit-input" id="tickerEditInput" maxlength="200" autocomplete="off" hidden>
        <button type="button" class="ticker-edit-btn" id="tickerEditBtn" title="Edit ticker"><i class="ph ph-pencil-simple"></i></button>
        <?php endif; ?>
    </div>

    <!-- Small log popups opened by clicking the footer status dots. -->
    <div class="log-popup" id="pingLog" hidden>
        <div class="log-popup-head">
            <span class="log-popup-title">Server ping</span>
            <?php if ($serverLabel !== ''): ?>
            <span class="log-popup-server" title="The backend this frontend is pinging"><?= htmlspecialchars($serverLabel) ?></span>
            <?php endif; ?>
            <button type="button" class="log-popup-x" aria-label="Close"><i class="ph ph-x"></i></button>
        </div>
        <div class="log-popup-body" id="pingLogBody"></div>
    </div>
    <div class="log-popup" id="heartbeatLog" hidden>
        <div class="log-popup-head"><span class="log-popup-title">Audio keep-alive &middot; heartbeat log</span><button type="button" class="log-popup-x" aria-label="Close"><i class="ph ph-x"></i></button></div>
        <div class="log-popup-body" id="heartbeatLogBody"></div>
    </div>

    <?php if (is_admin()): ?>
    <!-- Audio manager overlay (admin): its own window, separate from the
         Station manager below — every slot (incl. empty/disabled) in a
         sections list + one detail panel. Rendered by audio-manager.js from
         MANAGER_DATA. Field edits (enable/name/volume/chain/colour/trim, and
         the chain crossfade editor's own Save) are a draft, committed only on
         Save & Close — Move/Delete/Upload are immediate, structural actions
         (like Maintenance's danger zone) and silently flush any pending draft
         edits first so nothing is lost or left inconsistent with the server. -->
    <div class="planner-overlay" id="audioManagerOverlay" hidden>
        <div class="planner-frame">
            <header class="planner-head">
                <h2><i class="ph ph-waveform"></i> Audio manager</h2>
                <div class="planner-head-actions">
                    <span class="planner-msg" id="audioManagerMsg"></span>
                    <button type="button" class="planner-save" id="audioManagerSave"><i class="ph ph-floppy-disk"></i> Save &amp; Close</button>
                    <button type="button" class="planner-cancel" id="audioManagerCancel" title="Discard changes (Esc)">Cancel</button>
                </div>
            </header>
            <!-- Styled discard-confirmation (replaces the native confirm()). -->
            <div class="planner-confirm" id="audioManagerConfirm" hidden>
                <div class="planner-confirm-box">
                    <i class="ph ph-warning-circle"></i>
                    <p>Discard unsaved changes to the audio library?</p>
                    <div class="planner-confirm-actions">
                        <button type="button" id="audioManagerConfirmDiscard" class="pc-discard">Discard changes</button>
                        <button type="button" id="audioManagerConfirmKeep" class="pc-keep">Keep editing</button>
                    </div>
                </div>
            </div>
            <div class="mgr-body">
                <div class="mgr-pane mgr-audio" id="mgrPaneAudio">
                    <div class="ma-list-col">
                        <div class="ptree-toolbar">
                            <div class="ma-search-wrap">
                                <input type="text" class="ptree-search" id="maSearch" placeholder="Search carts&hellip;" autocomplete="off">
                                <button type="button" class="ma-search-clear" id="maSearchClear" title="Clear" hidden><i class="ph ph-x"></i></button>
                            </div>
                            <button type="button" class="ptree-fav-filter" id="maFavFilter" title="Show favourites only"><i class="ph ph-star"></i></button>
                        </div>
                        <div class="ptree-scroller" id="maList"></div>
                    </div>
                    <div class="ma-detail" id="maDetail">
                        <p class="mgr-stub" id="maEmptyHint"><i class="ph ph-cursor-click"></i> Pick a cart on the left to edit it.</p>
                        <!-- Empty slot: nothing but an uploader until a file lands. -->
                        <div class="ma-empty-upload" id="maEmptyUpload" hidden>
                            <p>This slot is empty. Upload an MP3 to start editing it.</p>
                            <button type="button" class="ma-btn" id="maEmptyUploadBtn"><i class="ph ph-upload-simple"></i> Upload audio</button>
                            <p class="ma-upload-hint">MP3 only, max 30&nbsp;MB (roughly 30&nbsp;minutes at typical bitrates).</p>
                        </div>
                        <div id="maForm" hidden>
                            <!-- Group 1: enabled + big name (small pencil beside it) + full/trimmed length -->
                            <div class="ma-row">
                                <label>Enabled</label>
                                <label class="ma-chain"><input type="checkbox" class="opt-switch" id="maEnabled"><span>Playable and can be added to lists</span></label>
                            </div>
                            <div class="ma-row ma-name-row">
                                <label>Name</label>
                                <div class="ma-name-wrap">
                                    <span class="ma-name-text" id="maNameText"></span>
                                    <input type="text" id="maName" maxlength="60" autocomplete="off" hidden>
                                    <button type="button" class="pbreak-edit" id="maNameEdit" title="Rename"><i class="ph ph-pencil-simple"></i></button>
                                    <button type="button" class="pbreak-edit" id="maFav" title="Favourite"><i class="ph ph-star"></i></button>
                                    <span class="ma-length-info" id="maLengthInfo" title="Full length &middot; trimmed length"></span>
                                </div>
                            </div>
                            <div class="ma-row"><label>Colour</label><div class="ma-swatches" id="maSwatches"></div></div>
                            <hr class="ma-hr">
                            <!-- Group 2: volume + inline trimmer -->
                            <div class="ma-row"><label>Volume</label><input type="range" class="ma-volume-short" id="maVolume" min="0" max="100" step="5"><span class="ma-vol-val" id="maVolVal">100%</span></div>
                            <div class="ma-row ma-row-top"><label>Trim</label>
                                <div class="ma-trimmer" id="maTrimmer">
                                    <div class="ma-wave-wrap">
                                        <div id="maWaveform"></div>
                                        <div class="ma-handle ma-handle-start" id="maHandleStart"></div>
                                        <div class="ma-handle ma-handle-end" id="maHandleEnd"></div>
                                    </div>
                                    <div class="ma-trim-times">
                                        <span>Start <b id="maTStart">0:00.0</b></span>
                                        <span>End <b id="maTEnd">0:00.0</b></span>
                                        <span>Length <b id="maTLen">0:00.0</b></span>
                                    </div>
                                    <div class="ma-audio-btns">
                                        <button type="button" class="ma-btn" id="maPlayFull"><i class="ph-fill ph-play"></i> Play</button>
                                        <button type="button" class="ma-btn" id="maPlayTrim"><i class="ph ph-brackets-square"></i> Play trimmed</button>
                                    </div>
                                </div>
                            </div>
                            <hr class="ma-hr">
                            <!-- Group 3: chain -->
                            <div class="ma-row"><label>Chain</label>
                                <div class="ma-chain-group">
                                    <label class="ma-chain"><input type="checkbox" class="opt-switch" id="maChain"><span>Auto-play the next cart when this one ends</span></label>
                                    <button type="button" class="ma-btn" id="maChainEdit" hidden><i class="ph ph-flow-arrow"></i> Edit chain</button>
                                </div>
                            </div>
                            <hr class="ma-hr">
                            <!-- Group 4: download + upload/replace, side by side -->
                            <div class="ma-row"><label>Audio file</label>
                                <div class="ma-audio-btns">
                                    <a class="ma-btn" id="maDownload" download><i class="ph ph-download-simple"></i> Download</a>
                                    <input type="file" id="maAudioFile" accept=".mp3,audio/mpeg" hidden>
                                    <button type="button" class="ma-btn" id="maAudioUpload"><i class="ph ph-upload-simple"></i> Upload / replace</button>
                                </div>
                            </div>
                            <hr class="ma-hr">
                            <!-- Group 5: move, right above clear (danger, two-step confirm) -->
                            <div class="ma-row"><label>Move</label>
                                <div class="ma-audio-btns">
                                    <select class="ma-select" id="maMoveSlot"></select>
                                    <button type="button" class="ma-btn" id="maMoveBtn"><i class="ph ph-arrows-down-up"></i> Move</button>
                                </div>
                            </div>
                            <div class="ma-row ma-danger-row">
                                <label></label>
                                <button type="button" class="ma-btn danger" id="maDelete"><i class="ph ph-trash"></i> Clear this slot</button>
                                <span class="ma-confirm" id="maDeleteConfirm" hidden>
                                    Are you sure?
                                    <button type="button" class="ma-btn danger" id="maDeleteYes">Yes, clear it</button>
                                    <button type="button" class="ma-btn" id="maDeleteNo">Cancel</button>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <!-- Chain crossfade editor: EDIT CHAIN opens the chain run (up to
                 5 items) as staggered waveform lanes — drag a lane left to
                 deepen its fade into the previous item, ride each lane's
                 volume line, preview the whole join. Fades save to cross.txt,
                 volumes to the carts themselves. -->
            <div class="chain-ed-modal" id="chainEditor" hidden>
                <div class="chain-ed-box">
                    <div class="chain-ed-head">
                        <h4 id="chainEdTitle">Chain crossfade</h4>
                        <span class="cross-readout" id="chainEdInfo"></span>
                    </div>
                    <div class="chain-lanes" id="chainLanes">
                        <div class="cross-playhead" id="chainPlayhead" hidden></div>
                    </div>
                    <div class="chain-ed-btns">
                        <button type="button" class="ma-btn" id="chainEdPlay"><i class="ph-fill ph-play"></i> Play</button>
                        <span class="chain-ed-out auto-out-badge" id="chainEdOut" title="Assigned output (manager &rsaquo; Routing)"></span>
                        <span class="chain-ed-note" id="chainEdNote"></span>
                        <button type="button" class="ma-btn chain-ed-save" id="chainEdSave" disabled><i class="ph ph-floppy-disk"></i> Save</button>
                        <button type="button" class="ma-btn" id="chainEdCancel">Cancel</button>
                    </div>
                    <div class="cross-vu"><div class="cross-vu-fill" id="chainVuFill"></div></div>
                </div>
            </div>
        </div>
    </div>

    <!-- Station manager overlay (admin): Station | Options | Routing | Maintenance.
         Reuses the planner's frame styling for unity. Station/Options/Routing are
         a draft, committed only on Save & Close (Cancel discards, confirming first
         if dirty) — Maintenance stays action-based (logs, backup/restore, danger
         zone all take effect immediately). -->
    <div class="planner-overlay" id="managerOverlay" hidden>
        <div class="planner-frame">
            <header class="planner-head">
                <h2><i class="ph ph-gear"></i> Station manager</h2>
                <div class="planner-head-actions">
                    <span class="planner-msg" id="managerMsg"></span>
                    <button type="button" class="planner-save" id="managerSave"><i class="ph ph-floppy-disk"></i> Save &amp; Close</button>
                    <button type="button" class="planner-cancel" id="managerCancel" title="Discard changes (Esc)">Cancel</button>
                </div>
            </header>
            <!-- Styled discard-confirmation (replaces the native confirm()). -->
            <div class="planner-confirm" id="managerConfirm" hidden>
                <div class="planner-confirm-box">
                    <i class="ph ph-warning-circle"></i>
                    <p>Discard unsaved changes to the station settings?</p>
                    <div class="planner-confirm-actions">
                        <button type="button" id="managerConfirmDiscard" class="pc-discard">Discard changes</button>
                        <button type="button" id="managerConfirmKeep" class="pc-keep">Keep editing</button>
                    </div>
                </div>
            </div>
            <div class="mgr-tabs">
                <button type="button" class="mgr-tab active" data-tab="station">Station</button>
                <button type="button" class="mgr-tab" data-tab="options">Options</button>
                <button type="button" class="mgr-tab" data-tab="routing">Routing</button>
                <button type="button" class="mgr-tab" data-tab="maintenance">Maintenance</button>
            </div>
            <div class="mgr-body">
                <!-- STATION: identity + ticker + section labels + ID-window names. -->
                <div class="mgr-pane" id="mgrPaneStation">
                    <div class="ma-row"><label>Station name</label><input type="text" id="stName" maxlength="60" autocomplete="off" placeholder="<?= htmlspecialchars(STATION_NAME) ?>"></div>
                    <div class="ma-row"><label>Logo</label>
                        <div class="ma-audio-btns">
                            <img id="stLogoPreview" class="st-logo" alt="logo" src="<?= htmlspecialchars(station_logo()) ?>">
                            <input type="file" id="stLogoFile" accept=".svg,.png" hidden>
                            <button type="button" class="ma-btn" id="stLogoUpload"><i class="ph ph-upload-simple"></i> Upload</button>
                            <button type="button" class="ma-btn" id="stLogoReset"><i class="ph ph-arrow-counter-clockwise"></i> Default</button>
                        </div>
                    </div>
                    <div class="ma-row"><label>Ticker</label><input type="text" id="stTicker" maxlength="200" autocomplete="off"></div>
                    <div class="ma-row"><label>Show ticker</label><input type="checkbox" class="opt-switch" id="stShowTicker" title="Show the scrolling status message in the footer bar"></div>
                    <div class="ma-row"><label>Sections</label><div class="st-labels" id="stLabels"></div></div>
                    <div class="ma-row"><label>ID window 1</label><input type="text" id="stIdName1" maxlength="30" autocomplete="off" placeholder="Station IDs"></div>
                    <div class="ma-row"><label>ID window 2</label><input type="text" id="stIdName2" maxlength="30" autocomplete="off" placeholder="Sweepers &amp; FX"></div>
                    <p class="mgr-stub st-note">Name &amp; ticker apply on the next reload of each screen.</p>
                </div>
                <div class="mgr-pane" id="mgrPaneOptions" hidden>
                    <div class="opt-list" id="optList"></div>
                    <button type="button" class="opt-link" id="optRegenQr" title="Not wired up yet"><i class="ph ph-qr-code"></i> Regenerate QR code</button>
                    <div class="opt-actions">
                        <a class="opt-link" href="admin.php"><i class="ph ph-clock-counter-clockwise"></i> Legacy admin panel</a>
                    </div>
                </div>
                <!-- ROUTING: which of the four SIMULATED stereo outputs each
                     DJ player and the PFL (preview) bus feeds. GUI-level
                     until the appification phase maps them to real devices. -->
                <div class="mgr-pane" id="mgrPaneRouting" hidden>
                    <p class="mgr-stub-text">Four simulated stereo outputs (<b>OUT 1&ndash;4</b>) for GUI testing —
                        assignments are stored and shown across the player, and will map to real sound
                        devices in the desktop build.</p>
                    <div class="opt-list" id="routingList"></div>
                    <hr class="ma-hr">
                    <!-- PFL (preview): the small mini-player docked under the DJ
                         library, its per-row/per-deck send buttons, and the
                         output every single-play preview (planner tree, audio
                         manager, DJ library) carries. -->
                    <div class="mnt-section">
                        <h3>PFL (preview)</h3>
                        <div class="opt-list" id="pflOptList"></div>
                    </div>
                </div>
                <!-- MAINTENANCE: backup/restore (.cartdb, cross-compatible with any
                     station built on the same helpers), runtime logs, and the
                     danger zone (moved here from Options). -->
                <div class="mgr-pane" id="mgrPaneMaintenance" hidden>
                    <div class="mnt-section">
                        <div class="mnt-section-head">
                            <h3>Backup &amp; restore</h3>
                            <button type="button" class="mnt-info-btn" id="mntBackupInfoBtn" title="What is this?">?</button>
                        </div>
                        <p class="mgr-stub-text" id="mntBackupInfo" hidden>A backup is a single <b>.cartdb</b> file (all audio + the pseudo-database). Restoring OVERWRITES the current station. A raw legacy carts.txt/uploads folder (e.g. from an older station) needs to be zipped into the same audio.zip + db.zip shape first — the field format itself (name|file|start|colour|end|volume) already matches.</p>
                        <form method="post" action="backup.php" target="_blank" class="mnt-form">
                            <button type="submit" name="create_backup" class="ma-btn"><i class="ph ph-download-simple"></i> Download full backup (.cartdb)</button>
                        </form>
                        <form method="post" action="backup.php" enctype="multipart/form-data" target="_blank" class="mnt-form">
                            <input type="file" name="backup_file" accept=".cartdb" required class="mnt-file">
                            <button type="submit" name="restore_backup" class="ma-btn danger"><i class="ph ph-upload-simple"></i> Restore from backup</button>
                        </form>
                    </div>
                    <hr class="ma-hr">
                    <div class="mnt-section">
                        <h3>Logs</h3>
                        <div class="opt-row">
                            <span class="opt-text"><b>Keep logs for</b><small>Older entries are purged automatically whenever the player page loads</small></span>
                            <select class="ma-select" id="mntLogRetention">
                                <option value="30">30 days</option>
                                <option value="60">60 days</option>
                                <option value="90">90 days</option>
                                <option value="180">180 days</option>
                                <option value="0">Forever</option>
                            </select>
                        </div>
                        <!-- Two small always-on scrollable panes, no popover — each with
                             its own file-size readout and an immediate "Clear now". -->
                        <div class="mnt-log-panes">
                            <div class="mnt-log-pane">
                                <div class="mnt-log-pane-head">
                                    <h4>Keep-alive</h4>
                                    <span class="mnt-log-size" id="mntLogSize-keepalive">&ndash;</span>
                                    <button type="button" class="ma-btn danger" data-log="keepalive"><i class="ph ph-trash"></i> Clear now</button>
                                </div>
                                <pre class="mnt-log-view" id="mntLogView-keepalive">Loading&hellip;</pre>
                            </div>
                            <div class="mnt-log-pane">
                                <div class="mnt-log-pane-head">
                                    <h4>Playback</h4>
                                    <span class="mnt-log-size" id="mntLogSize-playback">&ndash;</span>
                                    <button type="button" class="ma-btn danger" data-log="playback"><i class="ph ph-trash"></i> Clear now</button>
                                </div>
                                <pre class="mnt-log-view" id="mntLogView-playback">Loading&hellip;</pre>
                            </div>
                        </div>
                    </div>
                    <hr class="ma-hr">
                    <!-- Danger zone: destructive resets, guarded by a typed confirmation. -->
                    <div class="opt-danger">
                        <div class="opt-danger-head">Danger zone</div>
                        <p class="opt-danger-hint">Type <b>clear</b> to arm the buttons. Audio files in uploads/ are never touched.</p>
                        <input type="text" id="optClearConfirm" class="opt-clear-input" placeholder="type clear here" autocomplete="off">
                        <div class="opt-danger-btns">
                            <button type="button" class="opt-danger-btn" id="optClearPlanner" disabled><i class="ph ph-calendar-x"></i> Clear planner data</button>
                            <button type="button" class="opt-danger-btn" id="optClearAll" disabled><i class="ph ph-warning"></i> Clear whole DB</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

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

        // Feature switches (data/settings.txt) — UI-level button gating only.
        window.SETTINGS = <?= json_encode($settings) ?>;
        // Set before any OUT badge / ticker paints, so there's no on/off flash.
        document.body.classList.toggle('hide-out-labels', !window.SETTINGS.show_out_labels);
        document.body.classList.toggle('hide-ticker', !window.SETTINGS.show_ticker);
        document.body.classList.toggle('dock-resize-off', !window.SETTINGS.dock_resize);
        document.body.classList.toggle('panel-resize-off', !window.SETTINGS.panel_resize);

        // Output routing (data/routing.txt): which SIMULATED stereo out each
        // DJ player and the PFL (preview) bus feeds. GUI-level for now.
        window.ROUTING = <?= json_encode(load_routing()) ?>;
<?php if (is_admin()): ?>
        // Manager data (admin): every slot incl. placeholders + chain flags,
        // and the Station tab's current values.
        window.MANAGER_DATA = <?= json_encode([
            'carts'          => $managerCarts,
            'labels'         => $labels,
            'ticker'         => $statusText,
            'stationName'    => station_name(),
            'logo'           => station_logo(),
            'idSectionNames' => $idSectionNames,
        ], JSON_UNESCAPED_UNICODE) ?>;
<?php endif; ?>

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
            showReloadMask('boardMask'); // same responsive-reflow jank as Stop all
            document.getElementById('cartgrid').src = url;
        });
        document.getElementById('ids-select').addEventListener('change', (e) => {
            document.getElementById('floater').src = e.target.value;
            if (winState.ids.visible && !winState.ids.docked) maskIdSurface('float');
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
                    if (!here(iframe)) {
                        dockIdsIndex = secIndex; iframe.src = idSectionUrls[secIndex]; needLoad = true;
                        document.getElementById('dockIdsSelect').value = secIndex;
                    }
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
                if (previewBtn) { previewBtn.classList.remove('playing'); previewBtn = null; }
            }
            function togglePreview(cart, btn) {
                if (previewBtn === btn) { stopPreview(); return; }  // same one -> stop
                stopPreview();
                preview = new Audio(`uploads/${cart.file}`);
                try { preview.currentTime = cart.start || 0; } catch (e) {}
                preview.play().catch(() => {});
                previewBtn = btn; btn.classList.add('playing'); // static speaker-in-brackets icon, same as everywhere else
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
                // Extra fire buttons mirror whatever's actually on screen right
                // now: the DJ decks (however many are allowed/visible) and/or the
                // autoplayer (only while its panel is open) — none of either when
                // neither is showing. Preview stays PFL-gated, same as everywhere else.
                const djOn = !!(window.DJMode && window.DJMode.isActive());
                const djCount = djOn ? window.DJMode.playerCount() : 0;
                const autoPanel = document.getElementById('automationPanel');
                const autoOn = !!(autoPanel && autoPanel.classList.contains('active'));
                const pflOn = !!(window.SETTINGS && window.SETTINGS.pfl_player && window.SETTINGS.pfl_buttons_search);
                const extraBtns = Array.from({ length: djCount }, (_, k) => k + 1).map((n) =>
                        `<button type="button" class="search-btn search-fire" data-deck="${n}" title="Fire into Player ${n}">${n}</button>`).join('') +
                    (autoOn ? `<button type="button" class="search-btn search-auto" title="Send to autoplayer"><span class="icon-clocknote"><i class="ph ph-clock"></i><i class="ph-fill ph-music-note"></i></span></button>` : '');
                box.innerHTML = hits.map((c) => {
                    const sec = sectionFor(c.i);
                    const crumb = sec ? esc(sec.label) : '&mdash;';
                    return `<div class="search-row" data-i="${c.i}" role="option">` +
                        `<span class="search-dot" style="background:${CAT[c.color] || CAT['1']}"></span>` +
                        `<span class="search-name">${esc(c.name)}</span>` +
                        `<span class="search-crumb">${crumb}</span>` +
                        (pflOn ? `<button type="button" class="search-play" title="Preview (PFL)"><span class="pfl-icon"><i class="ph ph-speaker-simple-high"></i></span></button>` : '') +
                        extraBtns + `</div>`;
                }).join('');
                box.hidden = false;
                rows = [...box.querySelectorAll('.search-row')];
                rows.forEach((row) => {
                    const cart = carts.find((c) => c.i === +row.dataset.i);
                    const playBtn = row.querySelector('.search-play');
                    if (playBtn) playBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePreview(cart, playBtn); });
                    row.querySelectorAll('.search-fire').forEach((b) => b.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.DJMode.loadDeck(+b.dataset.deck, cart);
                        close();
                    }));
                    const autoBtn = row.querySelector('.search-auto');
                    if (autoBtn) autoBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.DJMode && window.DJMode.sendToAuto(cart);
                        close();
                    });
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

        // --- In-GUI ticker edit (admin-only): pencil -> single-line input,
        // Enter/blur saves (POST save-station.php), Escape discards.
        (() => {
            const btn = document.getElementById('tickerEditBtn');
            if (!btn) return; // not admin
            const msg = document.getElementById('tickerMsg');
            const inp = document.getElementById('tickerEditInput');
            let cancelled = false;
            function startEdit() {
                cancelled = false;
                inp.value = msg.textContent;
                msg.hidden = true;
                inp.hidden = false;
                inp.focus();
                inp.select();
            }
            async function commit() {
                inp.hidden = true;
                msg.hidden = false;
                if (cancelled) return;
                const value = inp.value.trim();
                if (value === msg.textContent) return; // unchanged
                try {
                    const r = await fetch('save-station.php', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ticker: value }),
                    });
                    const resp = await r.json();
                    if (resp.ok) msg.textContent = value;
                } catch (e) { /* best-effort — the field just reverts to the last saved text */ }
            }
            btn.addEventListener('click', startEdit);
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
                else if (e.key === 'Escape') { cancelled = true; inp.blur(); }
            });
            inp.addEventListener('blur', commit);
        })();

        // Big custom tooltips for the topbar buttons (the native title bubble
        // is tiny and slow) — the title text moves to data-tip, rendered by
        // a styled ::after in player.css.
        document.querySelectorAll('.topbar .icon-btn[title]').forEach((b) => {
            b.dataset.tip = b.getAttribute('title');
            b.removeAttribute('title');
        });

        // --- Toolbar actions.
        function stopAll() {
            // Both cart walls (the main board and whichever ID-window surface
            // is live) force-reload and visibly reflow — mask each one that's
            // actually on screen.
            showReloadMask('boardMask');
            if (winState.ids.visible) maskIdSurface(winState.ids.docked ? 'dock' : 'float');
            ['cartgrid', 'floater', 'dockIdsFrame'].forEach(id => {
                const iframe = document.getElementById(id);
                if (iframe && iframe.src && !iframe.src.includes('about:blank')) iframe.src = iframe.src;
            });
            if (window.Automation) window.Automation.stop();
            if (window.DJMode) window.DJMode.stopAll();
        }
        // Cart names/colours/enable-state/trims/labels can all change from the
        // Station manager or the Audio manager; both call this on close so the
        // board, the floating/docked ID windows, and the clock pick it up
        // without needing a full page reload. Only live (non about:blank)
        // frames are touched. The reload is masked by the same progress
        // overlay the startup kick uses — the bar rides to 90% on a timer and
        // completes when every reloaded frame has actually landed (with a
        // safety timeout so the mask can never get stuck).
        // holdMs: extra time the (fully opaque) overlay lingers AFTER the
        // frames have reloaded — managers pass 2500 so the fresh GUI is fully
        // settled before it's revealed.
        window.refreshPlayerWindows = function (holdMs) {
            holdMs = holdMs || 0;
            const frames = ['cartgrid', 'floater', 'floater2', 'dockIdsFrame', 'dockClockFrame', 'dockClockRing', 'dockClockCount2']
                .map((id) => document.getElementById(id))
                .filter((f) => f && f.src && !f.src.includes('about:blank'));
            const overlay = document.getElementById('loadingOverlay');
            const bar = document.getElementById('progressBar');
            overlay.querySelector('.message').textContent = 'Refreshing';
            bar.style.width = '0%';
            overlay.style.display = 'flex';
            let progress = 0;
            const tick = setInterval(() => {
                progress = Math.min(progress + 15, 90);
                bar.style.width = progress + '%';
            }, 150);
            let pending = frames.length, finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                clearInterval(tick);
                bar.style.width = '100%';
                setTimeout(() => { overlay.style.display = 'none'; }, 350 + holdMs);
            };
            const done = () => { if (--pending <= 0) finish(); };
            if (!frames.length) { finish(); return; } // still honour the hold with no frames
            frames.forEach((f) => {
                f.addEventListener('load', done, { once: true });
                f.src = f.src;
            });
            setTimeout(finish, 4000);
        };
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
        // Docked clock: a thin header dropdown picks one of the two single-view
        // pages — no "Clock + countdown" here (that combined 420x420 view only
        // makes sense floating; the dock bar is a fixed, shorter strip).
        const DOCK_SRC = ['clock.php?dock=1', 'clock-progress.php?dock=1'];
        let dockClockIndex = 0;
        // Docked Station-ID sections mirror the floating window's dropdown
        // (names editable in the manager's Station tab). fit=1 makes the grid
        // fill the dock pane.
        const idSectionUrls = [...document.getElementById('ids-select').options].map(o => o.value + '&fit=1');
        let dockIdsIndex = 0;
        (() => {
            const sel = document.getElementById('dockIdsSelect');
            [...document.getElementById('ids-select').options].forEach((o, i) => {
                const opt = document.createElement('option');
                opt.value = i; opt.textContent = o.textContent;
                sel.appendChild(opt);
            });
        })();
        // Dragging the resize handle sits right next to these dropdowns —
        // lock them out for a few seconds after each drag so an imprecise
        // release doesn't land on (and accidentally change) one of them.
        let dockDropdownsLocked = false;
        let dockDropdownsLockTimer = null;
        function lockDockDropdowns() {
            dockDropdownsLocked = true;
            clearTimeout(dockDropdownsLockTimer);
            dockDropdownsLockTimer = setTimeout(() => {
                dockDropdownsLocked = false;
                renderWindows(); // restores each select's normal disabled state
            }, 3000);
            renderWindows();
        }
        document.getElementById('dockClockSelect').addEventListener('change', (e) => {
            if (layoutLocked || dockDropdownsLocked) return; // don't reload the frame mid-playback
            dockClockIndex = +e.target.value;
            document.getElementById('dockClockFrame').src = DOCK_SRC[dockClockIndex];
        });
        document.getElementById('dockIdsSelect').addEventListener('change', (e) => {
            if (layoutLocked || dockDropdownsLocked) return; // don't reload the grid mid-playback
            dockIdsIndex = +e.target.value;
            document.getElementById('dockIdsFrame').src = idSectionUrls[dockIdsIndex];
            maskIdSurface('dock');
        });
        // Comfortably fits each pane's 24px header + a legible minimum of
        // actual content (clock ring / a row of ID tiles) so shrinking the
        // dock never squashes them into an unreadable sliver.
        const DOCK_MIN_H = 160;
        const DOCK_MAX_H = 500;
        const winState = (() => {
            // First visit (no saved state) starts with BOTH views docked.
            const def = { clock: { docked: true, visible: true }, ids: { docked: true, visible: true }, dockHeight: 200 };
            try {
                const saved = JSON.parse(localStorage.getItem(WIN_STORE));
                if (saved && saved.clock && saved.ids) {
                    if (!saved.dockHeight) saved.dockHeight = 200;
                    return saved;
                }
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
            const clockOnly = clockDock && !idsDock;

            // Clock ALONE: the trio (big digital | ring | end-of-hour) takes
            // over and the dropdown locks on "Clock" as a plain header. Any
            // other layout reverts to the remembered dropdown selection.
            // Both also lock out briefly right after a dock-resize drag (see
            // lockDockDropdowns) since they sit so close to the handle.
            const clockSel = document.getElementById('dockClockSelect');
            clockSel.disabled = clockOnly || dockDropdownsLocked;
            clockSel.value = clockOnly ? 0 : dockClockIndex;
            document.getElementById('dockIdsSelect').disabled = dockDropdownsLocked;
            // Lazy-load / release the dock iframes so nothing runs while undocked/hidden.
            const singleFrame = document.getElementById('dockClockFrame');
            singleFrame.src = (clockDock && !clockOnly) ? DOCK_SRC[dockClockIndex] : 'about:blank';
            singleFrame.hidden = clockOnly || !clockDock;
            document.getElementById('dockClockMulti').hidden = !clockOnly;
            syncDockClockRing(clockOnly);
            document.getElementById('dockClockCount2').src = clockOnly ? 'clock-progress.php?dock=1' : 'about:blank';
            document.getElementById('dockIdsFrame').src   = idsDock   ? idSectionUrls[dockIdsIndex] : 'about:blank';
            document.getElementById('dockIdsSelect').value = dockIdsIndex;

            document.getElementById('dockClock').style.display = clockDock ? 'flex' : 'none';
            document.getElementById('dockIds').style.display   = idsDock   ? 'flex' : 'none';
            const bar = document.getElementById('dockBar');
            bar.classList.toggle('clock-only', clockDock && !idsDock);
            bar.classList.toggle('ids-only',   idsDock && !clockDock);
            bar.classList.toggle('both',       clockDock && idsDock);
            bar.style.display = (clockDock || idsDock) ? 'flex' : 'none';
            bar.style.height = winState.dockHeight + 'px';
            document.getElementById('dockResizeHandle').hidden = !(clockDock || idsDock);
            // DJ mode tucks a clock-only dock under the library column so the
            // three decks keep the full height (see player.css).
            document.body.classList.toggle('dock-clock-only', clockDock && !idsDock);

            // Mask the Station-ID window while its surface changes (dock <->
            // undock, hide -> show): the grid inside reflows responsively and
            // that jank is hidden behind a black cover + progress bar.
            const idsSurface = !winState.ids.visible ? 'none' : (winState.ids.docked ? 'dock' : 'float');
            if (lastIdsSurface !== undefined && idsSurface !== lastIdsSurface && idsSurface !== 'none') {
                maskIdSurface(idsSurface);
            }
            // The docked ids pane doesn't reload its SRC when the clock docks/
            // undocks alongside it, but the dock-bar width class flips (both <->
            // ids-only) and the grid inside reflows to the new width — same
            // jank, same mask, even though idsSurface itself didn't change.
            else if (idsSurface === 'dock' && lastClockDock !== undefined && clockDock !== lastClockDock) {
                maskIdSurface('dock');
            }
            lastIdsSurface = idsSurface;
            lastClockDock = clockDock;
        }
        // Which ID surface / clock-dock state the last render showed — so we
        // only mask on an actual change.
        let lastIdsSurface = undefined;
        let lastClockDock = undefined;
        function maskIdSurface(kind) {
            showReloadMask(kind === 'dock' ? 'dockIdsMask' : 'floatIdsMask');
        }
        // Generic reload mask (black cover + progress bar) for any surface
        // that's about to force-reload and visibly reflow: the board (Stop
        // all) and the Station-ID window (dock/undock, section change, or
        // the clock docking/undocking alongside it).
        function showReloadMask(maskId) {
            const mask = document.getElementById(maskId);
            if (!mask) return;
            const bar = mask.querySelector('.win-reload-bar > i');
            mask.style.display = 'flex';
            bar.style.transition = 'none';
            bar.style.width = '0%';
            requestAnimationFrame(() => {
                bar.style.transition = 'width 1.1s ease';
                bar.style.width = '92%';
            });
            clearTimeout(mask._t);
            mask._t = setTimeout(() => {
                bar.style.transition = 'width 0.2s ease';
                bar.style.width = '100%';
                setTimeout(() => { mask.style.display = 'none'; }, 220);
            }, 1150);
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

        // Bottom dock resize: drag the thin handle to change the dock's
        // height. A fixed ghost line follows the cursor (clamped to
        // [DOCK_MIN_H, DOCK_MAX_H]) without live-resizing the dock itself —
        // the resize only applies on release, so the iframes inside don't
        // reflow/jank on every mousemove. Dragging past either limit turns
        // the ghost red; releasing there snaps to that limit rather than
        // wherever the cursor happened to be. Gated by the Options tab's
        // "Allow dock resize" switch (off by default).
        (() => {
            const handle = document.getElementById('dockResizeHandle');
            const ghost = document.getElementById('dockResizeGhost');
            const bar = document.getElementById('dockBar');
            let dragging = false, lockedDuringDrag = false, startY = 0, startHeight = 0, finalHeight = 0;

            function positionGhost(height) {
                const rect = bar.getBoundingClientRect();
                const bottom = rect.bottom;
                ghost.style.top = (bottom - height) + 'px';
            }

            handle.addEventListener('mousedown', (e) => {
                if (!window.SETTINGS.dock_resize) return;
                dragging = true;
                // Still on-air, or within the 3s grace right after — rather
                // than silently doing nothing, show a ghost line frozen in
                // place and red, so attempting to drag actually explains why
                // nothing is happening instead of just going nowhere.
                lockedDuringDrag = resizeLocked();
                startY = e.clientY;
                startHeight = winState.dockHeight;
                handle.classList.add('active');
                ghost.hidden = false;
                ghost.classList.toggle('blocked', lockedDuringDrag);
                positionGhost(startHeight);
                // The dock's panes are iframes: without an overlay above them,
                // a fast mouse move crossing into an iframe stops reaching
                // this (parent) document's mousemove listener entirely and
                // the drag "drops". Same fix as the floating-window drag.
                dragOverlay.classList.add('resize-v', 'active');
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                if (lockedDuringDrag) { positionGhost(startHeight); return; } // frozen in place, stays red
                const raw = startHeight + (startY - e.clientY);
                const blocked = raw < DOCK_MIN_H || raw > DOCK_MAX_H;
                finalHeight = Math.max(DOCK_MIN_H, Math.min(DOCK_MAX_H, raw));
                ghost.classList.toggle('blocked', blocked);
                positionGhost(finalHeight);
            });

            document.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false;
                handle.classList.remove('active');
                ghost.hidden = true;
                ghost.classList.remove('blocked');
                dragOverlay.classList.remove('resize-v', 'active');
                if (!lockedDuringDrag) {
                    winState.dockHeight = finalHeight;
                    bar.style.height = finalHeight + 'px';
                    saveWinState();
                    lockDockDropdowns();
                }
            });
        })();

        // DJ tree / automation sidebar width-resize: drag either handle to
        // widen its panel. Gated by the Options tab's "Allow panel resize"
        // switch (off by default); span is deliberately narrow — the panel
        // can only grow, never shrink below its own default width, and the
        // max growth is capped at PANEL_MAX_GROWTH.
        (() => {
            const PANEL_MAX_GROWTH = 160;

            const treeEl = document.querySelector('.dj-tree');
            const autoEl = document.getElementById('automationPanel');

            // The permanent floor/ceiling for each panel — measured ONCE,
            // before any saved resize is applied, so it reflects the panel's
            // true CSS default and never ratchets up across drags (a
            // previous version re-measured "current width" at the START of
            // EVERY drag, which meant growing once permanently raised the
            // floor too — dragging back down toward the ORIGINAL default was
            // then impossible, always reported as "blocked"). Both panels can
            // be hidden at this point (Carts mode / automation not open),
            // which would measure 0 — briefly reveal to get a real number.
            function measureNaturalWidth(el, hiddenAncestorSelector) {
                const ancestor = hiddenAncestorSelector ? el.closest(hiddenAncestorSelector) : null;
                const ancestorWasHidden = ancestor ? ancestor.hidden : false;
                if (ancestorWasHidden) ancestor.hidden = false;
                const prevDisplay = el.style.display;
                const elWasHiddenByDisplay = getComputedStyle(el).display === 'none';
                if (elWasHiddenByDisplay) el.style.display = 'flex';
                const width = el.getBoundingClientRect().width;
                if (elWasHiddenByDisplay) el.style.display = prevDisplay;
                if (ancestorWasHidden) ancestor.hidden = true;
                return width;
            }
            const DEFAULT_TREE_WIDTH = measureNaturalWidth(treeEl, '#djMode');
            const DEFAULT_AUTO_WIDTH = measureNaturalWidth(autoEl, null);

            // max-width overridden too — .automation-panel's own CSS caps it
            // at 460px, which would otherwise silently clip any resize past
            // that regardless of the flex-basis set here.
            if (winState.treeWidth) { treeEl.style.flexBasis = winState.treeWidth + 'px'; treeEl.style.maxWidth = winState.treeWidth + 'px'; }
            if (winState.autoWidth) { autoEl.style.flexBasis = winState.autoWidth + 'px'; autoEl.style.maxWidth = winState.autoWidth + 'px'; }

            function updatePanelResizeHandles() {
                const allowed = !!(window.SETTINGS && window.SETTINGS.panel_resize);
                const treeHandle = document.getElementById('treeResizeHandle');
                const autoHandle = document.getElementById('autoResizeHandle');
                const djOn = document.body.classList.contains('dj-mode');
                const autoOn = autoEl.classList.contains('active');
                if (treeHandle) treeHandle.hidden = !(djOn && allowed);
                if (autoHandle) autoHandle.hidden = !(autoOn && allowed);
            }
            updatePanelResizeHandles();
            // Re-checked after a Settings save (manager.js) and whenever DJ
            // mode or the automation panel's own visibility changes.
            window.updatePanelResizeHandles = updatePanelResizeHandles;
            new MutationObserver(updatePanelResizeHandles)
                .observe(document.body, { attributes: true, attributeFilter: ['class'] });
            new MutationObserver(updatePanelResizeHandles)
                .observe(autoEl, { attributes: true, attributeFilter: ['class'] });

            // dir=+1: the handle sits on the panel's trailing edge and
            // dragging AWAY from it grows the panel (the tree). dir=-1: the
            // handle sits on the panel's leading edge and dragging TOWARD it
            // grows the panel (the automation sidebar).
            function makeResizer(handleId, panelEl, dir, storeKey, defaultWidth) {
                const handle = document.getElementById(handleId);
                const ghost = document.getElementById('panelResizeGhost');
                if (!handle || !panelEl) return;
                // Fixed for every drag (not "current width at drag start") —
                // the whole resizable band is always [defaultWidth,
                // defaultWidth + PANEL_MAX_GROWTH], so shrinking back toward
                // the original default is always possible, no matter how
                // large a PREVIOUS drag grew it.
                const minWidth = defaultWidth;
                const maxWidth = defaultWidth + PANEL_MAX_GROWTH;
                let dragging = false, startX = 0, startWidth = 0, finalWidth = 0;

                function positionGhost(width) {
                    const rect = panelEl.getBoundingClientRect();
                    ghost.style.left = (dir > 0 ? rect.left + width : rect.right - width) + 'px';
                }

                handle.addEventListener('mousedown', (e) => {
                    if (layoutLocked || !(window.SETTINGS && window.SETTINGS.panel_resize)) return;
                    dragging = true;
                    startX = e.clientX;
                    startWidth = panelEl.getBoundingClientRect().width;
                    handle.classList.add('active');
                    ghost.hidden = false;
                    positionGhost(startWidth);
                    dragOverlay.classList.add('resize-h', 'active');
                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!dragging) return;
                    const raw = startWidth + dir * (e.clientX - startX);
                    const blocked = raw < minWidth || raw > maxWidth;
                    finalWidth = Math.max(minWidth, Math.min(maxWidth, raw));
                    ghost.classList.toggle('blocked', blocked);
                    positionGhost(finalWidth);
                });

                document.addEventListener('mouseup', () => {
                    if (!dragging) return;
                    dragging = false;
                    handle.classList.remove('active');
                    ghost.hidden = true;
                    ghost.classList.remove('blocked');
                    dragOverlay.classList.remove('resize-h', 'active');
                    panelEl.style.flexBasis = finalWidth + 'px';
                    panelEl.style.maxWidth = finalWidth + 'px';
                    winState[storeKey] = finalWidth;
                    saveWinState();
                });
            }
            makeResizer('treeResizeHandle', treeEl, 1, 'treeWidth', DEFAULT_TREE_WIDTH);
            makeResizer('autoResizeHandle', autoEl, -1, 'autoWidth', DEFAULT_AUTO_WIDTH);
        })();

        // The trio's ring drops its centre digits (the big digital clock sits
        // right beside it) — but in DJ mode the tucked dock shows the ring
        // ALONE, so there the digits come back. Called from renderWindows and
        // from the DJ mode toggle (dj.js).
        function syncDockClockRing(show) {
            const ring = document.getElementById('dockClockRing');
            if (show === undefined) show = !document.getElementById('dockClockMulti').hidden;
            if (!show) { ring.src = 'about:blank'; return; }
            const want = document.body.classList.contains('dj-mode')
                ? 'clock.php?dock=1'
                : 'clock.php?dock=1&nodigits=1';
            if (!ring.src.endsWith(want)) ring.src = want;
        }
        window.syncDockClockRing = syncDockClockRing;

        // Big digital clock (with seconds) for the clock-only dock trio.
        setInterval(() => {
            const el = document.getElementById('dockClockDigital');
            if (!el || document.getElementById('dockClockMulti').hidden) return;
            const d = new Date();
            const p = (n) => String(n).padStart(2, '0');
            el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        }, 250);

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
        // Resize handles (dock height, DJ tree/automation width) stay locked
        // a little LONGER than the rest of the layout: the instant playback
        // clears, they'd otherwise unlock right under the cursor — confusing
        // if the operator was still reaching toward something else nearby.
        let resizeGraceUntil = 0;
        function resizeLocked() { return layoutLocked || Date.now() < resizeGraceUntil; }
        function recomputeLock() {
            const anyPlaying = [...framePlaying.values()].some((n) => n > 0);
            const autoRunning = !!(window.Automation && window.Automation.isRunning());
            const locked = anyPlaying || autoRunning;
            if (locked !== layoutLocked) {
                if (!locked) resizeGraceUntil = Date.now() + 3000;
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
    <script src="<?= asset_v('assets/js/audio-engine.js') ?>"></script>
    <script>
        // Meter bridge: reads AudioEngine's analysers/DynamicsCompressorNode
        // .reduction values directly (same document as the engine — no
        // postMessage needed). Runs continuously; channels simply read 0 while
        // nothing is connected to them yet (Cart Wall until Stage 2 lands).
        (() => {
            const CH = [
                { key: 'cartwall', analyser: () => window.AudioEngine.cartWallAnalyser },
                { key: 'auto', analyser: () => window.AudioEngine.autoplayerAnalyser },
                { key: 'player1', analyser: () => window.AudioEngine.deckAnalyser(1) },
                { key: 'player2', analyser: () => window.AudioEngine.deckAnalyser(2) },
                { key: 'player3', analyser: () => window.AudioEngine.deckAnalyser(3) },
                { key: 'master', analyser: () => window.AudioEngine.masterAnalyser },
            ];
            const GR = [
                { key: 'agc', reduction: () => window.AudioEngine.reductionDb.agc() },
                { key: 'comp', reduction: () => window.AudioEngine.reductionDb.compressor() },
                { key: 'limit', reduction: () => window.AudioEngine.reductionDb.limiter() },
            ];
            const fills = {};
            document.querySelectorAll('#meterBridge .meter-ch').forEach((el) => {
                fills[el.dataset.ch] = el.querySelector('.meter-fill');
            });
            function frame() {
                CH.forEach(({ key, analyser }) => {
                    const fill = fills[key];
                    if (!fill) return;
                    const level = window.AudioEngine.levelOf(analyser());
                    fill.style.height = Math.min(100, level * 140) + '%';
                });
                GR.forEach(({ key, reduction }) => {
                    const fill = fills[key];
                    if (!fill) return;
                    // .reduction is 0 (none) to roughly -20dB+ (heavy) — map
                    // 0..20dB of reduction onto 0..100% fill height.
                    const db = Math.abs(reduction() || 0);
                    fill.style.height = Math.min(100, (db / 20) * 100) + '%';
                });
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        })();
    </script>
    <script src="<?= asset_v('assets/js/automation.js') ?>"></script>
    <script src="<?= asset_v('assets/js/dj.js') ?>"></script>
    <?php if (is_admin()): ?><script src="<?= asset_v('assets/js/planner.js') ?>"></script><script src="assets/vendor/wavesurfer.min.js"></script><script src="<?= asset_v('assets/js/manager.js') ?>"></script><script src="<?= asset_v('assets/js/audio-manager.js') ?>"></script><?php endif; ?>
</body>
</html>
