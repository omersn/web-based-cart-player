<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Edit the scrolling status ticker shown at the bottom of the player. */
require_once __DIR__ . '/auth.php';
require_admin();

$statusFile = data_path('status.txt');

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['status'])) {
    $newStatus = mb_substr(trim($_POST['status']), 0, 100, 'UTF-8');
    file_put_contents($statusFile, $newStatus, LOCK_EX);
    header('Location: admin.php');
    exit;
}

$current = file_exists($statusFile) ? file_get_contents($statusFile) : '';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit status ticker</title>
    <style>
        body { background-color: #000; font-family: Arial, sans-serif; margin: 0; }
        .container {
            position: fixed;
            inset: 0;
            width: 700px;
            height: 200px;
            margin: auto;
            background-color: #fff;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        textarea {
            width: 70%;
            height: 40px;
            font-size: 16px;
            font-family: Arial, sans-serif;
            padding: 10px;
            border: 1px solid #555;
            border-radius: 5px;
            background-color: #333;
            color: #fff;
            resize: none;
            text-align: center;
            overflow: hidden;
        }
        button {
            margin-top: 15px;
            padding: 10px 20px;
            font-size: 16px;
            background-color: #007bff;
            color: #fff;
            border: none;
            border-radius: 5px;
            cursor: pointer;
        }
        button:hover { background-color: #0056b3; }
        .clear-button { background-color: #dc3545; margin-left: 10px; }
        .clear-button:hover { background-color: #b02a37; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Edit status ticker</h2>
        <form method="post">
            <textarea name="status" id="statusTextarea" maxlength="100"><?= htmlspecialchars($current, ENT_QUOTES, 'UTF-8') ?></textarea>
            <br>
            <button type="button" class="clear-button" onclick="clearAndSave()">Hide ticker</button>
            <button type="submit">Save</button>
        </form>
    </div>

    <script>
        function clearAndSave() {
            document.getElementById('statusTextarea').value = '';
            document.querySelector('form').submit();
        }
    </script>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
</body>
</html>
