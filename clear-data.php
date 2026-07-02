<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Danger zone (manager Options tab): destructive resets.
 *
 * POST JSON: { "mode": "planner"|"all", "confirm": "clear" }
 *
 * planner  Empties the break plan and the favourites.
 * all      Resets the whole pseudo-DB: every carts.txt line becomes an empty
 *          placeholder, chains/breaks/favourites are emptied and the ticker
 *          is cleared. Audio files in uploads/ are NEVER touched.
 *
 * Admin-only, and the client-side typed confirmation is re-checked here —
 * the server is the gate, not the UI.
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
$mode    = $payload['mode'] ?? '';
if (($payload['confirm'] ?? '') !== 'clear' || !in_array($mode, ['planner', 'all'], true)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Bad confirmation']);
    exit;
}

$ok = save_breaks([]) && save_favorites([]);
if ($mode === 'all') {
    $count = max(1, count(load_carts()));
    $ok = $ok
        && save_carts(array_fill(0, $count, '- | 0.mp3|0|1'))
        && file_put_contents(data_path('cross.txt'), str_repeat("0\n", $count), LOCK_EX) !== false
        && file_put_contents(data_path('status.txt'), '', LOCK_EX) !== false;
}

if (!$ok) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write data files']);
    exit;
}
echo json_encode(['ok' => true, 'mode' => $mode]);
