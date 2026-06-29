<?php
/**
 * Per-cart playback volume editor (6th field of a cart line). Shown inside a
 * small popup iframe from the admin list; saves over fetch() with a debounce.
 */
require_once __DIR__ . '/includes/helpers.php';

// Save (AJAX POST)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $lineNumber = isset($_POST['lineNumber']) ? (int) $_POST['lineNumber'] : null;
    $volume     = isset($_POST['volume']) ? (float) $_POST['volume'] : 1.0;

    if ($lineNumber === null) {
        http_response_code(400);
        echo 'Error: Invalid data provided.';
        exit;
    }

    $lines = load_carts();
    if (!isset($lines[$lineNumber - 1])) {
        http_response_code(400);
        echo 'Error: Invalid line number.';
        exit;
    }

    $parts    = explode('|', $lines[$lineNumber - 1]);
    $parts[5] = $volume; // append/replace the volume field
    $lines[$lineNumber - 1] = implode('|', $parts);

    if (!save_carts($lines)) {
        http_response_code(500);
        echo 'Error: Failed to update carts.txt.';
        exit;
    }

    echo "Success: Updated volume for line $lineNumber.";
    exit;
}

// Display
$carts = load_carts();
if (empty($carts)) {
    die('Error: carts.txt not found.');
}

$number = isset($_GET['number']) ? (int) $_GET['number'] : 1;
if ($number < 1 || $number > count($carts)) {
    die('Error: Invalid number parameter.');
}

$parts        = explode('|', $carts[$number - 1]);
$currentTrack = [
    'name'     => $parts[0] ?? '',
    'filename' => $parts[1] ?? '0.mp3',
    'volume'   => isset($parts[5]) ? (float) $parts[5] : 1.0,
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Volume</title>
    <style>
        body { text-align: center; font-family: Arial, sans-serif; overflow: hidden; }
        input[type="range"] { -webkit-appearance: none; appearance: none; }
        input[type="range"]::-webkit-slider-runnable-track {
            width: 100%; height: 10px; border-radius: 5px;
            background-color: #acacb4; opacity: 0.6;
            background-image: linear-gradient(to right, #cacad6, #cacad6 2px, #acacb4 2px, #acacb4);
            background-size: 4px 100%;
        }
        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none; width: 10px; height: 10px;
            background: #007bff; border-radius: 3px; cursor: pointer;
            clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
        }
    </style>
</head>
<body>
    <div class="container" style="margin-top: -12px; line-height: 10%;">
        <h6 style="font-family: Arial, sans-serif; font-size: 9px;">
            <button id="playPauseButton" style="height:20px; background-color:#fff; border:0;">▶</button>
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<?= htmlspecialchars($currentTrack['name']) ?>
        </h6>

        <audio id="audioPlayer" style="display: none;">
            <source src="uploads/<?= htmlspecialchars($currentTrack['filename']) ?>" type="audio/mpeg">
        </audio>

        <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
            <input id="volumeSlider" type="range" min="0" max="1" step="0.01" value="<?= $currentTrack['volume'] ?>"
                   style="width: 150px; height: 10px; background: lightgray; border-radius: 5px; outline: none; transform: rotate(180deg);">
            <div id="loudnessMeter" style="top:-110px; transform: rotate(-90deg); width: 10px; height: 150px; background: lightgray; border: 1px solid #000; position: relative;">
                <div id="loudnessLevel" style="width: 100%; height: 0%; background-color: green; position: absolute; bottom: 0; transition: height 0.1s;"></div>
            </div>
        </div>
        <p style="display:none;">Volume: <span id="volumeValue"><?= $currentTrack['volume'] ?></span></p>
    </div>

    <script>
        const lineNumber = <?= $number ?>;
        const playPauseButton = document.getElementById('playPauseButton');
        const volumeSlider = document.getElementById('volumeSlider');
        const volumeValue = document.getElementById('volumeValue');
        const audioPlayer = document.getElementById('audioPlayer');

        audioPlayer.volume = parseFloat(volumeSlider.value);

        playPauseButton.addEventListener('click', () => {
            if (audioPlayer.paused) {
                audioPlayer.play();
                playPauseButton.textContent = '❚❚';
            } else {
                audioPlayer.pause();
                playPauseButton.textContent = '▶';
            }
        });

        let saveTimeout;
        volumeSlider.addEventListener('input', function () {
            const volume = parseFloat(this.value);
            audioPlayer.volume = volume;
            volumeValue.textContent = volume.toFixed(2);

            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ lineNumber, volume }),
                })
                    .then(response => response.text())
                    .then(data => console.log('Volume saved:', data))
                    .catch(error => console.error('Error saving volume:', error));
            }, 200);
        });

        // Live loudness meter via Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaElementSource(audioPlayer);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        function updateLoudnessMeter() {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
            const loudness = Math.min((average / 255) * 100, 100);
            const loudnessLevel = document.getElementById('loudnessLevel');
            loudnessLevel.style.height = `${loudness}%`;
            loudnessLevel.style.backgroundColor = loudness < 30 ? 'green' : (loudness < 70 ? 'yellow' : 'red');
            requestAnimationFrame(updateLoudnessMeter);
        }

        audioPlayer.addEventListener('play', () => {
            audioContext.resume();
            updateLoudnessMeter();
        });
    </script>
</body>
</html>
