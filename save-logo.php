<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Upload a custom station logo (manager Station tab).
 *
 * Multipart POST, field "logo": an .svg or .png (max 512 KB). Saved as
 * assets/img/logo-custom.<ext>; station_logo() prefers it over the default.
 * POST { "reset": 1 } (JSON) removes the custom logo instead.
 */
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/includes/helpers.php';

header('Content-Type: application/json');

if (!is_admin()) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Admin login required']);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST only']);
    exit;
}

$dir = BASE_DIR . '/assets/img/';

// Reset: drop any custom logo, back to the default.
$raw = file_get_contents('php://input');
$json = json_decode($raw, true);
if (is_array($json) && !empty($json['reset'])) {
    foreach (['logo-custom.svg', 'logo-custom.png'] as $f) { @unlink($dir . $f); }
    echo json_encode(['ok' => true, 'logo' => station_logo()]);
    exit;
}

if (!isset($_FILES['logo']) || $_FILES['logo']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'No file uploaded']);
    exit;
}
if ($_FILES['logo']['size'] > 512 * 1024) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Logo too big (max 512 KB)']);
    exit;
}

$name = strtolower($_FILES['logo']['name']);
$ext  = str_ends_with($name, '.svg') ? 'svg' : (str_ends_with($name, '.png') ? 'png' : '');
if ($ext === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Only .svg or .png']);
    exit;
}

foreach (['logo-custom.svg', 'logo-custom.png'] as $f) { @unlink($dir . $f); }
if (!move_uploaded_file($_FILES['logo']['tmp_name'], $dir . 'logo-custom.' . $ext)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not save the logo']);
    exit;
}
echo json_encode(['ok' => true, 'logo' => station_logo()]);
