<?php
/**
 * Web-based Cart Player — shared data helpers.
 *
 * Thin wrappers around the flat-file "pseudo-database" in data/. They replace
 * the file('carts.txt') / file_put_contents() / colour-map / label-loading
 * snippets that used to be copy-pasted across admin.php, dj.php, index.php,
 * grid.php, mobile.php and the small editing endpoints.
 *
 * Cart line format (pipe separated):
 *   name | filename.mp3 | startSeconds | colourCode(1-5) | endSeconds | volume
 */

require_once __DIR__ . '/../config.php';

/** Button colour for a "1".."5" code, falling back to blue. */
function color_for(?string $code): string
{
    return COLOR_MAP[$code] ?? COLOR_MAP['1'];
}

/** Read the cart list as raw "name|file|..." lines (no trailing newlines). */
function load_carts(): array
{
    $path = data_path('carts.txt');
    return file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES) : [];
}

/** Persist the cart list back to data/carts.txt. Returns false on failure. */
function save_carts(array $carts): bool
{
    return file_put_contents(data_path('carts.txt'), implode("\n", $carts) . "\n") !== false;
}

/**
 * The 10 editable section labels (data/parts.txt), 0-indexed, with a numeric
 * fallback ("1".."10") when a line is missing.
 */
function load_section_labels(): array
{
    $path  = data_path('parts.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    $labels = [];
    for ($i = 0; $i < 10; $i++) {
        $labels[$i] = $lines[$i] ?? (string) ($i + 1);
    }
    return $labels;
}

/** Per-page names (data/page_names.txt). */
function load_page_names(): array
{
    $path = data_path('page_names.txt');
    return file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
}

/** Chain flags (data/cross.txt) as an array of ints — 1 = auto-play next. */
function load_cross_states(): array
{
    $path  = data_path('cross.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    return array_map('intval', $lines);
}
