<?php // SPDX-License-Identifier: AGPL-3.0-or-later ?>
<?php
require_once __DIR__ . '/auth.php';
require_admin();

$logFile = 'keep-alive.log'; // Path to the log file (written at runtime by log-keep-alive.php)

// Read and process logs
$logsByDate = [];
if (file_exists($logFile)) {
    $logEntries = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($logEntries as $entry) {
        // Match the log format, with an optional machine ID (older lines omit it).
        preg_match('/\[(.*?)\](?: ID: (\S+))? IP: (.*?) - (.*)/', $entry, $matches);
        $timestamp = $matches[1] ?? 'Unknown'; // Extract timestamp
        $machineId = ($matches[2] ?? '') !== '' ? $matches[2] : '—'; // Machine ID
        $ip = $matches[3] ?? 'Unknown'; // Extract IP address
        $action = $matches[4] ?? 'Unknown'; // Extract action

        // Extract the date part from the timestamp
        $date = explode('T', $timestamp)[0] ?? 'Unknown';

        // Group by date
        $logsByDate[$date][] = [
            'timestamp' => $timestamp,
            'machineId' => $machineId,
            'ip' => $ip,
            'action' => $action,
        ];
    }
}
?>

<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['clear_log'])) {
    if (file_exists($logFile)) {
        file_put_contents($logFile, ''); // Clear the file contents
        $message = "Log file cleared successfully!";
    } else {
        $message = "Log file does not exist.";
    }
    // Redirect back to the same page to refresh
    header("Location: " . $_SERVER['PHP_SELF']);
    exit;
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="assets/css/admin.css">
    <title>Keep-Alive Log Viewer</title>
    <style>
        body {
            text-align: center;
            font-family: Arial, sans-serif;
            margin: 20px;
        }
        .log-container {
            max-width: 800px;
            margin: 0 auto;
            text-align: left;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            padding: 10px;
            border: 1px solid #ddd;
            text-align: left;
        }
        th {
            background-color: #f4f4f4;
        }
        tr:hover {
            background-color: #f1f1f1;
        }
        .back-button {
            display: inline-block;
            margin: 20px 0;
            padding: 10px 20px;
            background-color: lightgray;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            cursor: pointer;
        }
        .back-button:hover {
            background-color: #0056b3;
        }
        .date {
            font-weight: bold;
            margin: 10px 0;
            cursor: pointer;
        }
        .log-entries {
            margin-left: 20px;
            display: none; /* Initially hidden */
        }
    </style>
</head>
<body>
<div class="container">
    <h1>Keep-Alive Log Viewer</h1>
    <div class="log-container">
        <?php if (!empty($logsByDate)): ?>
            <?php ksort($logsByDate); // Sort dates ?>
            <?php $dayCounter = 1; // Initialize day counter ?>
            <?php foreach ($logsByDate as $date => $entries): ?>
                <div class="date" onclick="toggleLogEntries('log-<?= md5($date) ?>')">
                    <?= $dayCounter++ ?>. Day: <?= htmlspecialchars($date) ?>
                </div>
                <div id="log-<?= md5($date) ?>" class="log-entries">
        <table>
    <thead>
        <tr>
            <th>Machine</th>
            <th>IP</th>
            <th>Action</th>
            <th>Date</th>
        </tr>
    </thead>
    <tbody>
        <?php foreach ($entries as $entry): ?>
            <tr>
                <td><?= htmlspecialchars($entry['machineId']) ?></td>
                <td><?= htmlspecialchars($entry['ip']) ?></td>
                <td><?= htmlspecialchars($entry['action']) ?></td>
                <td>
                    <?php
                    // Format the ISO 8601 timestamp
                    try {
                        $dateTime = new DateTime($entry['timestamp']);
                        echo $dateTime->format('F j, Y, g:i:s A'); // Add seconds (s)
                    } catch (Exception $e) {
                        echo htmlspecialchars($entry['timestamp']); // Fallback for invalid timestamps
                    }
                    ?>
                </td>
            </tr>
        <?php endforeach; ?>
    </tbody>
</table>

                </div>
            <?php endforeach; ?>
        <?php else: ?>
            <p>No logs available.</p>
        <?php endif; ?>
    </div>
    <script>
        function toggleLogEntries(id) {
            const logEntries = document.getElementById(id);
            if (logEntries.style.display === 'none' || logEntries.style.display === '') {
                logEntries.style.display = 'block'; // Show entries
            } else {
                logEntries.style.display = 'none'; // Hide entries
            }
        }
    </script>
    <form method="post">
        <button type="submit" name="clear_log" class="clear-log-button">Clear Log</button>
    </form>
</div>
<div>
    <?php if (isset($message)): ?>
        <p><?= htmlspecialchars($message) ?></p>
    <?php endif; ?>
</div>
<a href="maintenance.php" class="back-button">Back</a>
<div style="position:absolute; top:12px; left:9px;">
    <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
</div>
</body>
</html>
