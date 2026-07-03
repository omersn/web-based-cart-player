<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Replace the audio file for a cart (uploads/<id>.mp3) and return to admin. */
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['audio-file'])) {
    $cartId     = (int) ($_POST['cart-id'] ?? 0);
    $uploadFile = upload_path($cartId . '.mp3');

    if (move_uploaded_file($_FILES['audio-file']['tmp_name'], $uploadFile)) {
        header('Location: admin.php');
        exit;
    }

    echo 'File upload failed.';
}
