<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Set a cart's END point (embedded version, shown inside a popup iframe). */
require_once __DIR__ . '/includes/helpers.php';

if (!isset($_GET['file'])) {
    die('No file specified.');
}

$filename    = $_GET['file'];
$startPoint  = 0;
$endPoint    = 100000;
$displayName = '';
$fileExists  = false;

foreach (load_carts() as $entry) {
    list($name, $cartFilename, $start, $color, $end) = array_pad(explode('|', $entry), 5, null);
    if ($cartFilename === $filename) {
        $fileExists  = true;
        $displayName = $name;
        if ($start !== null) {
            $startPoint = (float) $start;
        }
        if ($end !== null) {
            $endPoint = (float) $end;
        }
        break;
    }
}

if (!$fileExists) {
    die('File not found in carts.');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trimmer end point</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <link rel="stylesheet" href="assets/css/trimmer.css">
    <script src="assets/vendor/wavesurfer.min.js"></script>
</head>
<body>
    <div class="container">
        <h2>Trim silence</h2>
        <div class="toggle-container">
            Start -<div class="toggle-button on" id="toggle-button"><div class="toggle-knob"></div></div>- End
        </div>

        <script>
            document.getElementById('toggle-button').addEventListener('click', () => {
                window.location.href = window.location.href.replace('trimmer-endpoint-div.php', 'trimmer-div.php');
            });
        </script>

        <center><h3><?= htmlspecialchars($displayName) ?></h3></center>
        <div class="time-box" id="time-box">Loading</div>
        <div id="waveform"></div>
        <div>
            <input type="range" id="zoom-slider" min="1" max="200" value="1">
            <label for="zoom-slider">🔎</label>
        </div>
        <button onclick="wavesurfer.playPause()">▶/❚❚</button>
        <div class="controls" style="text-align: left;">
            <button id="save-button" class="button-common change-audio-button" style="display:block;">Save</button>
        </div>
    </div>

    <script>
        const file = "<?= htmlspecialchars($filename) ?>";
        const startPoint = <?= $startPoint ?>;
        const endPoint = <?= $endPoint ?>;

        const wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: 'lightgray',
            progressColor: 'blue',
            cursorColor: 'lightblue',
            height: 180,
            cursorWidth: 6,
            dragToSeek: true,
        });

        wavesurfer.load(`uploads/${file}`);

        wavesurfer.on('ready', () => {
            if (wavesurfer.getDuration() > 0) {
                if (endPoint > 0 && endPoint <= wavesurfer.getDuration()) {
                    wavesurfer.seekTo(endPoint / wavesurfer.getDuration());
                } else {
                    wavesurfer.seekTo(1.0);
                }
            }
            updateTimes();
        });
        wavesurfer.on('audioprocess', updateTimes);
        wavesurfer.on('seek', updateTimes);
        document.querySelector('#waveform').addEventListener('click', () => setTimeout(updateTimes, 100));

        document.addEventListener('keydown', (event) => {
            if (event.target.matches('input, textarea, select') || event.target.id === 'zoom-slider') return;

            if (event.code === 'Space') {
                event.preventDefault();
                wavesurfer.playPause();
            }

            if (!wavesurfer.isPlaying() && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
                event.preventDefault();
                const offset = event.code === 'ArrowLeft' ? -0.2 : 0.2;
                const newTime = Math.max(0, Math.min(wavesurfer.getCurrentTime() + offset, wavesurfer.getDuration()));
                wavesurfer.seekTo(newTime / wavesurfer.getDuration());
                wavesurfer.play();
                setTimeout(() => {
                    wavesurfer.pause();
                    wavesurfer.seekTo(newTime / wavesurfer.getDuration());
                }, 60);
            }

            if (event.code === 'Enter') {
                event.preventDefault();
                document.getElementById('save-button').click();
            }
        });

        function updateTimes() {
            const currentTime = formatTime(wavesurfer.getCurrentTime());
            const duration = formatTime(wavesurfer.getDuration());
            document.getElementById('time-box').textContent = `Current position: ${currentTime} of ${duration}`;
        }

        function formatTime(seconds) {
            if (isNaN(seconds)) return '00:00';
            const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
            const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
            return `${mins}:${secs}`;
        }

        document.getElementById('save-button').addEventListener('click', () => {
            const endTime = wavesurfer.getCurrentTime();
            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'save_trim_endpoint.php', true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.send(`file=${file}&end=${endTime}`);
            xhr.onload = () => {
                if (xhr.status === 200 && window.parent && typeof window.parent.hideParentDiv === 'function') {
                    window.parent.hideParentDiv();
                } else if (xhr.status !== 200) {
                    alert('Failed to save endpoint.');
                }
            };
        });

        const zoomSlider = document.getElementById('zoom-slider');
        zoomSlider.addEventListener('input', (event) => wavesurfer.zoom(Number(event.target.value)));
    </script>
</body>
</html>
