<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Tail a runtime log for the manager's Maintenance tab. Admin-only. */
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/includes/helpers.php';

header('Content-Type: application/json');

if (!is_admin()) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Admin login required']);
    exit;
}

$which = $_GET['log'] ?? '';
$files = [
    'keepalive' => BASE_DIR . '/keep-alive.log',
    'playback'  => BASE_DIR . '/playback-log.log',
];
if (!isset($files[$which])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown log']);
    exit;
}

$path = $files[$which];
echo json_encode([
    'ok'    => true,
    'lines' => tail_file($path, 200),
    'size'  => file_exists($path) ? filesize($path) : 0,
]);
