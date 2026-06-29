/*
 * Keep-alive heartbeat
 * --------------------
 * Radio playout machines often leave the cart player open and idle for long
 * stretches. Browsers (and the OS audio stack) will let the audio output go to
 * sleep after a while, which adds a noticeable delay — or a clipped first few
 * milliseconds — the next time a jingle is fired. That is unacceptable on air.
 *
 * To avoid it, this script plays a near-silent clip (uploads/00.mp3) at 1%
 * volume on a fixed interval. That keeps the audio device "warm" so the first
 * real jingle after an idle period plays instantly. It doubles as a connection
 * monitor: each beat is logged server-side, and a colour-coded dot shows the
 * current online/offline state.
 *
 * NOTE: the interval below is 30 seconds. (The original code carried a comment
 * claiming "3 minutes"; that was never true — the value has always been 30s.)
 */
document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('keep-alive-audio');
    const indicator = document.getElementById('keep-alive-indicator');

    let wasOnline = navigator.onLine;
    audio.volume = 0.01; // 1% — effectively inaudible, but enough to keep the device awake.

    // Force a style reflow so indicator class changes are applied immediately.
    const forceDOMUpdate = (element) => {
        const display = element.style.display;
        element.style.display = 'none';
        void element.offsetHeight;
        element.style.display = display;
    };

    const setIndicatorGreen = () => {
        if (!navigator.onLine) {
            return; // never show green while offline
        }
        indicator.classList.remove('offline', 'yellow');
        indicator.classList.add('blinking');
        forceDOMUpdate(indicator);
    };

    const setIndicatorOffline = () => {
        indicator.classList.remove('blinking', 'yellow');
        indicator.classList.add('offline');
        forceDOMUpdate(indicator);
    };

    // Report each beat (or failure) to the server log.
    const logEvent = (message, isError = false) => {
        if (!navigator.onLine) {
            return;
        }
        fetch('log-keep-alive.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'keep-alive',
                message,
                isError,
                timestamp: new Date().toISOString(),
            }),
        }).catch(() => setIndicatorOffline());
    };

    // The actual heartbeat: try to play the silent clip.
    const playKeepAliveAudio = () => {
        if (!navigator.onLine) {
            setIndicatorOffline();
            logEvent('Skipped playback: offline.', true);
            return;
        }

        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    logEvent('Keep-alive heartbeat succeeded.');
                    setIndicatorGreen();
                })
                .catch((err) => {
                    // Browsers block audio until the user has interacted with the
                    // page once; that is the usual cause of a failed early beat.
                    logEvent(`Heartbeat failed: ${err.message}`, true);
                    setIndicatorOffline();
                });
        } else {
            logEvent('Audio playback not supported or interrupted.', true);
            setIndicatorOffline();
        }
    };

    const updateNetworkStatus = () => {
        if (navigator.onLine && !wasOnline) {
            logEvent('Reconnected to the network.');
            setIndicatorGreen();
        } else if (!navigator.onLine && wasOnline) {
            logEvent('Disconnected from the network.', true);
            setIndicatorOffline();
        }
        wasOnline = navigator.onLine;
    };

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    setInterval(playKeepAliveAudio, 30000); // 30-second heartbeat
    updateNetworkStatus();
});
