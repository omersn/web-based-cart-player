<?php
/** Save a new end point (in seconds) for the cart whose file matches. */
require_once __DIR__ . '/includes/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    die('Invalid request method.');
}
if (!isset($_POST['file'], $_POST['end'])) {
    die('Missing required parameters.');
}

$file = $_POST['file'];
$end  = (float) $_POST['end'];

$carts        = load_carts();
$updatedCarts = [];
$found        = false;

foreach ($carts as $entry) {
    list($name, $cartFilename, $start, $color, $endpoint) = array_pad(explode('|', $entry), 5, null);
    if ($cartFilename === $file) {
        $found          = true;
        $updatedCarts[] = "$name|$cartFilename|$start|$color|$end";
    } else {
        $updatedCarts[] = $entry;
    }
}

if (!$found) {
    die('File not found in carts.');
}

save_carts($updatedCarts);
echo 'Success';
