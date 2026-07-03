<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Save a new start point (in seconds) for the cart whose file matches. */
require_once __DIR__ . '/includes/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    die('Invalid request method.');
}
if (!isset($_POST['file'], $_POST['start'])) {
    die('Missing required parameters.');
}

$file  = $_POST['file'];
$start = (float) $_POST['start'];

$carts        = load_carts();
$updatedCarts = [];
$matchedIds   = []; // 1-based carts.txt lines using this file (for the break-plan warning)

foreach ($carts as $i => $entry) {
    list($name, $cartFilename, $startPoint, $color, $endPoint) = array_pad(explode('|', $entry), 5, null);
    if ($cartFilename === $file) {
        $matchedIds[]   = $i + 1;
        $updatedCarts[] = "$name|$cartFilename|$start|$color|$endPoint"; // preserve endpoint
    } else {
        $updatedCarts[] = $entry;
    }
}

if (!$matchedIds) {
    die('File not found in carts.');
}

save_carts($updatedCarts);

// Break-plan cross-check: a new trim changes this cart's runtime, and with it
// the length of every planned break that references the cart. The trimmer UI
// surfaces this as an alert before returning to the admin.
$warn = breaks_referencing($matchedIds);
if ($warn) {
    $list = implode(', ', array_map(fn ($b) => "{$b['name']} ({$b['time']})", $warn));
    echo "Success|WARN:This cart is used in the break plan: $list. The new trim changes those break lengths.";
} else {
    echo 'Success';
}
