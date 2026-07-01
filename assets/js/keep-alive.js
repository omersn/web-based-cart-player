// SPDX-License-Identifier: AGPL-3.0-or-later
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

    audio.volume = 0.01; // 1% — effectively inaudible, but enough to keep the device awake.

    // Force a style reflow so indicator class changes are applied immediately.
    const forceDOMUpdate = (element) => {
        const display = element.style.display;
        element.style.display = 'none';
        void element.offsetHeight;
        element.style.display = display;
    };

    // Tell the parent page (the Connected/Standby pill in the top bar) about
    // our online/offline state. Harmless if nobody is listening (e.g. when
    // this page is opened standalone).
    const notifyParent = (patch) => {
        try {
            window.parent.postMessage({ source: 'keep-alive', ...patch }, '*');
        } catch (e) { /* no parent window — ignore */ }
    };

    const setIndicatorGreen = () => {
        indicator.classList.remove('offline', 'yellow');
        indicator.classList.add('blinking');
        forceDOMUpdate(indicator);
    };

    const setIndicatorOffline = () => {
        indicator.classList.remove('blinking', 'yellow');
        indicator.classList.add('offline');
        forceDOMUpdate(indicator);
    };

    // ---- Connection monitor -------------------------------------------------
    // Ping the server directly (a HEAD request is almost free) so the "Connected"
    // pill reflects real server reachability, not just the browser's onLine guess.
    // Runs more often than the 30s audio heartbeat so "we're up" stays current.
    const pingServer = () => {
        if (!navigator.onLine) {
            setIndicatorOffline();
            notifyParent({ connection: 'offline' });
            return;
        }
        fetch(`keep-alive.php?ping=${Date.now()}`, { method: 'HEAD', cache: 'no-store' })
            .then(() => {
                setIndicatorGreen();
                notifyParent({ connection: 'online' });
            })
            .catch(() => {
                setIndicatorOffline();
                notifyParent({ connection: 'offline' });
            });
    };

    // Report an audio heartbeat (or failure) to the server log.
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
        }).catch(() => {});
    };

    // ---- Audio keep-alive ---------------------------------------------------
    // Play the near-silent clip to keep the output device warm. Success means the
    // audio subsystem is on standby and ready ("AUDIO STBY"); a failure — usually
    // the autoplay gate before any user gesture — reports "AUDIO OFF".
    const playKeepAliveAudio = () => {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    logEvent('Keep-alive heartbeat succeeded.');
                    notifyParent({ audio: 'active' });
                })
                .catch((err) => {
                    logEvent(`Heartbeat failed: ${err.message}`, true);
                    notifyParent({ audio: 'idle' });
                });
        } else {
            logEvent('Audio playback not supported or interrupted.', true);
            notifyParent({ audio: 'idle' });
        }
    };

    window.addEventListener('online', pingServer);
    window.addEventListener('offline', pingServer);

    // The parent posts this right after the user's first gesture (the START
    // button), so the audio heartbeat can start immediately instead of being
    // blocked by the autoplay gate until the next 30s beat.
    window.addEventListener('message', (event) => {
        if (event.data && event.data.cmd === 'keepalive-play') playKeepAliveAudio();
    });

    setInterval(pingServer, 10000);         // 10-second connection ping
    setInterval(playKeepAliveAudio, 30000); // 30-second audio heartbeat
    pingServer();
    playKeepAliveAudio();
});
