<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Delete every unreferenced (soft-deleted) audio file from uploads/. */
require_once __DIR__ . '/includes/helpers.php';

/** Files in uploads/ not referenced by any cart. */
function getUnreferencedFiles(): array
{
    $referenced = ['0.mp3', '00.mp3']; // never delete the placeholder/keepalive clips
    foreach (load_carts() as $line) {
        $parts = explode('|', $line);
        if (isset($parts[1])) {
            $referenced[] = trim($parts[1]);
        }
    }
    $all = array_diff(scandir(UPLOAD_DIR), ['.', '..']);
    return array_diff($all, $referenced);
}

$message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['confirm_delete'])) {
    $unreferenced = getUnreferencedFiles();
    foreach ($unreferenced as $file) {
        $path = upload_path($file);
        if ($file !== '0.mp3' && $file !== '00.mp3' && file_exists($path)) {
            unlink($path);
        }
    }
    $message = count($unreferenced) . ' unreferenced files deleted.';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maintenance: delete unreferenced files</title>
    <style>
        body { background-color: #000; color: #fff; font-family: Arial, sans-serif; padding: 40px; }
        .top-link { text-align: center; position: absolute; top: 5px; right: 10px; background-color: #9fbdd1; width: 110px; height: 23px; box-shadow: 2px 2px 0 1px rgba(163, 163, 163, 0.64); }
        .top-link a { color: #000; }
    </style>
</head>
<body>
    <div class="top-link"><a href="admin.php">Admin</a></div>

    <h1>Maintenance: delete unreferenced files</h1>
    <?php if ($message): ?>
        <p><?= htmlspecialchars($message) ?></p>
    <?php else: ?>
        <p>Delete all unreferenced audio files from storage. This action is irreversible.</p>
        <form method="POST">
            <button type="submit" name="confirm_delete" onclick="return confirm('Are you sure you want to delete all unreferenced files?');">Confirm and delete</button>
        </form>
    <?php endif; ?>
    <a href="maintenance.php" style="color:#fff;">Back</a>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
</body>
</html>
