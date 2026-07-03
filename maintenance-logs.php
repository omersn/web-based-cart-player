<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Runtime log viewer for the manager's Maintenance tab. Admin-only.
 *
 *   GET  ?log=keepalive|playback              -> tail the log (JSON lines)
 *   POST { "log": "...", "action": "clear" }   -> truncate that log file
 */
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/includes/helpers.php';

header('Content-Type: application/json');

if (!is_admin()) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Admin login required']);
    exit;
}

$files = [
    'keepalive' => BASE_DIR . '/keep-alive.log',
    'playback'  => BASE_DIR . '/playback-log.log',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $p = json_decode(file_get_contents('php://input'), true);
    $which = $p['log'] ?? '';
    if (!isset($files[$which]) || ($p['action'] ?? '') !== 'clear') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Bad request']);
        exit;
    }
    if (file_put_contents($files[$which], '', LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Could not clear the log']);
        exit;
    }
    echo json_encode(['ok' => true]);
    exit;
}

$which = $_GET['log'] ?? '';
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
