<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
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

/**
 * Commercial breaks (data/breaks.txt) for the planner and the automation
 * strip. One break per line, pipe separated:
 *
 *   HH:MM | anchor | name | itemIds | enabled | trigger
 *
 *   - HH:MM    24h wall-clock time the break anchors to; repeats daily.
 *              Kept (inert) for manual breaks so switching back restores it.
 *              Manual breaks may instead carry the literal "NOTIME" (shown as
 *              --:-- in the UI); a time is only forced when they're moved to
 *              scheduled.
 *   - anchor   "start" (begins at HH:MM) or "end" (must END by HH:MM)
 *   - name     free-text chip label (pipes are stripped on save)
 *   - itemIds  comma-separated 1-based carts.txt line numbers. These are
 *              REFERENCES, resolved against the live cart data (including
 *              trims) at play/calc time — never snapshots.
 *   - enabled  1/0; missing = 1. Disabled breaks are planner-only parking
 *              (templates, holiday specials) — the player never shows them.
 *   - trigger  "auto" (fires on its time) or "manual" (no time trigger —
 *              the DJ loads and fires it by hand); missing = auto.
 *
 * Returned sorted by time so strip/list rendering can assume day order.
 * Malformed lines are skipped rather than fatal — same forgiving stance as
 * the rest of the pseudo-database.
 */
function load_breaks(): array
{
    $path  = data_path('breaks.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    $breaks = [];
    foreach ($lines as $line) {
        $p = explode('|', $line);
        if (count($p) < 4 || !preg_match('/^(([01]\d|2[0-3]):[0-5]\d|NOTIME)$/', trim($p[0]))) continue;
        $ids = array_values(array_filter(array_map('intval', explode(',', $p[3])), fn ($n) => $n > 0));
        $breaks[] = [
            'time'    => trim($p[0]),
            'anchor'  => trim($p[1]) === 'end' ? 'end' : 'start',
            'name'    => trim($p[2]),
            'items'   => $ids,
            'enabled' => !isset($p[4]) || trim($p[4]) !== '0',
            'manual'  => isset($p[5]) && trim($p[5]) === 'manual',
        ];
    }
    usort($breaks, fn ($a, $b) => strcmp($a['time'], $b['time']));
    return $breaks;
}

/**
 * Planner favourites (data/favorites.txt): starred cart ids, one 1-based
 * carts.txt line number per line. Shared station-wide (not per browser).
 */
function load_favorites(): array
{
    $path  = data_path('favorites.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    return array_values(array_filter(array_map('intval', $lines), fn ($n) => $n > 0));
}

/** Persist the favourites list. Returns false on failure. */
function save_favorites(array $ids): bool
{
    $ids  = array_values(array_unique(array_filter(array_map('intval', $ids), fn ($n) => $n > 0)));
    $body = $ids ? implode("\n", $ids) . "\n" : '';
    return file_put_contents(data_path('favorites.txt'), $body, LOCK_EX) !== false;
}

/**
 * Breaks that reference any of the given 1-based cart ids. Used by the trim
 * savers to warn the admin that re-trimming a cart changes the length of the
 * planned breaks it appears in.
 */
function breaks_referencing(array $ids): array
{
    return array_values(array_filter(
        load_breaks(),
        fn ($b) => array_intersect($ids, $b['items'])
    ));
}

/** Persist the breaks list back to data/breaks.txt. Returns false on failure. */
function save_breaks(array $breaks): bool
{
    $lines = array_map(
        fn ($b) => implode('|', [
            $b['time'],
            ($b['anchor'] ?? 'start') === 'end' ? 'end' : 'start',
            str_replace(['|', "\n", "\r"], ' ', $b['name']),
            implode(',', $b['items']),
            (!isset($b['enabled']) || $b['enabled']) ? '1' : '0',
            !empty($b['manual']) ? 'manual' : 'auto',
        ]),
        $breaks
    );
    $body = $lines ? implode("\n", $lines) . "\n" : '';
    return file_put_contents(data_path('breaks.txt'), $body, LOCK_EX) !== false;
}
