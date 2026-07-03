<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * The cart wall grid. Embedded as an iframe by index.php (and linked directly
 * from the mobile page). The heavy lifting — loading carts, the audio preload
 * hack, chaining and the back-timer — lives in assets/js/cartwall.js; this
 * file is just the shell plus a tiny log endpoint.
 *
 * Query params: from, to (slice of the cart list), line (columns),
 * pagination (0 hides the pager), smalltext (font px), btnh (button height px),
 * smallbacktimer (1 = compact back-timer).
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/includes/helpers.php'; // asset_v() cache-buster

header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// Playback log endpoint: cartwall.js POSTs play/stop/refresh lines here.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    file_put_contents('playback-log.log', file_get_contents('php://input') . PHP_EOL, FILE_APPEND);
    exit;
}

$pagination        = $_GET['pagination'] ?? '1';
$smalltext         = $_GET['smalltext'] ?? '16';
$btnh              = $_GET['btnh'] ?? '118';
$smallbacktimer    = $_GET['smallbacktimer'] ?? '0';
// fit=1: the main board. The active page becomes a height-filling grid so every
// cart is always visible (no scroll), sized to both the viewport width AND
// height. Floating windows leave this off and keep natural (btnh) row heights.
$fit               = $_GET['fit'] ?? '0';
$paginationDisplay = ($pagination === '0') ? 'none' : 'block';
$backtimerStyles   = ($smallbacktimer === '1')
    ? 'left: 14px; width: 80px; height: 40px; font-size: 20px;'
    : 'left: 15px; width: 300px; height: 150px; font-size: 88px;';
$settings = load_settings(); // gates the per-tile PFL preview button + mini-player below
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cart Wall</title>
    <link href="assets/fonts/fonts.css" rel="stylesheet">
    <style>
        @import url('assets/vendor/phosphor/regular/style.css'); /* speaker-in-brackets PFL icon */
        :root {
            --bg-app: #0b0d11;
            --raised: rgba(255, 255, 255, 0.05);
            --hairline: rgba(255, 255, 255, 0.09);
            --empty-fill: rgba(255, 255, 255, 0.02);
            --empty-border: rgba(255, 255, 255, 0.09);
            --text-secondary: #9aa4b2;
            --cat-blue: #2f6fd6; --cat-cyan: #2aa7bf; --cat-green: #2f9e5f;
            --cat-magenta: #b0479e; --cat-amber: #c98a2b; --cat-now: #d83f45;
            --chain: rgba(52, 195, 212, 0.85);
        }
        html, body { background-color: var(--bg-app); font-family: 'Assistant', Arial, sans-serif; margin: 0; }
<?php if ($fit === '1'): ?>
        /* fit mode: fill the iframe so the active page's grid can size rows to
           the available height — every cart visible, no scroll. */
        html, body { height: 100%; overflow: hidden; }
        .cartwall-container, .cartwall { height: 100%; }
