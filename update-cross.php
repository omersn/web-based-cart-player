<?php
/**
 * End-point + chain editor with a WaveSurfer waveform. Reads the cart list and
 * data/cross.txt; saves the chosen end point (as the chain "delay") over fetch().
 */
require_once __DIR__ . '/includes/helpers.php';

$crossFile = data_path('cross.txt');

// Save (AJAX POST)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $lineNumber = isset($_POST['lineNumber']) ? (int) $_POST['lineNumber'] : null;
    $chained    = isset($_POST['chained']) ? (int) $_POST['chained'] : 0;
    $delay      = isset($_POST['delay']) ? (float) $_POST['delay'] : 0;

    if ($lineNumber === null) {
        die('Error: Invalid data provided.');
    }

    $lines = file_exists($crossFile) ? file($crossFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    while (count($lines) < $lineNumber) {
        $lines[] = '0|0';
    }
    $lines[$lineNumber - 1] = "$chained|$delay";

    if (file_put_contents($crossFile, implode(PHP_EOL, $lines)) === false) {
        die('Error: Failed to save data to cross.txt.');
    }

    echo "Success: Updated line $lineNumber with chained=$chained, delay=$delay.";
    exit;
}

// Display
$carts = load_carts();
if (empty($carts)) {
    die('Error: carts.txt not found.');
}

$tracks = [];
foreach ($carts as $line) {
    list($name, $filename, $startPoint, $color) = explode('|', $line);
    $tracks[] = [
        'name'       => $name,
        'url'        => 'uploads/' . trim($filename),
        'startPoint' => (float) $startPoint,
    ];
}

$number = isset($_GET['number']) ? (int) $_GET['number'] : 1;
if ($number < 1 || $number > count($tracks)) {
    die('Error: Invalid number parameter.');
}
$currentTrack = $tracks[$number - 1];

$crossData = [];
if (file_exists($crossFile)) {
    foreach (file($crossFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $index => $line) {
        // Lines may be "flag|delay" or just "flag"; pad so $delay is always set.
        [$chained, $delay] = array_pad(explode('|', $line), 2, 0);
        $crossData[$index + 1] = ['chained' => (int) $chained, 'delay' => (float) $delay];
    }
}
$currentChainStatus = $crossData[$number]['chained'] ?? 0;
$currentDelay       = $crossData[$number]['delay'] ?? 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>End point selector</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <script src="https://unpkg.com/wavesurfer.js"></script>
</head>
<body>
    <div class="container">
        <h2>Select end point for: <?= htmlspecialchars($currentTrack['name']) ?></h2>
        <center>
            <button id="chainToggle" class="save-button" data-chained="<?= $currentChainStatus ?>">
                <?= $currentChainStatus ? 'Unchain' : 'Chain' ?>
            </button>
            <p>Current delay: <span id="currentDelay"><?= $currentDelay ?></span> seconds</p>
            <div id="waveform" style="background-color: #e6e3e3;"></div>
            <div>
                <button id="backward" class="save-button">-1 sec</button>
                <button id="forward" class="save-button">+1 sec</button>
            </div>
            <button id="save" class="save-button" style="background-color: #007bff; color: #fff;">Save end point</button>
        </center>
    </div>

    <script>
        const audioUrl = "<?= $currentTrack['url'] ?>";
        const startPoint = <?= $currentTrack['startPoint'] ?>;
        const lineNumber = <?= $number ?>;

        const waveSurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: 'blue',
            progressColor: 'blue',
            cursorColor: 'red',
            height: 150,
        });
        waveSurfer.load(audioUrl);
        waveSurfer.on('ready', () => waveSurfer.setCurrentTime(startPoint));

        document.getElementById('backward').addEventListener('click', () => {
            waveSurfer.seekTo(Math.max(0, waveSurfer.getCurrentTime() - 1) / waveSurfer.getDuration());
        });
        document.getElementById('forward').addEventListener('click', () => {
            waveSurfer.seekTo(Math.min(waveSurfer.getDuration(), waveSurfer.getCurrentTime() + 1) / waveSurfer.getDuration());
        });

        document.getElementById('save').addEventListener('click', () => {
            const endPoint = waveSurfer.getCurrentTime().toFixed(2);
            const chained = document.getElementById('chainToggle').getAttribute('data-chained') === '1' ? 1 : 0;
            fetch(window.location.href, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ lineNumber, chained, delay: endPoint }),
            })
                .then(response => response.text())
                .then(data => { console.log(data); alert(`End point saved: ${endPoint} seconds`); })
                .catch(error => console.error('Error:', error));
        });

        document.getElementById('chainToggle').addEventListener('click', function () {
            const newChained = this.getAttribute('data-chained') === '1' ? 0 : 1;
            this.setAttribute('data-chained', newChained);
            this.textContent = newChained ? 'Unchain' : 'Chain';
        });
    </script>
</body>
</html>
