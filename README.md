# Web-based Cart Player

A browser-based **cart wall** (a.k.a. jingle / sound-effect playout panel) for live radio,
built with plain PHP and vanilla JavaScript — no framework, no database server. It runs the
on-air jingles, station IDs, sweepers and promos for a live station from a grid of clickable
buttons, and has been used daily in production.

This repository is a **cleaned-up, de-branded demo** of that system. The audio, content and
credentials are sample data; drop in your own and point it at a PHP host to run it for real.

> **Demo logins** — Admin: `admin` / `admin` · DJ: `dj` / `dj`
> (defined in [`config.php`](config.php); change them before any real deployment).

---

## Features

- **Cart wall** — a paginated grid of colour-coded buttons; click to play, click to stop.
- **Sections** — the flat cart list is sliced into named sections (Station IDs, Jingles, Promos…).
- **Chaining** — link carts so they play back-to-back as one sequence (e.g. a 3-part opener).
- **Trimming** — set per-cart start/end points on a waveform (WaveSurfer.js).
- **Per-cart volume**, colour and rename, all from the admin screen.
- **Back-timer** — a big on-screen countdown of the playing item (or the whole chained run).
- **Schedule to the hour** — right-click a cart to fire it automatically at the top of the hour.
- **Floating windows** — a always-available Station ID panel and a broadcast clock.
- **Keep-alive heartbeat** — keeps the audio device warm so the first jingle is never late.
- **Mobile access** — a QR code opens a touch-friendly section view on a phone.
- **Admin tooling** — playback & connection logs, a usage chart, backup/restore, and cleanup.
- **Two roles** — full `admin` and a limited `dj` view.

---

## How it works

```
index.php  ── the player shell ──────────────────────────────────────────────┐
   ├─ <iframe> grid.php?from=10&to=75   → the main cart wall                   │
   ├─ <iframe> grid.php?from=0&to=10    → floating "Station ID" window         │
   ├─ <iframe> clock.php                → floating broadcast clock             │
   └─ <iframe> keep-alive.php           → heartbeat (silent audio + indicator) │
                                                                               │
grid.php  ── cart-wall shell ── loads assets/js/cartwall.js (the engine) ──────┘

data/*.txt   the "pseudo-database" (flat files)        uploads/*.mp3   the audio
```

- **`config.php`** is the single source of truth: station name, demo credentials, paths,
  section sizing and the button colour palette.
- **`auth.php`** provides the `admin` / `dj` session guards.
- **`includes/helpers.php`** wraps the flat-file reads/writes (`load_carts()`, `color_for()`, …).

### The audio load mechanism (the "preload hack")

This is the trick that makes the player usable on air, and it lives in
[`assets/js/cartwall.js`](assets/js/cartwall.js).

Browsers don't actually decode an `<audio>` element's data until something forces them to, so a
cold first `play()` often has audible latency or a clipped attack — unacceptable for a jingle.
To avoid that, each clip is **primed** as the wall loads: it is played once **muted** (`volume = 0`)
and immediately paused, at a small **staggered delay** so the browser isn't asked to decode every
file in the same instant. If a clip reports that it never really started, it is retried a few times
with a growing delay. After this pass the first real click is instant and clean.

### The keep-alive heartbeat

See [`assets/js/keep-alive.js`](assets/js/keep-alive.js). A playout machine often sits idle for long
stretches; the OS/browser will then let the audio output go to sleep, which adds a delay the next
time a jingle fires. The heartbeat plays a **near-silent clip at 1% volume every 30 seconds** to keep
the audio device awake. It doubles as a connection monitor: each beat is logged and a colour-coded
dot shows online (green) / offline (red).

### Data format

The cart list (`data/carts.txt`) is one pipe-separated line per button:

```
name | filename.mp3 | startSeconds | colourCode(1-5) | endSeconds | volume
```

An empty slot is `- | 0.mp3|0|1`. Other files: `cross.txt` (chain flags), `parts.txt`
(section labels), `page_names.txt`, `dj-rights.txt`, `status.txt` (the ticker) and
`credits/day1..7.txt` (daily on-air credits).

---

## Running it locally

Requires PHP 7.4+ (8.x recommended). From the project root:

```bash
php -S localhost:8000
```

Then open <http://localhost:8000/index.php>. Sign in at `/login.php` with the demo credentials
above. The `data/` and `uploads/` folders must be writable by the web server.

> Tip: regenerate the QR code (`assets/img/qr.png`) to point at your own deployment's
> `mobile.php` URL so phones on your network can scan it.

## Deploying

Copy the folder onto any PHP-capable web host (Apache, nginx + php-fpm, shared hosting, …) and make
sure `data/` and `uploads/` are writable. There is no build step and no database to provision.

**Before going live:** change the credentials in `config.php` (and ideally switch to hashed
passwords), and restrict access to the admin endpoints.

---

## Project structure

```
config.php              branding, demo credentials, paths, colours
auth.php                session-based admin/dj guards
includes/helpers.php    flat-file data helpers
index.php               player shell        grid.php        cart wall
admin.php / dj.php      management screens   login/logout   auth
keep-alive.php          heartbeat            mobile.php      QR landing page
trimmer*.php            waveform editors     *-cross / volume / color / rename …
maintenance*.php        logs, cleanup, backup, usage chart
assets/css|js|img       extracted styles, the cart-wall engine, logo & QR
data/                   the pseudo-database (sample content)
uploads/                audio (sample demo tones)
```

## License

MIT © 2024-2026 Omer Senesh. See [LICENSE](LICENSE).

Originally built as a JS + PHP patchwork for a live community radio station and refactored into
this presentable, self-hostable demo.
