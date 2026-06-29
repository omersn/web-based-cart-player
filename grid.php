<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The cart wall grid. Embedded as an iframe by index.php (and linked directly
 * from the mobile page). The heavy lifting — loading carts, the audio preload
 * hack, the level meter, chaining and the back-timer — lives in
 * assets/js/cartwall.js; this file is just the shell plus a tiny log endpoint.
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
$smalltext         = $_GET['smalltext'] ?? '17';
$btnh              = $_GET['btnh'] ?? '100';
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
    <style>
        .button .clock-icon { position: absolute; top: 1%; right: 1%; font-size: 22px; pointer-events: none; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
        .button .clock-icon .emoji { font-size: 40px; padding-left: 27px; }
        .button .clock-icon .countdown { font-size: 22px; color: red; margin-top: -4px; padding: 9px; font-weight: bold; }
        @keyframes blink { 50% { opacity: 0; } }

        .context-menu { display: none; position: absolute; z-index: 10000; background-color: #fff; border: 1px solid gray; border-radius: 5px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2); font-family: Arial, sans-serif; padding: 10px; text-align: left; min-width: 200px; font-size: 14px; }
        .context-menu button { display: block; width: 100%; padding: 10px; background: none; border: none; text-align: left; cursor: pointer; }
        .context-menu button:hover { background-color: #f0f0f0; }

        .cartwall-container { margin: -3px; margin-top: -10px; text-align: center; }
        .page { display: none; grid-template-columns: repeat(var(--columns, 5), 1fr); gap: 15px; padding: 10px; }
        .page.active { display: grid; }

        .button, .buttonext {
            position: relative; padding: 45px; background-color: gray; color: #fff; border: none; outline: none;
            border-radius: 8px; text-align: center; cursor: pointer; font-size: <?= htmlspecialchars($smalltext) ?>px;
            overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: center;
            height: 90px; min-height: <?= htmlspecialchars($btnh) ?>px; min-width: 75px;
        }
        .button:active { background-color: #0056b3; }
        .button.disabled { cursor: not-allowed; opacity: 0.5; }
        .button .progress { position: absolute; top: 0; right: 0; height: 100%; width: 0; background-color: rgba(255, 255, 255, 0.3); z-index: 1; transition: width 0.1s linear; display: none; }
        .button span { position: relative; z-index: 2; }
        .duration { font-size: <?= htmlspecialchars($smalltext) ?>px; color: #ffffffcc; margin-top: 5px; }
        .duration.active { color: #fff; }
        .button.playing { background-color: red; }

        .pagination { display: <?= $paginationDisplay ?>; margin: 46px; margin-bottom: 14px; text-align: center; }
        .pagination button { margin: 5px; padding: 10px; padding-top: 22px; background-color: #007bff; color: #fff; border: none; border-radius: 4px; cursor: pointer; min-width: 70px; }
        .pagination button.active { background-color: #0056b3; }

        .levelMeter { position: absolute; bottom: 5px; right: 5px; width: 50px; height: 10px; background-color: #333; border-radius: 5px; display: none; }
    </style>
</head>
<body style="background-color: black;">
    <div id="context-menu" class="context-menu">
        <button id="play-at-button">Play automatically at the top of the hour</button>
    </div>

    <!-- Large remaining-time overlay; revealed a few seconds after load. -->
    <div id="backtimer" style="display: none; padding-top: 59px; z-index: 1000; position: fixed; top: -9999999px; border-radius: 10px; background-color: red; align-items: center; justify-content: center; font-family: Arial, sans-serif; color: #fff; border: 2px solid gray; box-shadow: 5px 5px 15px 5px #000; <?= $backtimerStyles ?>"></div>

    <!-- Collapsible on-screen message log. -->
    <div id="messagelog-container" style="display: <?= $paginationDisplay ?>; width: 480px; position: fixed; bottom: 0; left: 60%; right: 0; background-color: #222; color: #fff; padding: 12px; font-family: Arial, sans-serif; font-size: 12px; border-top: 2px solid #444; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; z-index: 99999;">
        <span id="messagelog-header" style="display: inline-block; width: 100%; text-align: left; overflow: hidden;">
            <b>Messages</b> <span id="messagelog-line"></span>
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
