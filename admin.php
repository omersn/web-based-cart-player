<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Admin management screen: reorder, rename, recolor, trim, set volume, chain,
 * add and (soft-)delete carts. Full access — see dj.php for the limited view.
 */
require_once __DIR__ . '/auth.php';
require_admin();
require_once __DIR__ . '/includes/helpers.php';

$carts       = load_carts();
$crossStates = load_cross_states();
$labels      = load_section_labels();

// --- Mutations -------------------------------------------------------------
if (isset($_GET['delete'])) {
    $id = (int) $_GET['delete'];
    if (isset($carts[$id])) {
        $carts[$id] = '- | 0.mp3|0|1';
        save_carts($carts);
    }
    header('Location: admin.php?deleted=true');
    exit;
}

if (isset($_GET['add_between'])) {
    $id = (int) $_GET['add_between'];
    array_splice($carts, $id + 1, 0, '- | 0.mp3|0|1');
    save_carts($carts);
    header('Location: admin.php?added=true');
    exit;
}

if (isset($_GET['move_up']) || isset($_GET['move_down'])) {
    $id        = isset($_GET['move_up']) ? (int) $_GET['move_up'] : (int) $_GET['move_down'];
    $direction = isset($_GET['move_up']) ? -1 : 1;
    if (isset($carts[$id], $carts[$id + $direction])) {
        [$carts[$id], $carts[$id + $direction]] = [$carts[$id + $direction], $carts[$id]];
        save_carts($carts);
    }
    header('Location: admin.php');
    exit;
}

