<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Admin maintenance hub: log viewers, cleanup, recalc, backup, chain reset, info. */
require_once __DIR__ . '/auth.php';
require_admin();

/** Recursive folder size in bytes. */
function getFolderSize(string $folder): int
{
    $size = 0;
    if (!is_dir($folder)) {
        return 0;
    }
    foreach (scandir($folder) as $file) {
        if ($file === '.' || $file === '..') {
            continue;
        }
        $path = $folder . DIRECTORY_SEPARATOR . $file;
        $size += is_dir($path) ? getFolderSize($path) : filesize($path);
    }
    return $size;
}

/** Human-readable byte size. */
function formatSize(int $bytes): string
{
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    while ($bytes >= 1024 && $i < count($units) - 1) {
        $bytes /= 1024;
        $i++;
    }
    return round($bytes, 2) . ' ' . $units[$i];
}

/** Files in uploads/ that are not referenced by any cart (soft-deleted leftovers). */
function getUnreferencedFiles(): array
{
    $referenced = ['0.mp3', '00.mp3']; // never offer the placeholder/keepalive clips for deletion
    foreach (load_carts() as $line) {
        $parts = explode('|', $line);
        if (isset($parts[1])) {
            $referenced[] = trim($parts[1]);
        }
    }
    $all = array_diff(scandir(UPLOAD_DIR), ['.', '..']);
    return array_diff($all, $referenced);
}

require_once __DIR__ . '/includes/helpers.php';

// Handle per-file delete / download from the cleanup tool.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['delete'])) {
        $file = basename($_POST['delete']);
        $path = upload_path($file);
        if ($file !== '0.mp3' && $file !== '00.mp3' && file_exists($path)) {
            unlink($path);
            header('Refresh:0');
        }
    } elseif (isset($_POST['download'])) {
        $file = basename($_POST['download']);
        $path = upload_path($file);
        if (file_exists($path)) {
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . $file . '"');
            header('Content-Length: ' . filesize($path));
            readfile($path);
            exit;
        }
    }
}

