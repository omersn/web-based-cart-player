<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Destroy the session and bounce back to the player (via the realign step). */
session_start();
session_unset();
session_destroy();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Logging out</title>
    <style>
        body, html {
            margin: 0;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: #000;
            color: #fff;
            font-family: Arial, sans-serif;
            overflow: hidden;
        }
        .message { font-size: 24px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div style="text-align: center;">
        <div class="message">Logging out</div>
        <img src="assets/img/loading.gif" height="30" alt="Loading">
    </div>

    <script>
        setTimeout(() => {
            window.location.href = 'process-carts.php?action=align';
        }, 2000);
    </script>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
</body>
</html>
