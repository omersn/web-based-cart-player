<?php // License: PolyForm-Strict-1.0.0 (see LICENSE) ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Broadcast Clock</title>
    <link href="assets/fonts/fonts.css" rel="stylesheet">
    <style>
        /*
         * Broadcast clock: a conic-gradient ring that fills as the current hour
         * elapses, live HH:MM in the middle, a ring of 60 dots around it that
         * light up green second by second (every 5th in red, like the 5-second
         * graduations on a real dial), and 4 green quarter-hour marks on the
         * hour ring itself (after Bodet-style broadcast/railway clocks) — a
         * broadcast clock is only useful with real seconds.
         * Original implementation — built for this "studio" redesign, not
         * derived from the old dot-circle clock this file used to hold.
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
            z-index: 0;
            background: conic-gradient(#f0453f var(--deg, 0deg), rgba(255, 255, 255, 0.07) var(--deg, 0deg) 360deg);
        }
        .ring::after {
            content: '';
            position: absolute;
            width: 170px;
            height: 170px;
            border-radius: 50%;
            z-index: 1;
            background: #0a0c10;
        }
        /* 60 dots evenly spaced on a ring of radius --sec-radius: each tick sits
           at the top-centre of the container, then rotates around the
           container's own centre (transform-origin) to fan out into a circle. */
        .sec-ring {
            --sec-radius: 72px;
            position: absolute;
            z-index: 2;
            width: calc(var(--sec-radius) * 2);
            height: calc(var(--sec-radius) * 2);
            top: 50%; left: 50%;
            margin-top: calc(var(--sec-radius) * -1);
            margin-left: calc(var(--sec-radius) * -1);
        }
        .sec-ring .tick {
            position: absolute;
            top: 0; left: 50%;
            width: 6px; height: 6px;
            margin-left: -3px;
            border-radius: 50%;
            background: rgba(53, 196, 111, 0.18);
            transform-origin: 50% var(--sec-radius);
            transform: rotate(calc(var(--i) * 6deg));
            transition: background-color 0.15s ease, box-shadow 0.15s ease;
        }
        .sec-ring .tick.lit { background: #35c46f; box-shadow: 0 0 5px rgba(53, 196, 111, 0.85); }
        /* Every 5th second gets a red marker, like a dial's 5-second graduations. */
        .sec-ring .tick.marker { background: rgba(240, 69, 63, 0.4); }
        .sec-ring .tick.marker.lit { background: #f0453f; box-shadow: 0 0 5px rgba(240, 69, 63, 0.85); }
        /* 4 green quarter-hour marks (00/15/30/45) sitting on the hour ring
           itself — same rotate + transform-origin trick as the second dots. */
        .hour-marks { position: absolute; z-index: 1; width: 0; height: 0; top: 50%; left: 50%; }
        .hour-marks .hour-mark {
            position: absolute;
            top: -105px; left: -1.5px;
            width: 3px; height: 16px;
            border-radius: 2px;
            background: #35c46f;
            transform-origin: 1.5px 105px;
            transform: rotate(calc(var(--i) * 90deg));
        }
        .readout {
            position: relative;
            z-index: 3;
            text-align: center;
            direction: ltr;
        }
        .readout .hm { font-size: 44px; font-weight: 700; color: #f2f5f8; line-height: 1; }

        /* Compact sizing when docked (?dock=1) so the ring fits the short dock. */
        body.dock .ring { width: 150px; height: 150px; }
        body.dock .ring::after { width: 116px; height: 116px; }
        body.dock .sec-ring { --sec-radius: 46px; }
        body.dock .sec-ring .tick { width: 4px; height: 4px; margin-left: -2px; }
        body.dock .hour-marks .hour-mark { top: -75px; left: -1px; width: 2px; height: 10px; transform-origin: 1px 75px; }
        body.dock .readout .hm { font-size: 30px; }
        /* ?nodigits=1 (the clock-only dock trio): the big digital clock sits
           right beside this ring, so the centre readout is redundant there. */
        body.nodigits .readout { display: none; }
    </style>
</head>
<body class="<?= isset($_GET['dock']) ? 'dock' : '' ?><?= isset($_GET['nodigits']) ? ' nodigits' : '' ?>">
    <div class="ring" id="ring">
        <div class="hour-marks" id="hourMarks"></div>
        <div class="sec-ring" id="secRing"></div>
        <div class="readout">
            <div class="hm" id="hm">00:00</div>
        </div>
    </div>

    <script>
        const ring = document.getElementById('ring');
        const hm = document.getElementById('hm');
        const secRing = document.getElementById('secRing');
        const hourMarks = document.getElementById('hourMarks');

        const ticks = [];
        for (let i = 0; i < 60; i++) {
            const tick = document.createElement('span');
            tick.className = 'tick' + (i % 5 === 0 ? ' marker' : '');
            tick.style.setProperty('--i', i);
            secRing.appendChild(tick);
            ticks.push(tick);
        }
        // Static quarter-hour marks (00/15/30/45) — fixed reference points, no updates needed.
        for (let i = 0; i < 4; i++) {
            const mark = document.createElement('span');
            mark.className = 'hour-mark';
            mark.style.setProperty('--i', i);
            hourMarks.appendChild(mark);
        }

        function update() {
            const now = new Date();
            const secondsIntoHour = now.getMinutes() * 60 + now.getSeconds();
            const seconds = now.getSeconds();

            hm.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            // Dots accumulate through the minute (0..current second lit), then
            // reset together at the top of the next minute.
            ticks.forEach((tick, i) => tick.classList.toggle('lit', i <= seconds));

            const deg = (secondsIntoHour / 3600) * 360;
            ring.style.setProperty('--deg', `${deg}deg`);
        }

        update();
        setInterval(update, 1000);
    </script>
</body>
</html>
