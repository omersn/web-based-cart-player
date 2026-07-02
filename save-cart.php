<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Unified cart editor endpoint (manager Audio tab). One endpoint, four ops —
 * all on the 1-based carts.txt line id:
 *
 *   { "op": "update", "id": N, "name"?, "color"?, "volume"?, "start"?, "end"? }
 *   { "op": "chain",  "id": N, "cross": 0|1 }        auto-play-next flag
 *   { "op": "enable", "id": N, "enabled": 0|1 }      per-cart on/off
 *   { "op": "delete", "id": N }                      slot -> empty placeholder
 *   { "op": "move",   "id": N, "to": M }             reorder (slot N -> slot M)
 *
 * delete purges the id from the break plan + favourites; move REMAPS every
 * break/favourite reference so the plan follows the carts around — the flat
 * files reference carts by line number, so any reorder must keep them in sync.
 *
 * Admin-only. Responds { ok: true } (+ carts count).
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

$p  = json_decode(file_get_contents('php://input'), true);
$op = $p['op'] ?? '';
$id = (int) ($p['id'] ?? 0);

$carts = load_carts();
if ($id < 1 || $id > count($carts)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => "Bad cart id $id"]);
    exit;
}

// cross.txt / enabled.txt padded to the cart count so line moves stay aligned.
$cross = load_cross_states();
$cross = array_pad($cross, count($carts), 0);
$enabledStates = load_enabled_states();
$enabledStates = array_pad($enabledStates, count($carts), 1);

$fail = function ($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
};
$saveCross   = fn ($c) => file_put_contents(data_path('cross.txt'), implode("\n", $c) . "\n", LOCK_EX) !== false;
$saveEnabled = fn ($e) => save_enabled_states($e);
// Rewrite every cart-id reference (breaks + favourites) through $map(oldId)->newId|null.
$remapRefs = function (callable $map) {
    $breaks = load_breaks();
    foreach ($breaks as &$b) {
        $b['items'] = array_values(array_filter(array_map($map, $b['items'])));
    }
    unset($b);
    return save_breaks($breaks) && save_favorites(array_filter(array_map($map, load_favorites())));
};

switch ($op) {
    case 'update': {
        $f = array_pad(explode('|', $carts[$id - 1]), 6, '');
        if (array_key_exists('name', $p)) {
            $f[0] = mb_substr(str_replace(['|', "\n", "\r"], ' ', trim((string) $p['name'])), 0, 60, 'UTF-8') ?: '-';
        }
        if (array_key_exists('color', $p)) {
            $c = (string) $p['color'];
            if (!in_array($c, ['1', '2', '3', '4', '5'], true)) $fail('Bad color');
            $f[3] = $c;
        }
        if (array_key_exists('volume', $p)) {
            $v = max(0, min(1, (float) $p['volume']));
            $f[5] = $v == 1 ? '' : (string) $v;
        }
        // Inline trimmer (replaces the old iframe trimmer pages): start/end
        // in seconds, validated relative to each other when both are known.
        if (array_key_exists('start', $p)) $f[2] = (string) max(0, (float) $p['start']);
        if (array_key_exists('end', $p)) {
            $end = (float) $p['end'];
            $start = (float) ($f[2] !== '' ? $f[2] : 0);
            if ($end <= $start) $fail('End must be after start');
            $f[4] = (string) $end;
        }
        // Drop empty trailing fields so untouched lines keep their old shape.
        while (count($f) > 4 && trim(end($f)) === '') array_pop($f);
        $carts[$id - 1] = implode('|', $f);
        if (!save_carts($carts)) $fail('Could not write carts.txt', 500);
        break;
    }
    case 'chain': {
        $cross[$id - 1] = !empty($p['cross']) ? 1 : 0;
        if (!$saveCross($cross)) $fail('Could not write cross.txt', 500);
        break;
    }
    case 'enable': {
        $enabledStates[$id - 1] = !empty($p['enabled']) ? 1 : 0;
        if (!$saveEnabled($enabledStates)) $fail('Could not write enabled.txt', 500);
        break;
    }
    case 'delete': {
        $carts[$id - 1] = '- | 0.mp3|0|1';
        $cross[$id - 1] = 0;
        $enabledStates[$id - 1] = 1;
        if (!save_carts($carts) || !$saveCross($cross) || !$saveEnabled($enabledStates)) $fail('Could not write data files', 500);
        $remapRefs(fn ($x) => $x === $id ? null : $x); // purge from breaks + favourites
        break;
    }
    case 'move': {
        $to = (int) ($p['to'] ?? 0);
        if ($to < 1 || $to > count($carts)) $fail("Bad target slot $to");
        if ($to === $id) break;
        // Move the line (and its chain + enabled flags) from slot id to slot to.
        $line = array_splice($carts, $id - 1, 1)[0];
        array_splice($carts, $to - 1, 0, [$line]);
        $flag = array_splice($cross, $id - 1, 1)[0];
        array_splice($cross, $to - 1, 0, [$flag]);
        $en = array_splice($enabledStates, $id - 1, 1)[0];
        array_splice($enabledStates, $to - 1, 0, [$en]);
        if (!save_carts($carts) || !$saveCross($cross) || !$saveEnabled($enabledStates)) $fail('Could not write data files', 500);
        // Every reference shifts with the move.
        $remapRefs(function ($x) use ($id, $to) {
            if ($x === $id) return $to;
            if ($id < $to && $x > $id && $x <= $to) return $x - 1;
            if ($id > $to && $x >= $to && $x < $id) return $x + 1;
            return $x;
        });
        break;
    }
    default:
        $fail("Unknown op \"$op\"");
}

echo json_encode(['ok' => true, 'count' => count($carts)]);
