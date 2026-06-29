<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Change a cart's button colour (embedded version, shown inside a popup iframe). */
require_once __DIR__ . '/includes/helpers.php';

if (!isset($_GET['id'])) {
    die('No ID specified.');
}

$id    = (int) $_GET['id'];
$carts = load_carts();
if (!isset($carts[$id])) {
    die('Invalid ID.');
}

list($name, $file, $start, $color, $end) = array_pad(explode('|', $carts[$id]), 5, null);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $newColor   = $_POST['colorCode'] ?? $color;
    $carts[$id] = "{$name}|{$file}|{$start}|{$newColor}|{$end}";
    save_carts($carts);

    // Tell the parent window to close the popup and refresh.
    echo '<!DOCTYPE html><html><head><script>'
        . 'if (window.parent && typeof window.parent.hideParentDiv2 === "function") { window.parent.hideParentDiv2(); }'
        . '</script></head><body></body></html>';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Change color</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <style>
        .color-dropdown { position: relative; width: 100px; cursor: pointer; top: -25px; left: -40px; }
        .selected-color { width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .dropdown-options { position: absolute; top: 35px; left: 0; width: 100%; display: none; border: 1px solid #ccc; border-radius: 4px; background-color: #fff; z-index: 10; }
        .color-option { width: 100%; height: 30px; cursor: pointer; transition: all 0.2s; }
        .color-option:hover { opacity: 0.7; }
    </style>
</head>
<body style="background-color:#000; padding:0;">
    <div class="container" style="position: fixed; inset: 0; width: 400px; height: 250px; margin: 0; padding: 0;">
        <form action="color-div.php?id=<?= $id ?>" method="POST">
            <center>
                <h6>Jingle name: <?= htmlspecialchars($name) ?></h6>
                <label for="colorCode">Choose color:</label>
                <div class="color-dropdown">
                    <input type="hidden" name="colorCode" id="colorCode" value="<?= htmlspecialchars($color) ?>">
                    <div class="selected-color" id="selectedColor" style="background-color: <?= color_for($color) ?>;"></div>
                    <div class="dropdown-options" id="dropdownOptions">
                        <div class="color-option" data-value="1" style="background-color: #007bff;" title="Blue"></div>
                        <div class="color-option" data-value="2" style="background-color: #4dbf49;" title="Green"></div>
                        <div class="color-option" data-value="3" style="background-color: #d15ccf;" title="Purple"></div>
                        <div class="color-option" data-value="4" style="background-color: #d19724;" title="Orange"></div>
                        <div class="color-option" data-value="5" style="background-color: #5eccd6;" title="Cyan"></div>
                    </div>
                </div>
            </center>
            <br><br><br><br><br>
            <div style="text-align: left;">
                <button type="submit" class="button-common change-audio-button">Save</button>
            </div>
        </form>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const selectedColor = document.getElementById('selectedColor');
            const dropdownOptions = document.getElementById('dropdownOptions');
            const colorCodeInput = document.getElementById('colorCode');

            selectedColor.addEventListener('click', () => {
                dropdownOptions.style.display = dropdownOptions.style.display === 'block' ? 'none' : 'block';
            });
            document.querySelectorAll('.color-option').forEach(option => {
                option.addEventListener('click', (event) => {
                    selectedColor.style.backgroundColor = getComputedStyle(event.target).backgroundColor;
                    colorCodeInput.value = event.target.getAttribute('data-value');
                    dropdownOptions.style.display = 'none';
                });
            });
            document.addEventListener('click', (event) => {
                if (!event.target.closest('.color-dropdown')) {
                    dropdownOptions.style.display = 'none';
                }
            });
        });
    </script>
</body>
</html>
