<?php
/** Public "download a jingle" page: lists every populated cart as a download link. */
require_once __DIR__ . '/includes/helpers.php';

$carts = load_carts();

/** Derive a human date from the (timestamp).mp3 filename of the 2nd cart. */
function getLastUpdateDate(array $carts): string
{
    if (isset($carts[1])) {
        $parts = explode('|', $carts[1]);
        if (isset($parts[1])) {
            $timestampPart = explode('.', trim($parts[1]))[0];
            if (ctype_digit($timestampPart)) {
                return date('d/m/Y H:i', (int) $timestampPart);
            }
        }
    }
    return 'Date unavailable';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Download jingles</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <style>
        #searchInput { padding: 10px; font-size: 16px; width: 300px; border: 1px solid #ccc; border-radius: 4px; }
        button { padding: 10px 15px; font-size: 16px; color: #fff; background-color: #007bff; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        .status-bar { position: fixed; bottom: 0; left: 0; width: 100%; background-color: #27ae60; color: #fff; text-align: center; font-size: 20px; font-weight: bold; padding: 15px; box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.3); }
    </style>
</head>
<body>
    <div class="container">
        <h2>Download jingles &mdash; <?= htmlspecialchars(STATION_NAME) ?></h2>
        <ul>
            <div>
                <input type="text" id="searchInput" placeholder="Search">
                <button onclick="searchPage()">Search a jingle to download</button>

                <br><br>
                &nbsp;<a href="merge-openers.php">Download the latest station-opener bundle (parts 1, 2 &amp; 3)</a><br><br>

                <?php
                foreach ($carts as $id => $entry) {
                    list($name, $filename, $start, $color) = explode('|', $entry) + [null, null, '0', '1'];
                    $filename = trim($filename);
                    if ($filename === '0.mp3') {
                        continue;
                    }
                    $colorCode = color_for($color);
                    echo "<li>";
                    echo "<a href='uploads/{$filename}' download='" . htmlspecialchars($name) . ".mp3'>💾</a>";
                    echo "<span style='width: 280px; height: 19px; background-color: {$colorCode}; margin-left: 10px; padding-right: 10px; border: 1px solid #ccc; display: inline-block; border-radius: 5px; color: #fff;'>";
                    echo '&nbsp;&nbsp;' . htmlspecialchars($name);
                    echo "</span></li>";
                }
                ?>
            </div>
        </ul>
    </div>

    <div class="status-bar">Sponsor last updated: <?= getLastUpdateDate($carts) ?></div>

    <div style="text-align: center; position: absolute; top: 5px; right: 10px; background-color: #9fbdd1; width: 130px; height: 23px; box-shadow: 2px 2px 0 1px rgba(163, 163, 163, 0.64);">
        <a href="index.php">Back to cart wall</a>
    </div>
    <div style="position: absolute; top: 12px; left: 9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>

    <script>
        function searchPage() {
            const searchTerm = document.getElementById('searchInput').value.trim();
            if (!searchTerm) return;

            document.querySelectorAll('mark').forEach(mark => {
                const parent = mark.parentNode;
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            });

            const regex = new RegExp(`(${searchTerm})`, 'gi');
            document.body.innerHTML = document.body.innerHTML.replace(regex, (match) => `<mark>${match}</mark>`);

            const firstMatch = document.querySelector('mark');
            if (firstMatch) {
                firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                alert('No matches found.');
            }
        }
    </script>
</body>
</html>
