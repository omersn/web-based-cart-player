<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Upload (or replace) a cart's audio (manager Audio tab).
 *
 * Multipart POST: "id" (1-based carts.txt line) + "audio" (.mp3, max 30 MB).
 * The file lands in uploads/ (timestamped if the name is taken) and the slot
 * points at it; trims reset (they belonged to the old audio). An empty slot
 * gets the file's name as its cart name until it's renamed.
 */
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/includes/helpers.php';

header('Content-Type: application/json');

if (!is_admin()) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Admin login required']);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_FILES['audio'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'No file uploaded']);
    exit;
}

$id    = (int) ($_POST['id'] ?? 0);
$carts = load_carts();
if ($id < 1 || $id > count($carts)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => "Bad cart id $id"]);
    exit;
}
if ($_FILES['audio']['error'] !== UPLOAD_ERR_OK || $_FILES['audio']['size'] > 30 * 1024 * 1024) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Upload failed or file too big (max 30 MB)']);
    exit;
}
$orig = strtolower(basename($_FILES['audio']['name']));
if (!str_ends_with($orig, '.mp3')) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Only .mp3 files']);
    exit;
}

// Safe unique filename: strip anything exotic, never overwrite.
$base = preg_replace('/[^a-z0-9._-]+/', '_', pathinfo($orig, PATHINFO_FILENAME));
$file = $base . '.mp3';
if (file_exists(upload_path($file))) $file = $base . '-' . time() . '.mp3';
if (!move_uploaded_file($_FILES['audio']['tmp_name'], upload_path($file))) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not save the file']);
    exit;
}

$f = array_pad(explode('|', $carts[$id - 1]), 6, '');
$name = trim($f[0]);
if ($name === '' || $name === '-') $name = str_replace('_', ' ', $base); // empty slot: name after the file
$color = trim($f[3]) !== '' ? trim($f[3]) : '1';
// New audio -> old trims are meaningless; volume carries over.
$carts[$id - 1] = implode('|', [$name, $file, '0', $color, '', trim($f[5])]);
if (!save_carts($carts)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write carts.txt']);
    exit;
}
echo json_encode(['ok' => true, 'file' => $file, 'name' => $name]);
