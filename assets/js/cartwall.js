/*
 * Cart wall — load mechanism & playback
 * =====================================
 * This is the heart of the player. It reads the cart list, builds the grid of
 * buttons, and works around a handful of browser audio quirks so that the very
 * first click on a freshly loaded jingle plays instantly and cleanly.
 *
 * The "preload hack" (see preloadHack below)
 * ------------------------------------------
 * <audio> elements do not actually decode/buffer their data until something
 * forces them to. The first play() therefore often has audible latency or a
 * clipped attack — fatal for on-air jingles. To prime each clip we play it once
 * muted (volume 0) and immediately pause it, at a small staggered delay so the
 * browser is not asked to decode 25 files at the same instant. If a clip is not
 * ready yet we retry a few times with a growing delay. After this priming pass,
 * the first real click is instant.
 *
 * Other pieces:
 *  - A per-button WebAudio AnalyserNode draws a tiny level meter on a canvas.
 *  - Chaining (data/cross.txt): a "chained" button auto-clicks the next one when
 *    it finishes, so several carts play back-to-back as one sequence.
 *  - A large "back-timer" overlay shows the remaining time of the current item
 *    (or the whole chained sequence).
 *  - Right-click a cart to schedule it to fire at the top of the next hour.
 *  - Every play/stop is POSTed back to the page for the playback log.
 *
 * Config is injected by grid.php via window.CARTWALL_CONFIG.
 */
