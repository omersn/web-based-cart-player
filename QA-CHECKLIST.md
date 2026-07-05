<!-- License: PolyForm-Strict-1.0.0 (see LICENSE) -->
# Web-based Cart Player — Master QA Checklist

Manual test pass, organized by feature area and the date each section was added. Section 1-9 cover
the **Automation Playlist** panel (right-docked scheduled auto-playback queue) from its original
feature sprint; later dated sections cover subsequent work. Each item lists the exact steps and the
expected result.

**Setup for every test:** open the player, click **START** (enables audio), then right-click carts
on the board to queue them. The panel appears on the right once at least one cart is queued.

---

## 1. Panel lifecycle
- [ ] Right-clicking a cart shows the panel with that cart queued.
- [ ] Right-clicking a **chained** cart queues the whole chain as one bordered group.
- [ ] Removing the **last** item (trash or right-click) hides the panel immediately.
- [ ] After a full batch finishes playing, the list empties and the panel auto-hides after ~1s.
- [ ] `Clear & hide` empties and hides the panel, and clears persisted state.

## 2. Header — time & anchor (From / To)
- [ ] The whole assembly (`From o->` + time + caret) is **centered** in the panel.
- [ ] The From/To label is part of the **`o->` toggle button**, shown **before** the icon (label +
      icon read as one control; both turn amber together in To mode).
- [ ] The time (HH:MM:SS) stays in the **same horizontal position** when toggling From ↔ To — it
      never jumps. Verify at a wide window and at the panel's minimum width.
- [ ] Clicking the **time** opens the picker popover.
- [ ] Clicking the **`From/To o->` toggle** flips From ↔ To in one click (does NOT open the popover).
- [ ] With the picker **open**, clicking the toggle flips From ↔ To and leaves the picker **open**;
      a click anywhere else outside still closes it.
- [ ] After the toggle: header label (From/To) and the `ENDS AT` value both update to match.

## 3. Time picker popover (draft — apply only on OK)
- [ ] The popover is lean: just an **hour box** and a **minute box** (no START/END buttons, no
      separate typed field — the anchor is set by the header toggle).
- [ ] **Type directly** in the hour/minute boxes; out-of-range input clamps (e.g. hour `99` → `23`,
      minute `99` → `59`) as you type. A precise minute like `37` is accepted (not just 15-min steps).
- [ ] Each box also **drops down** a quick-pick list on focus/click; picking one fills the box.
- [ ] Open picker, change values, then click **outside** (or re-click the header): changes are
      **discarded**, the committed schedule is unchanged.
- [ ] Open picker, change values, click **OK** (or press **Enter**): changes apply to the header +
      all displays.
- [ ] Hour dropdown opens scrolled to the **current** real-world hour (not next hour).
- [ ] Past hours/minutes are grayed/disabled; the next top-of-hour is subtly highlighted.
- [ ] Dropdown lists are not clipped by the popover box and center on the selected value.
- [ ] Committing a time < 1 minute away is refused with a toast; the schedule is left unchanged.

## 4. Toast (validation warnings)
- [ ] Warnings appear **visibly** over the header area (red banner), not hidden behind the topbar or
      the queue list.
- [ ] The toast never blocks clicks: after it fades, the header/time are still clickable (it must be
      `pointer-events:none`).
- [ ] Warnings fire for: playlist locked, too close to start, won't fit before start, would overrun
      the hour, and time must be ≥ 1 minute away.

## 5. Reorder (drag & drop)
- [ ] Dragging a queue item reorders it; a translucent **ghost** previews the drop position.
- [ ] The original item is hidden while dragging (no duplicate), with **no jitter / no extra-item
      flash** at drag start.
- [ ] Drag & drop works reliably (not cancelled mid-drag).
- [ ] Chained groups drag as one unit and cannot be split.
- [ ] The native browser context menu never appears inside the panel.
- [ ] Adding an item scrolls the queue to the **bottom** (the new item is visible).
- [ ] Starting playback scrolls the queue back to the **top**.

## 6. AUTO vs MANUAL modes
- [ ] AUTO shows the `STARTS IN` / `ENDS AT` clocks; a Stop button appears once it's on air.
- [ ] MANUAL shows the transport (Play/Pause + Stop).
- [ ] In MANUAL, the header time area is **muted/grayed** but still **clickable**, and the `o->`
      toggle still works.
- [ ] AUTO fires playback automatically at the scheduled start; it does **not** re-fire in a loop
      after the batch finishes.
- [ ] MANUAL Play starts the batch; Pause/resume and Stop behave correctly.
- [ ] `Stop all` (top bar) also stops automation playback.

## 7. Scheduling correctness (seconds matter)
- [ ] `ENDS AT` reflects the real end: in **From** mode = start + total runtime; in **To** mode the
      start is back-timed so the batch **ends** exactly at the picked time.
- [ ] `STARTS IN` counts down with hours shown for symmetry (e.g. `-0:41:34`).
- [ ] All schedule readouts show seconds (`HH:MM:SS`).
- [ ] The `STARTS IN` / `ENDS AT` values are **always the same font size** as each other and
      **never overflow** their halves — even a wide countdown (e.g. `-23:56:20`) shrinks both to fit.
      Verify at the panel's min and max widths.
- [ ] A schedule set to the **past** shows `—:—` and drops to MANUAL — never a bogus ~24h countdown.

## 8. Locking & guards
- [ ] Within the lock lead (~10s before start) and while running, the panel **locks**: no add,
      remove, reorder, or schedule change.
- [ ] After a batch finishes, the panel **unlocks** correctly (no stuck-locked-forever state).

## 9. Persistence
- [ ] Queue + schedule + mode survive a page reload (localStorage).
- [ ] A restored schedule that's already stale (elapsed while the tab was closed) resets to a fresh
      default instead of blocking the next add.

