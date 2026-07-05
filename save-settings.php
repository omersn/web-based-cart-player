<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Save the feature switches (manager Options tab -> data/settings.txt).
 * Also carries the DSP settings (manager Audio tab's DSP section -- dsp_enabled,
 * dsp_type), the audio mode + simulated device toggle (audio_mode,
 * device_sim4_enabled), and pfl_player when toggled from the Audio tab's
 * stereo-mode "disable PFL" switch (same key the Options tab's own "Allow PFL
 * player" switch uses) — all posted directly from there (one key at a time,
 * applied live) rather than through the Options tab's draft/Save & Close flow.
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
    if ($k === 'dsp_type') {
        $merged[$k] = in_array($v, ['limiting', 'agcOnly', 'aggressive', 'gentle'], true) ? $v : 'aggressive';
        continue;
    }
    if ($k === 'audio_mode') { $merged[$k] = $v === 'multichannel' ? 'multichannel' : 'stereo'; continue; }
    $merged[$k] = $v ? 1 : 0;
}

if (!save_settings($merged)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write settings.txt']);
    exit;
}

echo json_encode(['ok' => true, 'settings' => load_settings()]);
