<?php // SPDX-License-Identifier: AGPL-3.0-or-later ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hourly Countdown</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700&family=Assistant:wght@700&display=swap" rel="stylesheet">
    <style>
        body {
            background-color: #0a0c10;
            margin: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: 'Assistant', Arial, sans-serif;
            color: #ff5b54;
        }

        .title {
            font-size: 6vmin;
            font-weight: bold;
            margin: 0;
            color: #9aa4b2;
        }

        .countdown {
            font-family: 'JetBrains Mono', monospace;
            font-size: 10vmin; /* Larger countdown */
            font-weight: bold;
            margin: 0;
        }

        .progress-container {
            position: relative;
            width: 80%; /* Responsive width for progress bar */
            height: 2vmin; /* Height of the progress bar */
            background-color: rgba(255, 255, 255, 0.07); /* Faint inactive bar */
            margin: 2vmin 0;
            border-radius: 1vmin;
        }

        .progress-bar {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background-color: #f0453f;
            border-radius: 1vmin;
            width: 0%; /* Dynamic width for progress */
            transition: width 0.1s linear; /* Smooth animation */
        }

        .seconds-dots {
            display: flex;
            justify-content: space-between;
            width: 80%; /* Same width as the progress bar */
            margin-top: 1vmin;
        }

        .seconds-dots .dot {
            width: 0.5vmin; /* Small dot size */
            height: 0.5vmin;
            background-color: #330000; /* Very dark red for inactive dots */
            border-radius: 50%;
        }

        .seconds-dots .dot.active {
            background-color: red; /* Bright red for active seconds dots */
        }
    </style>
</head>
<body>
    <div class="title">Time to end of hour</div>
    <div class="countdown" id="countdown">-00:00</div>

    <!-- Progress bar container -->
    <div class="progress-container">
        <div class="progress-bar" id="progress-bar"></div>
    </div>

    <!-- Small dots for seconds -->
    <div class="seconds-dots" id="seconds-dots">
        <!-- Dots will be dynamically added here -->
    </div>

    <script>
        const countdownDisplay = document.getElementById("countdown");
        const progressBar = document.getElementById("progress-bar");
        const secondsDotsContainer = document.getElementById("seconds-dots");
        const totalSecondsInAnHour = 3600; // Total seconds in an hour

        // Create 60 smaller dots for seconds
        for (let i = 0; i < 60; i++) {
            const dot = document.createElement("div");
            dot.classList.add("dot");
            secondsDotsContainer.appendChild(dot);
        }
        const dots = document.querySelectorAll(".seconds-dots .dot");

        function updateClock() {
            const now = new Date();

            // Countdown to the end of the hour
            const secondsElapsed = now.getMinutes() * 60 + now.getSeconds();
            const secondsRemaining = totalSecondsInAnHour - secondsElapsed;
            const countdownMinutes = Math.floor(secondsRemaining / 60).toString().padStart(2, "0");
            const countdownSeconds = (secondsRemaining % 60).toString().padStart(2, "0");
            countdownDisplay.textContent = `-${countdownMinutes}:${countdownSeconds}`;

            // Update progress bar
            const percentageElapsed = (secondsElapsed / totalSecondsInAnHour) * 100;
            progressBar.style.width = `${percentageElapsed}%`;

            // Update small seconds dots
            dots.forEach((dot, index) => {
                if (index <= now.getSeconds()) {
                    dot.classList.add("active");
                } else {
                    dot.classList.remove("active");
                }
            });
        }

        // Start the clock
        setInterval(updateClock, 1000);
        updateClock(); // Initialize the display
    </script>
</body>
</html>
