<?php // SPDX-License-Identifier: AGPL-3.0-or-later ?>
<?php
// Define the path to the log file
$logFile = 'keep-alive.log';

// Get the JSON input from the client
$input = json_decode(file_get_contents('php://input'), true);

// Extract details from the request
$message = $input['message'] ?? 'No message provided';
$isError = $input['isError'] ?? false;
$timestamp = $input['timestamp'] ?? date('Y-m-d H:i:s');

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
    "[%s] IP: %s - %s\n",
    $timestamp,
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
