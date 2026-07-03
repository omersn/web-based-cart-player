<?php // License: PolyForm-Strict-1.0.0 (see LICENSE) ?>
<?php
// Define the path to the log file
$logFile = 'keep-alive.log';

// GET -> return the most recent parsed entries as JSON, for the in-page
// "heartbeat" popup (timestamp + machine ID + message; the IP stays out of the
// client view). Handles both the new "ID: … IP: …" lines and older ID-less
// ones. The POST branch below still records new heartbeats.
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $tail = max(1, min(200, (int) ($_GET['tail'] ?? 60)));
    $entries = [];
    if (file_exists($logFile)) {
        $lines = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach (array_slice($lines, -$tail) as $line) {
            if (preg_match('/^\[(.*?)\](?: ID: (\S+))? IP: .*? - (.*)$/', $line, $m)) {
                $entries[] = ['timestamp' => $m[1], 'machineId' => $m[2] ?? '', 'message' => $m[3]];
            }
        }
    }
    header('Content-Type: application/json');
    echo json_encode(['entries' => $entries]);
    exit;
}

// Get the JSON input from the client
$input = json_decode(file_get_contents('php://input'), true);

// Extract details from the request
$message = $input['message'] ?? 'No message provided';
$isError = $input['isError'] ?? false;
$timestamp = $input['timestamp'] ?? date('Y-m-d H:i:s');

// Sanitised per-machine ID (alphanumeric + dash, capped) — identifies which
// frontend logged this heartbeat.
$machineId = preg_replace('/[^A-Za-z0-9\-]/', '', substr((string) ($input['machineId'] ?? ''), 0, 24));
if ($machineId === '') { $machineId = 'unknown'; }

// Get the client IP address
$ipAddress = $_SERVER['REMOTE_ADDR'] ?? 'unknown_ip';

// Shorten the IP (use hash for IPv6 or long IPv4 addresses)
$shortIp = (filter_var($ipAddress, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) ?
    substr(md5($ipAddress), 0, 8) : // Hash IPv6 to 8 characters
    $ipAddress; // Keep IPv4 as is

// Translate specific action messages
if (strpos($message, 'play() failed because the user didn\'t interact with the document first') !== false) {
    $message = 'Heart-beat failed, waiting for first interaction to start audio engine';
}

// Format the log entry
$logEntry = sprintf(
    "[%s] ID: %s IP: %s - %s\n",
    $timestamp,
    $machineId,
    $shortIp,
    $message
);

// Try to append the log entry to the file
try {
    file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);
    $response = [
        'status' => 'success',
        'message' => 'Log entry recorded successfully',
        'ip' => $shortIp,
    ];
} catch (Exception $e) {
    $response = [
        'status' => 'error',
        'message' => 'Failed to write to log file: ' . $e->getMessage(),
    ];
}

// Send a response back to the client
header('Content-Type: application/json');
echo json_encode($response);
