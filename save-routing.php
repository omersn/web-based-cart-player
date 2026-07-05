<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Save the output-routing map (manager Routing tab -> data/routing.txt).
 *
 * POST a JSON body: { "routing": { "player1": 1..5, "player2": 1..5,
 *                                  "player3": 1..5, "pfl": 1..5 } }
 *
 * Up to 5 outputs, matching audio-engine.js's multichannel mode ceiling. In
 * stereo mode (audio_mode, settings.txt) these assignments are still cosmetic
 * — everything sums into one chain regardless; in multichannel mode they're
 * what actually decides which independent channel a source's audio reaches.
 * The "device" each channel maps to is a simulated label either way (GUI-level
 * until the appification phase maps them to real hardware). Admin-only.
 * Responds with { ok: true, routing: {...} } (the saved, normalised map).
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

$p = json_decode(file_get_contents('php://input'), true);
if (!is_array($p) || !isset($p['routing']) || !is_array($p['routing'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Malformed payload']);
    exit;
}

// Merge onto the current map — a partial payload (one dropdown change)
// leaves the other assignments untouched; save_routing clamps to 1..5.
$merged = array_merge(load_routing(), array_intersect_key($p['routing'], load_routing()));
if (!save_routing($merged)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write routing.txt']);
    exit;
}

echo json_encode(['ok' => true, 'routing' => load_routing()]);
