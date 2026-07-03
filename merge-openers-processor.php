<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Headless variant of merge-openers.php: concatenate the first three real
 * jingle MP3s and stream the result straight back as a download.
 */
require_once __DIR__ . '/includes/helpers.php';

$files = [];
foreach (load_carts() as $entry) {
    list($name, $filename) = explode('|', $entry) + [null, null];
    if ($filename && trim($filename) !== '0.mp3') {
        $files[] = upload_path(trim($filename));
    }
    if (count($files) >= 3) {
        break;
    }
}

if (count($files) < 3) {
    die('Error: Not enough valid MP3 files to merge.');
}

$downloadName = 'merged_opener_' . date('d-m-y') . '.mp3';
$mergedFile   = upload_path($downloadName);
$mergedHandle = fopen($mergedFile, 'w');

foreach ($files as $file) {
    $handle = fopen($file, 'rb');
    stream_copy_to_stream($handle, $mergedHandle);
    fclose($handle);
}
fclose($mergedHandle);

header('Content-Type: audio/mpeg');
header('Content-Disposition: attachment; filename="' . $downloadName . '"');
header('Content-Length: ' . filesize($mergedFile));
readfile($mergedFile);
unlink($mergedFile);
exit;