## ⚠️ Deferred / needs-specific-verification (from the feature sprint)
- [ ] **"End at" override fix** — set an **End at** time ~1–2 min out, wait until `STARTS IN` ≤ 10s,
      then right-click a cart into the (empty) queue. **Expected:** a "Too close to start" toast and
      the End-at time/mode is left **unchanged** (previously it silently reset to Start / next hour).
      Re-add once > 10s remains → queues normally.

---

## 10. DJ tree — chain-group row alignment (2026-07-04)
- [ ] Switch to DJ mode. Hover a chained group of carts (e.g. the Station Opener 1-3 chain in
      Station IDs): the length column (`0:05` etc.) lines up in the **same column** for chained
      rows as for ordinary (non-chained) rows below/above the group.
- [ ] The shared fire/send-to-auto rail renders as a **single row** of buttons (not a 2×2 grid) and
      never overlaps a row's own PFL preview button or its length text.
- [ ] Change **Options > DJ players** to 1, 2, then 3 and re-check the chain group each time — the
      rail and the reserved gutter should always line up correctly regardless of player count.

## 11. Crossfade editors — scrubbable playhead (2026-07-04)
- [ ] **Chain editor** (Audio library manager > select a chained cart > Edit chain): click Play, then while
      it's running, click or drag anywhere in the lanes. **Expected:** the playhead jumps to the
      clicked position and playback **continues** (does not stop).
- [ ] Chain editor shows a **gray overlap strip** straddling the junction between two chained lanes,
      sized to match the active crossfade — widens/narrows as you drag a lane's fade.
- [ ] **Batch editor** (Break Planner > select a break with 2+ items > click a gap's ✕ button >
      Play): while playing, click/drag anywhere in the lanes. **Expected:** the playhead jumps to
      the clicked position, playback **continues through to the natural end** (does not revert to
      the joint's original ~1.5s-before-overlap starting point).

## 12. Cart PFL polish (2026-07-04)
- [ ] Hover a board cart (big enough to show PFL — not the small docked Station-ID tiles): the tile
      contracts and the PFL strip slides up with a clearly visible gap between them; the strip
      background reads as a clearly brighter tone, not dark/muddy.
- [ ] Play a cart so it's actively "now playing" (red fill + white glow ring) **and** hover/PFL-shrink
      it at the same time: the white glow ring stays smoothly rounded at all four corners — no flat
      or squared-off seam where the tile's bottom edge contracts.

## 13. Maintenance — Logs (2026-07-04)
- [ ] Station Manager > Maintenance > Logs shows a **"Keep logs for"** dropdown (30/60/90/180 days,
      Forever). Changing it saves immediately — no Save & Close needed (re-open the tab to confirm
      the new value stuck).
- [ ] Keep-alive and Playback logs each show in their **own small scrollable pane** (no popup modal),
      each with a **file-size readout** and its own **"Clear now"** button.
- [ ] Clicking "Clear now" on one log doesn't affect the other; its size readout drops to reflect the
      now-empty file.
- [ ] Set retention to a short value (e.g. 30 days), confirm some log lines are older than that,
      reload the player page, and re-open Maintenance > Logs — the old lines are gone, recent lines
      remain, and any line the parser can't date is never removed.

## 14. Audio library manager — trimmer drafts, no separate Save (2026-07-04)
- [ ] Open Audio library manager, pick a cart, confirm there is **no "Save trim" button** next to Play /
      Play trimmed.
- [ ] Drag a trim handle, then select a **different** cart, then select the original cart again —
      the trim change is **still shown** (held in the in-memory draft).
- [ ] With that pending trim change, click **Cancel** — the unsaved-changes warning dialog appears;
      confirming discard reverts the trim back to its last-saved value (re-select the cart to check).
- [ ] With a pending trim change, click **Save & Close**, then reload the whole player page and
      re-open Audio library manager on that cart — the new trim persisted.

## 15. Layout fixes (2026-07-04)
- [ ] On a wide window, Audio library manager's **"Edit chain"** button sits directly under the Chain toggle
      (not stranded far to the right of the row).
- [ ] **"Move"** sits directly above **"Clear this slot"** in the same section, with no separating
      line between them.
- [ ] Open the Break Planner on a large window: the bottom editor area (crossfade editor, playlist
      list, totals bar) fills the full available width and height — no dead blank space to the right
      or below it.

## 16. Autoplayer — adding items in MANUAL mode (2026-07-04 bug fix)
- [ ] Switch the automation panel to **MANUAL** mode, then queue a cart (right-click a board cart,
      or DJ tree "send to autoplayer"). **Expected:** it queues normally — no "Too close to start"
      toast (this used to block every add once the mode had ever auto-flipped away from a stale AUTO
      schedule).
- [ ] Switch to **AUTO** mode with a schedule that is **not** imminent (default next full hour):
      adding a cart still works normally.
- [ ] Regression check: AUTO mode with a schedule genuinely within ~10s of its start time still
      correctly **refuses** new adds with "Too close to start" (the guard is scoped to AUTO mode
      only now, not removed).

## 17. Licensing (2026-07-04, non-functional — quick eyeball)
- [ ] The bottom-left "Source" link reads **`Source (PolyForm-Strict-1.0.0)`** and still opens the
      GitHub repo in a new tab.
- [ ] `LICENSE` at the repo root is the PolyForm Strict License 1.0.0 text (not AGPL).
- [ ] `assets/fonts/OFL.txt`, `assets/vendor/phosphor/LICENSE`, `assets/vendor/LICENSE-wavesurfer.txt`,
      and `assets/vendor/LICENSE-chartjs.txt` exist and contain the real license text for each.
