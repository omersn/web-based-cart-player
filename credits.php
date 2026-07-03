<?php // License: PolyForm-Strict-1.0.0 (see LICENSE) ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>On-air credits</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; background-color: #fff; color: #000; margin: 0; padding: 20px; }
        .days { display: flex; justify-content: center; gap: 10px; margin-bottom: 20px; }
        .day {
            padding: 20px 0; font-size: 22px; cursor: pointer; background: #eee;
            border-radius: 10px; transition: background 0.3s; flex: 1; max-width: 80px;
        }
        .day.selected { background: blue; color: #fff; }
        #content {
            font-size: 56px; padding: 20px; border-radius: 10px; background: #eee;
            min-height: 400px; display: flex; align-items: center; justify-content: center;
            white-space: pre-line;
        }
    </style>
</head>
<body onload="setToday()">
    <div class="days">
        <div class="day" onclick="loadDay(1)">Sun</div>
        <div class="day" onclick="loadDay(2)">Mon</div>
        <div class="day" onclick="loadDay(3)">Tue</div>
        <div class="day" onclick="loadDay(4)">Wed</div>
        <div class="day" onclick="loadDay(5)">Thu</div>
        <div class="day" onclick="loadDay(6)">Fri</div>
        <div class="day" onclick="loadDay(7)">Sat</div>
    </div>
    <div id="content">Pick a day</div>

    <script>
        function loadDay(day) {
            fetch(`data/credits/day${day}.txt?t=${Date.now()}`)
                .then(response => response.text())
                .then(data => {
                    document.getElementById('content').innerText = data;
                    document.querySelectorAll('.day').forEach(el => el.classList.remove('selected'));
                    document.querySelectorAll('.day')[day - 1].classList.add('selected');
                })
                .catch(() => {
                    document.getElementById('content').innerText = 'No content available';
                });
        }

        function setToday() {
            // getDay(): Sunday = 0 ... Saturday = 6  ->  day files 1..7
            loadDay(new Date().getDay() + 1);
        }
    </script>
</body>
</html>
