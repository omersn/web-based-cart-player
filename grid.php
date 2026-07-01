<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
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
$paginationDisplay = ($pagination === '0') ? 'none' : 'block';
$backtimerStyles   = ($smallbacktimer === '1')
    ? 'left: 14px; width: 80px; height: 40px; font-size: 20px;'
    : 'left: 15px; width: 300px; height: 150px; font-size: 88px;';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cart Wall</title>
    <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-app: #0b0d11;
            --raised: rgba(255, 255, 255, 0.05);
            --hairline: rgba(255, 255, 255, 0.09);
            --empty-fill: rgba(255, 255, 255, 0.02);
            --empty-border: rgba(255, 255, 255, 0.09);
            --text-secondary: #9aa4b2;
            --cat-blue: #2f6fd6; --cat-cyan: #2aa7bf; --cat-green: #2f9e5f;
            --cat-magenta: #b0479e; --cat-amber: #c98a2b; --cat-now: #d83f45;
        }
        html, body { background-color: var(--bg-app); font-family: 'Assistant', Arial, sans-serif; }

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

        .button, .buttonext {
            position: relative; padding: 12px; color: rgba(255, 255, 255, 0.96); border: none; outline: none;
            border-radius: 12px; text-align: center; cursor: pointer; font-size: <?= htmlspecialchars($smalltext) ?>px;
            font-family: 'Assistant', Arial, sans-serif; font-weight: 700;
            overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px;
            height: 90px; min-height: <?= htmlspecialchars($btnh) ?>px; min-width: 75px;
            transition: transform 0.1s ease;
        }
        .button:active { transform: scale(0.98); }
        .button.disabled { cursor: not-allowed; }

        /* Category fills: soft top highlight over the base colour, per the design tokens. */
        .button.cat-1 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-blue); }
        .button.cat-2 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-green); }
        .button.cat-3 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-magenta); }
        .button.cat-4 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-amber); }
        .button.cat-5 { background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 42%), var(--cat-cyan); }

        /* Empty slot: dashed, near-invisible tile. */
        .button.empty { background: var(--empty-fill); border: 1px dashed var(--empty-border); cursor: not-allowed; }

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
        .vu { display: none; position: absolute; top: 8px; right: 8px; z-index: 3; align-items: flex-end; gap: 3px; height: 16px; }
        .vu span { display: block; width: 3px; background: #fff; border-radius: 1px; animation: vuBounce 0.5s ease-in-out infinite; }
        .vu span:last-child { animation-duration: 0.6s; animation-delay: 0.12s; }
        .button.playing .vu { display: flex; }

        /* Chained carts overflow into the next cell so a run reads as one long
           "master button", matching the production behaviour. */
        .buttonext { width: 120%; z-index: 2; }

        .pagination { display: <?= $paginationDisplay ?>; margin: 16px; text-align: center; }
        .pagination button { margin: 4px; padding: 8px 14px; background: var(--raised); border: 1px solid var(--hairline); color: #eef1f5; border-radius: 8px; cursor: pointer; min-width: 70px; font-family: 'Assistant', Arial, sans-serif; font-weight: 700; font-size: 13px; }
        .pagination button.active { background: rgba(52, 195, 212, 0.2); border-color: rgba(52, 195, 212, 0.4); color: #7fe3ef; }
    </style>
</head>
<body style="background-color: var(--bg-app);">
    <div id="context-menu" class="context-menu">
        <button id="play-at-button">Play automatically at the top of the hour</button>
        <button id="cancel-timers-button">No active timers</button>
    </div>

    <!-- Large remaining-time overlay; revealed a few seconds after load. -->
    <div id="backtimer" style="display: none; padding-top: 59px; z-index: 1000; position: fixed; top: -9999999px; border-radius: 10px; background-color: #d83a3f; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; color: #fff; box-shadow: 0 22px 50px rgba(0, 0, 0, 0.6); <?= $backtimerStyles ?>"></div>

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
    </script>
    <script src="assets/js/cartwall.js"></script>
</body>
</html>
