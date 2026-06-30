<?php
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * DJ management screen: a limited view of one section of the cart list
 * (config DJ_FROM..DJ_TO) with rename / replace / color / trim / chain / delete
 * and reordering. See admin.php for the full version.
 */
require_once __DIR__ . '/auth.php';
require_dj();
require_once __DIR__ . '/includes/helpers.php';

$carts       = load_carts();
$crossStates = load_cross_states();

// Reorder within the list.
if (isset($_GET['move_up']) || isset($_GET['move_down'])) {
    $id        = isset($_GET['move_up']) ? (int) $_GET['move_up'] : (int) $_GET['move_down'];
    $direction = isset($_GET['move_up']) ? -1 : 1;
    if (isset($carts[$id], $carts[$id + $direction])) {
        [$carts[$id], $carts[$id + $direction]] = [$carts[$id + $direction], $carts[$id]];
        save_carts($carts);
    }
    header('Location: dj.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DJ &mdash; <?= htmlspecialchars(STATION_NAME) ?></title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <style>
        .cart-item { display: flex; align-items: center; justify-content: space-between; padding: 5px 10px; margin: 5px 0; border-radius: 5px; }
        .cart-name { display: flex; align-items: center; flex: 1; gap: 10px; }
        .cart-chained { background-color: #d1fcc7; border-radius: 50%; padding: 3px; }
    </style>
</head>
<body>
    <div class="notification-bottom2"><p>User:<br><?= htmlspecialchars(DJ_USER) ?></p></div>

    <div class="container">
        <h2>Jingle manager &mdash; <?= htmlspecialchars(STATION_NAME) ?></h2>
        <center><h4>DJ view</h4></center>

        <ul>
            <?php foreach ($carts as $id => $entry): ?>
                <?php if ($id < DJ_FROM || $id >= DJ_TO) { continue; } ?>
                <?php
                [$name, $filename, $start, $color] = explode('|', $entry) + [null, null, '0', '1'];
                $filename  = trim($filename);
                $isEmpty   = ($filename === '0.mp3');
                $colorCode = $isEmpty ? '#dedede' : color_for($color);
                $isChained = isset($crossStates[$id]) && $crossStates[$id] === 1;
                ?>
                <li class="cart-item" style="background-color: <?= $colorCode ?>;">
                    <div class="cart-name">
                        <?php if (!$isEmpty): ?>
                            <a href="change.php?id=<?= $id ?>" style="color:#fff;" title="Replace audio">↻</a>
                            <a href="rename.php?id=<?= $id ?>" style="color:#fff;" title="Rename">✏️</a>
                            <a href="color.php?id=<?= $id ?>" style="color:#fff;" title="Color">🎨</a>
                            <a href="trimmer.php?file=<?= htmlspecialchars($filename) ?>" style="color:#fff;" title="Trim">✂️</a>
                            <a href="dj-delete.php?id=<?= $id ?>" class="confirm-delete" style="color:#fff;" title="Clear">🗑️</a>
                            <a href="javascript:void(0);" onclick="openPopup('toggle-cross.php?number=<?= $id + 1 ?>')" class="<?= $isChained ? 'cart-chained' : '' ?>" title="Chain to next">🔗</a>
                        <?php endif; ?>
                    </div>

                    <?php if (!$isEmpty): ?>
                        <span style="color:#fff;"><?= htmlspecialchars($name) ?></span>
                        <button onclick="togglePlayback(this, 'uploads/<?= htmlspecialchars($filename) ?>')" data-playing="false">▶</button>
                    <?php else: ?>
                        <span style="color:#fff;">「 <a href="change.php?id=<?= $id ?>" style="color:#fff;">🔊⁺</a> 」 <?= htmlspecialchars($name) ?></span>
                    <?php endif; ?>

                    <span>
                        <?php if ($id > 0): ?><a href="dj.php?move_up=<?= $id ?>" style="color:gray;">▲</a><?php else: ?><span style="opacity:0.5;">▲</span><?php endif; ?>
                        <?php if ($id < count($carts) - 1): ?><a href="dj.php?move_down=<?= $id ?>" style="color:gray;">▼</a><?php else: ?><span style="opacity:0.5;">▼</span><?php endif; ?>
                    </span>
                </li>
            <?php endforeach; ?>
        </ul>
    </div>

    <div class="side-nav">
        <a href="process-carts.php?action=align">Back to cart wall</a>
        <a href="logout.php">Log out</a>
    </div>

    <div style="position:absolute; top:12px; left:9px;">
        <img src="assets/img/logo.svg" height="19" alt="<?= htmlspecialchars(STATION_NAME) ?>">
    </div>

    <!-- Popup container for the chain toggle. -->
    <div id="iframe-container" style="display:none; position:absolute; width:300px; height:150px; border:1px solid #ccc; background:#fff; z-index:1000; border-radius:10px;">
        <button onclick="document.getElementById('iframe-container').style.display='none'; location.reload();" style="position:absolute; top:5px; right:5px;">✕</button>
        <iframe id="floating-iframe" style="width:100%; height:100%; border:none;"></iframe>
    </div>
    <iframe id="previewFrame" name="previewFrame" style="display:none;"></iframe>

    <script>
        function togglePlayback(button, src) {
            const frame = document.getElementById('previewFrame');
            if (button.dataset.playing === 'true') {
                frame.src = 'null.html';
                button.dataset.playing = 'false';
                button.textContent = '▶';
            } else {
                frame.src = src;
                button.dataset.playing = 'true';
                button.textContent = '❚❚';
            }
        }
        function openPopup(url) {
            const container = document.getElementById('iframe-container');
            document.getElementById('floating-iframe').src = url;
            container.style.display = 'block';
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
        document.querySelectorAll('.confirm-delete').forEach(link => {
            link.addEventListener('click', (e) => {
                if (!confirm('Clear the contents of this slot?')) e.preventDefault();
            });
        });
    </script>
</body>
</html>
