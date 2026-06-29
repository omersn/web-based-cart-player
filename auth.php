<?php
/**
 * Web-based Cart Player — session-based authentication helpers.
 *
 * Two roles, each backed by its own session token (kept from the original
 * system so the rest of the contract is unchanged):
 *   - admin -> $_SESSION['login']   (full management, admin.php)
 *   - dj    -> $_SESSION['login2']  (limited management, dj.php)
 */

require_once __DIR__ . '/config.php';

/** Start the session once, regardless of how many includes call us. */
function ensure_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

function is_admin(): bool
{
    ensure_session();
    return !empty($_SESSION['login']);
}

function is_dj(): bool
{
    ensure_session();
    return !empty($_SESSION['login2']);
}

/** Redirect to the login page unless the visitor is an admin. */
function require_admin(): void
{
    if (!is_admin()) {
        header('Location: login.php');
        exit;
    }
}

/** Redirect to the login page unless the visitor is a DJ. */
function require_dj(): void
{
    if (!is_dj()) {
        header('Location: login.php');
        exit;
    }
}
