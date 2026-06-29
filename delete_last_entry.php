<?php
/** Remove the last cart entry and return to the admin list. */
require_once __DIR__ . '/includes/helpers.php';

$carts = load_carts();

if (!empty($carts)) {
    array_pop($carts);
    save_carts($carts);
    header('Location: admin.php?last_deleted=true');
    exit;
}

header('Location: admin.php?error=empty_cart');
exit;
