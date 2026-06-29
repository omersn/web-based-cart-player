<?php
/** Reset every chain flag (data/cross.txt) back to "0", then return to maintenance. */
require_once __DIR__ . '/config.php';

$crossFile = data_path('cross.txt');

if (file_exists($crossFile)) {
    $lines        = file($crossFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $updatedLines = array_map(static fn() => '0', $lines);
    file_put_contents($crossFile, implode("\n", $updatedLines));
} else {
    file_put_contents($crossFile, "0\n");
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Resetting chains</title>
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
        <div class="message">Resetting chains</div>
        <img src="assets/img/loading.gif" height="30" alt="Loading">
    </div>

    <script>
        setTimeout(() => {
            window.location.href = 'maintenance.php';
        }, 1500);
    </script>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
</body>
</html>
