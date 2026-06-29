<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Broadcast Clock</title>
    <style>
        body {
            background-color: black;
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: Arial, sans-serif;
        }

        .clock-container {
            position: relative;
            width: 100vmin; /* Responsive size */
            height: 100vmin;
        }

        .dot {
            position: absolute;
            width: 1.5%; /* Dot size scales with container */
            height: 1.5%;
            background-color: #330000; /* Very dark red for inactive dots */
            border-radius: 50%;
            transform: translate(-50%, -50%);
        }

        .dot.green {
            background-color: green;
        }

        .dot.active {
            background-color: red; /* Bright red for active seconds dots */
        }

        .center-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: red;
        }

        .center-text .time {
            font-size: 10vmin; /* Scales with the container */
            font-weight: bold;
            margin: 0;
        }

        .center-text .seconds {
            font-size: 5vmin; /* Scales with the container */
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="clock-container" id="clock">
        <div class="center-text">
            <div class="time" id="time">00:00</div>
            <div class="seconds" id="seconds">00</div>
        </div>
    </div>

    <script>
        const container = document.getElementById("clock");
        const timeDisplay = document.getElementById("time");
        const secondsDisplay = document.getElementById("seconds");
        const totalDots = 60; // 60 dots for the seconds
        const greenDots = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]; // Positions for green dots

        // Create dots around the clock
        for (let i = 0; i < totalDots; i++) {
            const dot = document.createElement("div");
            dot.classList.add("dot");

            // Add green dots at 5-minute marks
            if (greenDots.includes(i)) {
                dot.classList.add("green");
            }

            container.appendChild(dot);

            // Position dots in a circular pattern
            const angle = ((i / totalDots) * 360) - 90; // Offset by -90 degrees (clockwise)
            const radius = 40; // Percentage distance from the center
            const radians = (angle * Math.PI) / 180; // Convert degrees to radians
            const x = 50 + Math.cos(radians) * radius; // Calculate X position (center is 50%)
            const y = 50 + Math.sin(radians) * radius; // Calculate Y position (center is 50%)

            dot.style.left = `${x}%`;
            dot.style.top = `${y}%`;
        }

        const dots = document.querySelectorAll(".dot");

        function updateClock() {
            const now = new Date();

            // Update center time display
            const hours = now.getHours().toString().padStart(2, "0");
            const minutes = now.getMinutes().toString().padStart(2, "0");
            const seconds = now.getSeconds().toString().padStart(2, "0");

            timeDisplay.textContent = `${hours}:${minutes}`;
            secondsDisplay.textContent = seconds;

            // Update red dots for seconds hand
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
