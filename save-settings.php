<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Save the feature switches (manager Options tab -> data/settings.txt).
 *
 * POST a JSON body:  { "settings": { "mobile": 0|1, "download": 0|1, ... } }
 *
 * Admin-only. Unknown keys are ignored (load_settings/save_settings only
 * carry the known switch set). Responds { ok: true, settings: {...} }.
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

$payload = json_decode(file_get_contents('php://input'), true);
if (!is_array($payload) || !isset($payload['settings']) || !is_array($payload['settings'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Malformed payload']);
    exit;
}

$merged = load_settings();
foreach ($payload['settings'] as $k => $v) {
    if (!array_key_exists($k, $merged)) continue;
    if ($k === 'dj_players') { $merged[$k] = max(1, min(3, (int) $v)); continue; }
    if ($k === 'log_retention') {
        $iv = (int) $v;
        $merged[$k] = in_array($iv, [30, 60, 90, 180, 0], true) ? $iv : 90;
        continue;
    }
    $merged[$k] = $v ? 1 : 0;
}

if (!save_settings($merged)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write settings.txt']);
    exit;
}

echo json_encode(['ok' => true, 'settings' => load_settings()]);
