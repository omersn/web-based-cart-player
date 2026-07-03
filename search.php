<?php
// License: PolyForm-Strict-1.0.0 (see LICENSE)
/** Search overlay: renders matching carts as simple play/stop buttons. */
require_once __DIR__ . '/includes/helpers.php';

header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

session_start();
$cartwallColumns  = $_SESSION['cartwall_padding']   ?? 5;
$cartwallFontSize = $_SESSION['cartwall_font_size']  ?? 1.0;

$searchTerm = isset($_GET['search']) ? trim($_GET['search']) : '';

$filteredCarts = array_filter(load_carts(), static function ($line) use ($searchTerm) {
    $name = explode('|', $line)[0] ?? '';
    return $line !== '' && (empty($searchTerm) || stripos($name, $searchTerm) !== false);
});
$filteredCartsJson = json_encode(array_values($filteredCarts));
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="assets/css/player.css?v=<?= time() ?>">
    <title>Search</title>
    <style>
        .cartwall {
            display: grid;
            grid-template-columns: repeat(<?= (int) $cartwallColumns ?>, 1fr);
            gap: 10px;
            padding: 18px;
            padding-top: 50px;
        }
        .button {
            position: relative; padding: 45px; background-color: gray; color: #fff; border: none;
            border-radius: 8px; text-align: center; cursor: pointer; font-size: <?= (float) $cartwallFontSize ?>rem;
            overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: center;
            height: 90px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .button:active { background-color: #0056b3; }
        .progress { position: absolute; top: 0; left: 0; height: 100%; width: 0; background-color: rgba(255, 255, 255, 0.3); z-index: 1; transition: width 0.1s linear; }
        .no-results, .ttl {
            position: absolute; left: 50%; transform: translate(-50%, -50%); padding: 20px;
            background-color: rgba(0, 0, 0, 0.8); color: #fff; font-size: 1.5rem; border-radius: 10px;
            text-align: center; z-index: 1000;
        }
        .no-results { top: 50%; }
        .ttl { top: 4%; }
        .duration { font-size: 0.7rem; color: #ffffffcc; margin-top: 5px; }
    </style>
</head>
<body>
    <div class="cartwall" id="cartwall">Loading...</div>
    <div id="no-results" class="no-results" style="display: none;">No results</div>
    <div id="title" class="ttl">Search results</div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const cartwall = document.getElementById('cartwall');
            const noResults = document.getElementById('no-results');
            const cartLines = <?= $filteredCartsJson ?>;

            if (cartLines.length === 0) {
                noResults.style.display = 'block';
                cartwall.style.display = 'none';
                return;
            }

            cartwall.innerHTML = '';
            cartLines.forEach((line, index) => {
                const [name, audioPath, startPoint, colorCode] = line.split('|').map(part => part.trim());
                const startAt = parseFloat(startPoint) || 0;
                const buttonColor = { '1': '#007bff', '2': '#4dbf49', '3': '#d15ccf', '4': '#d19724', '5': '#5eccd6' }[colorCode] || '#007bff';

                const button = document.createElement('button');
                button.classList.add('button');
                button.textContent = name || `Unnamed ${index + 1}`;
                button.style.backgroundColor = buttonColor;

                const progress = document.createElement('div');
                progress.classList.add('progress');
                button.appendChild(progress);

                const duration = document.createElement('div');
                duration.classList.add('duration');
                duration.textContent = 'Loading...';
                button.appendChild(duration);

                const audio = new Audio(`uploads/${audioPath}`);
                audio.currentTime = startAt;

                audio.addEventListener('loadedmetadata', () => {
                    const remaining = Math.max(audio.duration - startAt, 0);
                    duration.textContent = `${Math.floor(remaining / 60)}:${Math.floor(remaining % 60).toString().padStart(2, '0')}`;
                });

                button.addEventListener('click', () => {
                    if (!audio.paused) {
                        audio.pause();
                        audio.currentTime = startAt;
                        button.style.backgroundColor = buttonColor;
                        progress.style.width = '0';
                    } else {
                        audio.play();
                        button.style.backgroundColor = 'red';

                        audio.addEventListener('timeupdate', () => {
                            const remaining = Math.max(audio.duration - audio.currentTime, 0);
                            duration.textContent = `${Math.floor(remaining / 60)}:${Math.floor(remaining % 60).toString().padStart(2, '0')}`;
                            progress.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
                        });

                        audio.addEventListener('ended', () => {
                            button.style.backgroundColor = buttonColor;
                            progress.style.width = '0';
                            duration.textContent = `${Math.floor(audio.duration / 60)}:${Math.floor(audio.duration % 60).toString().padStart(2, '0')}`;
                        });
                    }
                });

                cartwall.appendChild(button);
            });
        });
    </script>
</body>
</html>
