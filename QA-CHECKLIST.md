<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Automation Playlist — Master QA Checklist

Manual test pass for the **Automation Playlist** panel (right-docked scheduled auto-playback
queue), built on the `automation-playlist` branch. Work through this after the feature sprint,
before merging to `main`. Each item lists the exact steps and the expected result.

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
- [ ] The `o->` icon sits **next to** the centered time (not off to the far left).
- [ ] The time (HH:MM:SS) stays in the **same horizontal position** when toggling From ↔ To — it
      never jumps. Verify at a wide window and at the panel's minimum width.
- [ ] Clicking anywhere on the **time/label** area opens the picker popover (whole area is clickable,
      including the digits — regression from when only the label opened it).
- [ ] Clicking the **`o->` icon** flips From ↔ To in one click (does NOT open the popover).
- [ ] After the `o->` toggle: header label (From/To), popover START AT/END AT active state, and the
      `ENDS AT` value all update to match.
- [ ] Icon turns amber in **To** (end-at) mode.
- [ ] Caret stays pinned to the right edge in all states.

## 3. Time picker popover (draft — apply only on OK)
- [ ] Open picker, change hour/minute/mode, then click **outside** (or re-click the header): changes
      are **discarded**, the committed schedule is unchanged.
- [ ] Open picker, change values, click **OK**: changes apply to the header + all displays.
- [ ] **Enter** while the picker is open commits the same as OK.
- [ ] Hour combo opens scrolled to the **current** real-world hour (not next hour).
- [ ] Past hours/minutes are grayed/disabled; the next top-of-hour is subtly highlighted.
- [ ] Combo dropdowns are not clipped by the popover box and center on the selected value.
- [ ] Typing a precise `HH:MM` clamps out-of-range input (e.g. `99` → `23`) as you type.
- [ ] Picking a time < 1 minute away is refused with a toast; the schedule is left unchanged.

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
- [ ] **Right-click** a queue item removes it; right-click a chain group removes the whole chain.
- [ ] The native browser context menu never appears inside the panel.

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