(() => {
    const CONFIG = window.CARTWALL_CONFIG || { dataUrl: 'data', itemsPerPage: 25 };
    const DATA_URL = CONFIG.dataUrl;
    const itemsPerPage = CONFIG.itemsPerPage;

    const colorMapping = {
        '1': '#007bff',
        '2': '#4dbf49',
        '3': '#d15ccf',
        '4': '#d19724',
        '5': '#5eccd6',
    };

    const urlParams = new URLSearchParams(window.location.search);

    // Cache-busted data URLs.
    const fileUrl = `${DATA_URL}/carts.txt?v=${Date.now()}`;
    const pageNamesUrl = `${DATA_URL}/page_names.txt?v=${Date.now()}`;
    const crossFileUrl = `${DATA_URL}/cross.txt?v=${Date.now()}`;

    // Columns come from ?line (defaults to 5).
    const columns = parseInt(urlParams.get('line'), 10) || 5;
    document.documentElement.style.setProperty('--columns', columns);

    // Log a page refresh.
    window.addEventListener('load', () => {
        fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - page refreshed` });
    });

    // Reveal the back-timer overlay a few seconds after load.
    window.addEventListener('load', () => {
        setTimeout(() => {
            const backtimer = document.getElementById('backtimer');
            if (backtimer) backtimer.style.top = '-60px';
            logToPanel('[INFO] Back-timer ready');
        }, 6000);
    });

    function logToPanel(message) {
        const panel = document.getElementById('messagelog');
        if (panel) panel.innerHTML += `<br>${message}`;
    }

    // cross.txt -> which boxes (within the current from/to range) auto-chain.
    let specialBoxes = [];
    async function loadCrossFile() {
        try {
            const response = await fetch(crossFileUrl);
            if (!response.ok) throw new Error(`Failed to fetch cross.txt: ${response.status}`);
            const text = await response.text();

            const from = parseInt(urlParams.get('from'), 10) || 0;
            const to = parseInt(urlParams.get('to'), 10) || 100;

            specialBoxes = text
                .split(/\n/)
                .map((line, index) => {
                    const [flag, seconds] = line.split('|').map(part => part.trim());
                    if (index < from || index > to) return null;
                    return {
                        boxNumber: index - from + 1,
                        flag: parseInt(flag, 10),
                        seconds: parseFloat(seconds) || 0,
                    };
                })
                .filter(box => box !== null && !isNaN(box.flag));
        } catch (error) {
            console.error(`Error fetching cross.txt: ${error.message}`);
        }
    }

    async function loadCartwall() {
        const from = parseInt(urlParams.get('from'), 10) || 0;
        const to = parseInt(urlParams.get('to'), 10) || Infinity;

        try {
            await loadCrossFile();

            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
            const cartLines = (await response.text()).split('\n').filter(line => line.trim() !== '');
            const filteredCartLines = cartLines.slice(from, to);

            const totalPages = Math.ceil(filteredCartLines.length / itemsPerPage);
            const cartwall = document.getElementById('cartwall');
            const pagination = document.getElementById('pagination');

            // Page names sliced to the visible range.
            let pageNames = [];
            try {
                const namesText = await (await fetch(pageNamesUrl)).text();
                if (namesText) {
                    const all = namesText.split('\n').map(n => n.trim()).filter(n => n !== '');
                    const startIndex = Math.floor((from || 0) / itemsPerPage);
                    const endIndex = Math.ceil((to || filteredCartLines.length) / itemsPerPage);
                    pageNames = all.slice(startIndex, endIndex);
                }
            } catch (error) {
                console.error('Error fetching page names:', error);
            }

            cartwall.innerHTML = '';
            pagination.innerHTML = '';

            for (let i = 0; i < totalPages; i++) {
                const pageDiv = document.createElement('div');
                pageDiv.classList.add('page');
                if (i === 0) pageDiv.classList.add('active');

                filteredCartLines.slice(i * itemsPerPage, (i + 1) * itemsPerPage).forEach((line, index) => {
                    // Stagger button creation slightly to spread out audio decoding.
                    setTimeout(() => buildButton(line, i, index, pageDiv), index * 25);
                });

                cartwall.appendChild(pageDiv);

                const pageButton = document.createElement('button');
                pageButton.textContent = pageNames[i] || `Page ${i + 1}`;
                if (i === 0) pageButton.classList.add('active');
                pageButton.onclick = () => {
                    document.querySelectorAll('.page').forEach((div, idx) => div.classList.toggle('active', idx === i));
                    document.querySelectorAll('.pagination button').forEach((btn, idx) => btn.classList.toggle('active', idx === i));
                };
                pagination.appendChild(pageButton);
            }
        } catch (error) {
            console.error(`Error loading cartwall: ${error.message}`);
        }
    }

    function buildButton(line, pageIndex, index, pageDiv) {
        const boxNumber = pageIndex * itemsPerPage + index + 1;
        const isChained = specialBoxes.some(box => box.boxNumber === boxNumber && box.flag === 1);
        const buttonClass = isChained ? 'buttonext' : 'button';

        const [name, audioPath, startPoint, colorCode, endPoint] = line.split('|').map(part => part.trim());
        const startAt = parseFloat(startPoint) || 0;
        const endAt = parseFloat(endPoint) || null;
        const buttonColor = colorMapping[colorCode] || '#007bff';

        const button = document.createElement('button');
        button.classList.add(buttonClass);
        button.classList.add('button');
        button.style.backgroundColor = buttonColor;

        const progress = document.createElement('div');
        progress.classList.add('progress');

        const span = document.createElement('span');
        span.textContent = name;

        const duration = document.createElement('div');
        duration.classList.add('duration');
        duration.textContent = 'Loading...';

        const audioFilename = audioPath.trim();

        if (audioFilename === '0.mp3') {
            // Empty placeholder slot.
            button.disabled = true;
            button.classList.add('disabled');
            button.style.backgroundColor = '#1c1c1c';
            button.style.color = '#1c1c1c';
            duration.textContent = ' ';
            button.appendChild(span);
            button.appendChild(duration);
            pageDiv.appendChild(button);
            return;
        }

        const audio = new Audio(`uploads/${audioFilename}`);
        button._audio = audio;

        // --- The preload hack: prime each clip so its first real play is instant.
        audio.addEventListener('canplaythrough', () => {
            if (audio._preloadCompleted) return;

            let attempts = 0;
            const maxAttempts = 5;

            const preloadHack = async () => {
                try {
                    if (audioContext.state === 'suspended') {
                        await audioContext.resume();
                    }

                    audio.currentTime = startAt;
                    audio.volume = 0; // muted while priming

                    let playbackStarted = false;
                    const onPlaying = () => {
                        playbackStarted = true;
                        audio.removeEventListener('playing', onPlaying);
                    };
                    audio.addEventListener('playing', onPlaying);

                    await audio.play();

                    setTimeout(() => {
                        if (!playbackStarted) {
                            // Did not actually start — reset and retry with a growing delay.
                            audio.currentTime = 0;
                            audio._preloadCompleted = false;
                            attempts++;
                            if (attempts < maxAttempts) {
                                setTimeout(preloadHack, 10 * attempts);
                            } else {
                                logToPanel(`[WARN] Skipped '${name}' after ${maxAttempts} attempts.`);
                            }
                            return;
                        }
                        if (audio.paused) return;

                        audio.pause();
                        audio.currentTime = startAt;
                        audio._preloadCompleted = true;
                        logToPanel(`[INFO] Successfully primed '${name}'`);
                        audio.volume = 1.0;
                    }, 100);
                } catch (error) {
                    if (attempts < maxAttempts) {
                        attempts++;
                        setTimeout(preloadHack, 10 * attempts);
                    } else {
                        logToPanel(`[ERROR] Priming failed for '${name}': ${error.message}`);
                    }
                } finally {
                    const backtimer = document.getElementById('backtimer');
                    if (backtimer) backtimer.style.display = 'none';
                }
            };

            setTimeout(preloadHack, index * 25); // staggered per button
        });

        audio.addEventListener('error', (e) => console.error(`[ERROR] Failed to load audio '${audioFilename}':`, e));
        audio.load();
        logToPanel(`[INFO] Audio file '${audioFilename}' loaded: ${name}`);

        // --- Per-button level meter (WebAudio analyser drawn on a canvas).
        const levelMeterCanvas = document.createElement('canvas');
        levelMeterCanvas.classList.add('levelMeter');
        levelMeterCanvas.width = 50;
        levelMeterCanvas.height = 10;

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        const ctx = levelMeterCanvas.getContext('2d');

        function drawLevelMeter() {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            ctx.clearRect(0, 0, levelMeterCanvas.width, levelMeterCanvas.height);
            ctx.fillStyle = '#00FF00';
            ctx.fillRect(0, 0, (average / 255) * levelMeterCanvas.width, levelMeterCanvas.height);
            requestAnimationFrame(drawLevelMeter);
        }

        audio.addEventListener('loadedmetadata', () => {
            const trimmed = audio.duration - startAt;
            duration.textContent = `${Math.floor(trimmed / 60)}:${Math.floor(trimmed % 60).toString().padStart(2, '0')}`;
        });

        const backtimer = () => document.getElementById('backtimer');

        audio.addEventListener('play', () => {
            duration.style.backgroundColor = 'black';
            duration.style.color = 'white';
            duration.style.fontWeight = 'bold';
            duration.style.padding = '0 8px';
            backtimer().style.display = 'flex';

            audioContext.resume();
            levelMeterCanvas.style.display = 'block';
            drawLevelMeter();
            progress.style.display = 'block';
            fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - ${name} - played` });

            audio.addEventListener('timeupdate', () => {
                const remainingTime = audio.duration - audio.currentTime;
                progress.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
                const minutes = Math.floor(remainingTime / 60);
                const seconds = Math.floor(remainingTime % 60).toString().padStart(2, '0');
                duration.textContent = `${minutes}:${seconds}`;
                duration.classList.add('active');

                updateBackTimer(button, boxNumber, audio, minutes, seconds);
            });
        });

        audio.addEventListener('pause', () => {
            backtimer().innerHTML = ' ';
            duration.style.backgroundColor = 'transparent';
            duration.style.color = 'white';
            duration.style.fontWeight = 'normal';
            duration.style.padding = '0';
            audio.currentTime = startAt;
            progress.style.width = '0';
            progress.style.display = 'none';
            levelMeterCanvas.style.display = 'none';
            ctx.clearRect(0, 0, levelMeterCanvas.width, levelMeterCanvas.height);
            const trimmed = audio.duration - startAt;
            duration.textContent = `${Math.floor(trimmed / 60)}:${Math.floor(trimmed % 60).toString().padStart(2, '0')}`;
            duration.classList.remove('active');
            fetch('', { method: 'POST', body: `${new Date().toLocaleString()} - ${name} - stopped` });
            backtimer().style.display = 'none';
        });

        audio.addEventListener('ended', () => {
            backtimer().innerHTML = ' ';
            progress.style.width = '0';
            progress.style.display = 'none';
            levelMeterCanvas.style.display = 'none';
            ctx.clearRect(0, 0, levelMeterCanvas.width, levelMeterCanvas.height);
            const trimmed = audio.duration - startAt;
            duration.textContent = `${Math.floor(trimmed / 60)}:${Math.floor(trimmed % 60).toString().padStart(2, '0')}`;
            duration.classList.remove('active');
            button.style.backgroundColor = colorMapping[colorCode];
            backtimer().style.display = 'none';

            // Chain: auto-play the next button.
            if (button.classList.contains('buttonext')) {
                const nextButton = button.nextElementSibling;
                if (nextButton && nextButton.tagName === 'BUTTON') nextButton.click();
            }
        });

        let playbackTimer = null;
        button.onclick = () => {
            const playDuration = endAt - startAt;

            if (audio.paused) {
                audio.currentTime = startAt;
                audio.play();
                button.classList.add('playing');
                button.style.backgroundColor = 'red';

                if (playbackTimer) clearTimeout(playbackTimer);

                // Hard stop at the end point, then chain if applicable.
                playbackTimer = setTimeout(() => {
                    audio.pause();
                    button.classList.remove('playing');
                    button.style.backgroundColor = buttonColor;
                    if (button.classList.contains('buttonext')) {
                        const nextButton = button.nextElementSibling;
                        if (nextButton && nextButton.tagName === 'BUTTON') nextButton.click();
                    }
                }, playDuration * 1000);
            } else {
                audio.pause();
                button.classList.remove('playing');
                button.style.backgroundColor = buttonColor;
                if (playbackTimer) {
                    clearTimeout(playbackTimer);
                    playbackTimer = null;
                }
            }
        };

        button.appendChild(progress);
        button.appendChild(levelMeterCanvas);
        button.appendChild(span);
        button.appendChild(duration);
        pageDiv.appendChild(button);
    }

    // Back-timer: show remaining time of this item, or the whole chained run.
    function updateBackTimer(button, boxNumber, audio, minutes, seconds) {
        const backtimer = document.getElementById('backtimer');
        const isChained = specialBoxes.some(box => box.boxNumber === boxNumber && box.flag === 1);

        if (!isChained) {
            backtimer.innerHTML = `${minutes}:${seconds}`;
            return;
        }

        const remainingTime = audio.duration - audio.currentTime;
        if (audio.currentTime <= 0.5 || remainingTime <= 0.5) {
            backtimer.innerHTML = ' ';
            return;
        }

        let totalTime = remainingTime;
        let addedUnchained = false;
        let nextButton = button.nextElementSibling;
        while (nextButton) {
            const isNextChained = nextButton.classList.contains('buttonext');
            const durationElement = nextButton.querySelector('.duration');
            if (durationElement) {
                const [m, s] = durationElement.textContent.split(':').map(part => parseInt(part, 10));
                const nextDuration = (m * 60 + s) || 0;
                if (isNextChained || !addedUnchained) {
                    totalTime += nextDuration;
                    if (!isNextChained) addedUnchained = true;
                }
            }
            if (!isNextChained && addedUnchained) break;
            nextButton = nextButton.nextElementSibling;
        }

        const totalMinutes = Math.floor(totalTime / 60);
        const totalSeconds = Math.floor(totalTime % 60).toString().padStart(2, '0');
        backtimer.innerHTML = `${totalMinutes}:${totalSeconds}`;
    }

    // Right-click context menu: schedule a cart to fire at the top of the hour.
    function initContextMenu() {
        const contextMenu = document.getElementById('context-menu');
        const playAtButton = document.getElementById('play-at-button');
        if (!contextMenu || !playAtButton) return;

        let selectedButton = null;
        let timerActiveButton = null;
        const activeTimers = new Map();
        const countdownIntervals = new Map();

        const formatTime = (ms) => {
            const total = Math.floor(ms / 1000);
            return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
        };

        document.addEventListener('contextmenu', (event) => {
            const button = event.target.closest('.button, .buttonext');
            if (!button) {
                contextMenu.style.display = 'none';
                return;
            }
            event.preventDefault();
            selectedButton = button;

            if (timerActiveButton && timerActiveButton !== button) {
                playAtButton.disabled = true;
                playAtButton.style.opacity = 0.5;
                playAtButton.textContent = 'Another timer is active';
            } else {
                playAtButton.disabled = false;
                playAtButton.style.opacity = 1;
                const nextHour = (new Date().getHours() + 1) % 24;
                playAtButton.textContent = `Play automatically at ${nextHour.toString().padStart(2, '0')}:00`;
            }

            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.top = `${event.pageY}px`;
            contextMenu.style.display = 'block';

            if (activeTimers.has(button)) {
                playAtButton.disabled = true;
                playAtButton.style.opacity = 0.5;
                playAtButton.textContent = 'Timer active';
            }

            document.addEventListener('click', () => { contextMenu.style.display = 'none'; }, { once: true });
        });

        playAtButton.addEventListener('click', () => {
            if (!selectedButton || playAtButton.disabled) return;

            const now = new Date();
            const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
            const delay = nextHour - now;

            const timerButton = selectedButton;
            const timer = setTimeout(() => {
                timerButton.click();
                activeTimers.delete(timerButton);
                timerActiveButton = null;
                const icon = timerButton.querySelector('.clock-icon');
                if (icon) icon.style.display = 'none';
            }, delay);

            activeTimers.set(timerButton, timer);
            timerActiveButton = timerButton;

            let clockIcon = timerButton.querySelector('.clock-icon');
            if (!clockIcon) {
                clockIcon = document.createElement('div');
                clockIcon.classList.add('clock-icon');
                clockIcon.style.display = 'flex';
                clockIcon.innerHTML = `
                    <span class="emoji" style="animation: blink 0.5s step-start infinite;">🕒</span>
                    <span class="countdown" style="color: red;">${formatTime(delay)} -</span>`;
                timerButton.appendChild(clockIcon);

                const interval = setInterval(() => {
                    const remaining = nextHour - new Date();
                    if (remaining <= 0) {
                        clearInterval(interval);
                        countdownIntervals.delete(timerButton);
                    } else {
                        clockIcon.querySelector('.countdown').textContent = `${formatTime(remaining)} -`;
                    }
                }, 1000);
                countdownIntervals.set(timerButton, interval);
            }

            contextMenu.style.display = 'none';
        });

        document.addEventListener('click', () => { contextMenu.style.display = 'none'; });
    }

    document.addEventListener('DOMContentLoaded', initContextMenu);
    loadCartwall();
})();