$uploadCount      = count(array_diff(scandir(UPLOAD_DIR), ['.', '..']));
$carts            = load_carts();
$populatedCount   = count(array_filter($carts, static fn($l) => trim($l) !== '- | 0.mp3|0|1'));
$unreferenced     = getUnreferencedFiles();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maintenance &mdash; <?= htmlspecialchars(STATION_NAME) ?></title>
    <style>
        body { background-color: #000; }
        .card { width: 80%; max-width: 900px; margin: 20px auto; padding: 10px 25px; background-color: #c8e8d0; border-radius: 5px; box-shadow: 0 0 15px rgba(0, 0, 0, 0.1); font-family: Arial, sans-serif; color: #616161; }
        .card.gray { background-color: lightgray; }
        h1 { font-size: 22px; }
        h5 { font-weight: normal; }
        .top-link { font-family: Arial, sans-serif; text-align: center; position: absolute; top: 5px; right: 10px; background-color: #9fbdd1; width: 110px; height: 23px; box-shadow: 2px 2px 0 1px rgba(163, 163, 163, 0.64); }
    </style>
</head>
<body>
    <div class="top-link"><a href="admin.php">Admin</a></div>
    <center><h2 style="color:#fff; font-family: Arial, sans-serif;"><?= htmlspecialchars(APP_NAME) ?> &mdash; maintenance tools</h2></center>

    <div class="card">
        <h1>📋 Log viewer</h1>
        <a href="log-viewer.php">Open the playback operation log</a>
        <h5>See how the system is being used.</h5>
        <a href="log-viewer-keep-alive.php">Open the keep-alive (connection monitor) log</a>
        <h5>The keep-alive monitor plays a silent clip in the background to keep the audio device and the connection warm, so the first jingle after an idle period plays instantly.</h5>
        <a href="maintenance-usage.php">Open the usage visualization</a>
        <h5>A chart of playback and connection health over time.</h5>
    </div>

    <div class="card">
        <h1>🧹 Cleanup tool</h1>
        <h2>Remove unreferenced files</h2>
        <h5>Deleting a cart with the 🗑️ icon only removes the reference &mdash; the audio file is kept for safety. Review those leftovers here and remove them selectively or all at once.</h5>

        <div id="exp" style="display:none;">
            <p>Audio folder size: <?= formatSize(getFolderSize(UPLOAD_DIR)) ?></p>
            <p>Disk free space: <?= formatSize((int) disk_free_space('/')) ?></p>
            <p>The audio folder contains <?= $uploadCount ?> items.</p>
            <p>The database contains <?= count($carts) ?> entries, of which <strong><?= $populatedCount ?></strong> are populated with audio.</p>
            <p>Unreferenced audio files: <?= count($unreferenced) ?></p>

            <?php if (!empty($unreferenced)): ?>
                <ul>
                    <?php $totalSize = 0; foreach ($unreferenced as $file): ?>
                        <?php $path = upload_path($file); $fileSize = filesize($path); $totalSize += $fileSize; ?>
                        <li>
                            <strong><?= htmlspecialchars($file) ?></strong>
                            (<?= number_format($fileSize / (1024 * 1024), 2) ?> MB, <?= date('F j, Y', filemtime($path)) ?>)
                            <audio controls style="display:none;" id="player-<?= htmlspecialchars($file) ?>">
                                <source src="uploads/<?= htmlspecialchars($file) ?>" type="audio/mpeg">
                            </audio><br>
                            <button onclick="togglePlayback('<?= htmlspecialchars($file) ?>', this)">Play</button>
                            <form method="POST" style="display:inline;">
                                <input type="hidden" name="delete" value="<?= htmlspecialchars($file) ?>">
                                <button type="submit">Delete</button>
                            </form>
                            <form method="POST" style="display:inline;">
                                <input type="hidden" name="download" value="<?= htmlspecialchars($file) ?>">
                                <button type="submit">Download</button>
                            </form>
                        </li>
                    <?php endforeach; ?>
                </ul>
                <p><strong>Total size:</strong> <?= number_format($totalSize / (1024 * 1024), 2) ?> MB</p>
                <a href="maintenance_delete.php">Delete all unreferenced files</a>
            <?php else: ?>
                <p>No unreferenced files found.</p>
            <?php endif; ?>
        </div>
        <div id="showthe"><a href="#" onclick="showDiv(); return false;">Show the files</a></div>
    </div>

    <div class="card">
        <h1>🔄 Recalculate timestamps</h1>
        <a href="process-carts.php">Refresh the database and look for corruption</a>
        <h5>Use this if chained playback or end points behave unexpectedly.</h5>
    </div>

    <div class="card">
        <h1>🗃️ Backup &amp; restore</h1>
        <a href="backup.php">Download a backup copy</a>
        <h5>Snapshot the system (audio, metadata, page names and more). You can also restore from a downloaded backup on the same page.</h5>
    </div>

    <div class="card">
        <h1>🔗 Reset all chains</h1>
        <a href="reset-chain.php">Remove every link between items</a>
        <h5>Make all buttons single again.</h5>
    </div>

    <div class="card gray">
        <h1>Info</h1>
        <?php
        echo 'CPU load: ' . (function_exists('sys_getloadavg') ? implode(', ', sys_getloadavg()) : 'N/A') . '<br>';
        echo 'Memory usage: ' . memory_get_usage() . ' bytes<br>';
        echo 'PHP version: ' . phpversion() . '<br><br>';
        echo htmlspecialchars(APP_NAME) . ' &mdash; ' . htmlspecialchars(STATION_NAME) . '<br>'
            . htmlspecialchars(COPYRIGHT) . ' &middot; '
            . '<a href="' . htmlspecialchars(SOURCE_URL) . '">Source code</a> '
            . '&middot; ' . htmlspecialchars(LICENSE_NAME) . '. Source-available for personal/'
            . 'noncommercial evaluation only &mdash; comes with ABSOLUTELY NO WARRANTY, and may not '
            . 'be redistributed or modified. See LICENSE for the full terms.';
        ?>
    </div>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>

    <script>
        function showDiv() {
            document.getElementById('exp').style.display = 'block';
            document.getElementById('showthe').style.display = 'none';
        }
        function togglePlayback(fileId, button) {
            const player = document.getElementById('player-' + fileId);
            if (player.paused) {
                player.play();
                button.textContent = 'Stop';
            } else {
                player.pause();
                player.currentTime = 0;
                button.textContent = 'Play';
            }
        }
    </script>
</body>
</html>
