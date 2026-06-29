<?php // SPDX-License-Identifier: AGPL-3.0-or-later ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playback and Heartbeat Visualization</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            background-color: black;
            color: white;
            padding: 35px;
            font-family: Arial, sans-serif;
        }
        h1 {
            text-align: center;
            color: white;
        }
        #date-selector {
            display: block;
            margin: 20px auto;
            padding: 10px;
            font-size: 16px;
            border-radius: 5px;
            border: 1px solid lightgray;
        }
        .chart-container {
            background-color: white;
            border-radius: 10px;
            padding: 20px;
            margin: 20px auto;
            max-width: 800px;
        }
        canvas {
            display: block;
            margin: 0 auto;
        }
    </style>
</head>
<body>
    <div style="position:absolute; top:12px; left:9px;">
        <img src="assets/img/logo.svg" height="19" alt="Demo Radio Station">
    </div>
    <h1>Usage Info</h1>
    <select id="date-selector"></select>
    <div class="chart-container">
        <canvas id="usageChart" width="800" height="400"></canvas>
    </div>
    <script>
        let usageChart; // Global reference to the chart
        let availableDates = []; // Store all unique dates from the logs

        // Utility function to format dates as dd/mm/yyyy
        function formatDate(dateString) {
            const [year, month, day] = dateString.split('-');
            return `${day}/${month}/${year}`;
        }

        // Fetch and process logs
        async function fetchAndProcessLogs() {
            try {
                const heartbeatResponse = await fetch('keep-alive.log');
                const playbackResponse = await fetch('playback-log.log');

                if (!heartbeatResponse.ok || !playbackResponse.ok) {
                    throw new Error(`Failed to load log files`);
                }

                const heartbeatData = await heartbeatResponse.text();
                const playbackData = await playbackResponse.text();

                const heartbeatTimestamps = processHeartbeatLog(heartbeatData);
                const playbackTimestamps = processPlaybackLog(playbackData);
                const refreshTimestamps = processPageRefreshEvents(playbackData);

                availableDates = [...new Set([...heartbeatTimestamps, ...playbackTimestamps, ...refreshTimestamps]
                    .map(ts => ts.toISOString().split('T')[0]))].sort().reverse(); // Sort descending (latest date first)

                populateDateSelector();
                setInitialDate(heartbeatTimestamps, playbackTimestamps, refreshTimestamps);

                document.getElementById('date-selector').addEventListener('change', (event) => {
                    const selectedDate = event.target.value;
                    updateChart(selectedDate, heartbeatTimestamps, playbackTimestamps, refreshTimestamps);
                });
            } catch (error) {
                console.error('Error processing log data:', error);
            }
        }

        // Process heartbeat log
        function processHeartbeatLog(logData) {
            const lines = logData.trim().split('\n');
            const timestamps = [];
            lines.forEach(line => {
                const match = line.match(/\[([^\]]+)\]/);
                if (match) {
                    timestamps.push(new Date(match[1]));
                }
            });
            return timestamps;
        }

        // Process playback log
        function processPlaybackLog(logData) {
            const lines = logData.trim().split('\n');
            const timestamps = [];
            lines.forEach(line => {
                if (line.includes('played')) {
                    const match = line.match(/^(.+?) - .+? - played/);
                    if (match) {
                        const rawDate = match[1].trim();
                        const parsedDate = parseCustomDate(rawDate);
                        if (parsedDate) {
                            timestamps.push(parsedDate);
                        }
                    }
                }
            });
            return timestamps;
        }

        // Process page refresh events
        function processPageRefreshEvents(logData) {
            const lines = logData.trim().split('\n');
            const timestamps = [];
            lines.forEach(line => {
                if (line.includes('page refreshed')) {
                    const match = line.match(/^(.+?) - page refreshed/);
                    if (match) {
                        const rawDate = match[1].trim();
                        const parsedDate = parseCustomDate(rawDate);
                        if (parsedDate) {
                            timestamps.push(parsedDate);
                        }
                    }
                }
            });
            return timestamps;
        }

        // Custom date parser for "MM/DD/YYYY, hh:mm:ss AM/PM"
        function parseCustomDate(dateString) {
            const match = dateString.match(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+) (AM|PM)/);
            if (!match) {
                console.error(`Invalid date format: ${dateString}`);
                return null;
            }

            const [, month, day, year, hour, minute, second, period] = match;
            let hours = parseInt(hour, 10);
            if (period === 'PM' && hours !== 12) {
                hours += 12;
            } else if (period === 'AM' && hours === 12) {
                hours = 0;
            }

            return new Date(Date.UTC(year, month - 1, day, hours, minute, second));
        }

        // Populate the date selector
        function populateDateSelector() {
            const dateSelector = document.getElementById('date-selector');
            dateSelector.innerHTML = ''; // Clear existing options
            availableDates.forEach(date => {
                const option = document.createElement('option');
                option.value = date;
                option.textContent = formatDate(date);
                dateSelector.appendChild(option);
            });
        }

        // Set the initial date to the latest available date
        function setInitialDate(heartbeatTimestamps, playbackTimestamps, refreshTimestamps) {
            const latestDate = availableDates[0]; // Latest date is the first in the sorted array
            document.getElementById('date-selector').value = latestDate;
            updateChart(latestDate, heartbeatTimestamps, playbackTimestamps, refreshTimestamps);
        }

        // Update the chart with data for the selected date
        function updateChart(selectedDate, heartbeatTimestamps, playbackTimestamps, refreshTimestamps) {
            const heartbeatCounts = countEventsPerHour(heartbeatTimestamps, selectedDate);
            const playbackCounts = countEventsPerHour(playbackTimestamps, selectedDate);
            const refreshCounts = countEventsPerHour(refreshTimestamps, selectedDate);
            drawChart(selectedDate, heartbeatCounts, playbackCounts, refreshCounts);
        }

        // Count events per hour for a specific date
        function countEventsPerHour(timestamps, date) {
            const counts = Array(24).fill(0);
            timestamps.forEach(ts => {
                if (ts.toISOString().startsWith(date)) {
                    counts[ts.getUTCHours()]++;
                }
            });
            return counts;
        }

        // Draw the combined chart
        function drawChart(date, heartbeatCounts, playbackCounts, refreshCounts) {
            const ctx = document.getElementById('usageChart').getContext('2d');

            if (usageChart) {
                usageChart.destroy();
            }

            usageChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Array.from({ length: 24 }, (_, i) => `${i}:00 - ${i + 1}:00`),
                    datasets: [
                        {
                            label: `Heartbeat Events (${formatDate(date)})`,
                            data: heartbeatCounts,
                            backgroundColor: 'rgba(54, 162, 235, 0.2)',
                            borderColor: 'rgba(54, 162, 235, 1)',
                            borderWidth: 1
                        },
                        {
                            label: `Playback Events (${formatDate(date)})`,
                            data: playbackCounts,
                           backgroundColor: 'rgba(75, 192, 75, 0.2)',
                            borderColor: 'rgba(75, 192, 75, 1)',
                           
                            borderWidth: 1
                        },
                        {
                            label: `Page Refresh Events (${formatDate(date)})`,
                            data: refreshCounts,
                             backgroundColor: 'rgba(255, 99, 132, 0.2)',
                            borderColor: 'rgba(255, 99, 132, 1)',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Hours (UTC)',
                                color: 'black',
                            },
                            ticks: {
                                color: 'black',
                                font: {
                                    size: 10 // Smaller font size for X-axis labels
                                }
                            }
                        },
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Event Count',
                                color: 'black',
                            },
                            ticks: {
                                color: 'black',
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: {
                                color: 'black',
                            }
                        }
                    }
                }
            });
        }

        // Fetch and process logs on page load
        fetchAndProcessLogs();
    </script>
    <center><a href="maintenance.php" style="color:white;">Back</a></center>
</body>
</html>
