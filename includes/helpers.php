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
 * Per-cart enabled flags (data/enabled.txt), same shape as cross.txt — one
 * "1"/"0" per carts.txt line. A disabled cart is darkened in the manager and
 * excluded everywhere it could be played or queued (search, planner tree,
 * grid). Missing entries default to enabled (1).
 */
function load_enabled_states(): array
{
    $path  = data_path('enabled.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    return array_map(fn ($l) => trim($l) !== '0' ? 1 : 0, $lines);
}

/** Persist the per-cart enabled flags. Returns false on failure. */
function save_enabled_states(array $states): bool
{
    return file_put_contents(data_path('enabled.txt'), implode("\n", $states) . "\n", LOCK_EX) !== false;
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

/**
 * Feature switches (data/settings.txt, one "key|value" per line). Unknown
 * keys are ignored; missing keys fall back to the defaults below. All are
 * UI-level toggles — they enable/disable buttons, nothing deeper.
 *   mobile      Mobile-access (QR) button
 *   download    Download button
 *   automation  Automation playlist + break planner buttons
 *   ids_window  Station-ID / sweepers window button
 *   dj_mode     DJ layout button (placeholder — layout not built yet)
 */
function load_settings(): array
{
    $s = ['mobile' => 0, 'download' => 0, 'automation' => 1, 'ids_window' => 1, 'dj_mode' => 0];
    $path  = data_path('settings.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    foreach ($lines as $line) {
        [$k, $v] = array_pad(explode('|', $line, 2), 2, '');
        if (array_key_exists(trim($k), $s)) $s[trim($k)] = trim($v) === '1' ? 1 : 0;
    }
    return $s;
}

/**
 * Station name: the manager's Station tab writes an override to
 * data/station.txt; the config.php constant stays as the fallback/default.
 */
function station_name(): string
{
    $path = data_path('station.txt');
    $name = file_exists($path) ? trim((string) file_get_contents($path)) : '';
    return $name !== '' ? $name : STATION_NAME;
}

/** Uploaded custom logo (manager Station tab), falling back to the default. */
function station_logo(): string
{
    foreach (['logo-custom.svg', 'logo-custom.png'] as $f) {
        if (file_exists(BASE_DIR . '/assets/img/' . $f)) return 'assets/img/' . $f;
    }
    return 'assets/img/logo.svg';
}

/** Persist the switches. Returns false on failure. */
function save_settings(array $s): bool
{
    $lines = [];
    foreach (load_settings() as $k => $def) {
        $lines[] = $k . '|' . ((isset($s[$k]) ? $s[$k] : $def) ? '1' : '0');
    }
    return file_put_contents(data_path('settings.txt'), implode("\n", $lines) . "\n", LOCK_EX) !== false;
}

/**
 * Names of the two floating/docked ID-window sections (data/id-sections.txt,
 * 2 lines). Defaults match the demo data; editable from the manager's
 * Station tab. Used for the ids-select dropdown, the docked-window label,
 * and the manager/planner's section list.
 */
function load_id_section_names(): array
{
    $path  = data_path('id-sections.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    return [
        trim($lines[0] ?? '') !== '' ? trim($lines[0]) : 'Station IDs',
        trim($lines[1] ?? '') !== '' ? trim($lines[1]) : 'Sweepers & FX',
    ];
}

/** Persist the two ID-section names. Returns false on failure. */
function save_id_section_names(array $names): bool
{
    $a = mb_substr(trim((string) ($names[0] ?? '')), 0, 30, 'UTF-8') ?: 'Station IDs';
    $b = mb_substr(trim((string) ($names[1] ?? '')), 0, 30, 'UTF-8') ?: 'Sweepers & FX';
    return file_put_contents(data_path('id-sections.txt'), "$a\n$b\n", LOCK_EX) !== false;
}

/**
 * Last $lines lines of a (possibly large) log file, without loading the
 * whole thing into memory — seeks backward from the end in chunks until it
 * has enough newlines or hits the start of the file.
 */
function tail_file(string $path, int $lines = 200): array
{
    if (!file_exists($path)) return [];
    $fh = fopen($path, 'r');
    if (!$fh) return [];
    $chunk = 8192;
    $data = '';
    $pos = filesize($path);
    $found = 0;
    while ($pos > 0 && $found <= $lines) {
        $read = min($chunk, $pos);
        $pos -= $read;
        fseek($fh, $pos);
        $data = fread($fh, $read) . $data;
        $found = substr_count($data, "\n");
    }
    fclose($fh);
    $all = explode("\n", rtrim($data, "\n"));
    return array_slice($all, -$lines);
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
