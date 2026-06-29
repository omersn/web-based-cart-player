<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Toggle the "chain to next" flag for a cart (data/cross.txt). Shown inside a
 * small popup iframe from the admin/DJ lists; saves over fetch().
 */
require_once __DIR__ . '/includes/helpers.php';

$crossFile = data_path('cross.txt');

// Save (AJAX POST)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $lineNumber = isset($_POST['lineNumber']) ? (int) $_POST['lineNumber'] : null;
    $chained    = isset($_POST['chained']) ? (int) $_POST['chained'] : 0;

    if ($lineNumber === null) {
        http_response_code(400);
        echo 'Error: Invalid data provided.';
        exit;
    }

    $lines = file_exists($crossFile) ? file($crossFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    while (count($lines) < $lineNumber) {
        $lines[] = '0|0';
    }
    $lines[$lineNumber - 1] = "$chained|0";

    if (file_put_contents($crossFile, implode(PHP_EOL, $lines)) === false) {
        http_response_code(500);
        echo 'Error: Failed to update cross.txt.';
        exit;
    }

    echo "Success: Updated line $lineNumber with chained=$chained.";
    exit;
}

// Display
$carts = load_carts();
if (empty($carts)) {
    die('Error: carts.txt not found.');
}

$tracks = [];
foreach ($carts as $line) {
    list($name) = explode('|', $line);
    $tracks[]   = ['name' => $name];
}

$number = isset($_GET['number']) ? (int) $_GET['number'] : 1;
if ($number < 1 || $number > count($tracks)) {
    die('Error: Invalid number parameter.');
}
$currentTrack = $tracks[$number - 1];

$crossStates        = load_cross_states();
$currentChainStatus = $crossStates[$number - 1] ?? 0;
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chain</title>
</head>
<body>
    <div class="container" style="margin-top: 3px; line-height: 80%;">
        <center>
            <div style="font-family: Arial, sans-serif; font-size: 8px;"><?= htmlspecialchars($currentTrack['name']) ?></div><br>
            <button id="chainToggle"
                    class="save-button"
                    style="font-size:20px; color: <?= $currentChainStatus ? 'green' : 'gray' ?>;"
                    data-chained="<?= $currentChainStatus ?>">
                <?= $currentChainStatus ? 'Chained to next 🔗' : 'Not chained' ?>
            </button>
        </center>
    </div>

    <script>
        const lineNumber = <?= $number ?>;
        let isChained = <?= $currentChainStatus ?>;

        document.getElementById('chainToggle').addEventListener('click', function () {
            isChained = !isChained;
            this.setAttribute('data-chained', isChained ? '1' : '0');
            this.style.color = isChained ? 'green' : 'gray';
            this.textContent = isChained ? 'Chained to next 🔗' : 'Not chained';

            fetch(window.location.href, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ lineNumber, chained: isChained ? 1 : 0 }),
            })
                .then(response => response.text())
                .then(data => console.log(data))
                .catch(error => {
                    console.error('Error:', error);
                    alert('Failed to save data. Please try again.');
                });
        });
    </script>
</body>
</html>
