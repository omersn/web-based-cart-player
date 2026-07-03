<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Remove a cart entry entirely (1-based id) and return to the admin list. */
require_once __DIR__ . '/includes/helpers.php';

if (isset($_GET['id'])) {
    $cartId = (int) $_GET['id'];
    $cartItems = load_carts();

    if (isset($cartItems[$cartId - 1])) {
        unset($cartItems[$cartId - 1]);
        save_carts($cartItems);
    }

    header('Location: admin.php');
    exit;
}
