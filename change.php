<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Replace (or, for an empty slot, add) the audio of a cart. */
require_once __DIR__ . '/includes/helpers.php';

$carts       = load_carts();
$id          = isset($_GET['id']) ? (int) $_GET['id'] : null;
$itemTitle   = '';
$pageTitle   = 'Replace audio';
$isNewJingle = false;

if ($id !== null && isset($carts[$id])) {
    list($name, $oldFile, $startingPoint, $color) = explode('|', $carts[$id]) + [null, null, '0', '1'];
    $itemTitle = $name;

    if (trim($oldFile) === '0.mp3') {
        $pageTitle   = 'Add audio';
        $isNewJingle = true;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $id !== null) {
    if (isset($_FILES['audio']) && $_FILES['audio']['error'] === 0) {
        if (strtolower(pathinfo($_FILES['audio']['name'], PATHINFO_EXTENSION)) !== 'mp3') {
            echo 'Only MP3 files are allowed.';
            exit;
        }

        $timestamp   = time();
        $newFileName = $timestamp . '.mp3';

        if (move_uploaded_file($_FILES['audio']['tmp_name'], upload_path($newFileName))) {
            if ($isNewJingle && isset($_POST['newName'])) {
                $name = htmlspecialchars(trim($_POST['newName']));
            }
            if ($isNewJingle && isset($_POST['colorCode'])) {
                $color = htmlspecialchars(trim($_POST['colorCode']));
            }

            $carts[$id] = "{$name}|{$newFileName}|{$startingPoint}|{$color}";
            save_carts($carts);

            header('Location: admin.php');
            exit;
        }
        echo 'File upload failed.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($pageTitle) ?></title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <style>
        .color-dropdown { position: absolute; top: 245px; left: 450px; width: 100px; cursor: pointer; }
        .selected-color { width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 4px; background-color: #007bff; box-sizing: border-box; }
        .dropdown-options { position: absolute; width: 100%; background-color: #fff; border: 1px solid #ccc; border-radius: 4px; display: none; z-index: 10; }
        .color-option { height: 30px; cursor: pointer; transition: background-color 0.2s ease-in-out; }
        .color-option:hover { opacity: 0.7; }
    </style>
</head>
<body style="background-color:#000;">
    <div class="container" style="position: fixed; inset: 0; width: 600px; height: 300px; margin: auto;">
        <div class="form-container">
            <center><h2><?= htmlspecialchars($pageTitle) ?></h2></center>
            <form action="change.php?id=<?= $id ?>" method="post" enctype="multipart/form-data">
                <?php if ($isNewJingle): ?>
                    <label for="newName">Jingle name:</label>
                    <input type="text" id="newName" name="newName" maxlength="40" placeholder="Enter a name" required>
                    <br><br>
                <?php elseif (!empty($itemTitle)): ?>
                    <p>Jingle name: <?= htmlspecialchars($itemTitle) ?></p>
                <?php endif; ?>

                <input type="file" id="audio" name="audio" accept=".mp3" required><br><br>

                <?php if ($isNewJingle): ?>
                    <br><br>
                    <label for="colorCode">Choose color</label>
                    <div class="color-dropdown">
                        <input type="hidden" name="colorCode" id="colorCode" value="1">
                        <div class="selected-color" id="selectedColor" style="background-color: #007bff;"></div>
                        <div class="dropdown-options" id="dropdownOptions">
                            <div class="color-option" data-value="1" style="background-color: #007bff;" title="Blue"></div>
                            <div class="color-option" data-value="2" style="background-color: #4dbf49;" title="Green"></div>
                            <div class="color-option" data-value="3" style="background-color: #d15ccf;" title="Purple"></div>
                            <div class="color-option" data-value="4" style="background-color: #d19724;" title="Orange"></div>
                            <div class="color-option" data-value="5" style="background-color: #5eccd6;" title="Cyan"></div>
                        </div>
                    </div>
                <?php elseif (!empty($itemTitle)): ?>
                    <p style="font-size: 13px; color: #555;">Replacing the audio resets the start and end points.</p>
                <?php endif; ?>

                <div style="text-align: left;">
                    <button type="submit" class="button-common change-audio-button">OK</button>
                    <a href="admin.php">Cancel</a>
                </div>
            </form>
        </div>
    </div>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const selectedColor = document.getElementById('selectedColor');
            const dropdownOptions = document.getElementById('dropdownOptions');
            const colorCodeInput = document.getElementById('colorCode');
            if (!selectedColor || !dropdownOptions) return;

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
