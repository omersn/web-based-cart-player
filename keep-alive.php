<?php // SPDX-License-Identifier: AGPL-3.0-or-later ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Keep-alive monitor</title>
    <style>
        /* The indicator fills the tiny iframe the player embeds it in. */
        #keep-alive-indicator {
            width: 1000px;
            height: 2000px;
            margin: 0 auto;
            background-color: darkgreen;
        }
        @keyframes blink-green { 0%, 100% { background-color: darkgreen; } 50% { background-color: limegreen; } }
        #keep-alive-indicator.blinking { animation: blink-green 5s infinite; }

        @keyframes blink-red { 0%, 100% { background-color: red; } 50% { background-color: darkred; } }
        #keep-alive-indicator.offline { animation: blink-red 1s infinite; }

        #keep-alive-indicator.yellow { background-color: yellow; animation: none; }
    </style>
</head>
<body bgcolor="black" style="margin: 0;">
    <div id="keep-alive-indicator"></div>
    <!-- A near-silent clip; see assets/js/keep-alive.js for why it is played. -->
    <audio id="keep-alive-audio" src="uploads/00.mp3" preload="auto" style="display: none;"></audio>

    <script src="assets/js/keep-alive.js"></script>
</body>
</html>
