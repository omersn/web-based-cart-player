<?php
/**
 * Login page. Validates against the demo credentials in config.php and sets
 * the matching session token (admin -> 'login', dj -> 'login2').
 */
require_once __DIR__ . '/auth.php';

// Already signed in? Jump straight to the relevant dashboard.
if (is_admin()) {
    header('Location: admin.php');
    exit;
}
if (is_dj()) {
    header('Location: dj.php');
    exit;
}

$error = '';
if (isset($_POST['submit'])) {
    $username = $_POST['username'] ?? '';
    $password = $_POST['password'] ?? '';

    if ($username === ADMIN_USER && $password === ADMIN_PASS) {
        $_SESSION['login'] = true;
        header('Location: admin.php');
        exit;
    } elseif ($username === DJ_USER && $password === DJ_PASS) {
        $_SESSION['login2'] = true;
        header('Location: dj.php');
        exit;
    } else {
        $error = 'Invalid username or password';
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in &middot; <?= htmlspecialchars(APP_NAME) ?></title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <style>
        body {
            background-color: #000;
            color: #ddd;
            max-width: 380px;
            margin: 0 auto;
        }
        .login-box { padding: 20px; }
        .login-box input {
            width: 100%;
            padding: 12px 20px;
            margin: 8px 0;
            box-sizing: border-box;
        }
        .alert-danger {
            background: #c0392b;
            color: #fff;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }
        .demo-hint {
            margin-top: 18px;
            font-size: 13px;
            color: #9aa;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="login-box">
        <div style="margin-bottom: 12px;">
            <img src="assets/img/logo.svg" height="22" alt="<?= htmlspecialchars(STATION_NAME) ?>">
        </div>
        <h3>Sign in to the jingle manager</h3>

        <?php if ($error): ?>
            <div class="alert-danger"><?= htmlspecialchars($error) ?></div>
        <?php endif; ?>

        <form action="" method="post">
            <div>
                <label for="username">Username</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div>
                <label for="password">Password</label>
                <input type="password" id="password" name="password">
            </div>
            <button type="submit" name="submit">Sign in</button>
            <a href="index.php">Cancel</a>
        </form>

        <p class="demo-hint">
            <strong>Demo credentials</strong><br>
            Admin: <code><?= htmlspecialchars(ADMIN_USER) ?></code> /
            <code><?= htmlspecialchars(ADMIN_PASS) ?></code><br>
            DJ: <code><?= htmlspecialchars(DJ_USER) ?></code> /
            <code><?= htmlspecialchars(DJ_PASS) ?></code>
        </p>
    </div>
</body>
</html>
