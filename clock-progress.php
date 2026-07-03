<?php // License: PolyForm-Strict-1.0.0 (see LICENSE) ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Time to Top of Hour</title>
    <link href="assets/fonts/fonts.css" rel="stylesheet">
    <style>
        /*
         * "Time to top of hour" read-out: a big MM:SS countdown to :00, over a
         * slim bar that fills as the hour elapses (quarter ticks for reference),
         * turning urgent-red in the final stretch. Original implementation for
         * this player's studio redesign — shares the palette/type of clock.php
         * but is its own, purpose-built widget (no shared/derived layout code).
         */
        :root {
            --bg: #0a0c10;
            --dim: #566072;
            --red: #f0453f;
            --track: rgba(255, 255, 255, 0.08);
        }
        * { box-sizing: border-box; margin: 0; }
        body {
            background: var(--bg);
            height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3.2vmin;
            font-family: 'JetBrains Mono', monospace;
            color: #e8edf3;
            padding: 4vmin;
        }
        .label {
            font-size: 3vmin;
            letter-spacing: 0.28em;
            text-transform: uppercase;
            color: var(--dim);
            font-weight: 700;
        }
        .count {
            font-size: 17vmin;
            font-weight: 800;
            line-height: 0.9;
            font-variant-numeric: tabular-nums;
            transition: color 0.3s ease;
        }
        /* Final 2 minutes: the read-out and the fill glow red, and the last
           60 seconds pulse once per second — the "clear the deck" cue. */
        body.warn .count { color: var(--red); }
        body.urgent .count { animation: pulse 1s steps(1, end) infinite; }
        @keyframes pulse { 50% { opacity: 0.35; } }

        .track {
            position: relative;
            width: 74vmin;
            max-width: 88%;
            height: 1.6vmin;
            min-height: 6px;
            background: var(--track);
            border-radius: 999px;
            overflow: hidden;
        }
        .fill {
            position: absolute;
            inset: 0 auto 0 0;
            width: 0;
            background: linear-gradient(90deg, #7a8699, #aeb8c6);
            border-radius: 999px;
            transition: width 0.9s linear, background-color 0.3s ease;
        }
        body.warn .fill { background: linear-gradient(90deg, #b5322e, var(--red)); }
        /* Quarter-hour reference ticks sitting on top of the track. */
        .ticks { position: absolute; inset: 0; }
        .ticks i {
            position: absolute;
            top: 0; bottom: 0;
            width: 2px;
            margin-left: -1px;
            background: rgba(10, 12, 16, 0.85);
        }

        body.dock { gap: 1.4vmin; padding: 2vmin; }
        body.dock .label { font-size: 12px; letter-spacing: 0.2em; }
        body.dock .count { font-size: 44px; }
        body.dock .track { height: 8px; }
    </style>
</head>
<body class="<?= isset($_GET['dock']) ? 'dock' : '' ?>">
    <div class="label">To top of hour</div>
    <div class="count" id="count">--:--</div>
    <div class="track">
        <div class="fill" id="fill"></div>
        <div class="ticks" id="ticks"></div>
    </div>

    <script>
        const HOUR = 3600;
        const countEl = document.getElementById('count');
        const fillEl = document.getElementById('fill');

        // Quarter-hour ticks at 25/50/75% (00 and 60 are the bar's own ends).
        const ticks = document.getElementById('ticks');
        for (const pct of [25, 50, 75]) {
            const t = document.createElement('i');
            t.style.left = pct + '%';
            ticks.appendChild(t);
        }

        function pad(n) { return String(n).padStart(2, '0'); }

        function tick() {
            const now = new Date();
            const elapsed = now.getMinutes() * 60 + now.getSeconds();
            const remaining = HOUR - elapsed;

            countEl.textContent = `-${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`;
            fillEl.style.width = (elapsed / HOUR) * 100 + '%';

            document.body.classList.toggle('warn', remaining <= 120);
            document.body.classList.toggle('urgent', remaining <= 60);
        }

        tick();
        setInterval(tick, 1000);
    </script>
</body>
</html>
