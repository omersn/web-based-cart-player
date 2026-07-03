<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Backup & restore. A backup is a .cartdb file (a zip) holding audio.zip
 * (everything in uploads/) and db.zip (the pseudo-database text files).
 */
require_once __DIR__ . '/auth.php';
require_admin();

/** Zip up files/folders into $destination. */
function create_zip(array $files, string $destination): bool
{
    $zip = new ZipArchive();
    if ($zip->open($destination, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        return false;
    }
    foreach ($files as $file) {
        if (is_dir($file)) {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($file),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            foreach ($iterator as $info) {
                if (!$info->isDir()) {
                    $path = $info->getRealPath();
                    $zip->addFile($path, substr($path, strlen($file) + 1));
                }
            }
        } elseif (file_exists($file)) {
            $zip->addFile($file, basename($file));
        }
    }
    return $zip->close();
}

function extract_zip(string $zipPath, string $destination): bool
{
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
        return false;
    }
    $zip->extractTo($destination);
    $zip->close();
    return true;
}

$log = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['create_backup'])) {
        $dataFiles = array_map('data_path', ['carts.txt', 'cross.txt', 'page_names.txt', 'dj-rights.txt', 'parts.txt']);
        $audioZip  = BASE_DIR . '/audio.zip';
        $dbZip     = BASE_DIR . '/db.zip';
        $finalZip  = BASE_DIR . '/' . date('dmY') . '.cartdb';

        if (create_zip([UPLOAD_DIR], $audioZip)
            && create_zip($dataFiles, $dbZip)
            && create_zip([$audioZip, $dbZip], $finalZip)
            && file_exists($finalZip)
        ) {
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . basename($finalZip) . '"');
            header('Content-Length: ' . filesize($finalZip));
            readfile($finalZip);
            @unlink($audioZip);
            @unlink($dbZip);
            @unlink($finalZip);
            exit;
        }
        $log = 'Failed to create the backup file.';
    }

    if (isset($_POST['restore_backup'])) {
        if (isset($_FILES['backup_file']) && $_FILES['backup_file']['error'] === UPLOAD_ERR_OK) {
            if (extract_zip($_FILES['backup_file']['tmp_name'], BASE_DIR)) {
                $audioZip = BASE_DIR . '/audio.zip';
                $dbZip    = BASE_DIR . '/db.zip';
                if (file_exists($audioZip)) {
                    extract_zip($audioZip, UPLOAD_DIR);
                    unlink($audioZip);
                }
                if (file_exists($dbZip)) {
                    extract_zip($dbZip, DATA_DIR);
                    unlink($dbZip);
                }
                $log = 'Backup restored successfully.';
            } else {
                $log = 'Failed to extract the backup file.';
            }
        } else {
            $log = 'No backup file uploaded or upload error occurred.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="assets/css/admin.css">
    <title>Backup and restore</title>
    <style>
        body { text-align: center; font-family: Arial, sans-serif; }
        .container { margin-top: 50px; }
        button, input[type="submit"] { margin: 10px; padding: 10px 20px; font-size: 16px; cursor: pointer; }
    </style>
</head>
<body>
    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>

    <div class="container">
        <h2>Backup download</h2>
        <form method="post">
            <button type="submit" name="create_backup">Download backup</button>
        </form>
    </div>

    <div class="container">
        <form method="post" enctype="multipart/form-data">
            <h2>Upload and restore</h2>
            <input type="file" name="backup_file" accept=".cartdb" required style="background-color:lightgray; padding:10px;"><br><br>
            <input type="submit" name="restore_backup" value="Restore backup">
        </form>
    </div>

    <?php if ($log): ?>
        <div class="container"><p><?= htmlspecialchars($log) ?></p></div>
    <?php endif; ?>

    <a href="maintenance.php">Back</a>
</body>
</html>
