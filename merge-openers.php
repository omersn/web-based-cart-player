<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Concatenate the first three real jingle MP3s into one "station opener" file
 * and serve it for download. Shows a short merge animation, then triggers the
 * download in a hidden iframe.
 */
require_once __DIR__ . '/includes/helpers.php';

if (isset($_GET['download'])) {
    $files = [];
    foreach (load_carts() as $entry) {
        list($name, $filename) = explode('|', $entry) + [null, null];
        if ($filename && trim($filename) !== '0.mp3') {
            $files[] = upload_path(trim($filename));
        }
        if (count($files) >= 3) {
            break;
        }
    }

    if (count($files) < 3) {
        die('Error: Not enough valid MP3 files to merge.');
    }

    $downloadName = 'merged_opener_' . date('d-m-y') . '.mp3';
    $mergedFile   = upload_path($downloadName);
    $mergedHandle = fopen($mergedFile, 'w');

    foreach ($files as $file) {
        $handle = fopen($file, 'rb');
        stream_copy_to_stream($handle, $mergedHandle);
        fclose($handle);
    }
    fclose($mergedHandle);

    header('Content-Type: audio/mpeg');
    header('Content-Disposition: attachment; filename="' . $downloadName . '"');
    header('Content-Length: ' . filesize($mergedFile));
    readfile($mergedFile);
    unlink($mergedFile);
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Merging parts 1, 2 &amp; 3</title>
    <style>
        body { text-align: center; font-family: Arial, sans-serif; background-color: #000; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .container { background: #fff; color: #000; padding: 30px; border-radius: 10px; width: 900px; box-shadow: 0 0 15px rgba(255, 255, 255, 0.2); overflow: hidden; }
        .blocks { display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 20px; }
        .block { width: 50px; height: 50px; background-color: #27ae60; border-radius: 5px; transition: transform 3s ease-in-out, width 5s ease-in-out; display: flex; justify-content: center; align-items: center; font-weight: bold; color: #fff; }
        .merged { transform: translateX(0) scaleX(2); width: 150px; }
        .message { margin-top: 20px; font-size: 18px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Merging parts 1, 2 &amp; 3</h2>
        <div class="blocks">
            <div class="block" id="block1"></div>
            <div class="block" id="block2"></div>
            <div class="block" id="block3"></div>
        </div>
        <div class="message" id="message">Starting merge…</div>
    </div>

    <iframe id="hiddenFrame" style="display:none;"></iframe>

    <script>
        setTimeout(() => {
            ['block1', 'block2', 'block3'].forEach(id => document.getElementById(id).classList.add('merged'));
            document.getElementById('message').textContent = 'Merge complete! Downloading…';

            setTimeout(() => { document.getElementById('hiddenFrame').src = '?download=1'; }, 5000);
            setTimeout(() => { window.location.href = 'download.php'; }, 6800);
        }, 900);
    </script>
</body>
</html>