// Section headers keyed by cart index.
$sectionHeaders = [
    0   => 'Station IDs',
    10  => $labels[0], 35 => $labels[1], 60 => $labels[2], 85 => $labels[3],
    110 => 'Sweepers & Effects',
    120 => $labels[4], 145 => $labels[5], 170 => $labels[6],
    195 => $labels[7], 220 => $labels[8], 245 => $labels[9],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jingle manager &mdash; <?= htmlspecialchars(STATION_NAME) ?></title>
    <link rel="stylesheet" href="assets/css/admin.css">
</head>
<body>
    <?php if (isset($_GET['deleted'])): ?><div class="notification-bottom"><p>Slot cleared successfully</p></div><?php endif; ?>
    <?php if (isset($_GET['added'])): ?><div class="notification-bottom"><p>Jingle added successfully</p></div><?php endif; ?>
    <div class="notification-bottom"><p>User:<br><?= htmlspecialchars(ADMIN_USER) ?></p></div>

    <!-- Popup iframe containers (rename/volume/trim/color open into these). -->
    <div id="iframe-container" style="display:none; position:absolute; width:300px; height:109px; border:1px solid #ccc; box-shadow:0 4px 8px rgba(0,0,0,0.2); z-index:1000; background:#fff; border-radius:10px;">
        <button onclick="closePopup('iframe-container')" style="position:absolute; top:68px; right:155px; background:none; color:#3679f5; border:none; font-size:15px; cursor:pointer;">OK</button>
        <iframe id="floating-iframe" style="width:100%; height:100%; border:none;"></iframe>
    </div>
    <div id="iframe-container-2" style="display:none; position:absolute; width:650px; height:550px; border:1px solid #888; box-shadow:0 4px 8px rgba(0,0,0,0.3); z-index:1100; background:#f9f9f9; border-radius:19px;">
        <button onclick="document.getElementById('iframe-container-2').style.display='none';" style="position:absolute; top:5px; right:5px; background:none; color:red; border:none; font-size:14px; cursor:pointer;">✕</button>
        <iframe id="floating-iframe-2" style="width:100%; height:100%; border:none;"></iframe>
    </div>
    <div id="iframe-container-3" style="display:none; position:absolute; width:400px; height:250px; border:1px solid #555; box-shadow:0 4px 8px rgba(0,0,0,0.4); z-index:1200; background:#fff; border-radius:20px;">
        <button onclick="hideContainer3();" style="position:absolute; top:8px; right:8px; background:none; color:#d9534f; border:none; font-size:18px; font-weight:bold; cursor:pointer;">✕</button>
        <iframe id="floating-iframe-3" style="width:100%; height:100%; border:none;"></iframe>
    </div>

    <div class="container">
        <a href="javascript:void(0);" onclick="toggleLegend()">❓</a>
        <h2>Jingle manager &mdash; <?= htmlspecialchars(STATION_NAME) ?></h2>

        <!-- Icon legend -->
        <div id="legend" style="display:none; position:absolute; top:50px; left:50%; transform:translateX(-50%); width:560px; padding:20px; background-color:#dfdfe6; border:1px solid #ccc; border-radius:8px; box-shadow:0 4px 8px rgba(0,0,0,0.4); text-align:left;">
            <h3>What the icons mean</h3>
            <table style="width:100%; border-spacing:0 5px;">
                <tr><td>✏️</td><td>Rename the cart</td></tr>
                <tr><td>🎨</td><td>Change the button color</td></tr>
                <tr><td>⚙️</td><td>Replace the audio</td></tr>
                <tr><td>✂️</td><td>Set start &amp; end points</td></tr>
                <tr><td>🗑️</td><td>Delete audio (kept until cleanup)</td></tr>
                <tr><td>🎚️</td><td>Set playback volume</td></tr>
                <tr><td>🔗</td><td>Chain to the next cart (play as one sequence)</td></tr>
                <tr><td>▲ ▼</td><td>Move the cart up or down</td></tr>
                <tr><td><span style="color:gold;">█</span></td><td>This cart appears in the fixed Station ID window</td></tr>
                <tr><td>▶</td><td>Preview the full clip</td></tr>
            </table>
            <button onclick="toggleLegend()" style="padding:5px 10px; background-color:#007bff; color:#fff; border:none; border-radius:5px; cursor:pointer;">Close</button>
        </div>

        <ul class="admin-rows">
            <?php foreach ($carts as $id => $entry): ?>
                <?php if (isset($sectionHeaders[$id])): ?>
                    <h3 style="text-align:center; color:#000; background-color:#f0f0f0; padding:10px; border-radius:5px;"><?= htmlspecialchars($sectionHeaders[$id]) ?></h3>
                <?php endif; ?>
                <?php
                [$name, $filename, $start, $color, $end, $volume] = array_pad(explode('|', $entry), 6, null);
                $filename  = trim($filename);
                $volume    = $volume ?? '1';
                $isEmpty   = ($filename === '0.mp3');
                $colorCode = $isEmpty ? '#dedede' : color_for($color);
                $isChained = isset($crossStates[$id]) && $crossStates[$id] === 1;
                $isStationId = ($id >= 0 && $id <= 9) || ($id >= 110 && $id <= 119);
                ?>
                <li>
                    <span style="display:inline-block; width:280px; white-space:nowrap; overflow:hidden;">
                        <?php if (!$isEmpty): ?>
                            <a href="rename.php?id=<?= $id ?>" title="Rename">✏️</a>
                            <a href="change.php?id=<?= $id ?>" title="Replace audio">⚙️</a>
                            <a href="javascript:void(0);" onclick="openPopup3('color-div.php?id=<?= $id ?>')" title="Color">🎨</a>
                            <a href="javascript:void(0);" onclick="openPopup('volume.php?number=<?= $id + 1 ?>')" title="Volume">🎚️</a>
                            <a href="javascript:void(0);" onclick="openPopup2('trimmer-div.php?file=<?= htmlspecialchars($filename) ?>')" title="Trim">✂️</a>
                            <a href="admin.php?delete=<?= $id ?>" class="confirm-delete" title="Clear">🗑️</a>
                            <a href="javascript:void(0);" onclick="openPopup('toggle-cross.php?number=<?= $id + 1 ?>')" title="Chain to next" style="<?= $isChained ? 'background:#d1fcc7;' : '' ?>">🔗</a>
                            <?php $totalSeconds = (float) number_format((float) $end, 2) - (float) number_format((float) $start, 2); ?>
                            <span style="font-size:8px; margin-left:8px;">
                                <?= gmdate('i:s', (int) $start) ?> → <?= gmdate('i:s', (int) $end) ?>
                                &nbsp;⏱️<?= gmdate('i:s', (int) max($totalSeconds, 0)) ?>
                                &nbsp;🔊 <?= number_format((float) $volume * 100, 0) ?>%
                            </span>
                        <?php endif; ?>
                    </span>

                    <?= $isStationId ? '<span style="color:gold;">█</span> ' : '' ?>
                    <div style="width:300px; height:23px; background-color:<?= $colorCode ?>; margin-left:10px; padding-right:10px; border:1px solid #ccc; display:inline-block; text-align:right; border-radius:5px; color:#fff;">
                        <?php if ($isEmpty): ?>
                            「 <a href="change.php?id=<?= $id ?>" style="color:#fff;">🔊⁺</a> 」
                        <?php else: ?>
                            <a href="rename.php?id=<?= $id ?>" style="color:#fff;"><?= htmlspecialchars($name) ?></a>
                            <a href="uploads/<?= htmlspecialchars($filename) ?>" target="previewFrame" style="color:#fff;">▶</a>
                        <?php endif; ?>
                    </div>

                    <?php if ($id > 0): ?><a href="admin.php?move_up=<?= $id ?>" title="Move up" style="color:gray;">▲</a><?php else: ?><span style="color:gray; opacity:0.5;">▲</span><?php endif; ?>
                    <?php if ($id < count($carts) - 1): ?><a href="admin.php?move_down=<?= $id ?>" title="Move down" style="color:gray;">▼</a><?php else: ?><span style="color:gray; opacity:0.5;">▼</span><?php endif; ?>
                </li>
            <?php endforeach; ?>
        </ul>

        <a href="add.php" title="Add an empty slot at the end">➕</a>
        <a href="#" class="confirm-delete-last" style="color:#ed7979;" title="Delete last item">✖</a>
    </div>

    <!-- Side navigation -->
    <div class="side-nav">
        <a href="process-carts.php?action=align">Back to cart wall</a>
        <a href="page_names.php">Manage sections</a>
        <a href="maintenance.php">Maintenance</a>
        <a href="status.php">Status ticker</a>
        <a href="credit-edit.php">Edit credits</a>
        <a href="logout.php">Log out</a>
    </div>

    <div style="position:absolute; top:12px; left:9px;">
        <img src="assets/img/logo.svg" height="19" alt="<?= htmlspecialchars(STATION_NAME) ?>">
    </div>

    <center><iframe name="previewFrame" src="null.html" style="display:none;" height="0" width="0"></iframe></center>

    <script>
        function toggleLegend() {
            const el = document.getElementById('legend');
            el.style.display = (el.style.display === 'none' || el.style.display === '') ? 'block' : 'none';
        }

        // Popup iframe helpers (positioned near the clicked anchor).
        function openPopup(url) { openContainer('iframe-container', 'floating-iframe', url); }
        function openPopup2(url) { openContainer('iframe-container-2', 'floating-iframe-2', url); }
        function openPopup3(url) { openContainer('iframe-container-3', 'floating-iframe-3', url); }
        function openContainer(containerId, frameId, url) {
            const container = document.getElementById(containerId);
            document.getElementById(frameId).src = url;
            container.style.display = 'block';
            // Clamp to the viewport so wide popups (e.g. the 650px trimmer) never
            // run off-screen — important now that the controls sit on the right.
            const evt = window.event;
            const margin = 8;
            const w = container.offsetWidth, h = container.offsetHeight;
            let left = evt ? evt.pageX : 100;
            let top = evt ? evt.pageY : 100;
            left = Math.max(window.scrollX + margin, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - margin));
            top = Math.max(window.scrollY + margin, Math.min(top, window.scrollY + document.documentElement.clientHeight - h - margin));
            container.style.left = `${left}px`;
            container.style.top = `${top}px`;
        }
        function closePopup(id) { document.getElementById(id).style.display = 'none'; location.reload(); }
        // Called by saved trimmer/color iframes to close + refresh.
        function hideParentDiv() { closePopup('iframe-container-2'); }
        function hideParentDiv2() { hideContainer3(); }
        function hideContainer3() { document.getElementById('iframe-container-3').style.display = 'none'; location.reload(); }

        // Delete confirmations.
        document.querySelectorAll('.confirm-delete').forEach(link => {
            link.addEventListener('click', (e) => {
                if (!confirm('Clear the contents of this slot?')) e.preventDefault();
            });
        });
        document.querySelector('.confirm-delete-last').addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Delete the last item?')) window.location.href = 'delete_last_entry.php';
        });
    </script>
</body>
</html>
