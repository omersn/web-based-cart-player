<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Upload a brand-new jingle and append it to the cart list. */
require_once __DIR__ . '/includes/helpers.php';

/** Accept only real MP3 uploads. */
function isValidMp3(array $file): bool
{
    $ext  = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $mime = mime_content_type($file['tmp_name']);
    return $ext === 'mp3' && $mime === 'audio/mpeg';
}

$errorMessage = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['audioFile'])) {
    $file = $_FILES['audioFile'];

    if (isValidMp3($file)) {
        $timestamp  = time();
        $targetFile = upload_path($timestamp . '.mp3');

        if (move_uploaded_file($file['tmp_name'], $targetFile)) {
            $jingleName = htmlspecialchars($_POST['jingleName']);
            $colorCode  = htmlspecialchars($_POST['colorCode']);

            $carts   = load_carts();
            $carts[] = "{$jingleName}|{$timestamp}.mp3|0|{$colorCode}"; // default start point 0
            save_carts($carts);

            header('Location: admin.php');
            exit;
        }
        $errorMessage = 'Error uploading the file.';
    } else {
        $errorMessage = 'Please upload a valid MP3 file.';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Add new jingle</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <style>
        .color-dropdown { position: absolute; top: 186px; left: 450px; width: 100px; cursor: pointer; }
        .selected-color { width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .dropdown-options {
            position: absolute; top: 35px; left: 0; width: 100%; display: none;
            border: 1px solid #ccc; border-radius: 4px; background-color: #fff; z-index: 10;
        }
        .color-option { width: 100%; height: 30px; cursor: pointer; transition: all 0.2s; }
        .color-option:hover { opacity: 0.7; }
    </style>
</head>
<body style="background-color:#000;">
    <div class="container" style="position: fixed; inset: 0; width: 600px; height: 280px; margin: auto;">
        <h1>Add new jingle</h1>
        <form action="add.php" method="POST" enctype="multipart/form-data">
            <input type="text" name="jingleName" id="jingleName" maxlength="40" required style="margin: 7px; padding: 2px; width: 400px;">
            <label for="jingleName">Jingle name</label>
            <br><br>
            <input type="file" name="audioFile" id="audioFile" accept=".mp3" required>
            <label for="audioFile">Choose audio file</label>
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
            <br><br>
            <?php if ($errorMessage): ?>
                <p style="color: red;"><?= htmlspecialchars($errorMessage) ?></p>
            <?php endif; ?>
            <div style="text-align: left;">
                <button type="submit" class="button-common change-audio-button">Add</button>
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
