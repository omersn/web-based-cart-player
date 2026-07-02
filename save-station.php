<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Save the Station tab (manager): ticker, section labels, page names and the
 * station name override.
 *
 * POST JSON, all keys optional:
 *   { "ticker": "...", "labels": ["..." x10], "pageNames": ["..."],
 *     "stationName": "..." }
 *
 * Admin-only. Field lengths are clamped; pipes/newlines stripped where the
 * flat files use them as separators. Responds { ok: true }.
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
if (!is_array($p)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Malformed payload']);
    exit;
}

$clean = fn ($s, $max) => mb_substr(str_replace(["\n", "\r", '|'], ' ', trim((string) $s)), 0, $max, 'UTF-8');
$ok = true;

if (array_key_exists('ticker', $p)) {
    $ok = $ok && file_put_contents(data_path('status.txt'), mb_substr(trim((string) $p['ticker']), 0, 200, 'UTF-8'), LOCK_EX) !== false;
}
if (isset($p['labels']) && is_array($p['labels'])) {
    $labels = [];
    for ($i = 0; $i < 10; $i++) $labels[] = $clean($p['labels'][$i] ?? (string) ($i + 1), 40) ?: (string) ($i + 1);
    $ok = $ok && file_put_contents(data_path('parts.txt'), implode("\n", $labels) . "\n", LOCK_EX) !== false;
}
if (isset($p['pageNames']) && is_array($p['pageNames'])) {
    $names = array_map(fn ($n) => $clean($n, 40), $p['pageNames']);
    $ok = $ok && file_put_contents(data_path('page_names.txt'), implode("\n", $names) . "\n", LOCK_EX) !== false;
}
if (array_key_exists('stationName', $p)) {
    // Empty = revert to the config.php default.
    $ok = $ok && file_put_contents(data_path('station.txt'), $clean($p['stationName'], 60), LOCK_EX) !== false;
}

if (!$ok) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write data files']);
    exit;
}
echo json_encode(['ok' => true, 'stationName' => station_name()]);
