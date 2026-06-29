<?php
/** Soft-delete a cart from the DJ view: replace it with the empty placeholder. */
require_once __DIR__ . '/includes/helpers.php';

if (!isset($_GET['id'])) {
    die('Error: No ID provided for deletion.');
}

$cartIndex = (int) $_GET['id'];
$cartItems = load_carts();

if (isset($cartItems[$cartIndex])) {
    $cartItems[$cartIndex] = '- | 0.mp3|0|1';
    save_carts($cartItems);
}

header('Location: dj.php');
exit;
