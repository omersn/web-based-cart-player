<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Mobile-friendly landing page (the QR code points here): big section links. */
require_once __DIR__ . '/includes/helpers.php';

$labels = load_section_labels();

// Same section ranges as the desktop section selector.
$ranges = [
    ['from' => 10,  'to' => 35],
    ['from' => 35,  'to' => 60],
    ['from' => 60,  'to' => 85],
    ['from' => 85,  'to' => 110],
    ['from' => 120, 'to' => 145],
    ['from' => 145, 'to' => 170],
    ['from' => 170, 'to' => 195],
    ['from' => 195, 'to' => 220],
    ['from' => 220, 'to' => 245],
    ['from' => 245, 'to' => 270],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cart Player &mdash; Mobile</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; background-color: #000; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .container { background-color: #fff; border-radius: 16px; padding: 50px 30px 30px; width: 90%; max-width: 400px; box-shadow: 0 4px 15px rgba(255, 255, 255, 0.1), 0 4px 10px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; align-items: center; }
        h1 { font-size: 22px; margin-bottom: 20px; color: #333; }
        .link-button { display: block; width: 100%; max-width: 300px; padding: 15px; font-size: 18px; text-decoration: none; color: #fff; background-color: #007bff; border-radius: 8px; font-weight: bold; margin-bottom: 15px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); transition: background-color 0.3s ease, transform 0.2s ease; }
        .link-button:hover { background-color: #0056b3; transform: translateY(-3px); }
    </style>
</head>
<body>
    <div class="container">
        <h1><?= htmlspecialchars(STATION_NAME) ?> &mdash; mobile</h1>
        <?php foreach ($ranges as $i => $range): ?>
            <?php $label = $labels[$i] ?? ('Section ' . ($i + 1)); ?>
            <a class="link-button" href="grid.php?from=<?= $range['from'] ?>&to=<?= $range['to'] ?>&btnh=200&line=3&pagination=0"><?= htmlspecialchars($label) ?></a>
        <?php endforeach; ?>

        <a class="link-button" style="background-color: green;" href="grid.php?from=0&to=10&btnh=200&line=3&pagination=0">Station IDs</a>
        <a class="link-button" style="background-color: green;" href="grid.php?from=110&to=120&btnh=200&line=3&pagination=0">Sweepers &amp; Effects</a>
    </div>

    <div style="position: absolute; top: 9px; left: 9px;">
        <img src="assets/img/logo.svg" height="30" alt="<?= htmlspecialchars(STATION_NAME) ?>">
    </div>
</body>
</html>
