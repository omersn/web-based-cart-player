<?php
/** Persist a renamed cart (1-based id) from the inline rename form. */
require_once __DIR__ . '/includes/helpers.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $cartId  = (int) ($_POST['cart-id'] ?? 0);
    $newName = $_POST['new-name'] ?? '';

    $cartItems = load_carts();
    if (isset($cartItems[$cartId - 1])) {
        $cartItems[$cartId - 1] = $newName;
        save_carts($cartItems);
    }

    header('Location: admin.php');
    exit;
}
