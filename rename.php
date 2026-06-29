<?php
/** Rename a single cart (keeps all other fields intact). */
require_once __DIR__ . '/includes/helpers.php';

$id    = isset($_GET['id']) ? (int) $_GET['id'] : null;
$carts = load_carts();

if ($id === null || !isset($carts[$id])) {
    die('Invalid ID.');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    list($oldName, $oldFile, $oldStart, $oldColor, $oldEnd) = array_pad(explode('|', $carts[$id]), 5, null);
    $newName     = trim($_POST['name']);
    $carts[$id]  = "{$newName}|{$oldFile}|{$oldStart}|{$oldColor}|{$oldEnd}";
    save_carts($carts);
    header('Location: admin.php');
    exit;
}

list($currentName) = array_pad(explode('|', $carts[$id]), 5, null);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rename cart</title>
    <link rel="stylesheet" href="assets/css/admin.css">
</head>
<body style="background-color:#000;">
    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>

    <div class="container" style="position: fixed; inset: 0; width: 600px; height: 200px; margin: auto;">
        <div class="form-container">
            <h2>Rename cart</h2><br>
            <form action="rename.php?id=<?= $id ?>" method="post">
                <input type="text" id="name" name="name" maxlength="40" value="<?= htmlspecialchars($currentName) ?>" required>
                <div style="text-align: left;">
                    <button type="submit" class="button-common change-audio-button">OK</button>
                    <a href="admin.php">Cancel</a>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
