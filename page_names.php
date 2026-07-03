<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/**
 * Manage the editable section labels (data/parts.txt), the per-page names
 * (data/page_names.txt) and the DJ edit-rights (data/dj-rights.txt).
 */
require_once __DIR__ . '/config.php';

// Current section labels (parts.txt), 0-indexed.
$partsContent = file_exists(data_path('parts.txt'))
    ? file(data_path('parts.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)
    : [];
$lines = [];
for ($i = 0; $i < 10; $i++) {
    $lines[$i] = $partsContent[$i] ?? '';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Page names ("-" for empty)
    $pageNames = array_map(static fn($name) => trim($name) === '' ? '-' : $name, $_POST['pageNames']);
    file_put_contents(data_path('page_names.txt'), implode(PHP_EOL, $pageNames) . PHP_EOL);

    // DJ edit-rights (checkbox per page)
    $djRights = array_map(
        static fn($index) => isset($_POST['editAccess'][$index]) ? '1' : '0',
        array_keys($_POST['pageNames'])
    );
    file_put_contents(data_path('dj-rights.txt'), implode(PHP_EOL, $djRights) . PHP_EOL);

    // Section labels (parts.txt): 10 textareas line1..line10
    $sectionLabels = [];
    for ($i = 1; $i <= 10; $i++) {
        $sectionLabels[] = trim($_POST["line$i"] ?? '') ?: '-';
    }
    file_put_contents(data_path('parts.txt'), implode(PHP_EOL, $sectionLabels) . PHP_EOL);

    header('Location: admin.php');
    exit;
}

$pageNames = file_exists(data_path('page_names.txt'))
    ? file(data_path('page_names.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)
    : [];
$djRights = file_exists(data_path('dj-rights.txt'))
    ? file(data_path('dj-rights.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)
    : [];

// Section label textareas are interleaved between page-name rows (every 2nd row).
$labelForIndex = [0 => 1, 2 => 2, 4 => 3, 6 => 4, 8 => 5, 10 => 6, 12 => 7, 14 => 8, 16 => 9, 18 => 10];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Manage sections</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <style>
        body { font-family: Arial, sans-serif; color: #fff; margin: 0; }
        .container { width: 600px; max-width: 90%; margin: 20px auto; background-color: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5); }
        .page-names { display: flex; flex-direction: column; gap: 8px; }
        .page-name-input { display: flex; align-items: center; gap: 10px; }
        textarea { resize: none; width: 380px; font-size: 20px; text-align: center; margin-bottom: 10px; }
        button { padding: 10px 20px; background-color: #007bff; color: #fff; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Manage sections</h2><br>
        <form action="" method="POST">
            <div class="page-names" id="page-names">
                <?php foreach ($pageNames as $index => $name): ?>
                    <?php if (isset($labelForIndex[$index])): ?>
                        <?php $n = $labelForIndex[$index]; ?>
                        <?php if ($index > 0): ?><br><?php endif; ?>
                        <textarea name="line<?= $n ?>" rows="1" maxlength="20"><?= htmlspecialchars($lines[$n - 1]) ?></textarea>
                    <?php endif; ?>
                    <div class="page-name-input">
                        <input style="display:none;" type="text" name="pageNames[]" maxlength="20" value="<?= htmlspecialchars($name) ?>">
                        <label>
                            <input style="display:none;" type="checkbox" name="editAccess[<?= $index ?>]" <?= (isset($djRights[$index]) && $djRights[$index] === '1') ? 'checked' : '' ?>>
                        </label>
                    </div>
                <?php endforeach; ?>
            </div>
            <br>
            <div>
                <a href="admin.php">Cancel</a>
                <button type="submit">Save</button>
            </div>
        </form>
    </div>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
</body>
</html>
