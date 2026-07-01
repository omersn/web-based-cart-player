<?php // SPDX-License-Identifier: AGPL-3.0-or-later ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Broadcast Clock</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet">
    <style>
        /*
         * Countdown ring: a conic-gradient arc that fills red as the current
         * hour elapses, with the live HH:MM in the middle and the remaining
         * time to the top of the hour underneath. Original implementation —
         * built for this "studio" redesign, not derived from the old
         * dot-circle clock this file used to hold.
         */
        body {
            background-color: #0a0c10;
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: 'JetBrains Mono', monospace;
        }
        .ring {
            position: relative;
            width: 210px;
            height: 210px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ring::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: conic-gradient(#f0453f var(--deg, 0deg), rgba(255, 255, 255, 0.07) var(--deg, 0deg) 360deg);
        }
        .ring::after {
            content: '';
            position: absolute;
            width: 170px;
            height: 170px;
            border-radius: 50%;
            background: #0a0c10;
        }
        .readout {
            position: relative;
            z-index: 1;
            text-align: center;
            direction: ltr;
        }
        .readout .hm { font-size: 44px; font-weight: 700; color: #f2f5f8; line-height: 1; }
        .readout .countdown { font-size: 16px; font-weight: 600; color: #ff5b54; margin-top: 6px; }

        /* Compact sizing when docked (?dock=1) so the ring fits the short dock. */
        body.dock .ring { width: 150px; height: 150px; }
        body.dock .ring::after { width: 116px; height: 116px; }
        body.dock .readout .hm { font-size: 30px; }
        body.dock .readout .countdown { font-size: 12px; margin-top: 4px; }
    </style>
</head>
<body class="<?= isset($_GET['dock']) ? 'dock' : '' ?>">
    <div class="ring" id="ring">
        <div class="readout">
            <div class="hm" id="hm">00:00</div>
            <div class="countdown" id="countdown">0:00</div>
        </div>
    </div>

    <script>
        const ring = document.getElementById('ring');
        const hm = document.getElementById('hm');
        const countdown = document.getElementById('countdown');

        function update() {
            const now = new Date();
            const secondsIntoHour = now.getMinutes() * 60 + now.getSeconds();
            const secondsRemaining = 3600 - secondsIntoHour;

            hm.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            const minutes = Math.floor(secondsRemaining / 60);
            const seconds = secondsRemaining % 60;
            countdown.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;

            const deg = (secondsIntoHour / 3600) * 360;
            ring.style.setProperty('--deg', `${deg}deg`);
        }

        update();
        setInterval(update, 1000);
    </script>
</body>
</html>
