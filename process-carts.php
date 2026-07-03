<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Recalculate each cart's end point from the real audio duration and rewrite
 * the cart list. Runs client-side (it needs the browser to decode durations),
 * fetching and posting the cart list back to this same endpoint.
 *
 * ?action=align runs it silently and bounces back to the player afterwards
 * (used when returning from the admin/DJ views).
 */
require_once __DIR__ . '/includes/helpers.php';

// Save the recalculated list (AJAX POST).
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $content = $_POST['content'] ?? '';
    if ($content !== '') {
        if (file_put_contents(data_path('carts.txt'), $content) !== false) {
            echo 'Successfully updated carts.txt!';
        } else {
            http_response_code(500);
            echo 'Failed to update carts.txt.';
        }
    } else {
        http_response_code(400);
        echo 'No content provided.';
    }
    exit;
}

// Serve the raw cart list for the client to read.
if (isset($_GET['fetch']) && $_GET['fetch'] === 'carts') {
    $path = data_path('carts.txt');
    if (file_exists($path)) {
        header('Content-Type: text/plain');
        echo file_get_contents($path);
    } else {
        http_response_code(404);
        echo 'carts.txt not found.';
    }
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio duration processor</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 80px; color: #000; background-color: #000; width: 90%; overflow-x: hidden; }
        pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
    </style>
</head>
<body onload="window.scrollTo(0, document.body.scrollHeight);">
    <center><p style="color:#fff;" id="proctrans">Processing…</p></center>
    <div id="output" style="border: 3px solid gray; text-align: center;"></div>
    <div id="backLink"><a href="maintenance.php" style="color:#fff;">Back</a></div>

    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const redirectAfterProcessing = urlParams.get('action') === 'align';
        const printAsList = urlParams.get('action') === 'align';

        async function processCarts() {
            const outputDiv = document.getElementById('output');
            const updateOutput = (message) => {
                if (printAsList) {
                    outputDiv.innerHTML = `<pre>${message}</pre>`;
                } else {
                    outputDiv.innerHTML += `<pre>${message}</pre>`;
                }
            };

            try {
                const response = await fetch('?fetch=carts');
                if (!response.ok) {
                    updateOutput(`Failed to load carts.txt (HTTP ${response.status})`);
                    return;
                }

                const lines = (await response.text()).split('\n').filter(line => line.trim() !== '');
                const updatedLines = [];

                for (const line of lines) {
                    const parts = line.split('|');
                    if (parts.length < 2) {
                        updatedLines.push(line);
                        continue;
                    }

                    const [name, filename, startPoint, color, endPoint] = parts.map(part => part.trim());
                    if (filename === '0.mp3') {
                        updatedLines.push(line);
                        continue;
                    }

                    try {
                        const duration = await getAudioDuration(`uploads/${filename}`);
                        const newStart = startPoint && parseFloat(startPoint) > 0 ? parseFloat(startPoint) : 0.005;
                        let newEnd = endPoint && parseFloat(endPoint) > 0 ? parseFloat(endPoint) : duration - 0.005;
                        if (newEnd >= duration) {
                            newEnd = duration - 0.005;
                        }
                        updatedLines.push([name, filename, newStart.toFixed(3), color, newEnd.toFixed(3)].join('|'));
                        updateOutput(`Processed: ${filename} | Start: ${newStart.toFixed(3)}, End: ${newEnd.toFixed(3)}`);
                        window.scrollTo(0, document.body.scrollHeight);
                    } catch (error) {
                        updatedLines.push(line);
                        updateOutput(`Error processing ${filename}: ${error.message}`);
                    }
                }

                if (await saveCarts(updatedLines.join('\n'))) {
                    updateOutput('Successfully updated carts.txt!');
                    if (redirectAfterProcessing) {
                        window.location.href = 'index.php';
                    }
                } else {
                    updateOutput('Failed to save carts.txt.');
                }
            } catch (error) {
                updateOutput(`Error: ${error.message}`);
            }
        }

        function getAudioDuration(audioPath) {
            return new Promise((resolve, reject) => {
                const audio = new Audio(audioPath);
                audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
                audio.addEventListener('error', () => reject(new Error(`Failed to load audio: ${audioPath}`)));
            });
        }

        function saveCarts(updatedContent) {
            return new Promise((resolve) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '', true);
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                xhr.onload = () => resolve(xhr.status === 200);
                xhr.send(`content=${encodeURIComponent(updatedContent)}`);
            });
        }

        if (printAsList) {
            document.getElementById('backLink').style.display = 'none';
            document.getElementById('proctrans').textContent = 'Checking for changes, please wait';
        }

        processCarts();
    </script>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
</body>
</html>
