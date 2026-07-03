<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Save the planner's favourite carts (starred in the tree -> data/favorites.txt).
 *
 * POST a JSON body:  { "ids": [1-based cart ids] }
 *
 * Admin-only. Shared station-wide (not per browser), so every planner sees
 * the same stars. Responds { ok: true, ids: [...] } with the saved list.
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
if (!is_array($payload) || !isset($payload['ids']) || !is_array($payload['ids'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Malformed payload']);
    exit;
}

if (!save_favorites($payload['ids'])) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write favorites.txt']);
    exit;
}

echo json_encode(['ok' => true, 'ids' => load_favorites()]);
