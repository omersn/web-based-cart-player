<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Change a cart's button colour (full-page version, used from admin links). */
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
    header('Location: admin.php?color_updated=true');
    exit;
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
        .color-dropdown { position: relative; width: 100px; cursor: pointer; top: -25px; left: 427px; }
        .selected-color { width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .dropdown-options { position: absolute; top: 35px; left: 0; width: 100%; display: none; border: 1px solid #ccc; border-radius: 4px; background-color: #fff; z-index: 10; }
        .color-option { width: 100%; height: 30px; cursor: pointer; transition: all 0.2s; }
        .color-option:hover { opacity: 0.7; }
    </style>
</head>
<body style="background-color:#000;">
    <div class="container" style="position: fixed; inset: 0; width: 600px; height: 280px; margin: auto;">
        <h1>Change color</h1>
        <form action="color.php?id=<?= $id ?>" method="POST">
            <p>Jingle name: <?= htmlspecialchars($name) ?></p>
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
            <br><br>
            <div style="text-align: left;">
                <button type="submit" class="button-common change-audio-button">Save</button>
                <a href="admin.php">Cancel</a>
            </div>
        </form>
    </div>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
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
