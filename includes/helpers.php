<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
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

/**
 * Asset URL with an mtime cache-buster. Browsers happily serve week-old
 * CSS/JS against a fresh page otherwise — a recurring QA trap (styles
 * missing, buttons "not working") every time a file changes.
 */
function asset_v(string $path): string
{
    $f = BASE_DIR . '/' . $path;
    return $path . '?v=' . (file_exists($f) ? filemtime($f) : 1);
}

/**
 * Chain flags (data/cross.txt) as an array of ints — 1 = auto-play next.
 * A line may carry a second field, "flag|fadeMs": the chain-crossfade editor's
 * per-gap overlap in ms (the NEXT cart launches that early). intval() reads
 * just the flag, so every legacy reader keeps working untouched.
 */
function load_cross_states(): array
{
    $path  = data_path('cross.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    return array_map('intval', $lines);
}

/** Per-line chain-crossfade ms (cross.txt second field; 0 = butt joint). */
function load_chain_fades(): array
{
    $path  = data_path('cross.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    return array_map(function ($l) {
        $p = explode('|', $l);
        return max(0, min(10000, (int) ($p[1] ?? 0)));
    }, $lines);
}

/**
 * Persist chain flags + fades together ("flag" or "flag|ms" per line — the
 * ms field only appears where a fade exists, so an unused file keeps the
 * plain legacy shape).
 */
function save_cross_data(array $flags, array $fades): bool
{
    $lines = [];
    foreach ($flags as $i => $flag) {
        $ms = max(0, min(10000, (int) ($fades[$i] ?? 0)));
        $lines[] = $ms > 0 ? "$flag|$ms" : (string) $flag;
    }
    return file_put_contents(data_path('cross.txt'), implode("\n", $lines) . "\n", LOCK_EX) !== false;
}

/**
 * Output routing (data/routing.txt, "key|out" per line) — which of the four
 * SIMULATED stereo outputs each DJ player and the PFL (preview/pre-fade
 * listen) bus feeds. GUI-level only until the appification phase maps them
 * to real devices.
 */
function load_routing(): array
{
    // manager_preview: the audio-manager chain editor's own Play button.
    // Unlike the others it may also be 0 ("PFL output") rather than only 1-5.
    // 5 outputs matches the audio engine's multichannel mode ceiling
    // (audio-engine.js's NUM_CHANNELS) — stereo mode ignores the exact value.
    $r = ['player1' => 1, 'player2' => 2, 'player3' => 3, 'pfl' => 4, 'carts' => 1, 'autoplayer' => 1, 'manager_preview' => 0];
    $path  = data_path('routing.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    foreach ($lines as $line) {
        $p = explode('|', $line);
        $key = trim($p[0] ?? '');
        $out = (int) ($p[1] ?? 0);
        if (!array_key_exists($key, $r)) continue;
        $min = $key === 'manager_preview' ? 0 : 1;
        if ($out >= $min && $out <= 5) $r[$key] = $out;
    }
    return $r;
}

