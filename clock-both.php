<?php // License: PolyForm-Strict-1.0.0 (see LICENSE) ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Clock + Countdown</title>
    <style>
        /*
         * Combined view: the round clock over the top-of-hour countdown. Just a
         * flex column stacking the two existing widgets as iframes (both in
         * ?dock compact mode so they fit the small window) — replaces the old
         * <frameset>, which is obsolete/removed from HTML and can't be styled.
         */
        html, body { height: 100%; margin: 0; background: #0a0c10; }
        body { display: flex; flex-direction: column; }
        iframe { width: 100%; border: 0; display: block; }
        .clock { flex: 3 1 0; }
        .count { flex: 2 1 0; border-top: 1px solid rgba(255, 255, 255, 0.06); }
    </style>
</head>
<body>
    <iframe class="clock" src="clock.php?dock=1" scrolling="no" title="Clock"></iframe>
    <iframe class="count" src="clock-progress.php?dock=1" scrolling="no" title="Time to top of hour"></iframe>
</body>
</html>
