<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Edit the per-day on-air credits (data/credits/day1..7.txt). */
require_once __DIR__ . '/auth.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    for ($i = 1; $i <= 7; $i++) {
        if (isset($_POST['day' . $i])) {
            file_put_contents(data_path("credits/day$i.txt"), $_POST['day' . $i]);
        }
    }
    header('Location: admin.php');
    exit;
}

require_admin();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit credits</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; background-color: #000; color: #fff; margin: 0; padding: 20px; }
        .container { background: #fff; color: #000; padding: 20px; border-radius: 10px; max-width: 800px; min-width: 700px; margin: auto; }
        .day-label { font-size: 24px; margin-top: 10px; }
        textarea {
            font-family: Arial, sans-serif; width: 75%; height: 80px; font-size: 16px; resize: none;
            border-radius: 5px; padding: 5px; border: 1px solid #000; text-align: center;
        }
        button { margin-top: 20px; padding: 10px 20px; font-size: 18px; cursor: pointer; border-radius: 5px; border: none; background: #000; color: #fff; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Edit credits</h2>
        <form method="POST">
            <div id="editor">
                <?php
                $days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                for ($i = 1; $i <= 7; $i++) {
                    $path    = data_path("credits/day$i.txt");
                    $content = file_exists($path) ? file_get_contents($path) : '';
                    echo "<div class='day-label'>" . htmlspecialchars($days[$i - 1]) . "</div>";
                    echo "<textarea name='day$i' maxlength='100'>" . htmlspecialchars($content) . "</textarea>";
                }
                ?>
            </div>
            <button type="submit">Save</button>
        </form>
    </div>

    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
</body>
</html>
