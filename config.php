<?php
/**
 * Web-based Cart Player — central configuration.
 *
 * Single source of truth for branding, demo credentials, filesystem/URL paths,
 * cart-wall sizing and the button colour palette. Everything that used to be
 * hard-coded and copy-pasted across the individual PHP files now lives here.
 */

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------
const STATION_NAME = 'Demo Radio Station';
const APP_NAME     = 'Web-based Cart Player';

// ---------------------------------------------------------------------------
// Demo credentials
//
// DEMO ONLY — these are intentionally trivial so anyone can try the demo.
// Change them (and ideally switch to hashed passwords) before any real use.
// ---------------------------------------------------------------------------
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const DJ_USER    = 'dj';
const DJ_PASS    = 'dj';

// ---------------------------------------------------------------------------
// Paths
//   *_DIR = filesystem path, used by PHP for reading/writing files.
//   *_URL = URL path served to the browser, used by fetch()/<audio>/<img>.
//
// The pseudo-database lives in data/ and the audio in uploads/. Both are
// served by the web root because the cart wall fetches them from the browser.
// ---------------------------------------------------------------------------
define('BASE_DIR',   __DIR__);
define('DATA_DIR',   __DIR__ . '/data');
define('UPLOAD_DIR', __DIR__ . '/uploads');
const DATA_URL   = 'data';
const UPLOAD_URL = 'uploads';

/** Filesystem path to a pseudo-database file, e.g. data_path('carts.txt'). */
function data_path(string $file): string
{
    return DATA_DIR . '/' . $file;
}

/** Filesystem path to an uploaded audio file, e.g. upload_path('demo01.mp3'). */
function upload_path(string $file): string
{
    return UPLOAD_DIR . '/' . $file;
}

// ---------------------------------------------------------------------------
// Cart-wall layout
// ---------------------------------------------------------------------------

/** Carts shown per page inside a grid section. */
const ITEMS_PER_PAGE = 25;

/**
 * Range of cart indices the DJ view exposes (a slice of the flat cart list).
 * In the original station this pointed at the broadcaster zone; for the demo
 * it points at the populated "Jingles" section so the view has content.
 */
const DJ_FROM = 10;
const DJ_TO   = 35;

/**
 * Button colour palette: colour code "1".."5" -> hex. Shared by the cart
 * wall, the admin/DJ lists and the colour picker.
 */
const COLOR_MAP = [
    '1' => '#007bff', // Blue
    '2' => '#4dbf49', // Green
    '3' => '#d15ccf', // Purple
    '4' => '#d19724', // Orange
    '5' => '#5eccd6', // Cyan
];