/** Persist the routing map. Returns false on failure. */
function save_routing(array $r): bool
{
    $body = '';
    foreach (load_routing() as $key => $def) {
        $out = (int) ($r[$key] ?? $def);
        $min = $key === 'manager_preview' ? 0 : 1;
        $body .= $key . '|' . max($min, min(5, $out)) . "\n";
    }
    return file_put_contents(data_path('routing.txt'), $body, LOCK_EX) !== false;
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
 *   HH:MM | anchor | name | itemIds | enabled | trigger | overlaps | volumes
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
 *   - overlaps comma-separated ms values, one per GAP between consecutive
 *              items (so count = items - 1; missing/short = zeros). A value
 *              means the next item launches that many ms BEFORE the previous
 *              one ends (the planner's cross editor). Clamped 0..10000.
 *   - volumes  comma-separated per-ITEM volume overrides (0..1, 2 decimals),
 *              set by the cross editor's volume line. -1 (the default) means
 *              "no override — play at the cart's own volume".
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
        // Per-gap overlaps: fit to exactly count(items)-1 (pad missing with 0,
        // drop extras left behind by item removals), clamp each to 0..10s.
        $gaps = max(0, count($ids) - 1);
        $ov = isset($p[6]) && trim($p[6]) !== '' ? array_map('intval', explode(',', $p[6])) : [];
        $ov = array_slice(array_pad($ov, $gaps, 0), 0, $gaps);
        $ov = array_map(fn ($n) => max(0, min(10000, $n)), $ov);
        // Per-item volume overrides: one per item, -1 = no override.
        $vols = isset($p[7]) && trim($p[7]) !== '' ? array_map('floatval', explode(',', $p[7])) : [];
        $vols = array_slice(array_pad($vols, count($ids), -1), 0, count($ids));
        $vols = array_map(fn ($v) => ($v >= 0 && $v <= 1) ? round($v, 2) : -1, $vols);
        $breaks[] = [
            'time'    => trim($p[0]),
            'anchor'  => trim($p[1]) === 'end' ? 'end' : 'start',
            'name'    => trim($p[2]),
            'items'   => $ids,
            'enabled' => !isset($p[4]) || trim($p[4]) !== '0',
            'manual'  => isset($p[5]) && trim($p[5]) === 'manual',
            'overlaps' => $ov,
            'volumes' => $vols,
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
 *   dj_mode     DJ layout button — on by default, DJ mode is the out-of-box layout
 *   dj_players  How many of the 3 DJ decks are shown/allowed (1-3, not 0/1)
 *   dj_local_files    Allow loading a local MP3 (from disk, never uploaded) into a deck
 *   dj_waveform_scrub Allow click/drag on a deck's waveform to seek the playhead
 *   pfl_player  The small PFL (preview) mini-player docked under the DJ library
 *   pfl_buttons_carts   Hover preview icon on cart-board tiles
 *   pfl_buttons_players Preview button on each DJ deck
 *   pfl_buttons_tree    Preview button in the DJ library tree
 *   pfl_buttons_search  Preview button in the topbar search results
 *   show_out_labels  The "OUT N" output badges on DJ decks, PFL and the autoplayer
 *   show_ticker Shows the scrolling status message in the footer bar
 *   dock_resize  Allow dragging the bottom dock's height (off by default)
 *   panel_resize Allow widening the DJ tree / automation sidebar (off by default)
 *   log_retention Days of keep-alive/playback log history to keep (30/60/90/180, 0 = forever)
 */
function load_settings(): array
{
    $s = [
        'mobile' => 0, 'download' => 0, 'automation' => 1, 'ids_window' => 1, 'dj_mode' => 1,
        'dj_players' => 2, 'dj_local_files' => 1, 'dj_waveform_scrub' => 1, 'pfl_player' => 1,
        'pfl_buttons_carts' => 1, 'pfl_buttons_players' => 1, 'pfl_buttons_tree' => 1, 'pfl_buttons_search' => 1,
        'show_out_labels' => 0, 'show_ticker' => 1, 'dock_resize' => 0, 'panel_resize' => 0,
        'log_retention' => 90,
        // Persistent audio engine: ONE shared DSP style (AGC/compressor/limiter
        // parameters), applied to every on-air source uniformly — not per-channel,
        // even in multichannel mode below (see audio-engine.js's header comment).
        'dsp_enabled' => 1, 'dsp_type' => 'aggressive',
        // Stereo (today's single combined output, PFL always fully dry — see
        // pfl_player below) vs multichannel (independent output channels, PFL
        // becomes a routable source like any other — manager Audio tab's mode
        // switch). Real per-device hardware output is future desktop-build
        // work — device_sim4_enabled is one SIMULATED device (4 discrete
        // stereo outputs) for the routing matrix to have something to target
        // today; not wired to anything real yet.
        'audio_mode' => 'stereo', 'device_sim4_enabled' => 1,
    ];
    $logRetentionOptions = [30, 60, 90, 180, 0];
    $dspTypes = ['limiting', 'agcOnly', 'aggressive', 'gentle'];
    $path  = data_path('settings.txt');
    $lines = file_exists($path) ? file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
    foreach ($lines as $line) {
        [$k, $v] = array_pad(explode('|', $line, 2), 2, '');
        $k = trim($k);
        if (!array_key_exists($k, $s)) continue;
        if ($k === 'dj_players') { $s[$k] = max(1, min(3, (int) trim($v) ?: 3)); continue; }
        if ($k === 'log_retention') {
            $iv = (int) trim($v);
            $s[$k] = in_array($iv, $logRetentionOptions, true) ? $iv : 90;
            continue;
        }
        if ($k === 'dsp_type') {
            $tv = trim($v);
            $s[$k] = in_array($tv, $dspTypes, true) ? $tv : 'aggressive';
            continue;
        }
        if ($k === 'audio_mode') {
            $mv = trim($v);
            $s[$k] = $mv === 'multichannel' ? 'multichannel' : 'stereo';
            continue;
        }
        $s[$k] = trim($v) === '1' ? 1 : 0;
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
    $logRetentionOptions = [30, 60, 90, 180, 0];
    $dspTypes = ['limiting', 'agcOnly', 'aggressive', 'gentle'];
    $lines = [];
    foreach (load_settings() as $k => $def) {
        $v = isset($s[$k]) ? $s[$k] : $def;
        if ($k === 'dj_players') { $lines[] = $k . '|' . (string) max(1, min(3, (int) $v)); continue; }
        if ($k === 'log_retention') {
            $iv = (int) $v;
            $lines[] = $k . '|' . (string) (in_array($iv, $logRetentionOptions, true) ? $iv : 90);
            continue;
        }
        if ($k === 'dsp_type') {
            $lines[] = $k . '|' . (in_array($v, $dspTypes, true) ? $v : 'aggressive');
            continue;
        }
        if ($k === 'audio_mode') { $lines[] = $k . '|' . ($v === 'multichannel' ? 'multichannel' : 'stereo'); continue; }
        $lines[] = $k . '|' . ($v ? '1' : '0');
    }
    return file_put_contents(data_path('settings.txt'), implode("\n", $lines) . "\n", LOCK_EX) !== false;
}

/**
 * Drop keep-alive/playback log lines older than the configured retention
 * (Maintenance > Logs; 0 = forever, a no-op). Called once per index.php
 * load. Each log has its own timestamp shape, so parsing is per-file; a
 * line the parser can't date is always kept — this only ever removes lines
 * it's sure about.
 */
function purge_old_logs(): void
{
    $days = load_settings()['log_retention'];
    if ($days <= 0) return;
    $cutoff = time() - $days * 86400;

    // [2026-06-29T20:33:53.069Z] IP: ... — ISO 8601, unambiguous.
    purge_log_file(BASE_DIR . '/keep-alive.log', $cutoff, function (string $line): ?int {
        if (!preg_match('/^\[([^\]]+)\]/', $line, $m)) return null;
        $ts = strtotime($m[1]);
        return $ts !== false ? $ts : null;
    });
    // "03/07/2026, 23:36:30 - ..." — day/month/year, 24h (from toLocaleString()).
    purge_log_file(BASE_DIR . '/playback-log.log', $cutoff, function (string $line): ?int {
        if (!preg_match('/^(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2})/', $line, $m)) return null;
        $d = DateTime::createFromFormat('d/m/Y, H:i:s', $m[1]);
        return $d !== false ? $d->getTimestamp() : null;
    });
}

/** Rewrite $path keeping only lines whose parsed timestamp is >= $cutoff (or
 *  undated, per $parseTs returning null) — skips the write entirely when
 *  nothing would change. */
function purge_log_file(string $path, int $cutoff, callable $parseTs): void
{
    if (!file_exists($path)) return;
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!$lines) return;
    $kept = array_filter($lines, function (string $line) use ($parseTs, $cutoff): bool {
        $ts = $parseTs($line);
        return $ts === null || $ts >= $cutoff;
    });
    if (count($kept) === count($lines)) return;
    file_put_contents($path, $kept ? implode("\n", $kept) . "\n" : '', LOCK_EX);
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
            implode(',', array_map('intval', $b['overlaps'] ?? [])),
            implode(',', array_map(fn ($v) => $v >= 0 ? (string) round($v, 2) : '-1', $b['volumes'] ?? [])),
        ]),
        $breaks
    );
    $body = $lines ? implode("\n", $lines) . "\n" : '';
    return file_put_contents(data_path('breaks.txt'), $body, LOCK_EX) !== false;
}