<?php endif; ?>

        .button .clock-icon { position: absolute; top: 1%; right: 1%; font-size: 22px; pointer-events: none; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
        .button .clock-icon .emoji { font-size: 40px; padding-left: 27px; }
        .button .clock-icon .countdown { font-size: 22px; color: red; margin-top: -4px; padding: 9px; font-weight: bold; }
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes livePulse { 0% { box-shadow: 0 0 0 0 rgba(255, 77, 69, 0.55); } 70% { box-shadow: 0 0 0 7px rgba(255, 77, 69, 0); } 100% { box-shadow: 0 0 0 0 rgba(255, 77, 69, 0); } }
        @keyframes vuBounce { 0%, 100% { height: 25%; } 50% { height: 100%; } }

        .context-menu { display: none; position: absolute; z-index: 10000; background: #171b21; border: 1px solid var(--hairline); border-radius: 10px; box-shadow: 0 22px 50px rgba(0, 0, 0, 0.6); font-family: 'Assistant', Arial, sans-serif; padding: 6px; text-align: left; min-width: 220px; font-size: 14px; }
        .context-menu button { display: block; width: 100%; padding: 10px; background: none; border: none; border-radius: 6px; text-align: left; cursor: pointer; color: #eef1f5; font-family: inherit; font-size: 13px; }
        .context-menu button:hover { background-color: var(--raised); }

        .cartwall-container { text-align: center; }
        .page { display: none; grid-template-columns: repeat(var(--columns, 5), 1fr); gap: 12px; padding: 16px; }
        .page.active { display: grid; }
<?php if ($fit === '1'): ?>
        /* Height-filling board: rows share the available height equally (E). */
        .page.active { height: 100%; box-sizing: border-box; grid-auto-rows: 1fr; }
<?php endif; ?>

        .button, .buttonext, .cart-slot {
            position: relative; padding: 12px; color: rgba(255, 255, 255, 0.96); border: none; outline: none;
            border-radius: 12px; text-align: center; cursor: pointer; font-size: <?= htmlspecialchars($smalltext) ?>px;
            font-family: 'Assistant', Arial, sans-serif; font-weight: 700;
            overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px;
            height: <?= $fit === '1' ? 'auto' : '90px' ?>; min-height: <?= $fit === '1' ? '0' : htmlspecialchars($btnh) . 'px' ?>; min-width: 75px;
            transition: transform 0.1s ease;
        }
        .button:active { transform: scale(0.98); }
        .button.disabled { cursor: not-allowed; }
        /* A cart with a PFL strip is wrapped in .cart-slot (the actual grid
           item, sized exactly like a bare .button used to be); the button
           itself just fills the slot. Keeping the strip as .cart-slot's
           sibling (not the button's child) means pressing it can never also
           trigger the button's own native :active depress. */
        .cart-slot { padding: 0; cursor: default; overflow: visible; }
        .cart-slot > .button, .cart-slot > .buttonext {
            width: 100%; height: 100%; min-height: 0; min-width: 0;
        }

        /* Category fills: soft top highlight over the base colour, per the design tokens. */
        .button.cat-1 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-blue); }
        .button.cat-2 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-green); }
        .button.cat-3 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-magenta); }
        .button.cat-4 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-amber); }
        .button.cat-5 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-cyan); }

        /* Empty slot: dashed, near-invisible tile. */
        .button.empty { background: var(--empty-fill); border: 1px dashed var(--empty-border); cursor: not-allowed; }

        /* Disabled (manager Audio tab): darkened but its name still shows —
           reads as "this cart, turned off" rather than an empty slot. A thin
           gray X (two corner-to-corner gradient "lines") crosses the face,
           sitting behind the title/icons since background-image is always
           behind box content. */
        .button.button-off {
            background-color: #1a1d22;
            background-image:
                linear-gradient(45deg, transparent calc(50% - 0.75px), rgba(190, 197, 206, 0.4) calc(50% - 0.75px), rgba(190, 197, 206, 0.4) calc(50% + 0.75px), transparent calc(50% + 0.75px)),
                linear-gradient(-45deg, transparent calc(50% - 0.75px), rgba(190, 197, 206, 0.4) calc(50% - 0.75px), rgba(190, 197, 206, 0.4) calc(50% + 0.75px), transparent calc(50% + 0.75px));
            border: 1px solid rgba(255, 255, 255, 0.06); cursor: not-allowed; opacity: 0.55; filter: grayscale(0.6);
        }
        .button.button-off .title { color: var(--text-tertiary); }

        /* Flash a cart when jumped to from the search results. A sustained
           "breathing" cyan ring — stays visible the whole time (never fully
           fades between beats) so it keeps holding the eye while the grid
           finishes laying out. */
        @keyframes searchFlash {
            0%, 100% { box-shadow: 0 0 0 2px rgba(52, 195, 212, 0.6), 0 0 14px 4px rgba(52, 195, 212, 0.28); }
            50%      { box-shadow: 0 0 0 5px rgba(52, 195, 212, 1), 0 0 30px 10px rgba(52, 195, 212, 0.65); }
        }
        .button.search-flash { animation: searchFlash 0.9s ease-in-out 6; z-index: 3; }

        .button .progress { position: absolute; top: 0; left: 0; height: 100%; width: 0; background-color: rgba(255, 255, 255, 0.2); z-index: 1; transition: width 0.1s linear; display: none; pointer-events: none; }
        .button span.title { position: relative; z-index: 2; }
        .duration {
            position: relative; z-index: 2;
            font-family: 'JetBrains Mono', monospace; font-weight: 600;
            font-size: calc(<?= htmlspecialchars($smalltext) ?>px * 0.72);
            color: rgba(255, 255, 255, 0.8);
            background: rgba(0, 0, 0, 0.30);
            border-radius: 6px; padding: 1px 7px;
        }

        /* Now-playing: red fill + white glow ring, pulsing tag, 2-bar VU. */
        .button.playing {
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-now);
            box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9), 0 0 26px rgba(240, 69, 63, 0.5);
        }
        .playing-tag {
            display: none; position: absolute; top: 8px; left: 8px; z-index: 3;
            align-items: center; gap: 5px;
            font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
            color: #fff;
        }
        .playing-tag .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: livePulse 1.6s infinite; }
        .button.playing .playing-tag { display: flex; }
        /* 2-bar VU: heights are driven live from a WebAudio analyser in
           cartwall.js (real audio level), not a canned animation. */
        .vu { display: none; position: absolute; top: 8px; right: 8px; z-index: 3; align-items: flex-end; gap: 3px; height: 16px; }
        .vu span { display: block; width: 3px; background: #fff; border-radius: 1px; height: 10%; transition: height 0.06s linear; }
        .button.playing .vu { display: flex; }

        /* Chained carts: ONE border wraps the whole run and the members abut as a
           single block. Each member's INNER corners are squared and the grid gap
           is closed (negative margin) so the tiles sit flush — no wedges between
           them. Only the run's outer edges keep a rounded, bordered corner, drawn
           on an overlay so it never fights the .playing glow (I). */
        .chain-start { border-radius: 12px 0 0 12px; }
        .chain-mid   { border-radius: 0; }
        .chain-end   { border-radius: 0 12px 12px 0; }
        .chain-mid, .chain-end { margin-left: -12px; }
        /* A PFL-eligible chained cart is wrapped in a .cart-slot, which is
           then the actual grid cell — the margin above only shifts the
           button around inside its already-flush slot, so it needs its own
           copy at the grid level (see cartwall.js) instead, with the
           button's own copy cancelled (both would otherwise double-shift). */
        .cart-slot-chain-mid, .cart-slot-chain-end { margin-left: -12px; }
        .cart-slot > .chain-mid, .cart-slot > .chain-end { margin-left: 0; }

        /* On-air countdown status bar (sub-windows): slides up along the bottom. */
        #backtimer {
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000;
            height: 24px; display: flex; align-items: center; justify-content: center;
            background: linear-gradient(180deg, #f0453f, #c9302c);
            color: #fff; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 14px; letter-spacing: 0.05em;
            transform: translateY(100%); transition: transform 0.25s ease; pointer-events: none;
        }
        #backtimer.show { transform: translateY(0); }

        .chain::after {
            content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 4;
            border-top: 2px solid var(--chain); border-bottom: 2px solid var(--chain);
        }
        .chain-start::after { border-left: 2px solid var(--chain); border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
        .chain-end::after   { border-right: 2px solid var(--chain); border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
        /* When a chained cart plays, drop the per-button white ring so the single
           block border stays intact (start=no right, mid=no sides, end=no left).
           The red fill + PLAYING tag still mark it as live. */
        .chain.playing { box-shadow: none; }

        .pagination { display: <?= $paginationDisplay ?>; margin: 16px; text-align: center; }
        .pagination button { margin: 4px; padding: 8px 14px; background: var(--raised); border: 1px solid var(--hairline); color: #eef1f5; border-radius: 8px; cursor: pointer; min-width: 70px; font-family: 'Assistant', Arial, sans-serif; font-weight: 700; font-size: 13px; }
        .pagination button.active { background: rgba(52, 195, 212, 0.2); border-color: rgba(52, 195, 212, 0.4); color: #7fe3ef; }

        /* Shared "speaker in brackets" PFL icon (same mark used in the DJ
           tree/deck/search — CSS-drawn corner brackets scale cleanly, unlike
           literal '[' ']' text characters). */
        .pfl-icon {
            position: relative; display: inline-flex; align-items: center; justify-content: center;
            height: 100%; padding: 0 5px;
        }
        .pfl-icon::before, .pfl-icon::after {
            content: ''; position: absolute; top: 18%; bottom: 18%; width: 3px;
            border-top: 1.4px solid currentColor; border-bottom: 1.4px solid currentColor;
        }
        .pfl-icon::before { left: 0; border-left: 1.4px solid currentColor; }
        .pfl-icon::after { right: 0; border-right: 1.4px solid currentColor; }

        /* Hover PFL (preview): the tile's own bottom edge contracts (ease-in)
           via clip-path — paint-only, so its internal flex layout (and the
           name/duration text position) never reflows — while the strip
           slides up into the vacated sliver, leaving a 5% gap between them
           (20% clipped away, 15% is the strip's own height). A sibling of
           the button (see .cart-slot above) so pressing it never depresses
           the tile underneath. Suppressed on tiles too small to fit it (e.g.
           the Station-IDs window) via a ResizeObserver in cartwall.js, which
           toggles .pfl-eligible on the button. */
        /* "round 12px" matches the button's own border-radius — without it
           the clip shape's corners are square, which hard-clips the
           now-playing state's white glow ring into a mismatched, glitchy
           corner instead of following the tile's actual rounded edge. */
        .pfl-eligible { clip-path: inset(0 0 0 0 round 12px); transition: clip-path 0.15s ease-in; }
        .cart-slot:hover > .pfl-eligible,
        .pfl-eligible.pfl-shrunk { clip-path: inset(0 0 20% 0 round 12px); }
        .cart-pfl-strip {
            position: absolute; z-index: 5; left: 0; right: 0; bottom: 0; height: 15%; min-height: 16px;
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace;
            background: rgba(58, 66, 78, 0.88); color: #fff; border: 1px solid rgba(255, 255, 255, 0.4);
            border-radius: 0 0 10px 10px; cursor: pointer;
            opacity: 0; pointer-events: none; transform: translateY(8px);
            transition: opacity 0.15s ease-in, transform 0.15s ease-in, background 0.12s ease;
        }
        .cart-slot:hover > .pfl-eligible ~ .cart-pfl-strip { opacity: 1; pointer-events: auto; transform: translateY(0); }
        .cart-pfl-strip.active { opacity: 1; pointer-events: auto; transform: translateY(0); background: #f4c542; color: #5a4300; border-color: #c69a17; }

        /* Small PFL mini-player, docked to the bottom of this cartwall
           instance. Gated entirely by window.SETTINGS.pfl_player/pfl_buttons_carts
           (manager Routing tab). */
        .cart-pfl {
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 999;
            display: flex; align-items: center; gap: 10px;
            height: 34px; padding: 0 12px; box-sizing: border-box;
            background: #171b21; border-top: 1px solid var(--hairline);
            font-family: 'Assistant', Arial, sans-serif; font-size: 13px; color: #eef1f5;
        }
        .cart-pfl[hidden] { display: none; }
        .cart-pfl-label { font-weight: 700; color: #f4c542; letter-spacing: 0.05em; font-size: 11px; }
        .cart-pfl-name { flex: 0 0 auto; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cart-pfl-bar { flex: 1 1 auto; height: 5px; background: rgba(255, 255, 255, 0.12); border-radius: 3px; overflow: hidden; }
        .cart-pfl-bar > i { display: block; height: 100%; width: 0%; background: #f4c542; }
        .cart-pfl-stop { flex: 0 0 auto; background: rgba(255, 255, 255, 0.08); border: 1px solid var(--hairline); color: #eef1f5; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; font-family: inherit; }
        .cart-pfl-stop:disabled { opacity: 0.4; cursor: not-allowed; }
    </style>
</head>
<body style="background-color: var(--bg-app);">
    <div id="context-menu" class="context-menu">
        <button id="play-at-button">Play automatically at the top of the hour</button>
        <button id="cancel-timers-button">No active timers</button>
    </div>

    <!-- On-air countdown: a status bar that slides up along this window's bottom
         edge while a cart plays. (The main board reports its countdown to the
         parent shell instead, which shows the big bar over the ticker.) -->
    <div id="backtimer"></div>

    <!-- Collapsible on-screen message log. -->
    <div id="messagelog-container" style="display: <?= $paginationDisplay ?>; width: 480px; position: fixed; bottom: 0; left: 60%; right: 0; background-color: #12161c; color: #9aa4b2; padding: 12px; font-family: 'Assistant', Arial, sans-serif; font-size: 12px; border-top: 1px solid rgba(255,255,255,0.09); cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; z-index: 99999;">
        <span id="messagelog-header" style="display: inline-block; width: 100%; text-align: left; overflow: hidden;">
            <b style="color:#eef1f5;">Messages</b> <span id="messagelog-line"></span>
        </span>
        <div id="messagelog" style="display: none; max-height: 300px; overflow-y: auto; margin-top: 10px;"></div>
    </div>

    <div id="pagination" class="pagination" dir="ltr"></div>
    <div class="cartwall-container">
        <div id="cartwall" class="cartwall" dir="ltr"></div>
    </div>

    <button id="self-check-button" style="position: fixed; bottom: 5px; left: 5px; display: none; z-index: 1000; padding: 3px; font-size: 8px; cursor: pointer; background-color: #007bff; color: #fff; border: none; border-radius: 4px;">⟳</button>

    <!-- Small PFL (preview) mini-player: a hover-revealed sliding strip on
         each cart tile (see cartwall.js) sends its cart here. Docked to the
         bottom of this cartwall instance; gated entirely by
         window.SETTINGS.pfl_player/pfl_buttons_carts. -->
    <div class="cart-pfl" id="cartPfl" hidden>
        <span class="cart-pfl-label">PFL</span>
        <span class="cart-pfl-name">-</span>
        <div class="cart-pfl-bar"><i></i></div>
        <button type="button" class="cart-pfl-stop" id="cartPflStop" disabled title="Stop">Stop</button>
    </div>

    <script>
        // Message-log expand/collapse.
        (() => {
            const container = document.getElementById('messagelog-container');
            const line = document.getElementById('messagelog-line');
            const details = document.getElementById('messagelog');
            container.addEventListener('click', () => {
                const expanded = details.style.display === 'block';
                details.style.display = expanded ? 'none' : 'block';
                line.textContent = expanded ? '' : 'Click to close';
                container.style.whiteSpace = expanded ? 'nowrap' : 'normal';
            });
        })();

        window.CARTWALL_CONFIG = { dataUrl: <?= json_encode(DATA_URL) ?>, itemsPerPage: <?= ITEMS_PER_PAGE ?> };
        window.SETTINGS = <?= json_encode($settings) ?>;
        // Which simulated OUT the board's own plays carry — tagged onto the
        // playback log (manager > Maintenance) so it can later be checked
        // against real per-output audio hardware.
        window.ROUTING = <?= json_encode(load_routing()) ?>;
    </script>
    <script src="<?= asset_v('assets/js/cartwall.js') ?>"></script>
</body>
</html>
