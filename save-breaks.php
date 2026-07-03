<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Save the commercial-breaks plan (planner overlay -> data/breaks.txt).
 *
 * POST a JSON body:  { "breaks": [ { "time": "HH:MM", "anchor": "start"|"end",
 *                                    "name": "...", "items": [1-based cart ids] }, ... ] }
 *
 * Admin-only. Every break is validated server-side (time format, known cart
 * ids, non-placeholder carts) — the client-side planner validates too, but
 * the endpoint is the gate that actually protects the file.
 * Responds with JSON: { ok: true, breaks: [...] } (the saved, normalised list)
 * or { ok: false, error: "..." } with a 4xx status.
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
if (!is_array($payload) || !isset($payload['breaks']) || !is_array($payload['breaks'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Malformed payload']);
    exit;
}

// A cart id is valid when it points at a real (non-placeholder) carts.txt line.
$carts = load_carts();
$validId = function (int $id) use ($carts): bool {
    $line = $carts[$id - 1] ?? '';
    $p = explode('|', $line);
    $name = trim($p[0] ?? '');
    $file = trim($p[1] ?? '');
    return $name !== '' && $name !== '-' && $file !== '' && $file !== '0.mp3';
};

$clean = [];
foreach ($payload['breaks'] as $i => $b) {
    $time    = trim((string) ($b['time'] ?? ''));
    $manual  = !empty($b['manual']);
    $enabled = !isset($b['enabled']) || (bool) $b['enabled'];
    if ($time === '') $time = 'NOTIME';
    // NOTIME is legal only where the time is inert: manual breaks, or parked
    // (disabled) ones. An enabled scheduled break must carry a real HH:MM.
    if ($time === 'NOTIME') {
        if (!$manual && $enabled) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => "Break #" . ($i + 1) . ": a scheduled break needs a time"]);
            exit;
        }
    } elseif (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => "Break #" . ($i + 1) . ": bad time \"$time\""]);
        exit;
    }
    $items = array_values(array_map('intval', (array) ($b['items'] ?? [])));
    foreach ($items as $id) {
        if (!$validId($id)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => "Break #" . ($i + 1) . ": cart id $id doesn't exist (or is an empty slot)"]);
            exit;
        }
    }
    // Per-gap overlaps (cross editor): fit to exactly count(items)-1 and
    // clamp each to 0..10s — a malformed client can't inflate the file.
    $ovIn = array_values(array_map('intval', (array) ($b['overlaps'] ?? [])));
    $ov = [];
    for ($g = 0; $g < max(0, count($items) - 1); $g++) {
        $ov[] = max(0, min(10000, $ovIn[$g] ?? 0));
    }
    // Per-item volume overrides (cross editor's volume line): one per item;
    // anything outside 0..1 collapses to -1 = "no override".
    $volIn = array_values((array) ($b['volumes'] ?? []));
    $vols = [];
    for ($g = 0; $g < count($items); $g++) {
        $v = isset($volIn[$g]) && is_numeric($volIn[$g]) ? (float) $volIn[$g] : -1;
        $vols[] = ($v >= 0 && $v <= 1) ? round($v, 2) : -1;
    }
    $clean[] = [
        'time'    => $time,
        'anchor'  => ((string) ($b['anchor'] ?? 'start')) === 'end' ? 'end' : 'start',
        'name'    => mb_substr(trim((string) ($b['name'] ?? '')), 0, 60, 'UTF-8'),
        'items'   => $items,
        'enabled' => $enabled,
        'manual'  => $manual,
        'overlaps' => $ov,
        'volumes' => $vols,
    ];
}

// A time slot can only be occupied once: no two ENABLED SCHEDULED breaks may
// share the same HH:MM. Manual breaks (time is inert) and disabled breaks
// (planner-only parking) don't occupy slots.
$taken = [];
foreach ($clean as $b) {
    if (!$b['enabled'] || $b['manual']) continue;
    if (isset($taken[$b['time']])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => "Time slot {$b['time']} is used by two breaks — give one a new time"]);
        exit;
    }
    $taken[$b['time']] = true;
}

if (!save_breaks($clean)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Could not write breaks.txt']);
    exit;
}

echo json_encode(['ok' => true, 'breaks' => load_breaks()]);
