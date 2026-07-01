<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
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

// Licensing — this program is free software under the GNU AGPL-3.0-or-later.
// SOURCE_URL is shown in the UI so network users can obtain the Corresponding
// Source, as required by section 13 of the AGPL. Point it at your own fork if
// you deploy a modified version.
const LICENSE_NAME = 'AGPL-3.0-or-later';
const COPYRIGHT    = 'Copyright (C) 2024-2026 Omer Senesh';
const SOURCE_URL   = 'https://github.com/omersn/web-based-cart-player';

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
// Toolbar features
// ---------------------------------------------------------------------------

/**
 * Show the "utility" toolbar chips: Download, Mobile access (QR), and Credits.
 * Hidden for now while the product direction shifts away from them — flip to
 * true to bring the three buttons back (the code is untouched, just gated).
 */
const SHOW_UTILITY_CHIPS = false;

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
 * Button colour palette: colour code "1".."5" -> hex. Used by the admin/DJ
 * lists and the colour picker for their swatches. Kept in lock-step with the
 * board's studio palette (the --cat-* CSS custom properties in
 * assets/css/player.css, mirrored in assets/js/automation.js) so the colour you
 * pick in admin is exactly the colour the cart renders on the wall.
 */
const COLOR_MAP = [
    '1' => '#2f6fd6', // Blue
    '2' => '#2f9e5f', // Green
    '3' => '#b0479e', // Purple
    '4' => '#c98a2b', // Orange
    '5' => '#2aa7bf', // Cyan
];
