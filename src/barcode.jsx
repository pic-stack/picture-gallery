import React, { useState, useEffect } from "react";
import { BrowserMultiFormatReader } from "@zxing/library";


const BarcodeScanner = ({ onScan }) => {
    const [result, setResult] = useState(null);
    // Camera starts on automatically so scanning is the first thing the user sees.
    const [cameraOn, setCameraOn] = useState(true);
    // Bumped every time "Reset camera" is pressed. The camera effect below depends on it,
    // so changing it tears the camera down and starts it again from scratch.
    const [resetKey, setResetKey] = useState(0);
    const [error, setError] = useState(null);

    // Fully restart the camera: clear the last result, make sure the camera
    // is on, and bump resetKey to re-run the camera effect from scratch.
    function handleReset() {
        setResult(null);
        setError(null);
        setCameraOn(true);
        setResetKey((k) => k + 1);
    }

    // Keyboard shortcut: pressing the backtick key ( ` , just left of the 1 key) turns
    // the camera off if it's on, and starts it fresh if it's off.
    useEffect(() => {
        function onKeyDown(e) {
            // e.code is the physical key, so this works on any keyboard layout.
            if (e.code !== 'Backslash') return;
            // Leave combos like Cmd+` (Mac window switching) and held-down keys alone.
            if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
            // Don't trigger while the user is typing in a field.
            const t = e.target;
            if (
                t instanceof HTMLElement &&
                (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            ) {
                return;
            }

            if (cameraOn) {
                setCameraOn(false);
            } else {
                handleReset();
            }
        }

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [cameraOn]);

    // Camera effect: start the BACK camera and decode, only while turned on
    useEffect(() => {
        if (!cameraOn) return;

        const reader = new BrowserMultiFormatReader();
        // Local flag (not React state) so it's always current, even across
        // multiple frames decoded before a re-render happens.
        let hasScanned = false;
        // If this effect is cleaned up while the camera is still starting, this lets us
        // shut the camera down when it finishes starting instead of leaving it running.
        let cancelled = false;

        function onDecode(result) {
            if (result && !hasScanned) {
                hasScanned = true;
                // Stop decoding immediately — don't wait for React state
                // updates / effect cleanup, which can lag a frame or two
                // behind and let the same barcode fire onScan repeatedly.
                reader.reset();

                setResult(result.text);
                onScan?.(result.text);
                setCameraOn(false);
            }
        }

        // Ask for the back ("environment") camera. "ideal" rather than "exact" means a
        // laptop with only a front webcam still works instead of failing to start.
        const constraints = { video: { facingMode: { ideal: 'environment' } } };

        Promise.resolve(
            typeof reader.decodeFromConstraints === 'function'
                ? reader.decodeFromConstraints(constraints, 'video', onDecode)
                : reader.decodeFromVideoDevice(null, 'video', onDecode) // null = back camera
        )
            .then(() => {
                if (cancelled) reader.reset();
            })
            .catch((err) => {
                if (cancelled) return;
                if (err && err.name === 'NotAllowedError') {
                    setError('Camera access was blocked. Allow it, then tap Reset camera.');
                } else if (err && err.name === 'NotFoundError') {
                    setError('No camera found.');
                } else {
                    setError('Could not start the camera. Tap Reset camera to try again.');
                }
            });

        // cleanup so it doesn't keep decoding after turning off / unmounting
        return () => {
            cancelled = true;
            reader.reset();
        };
    }, [cameraOn, resetKey]);

    return (
        <div className="scanner-section">
            <div className={`scanner-frame${cameraOn ? ' is-active' : ''}`}>
                {cameraOn ? (
                    // key={resetKey} makes React build a brand-new <video> element on every
                    // reset, which clears any frozen or glitchy video stream.
                    <video key={resetKey} id="video" playsInline muted autoPlay />
                ) : (
                    <div className="scanner-placeholder">Camera off</div>
                )}
                <span className="corner tl" />
                <span className="corner tr" />
                <span className="corner bl" />
                <span className="corner br" />
            </div>

            <p className="scan-status">
                {error ? (
                    error
                ) : result ? (
                    <>Scanned: <strong>{result}</strong></>
                ) : cameraOn ? (
                    'Point the camera at a barcode…'
                ) : (
                    'Camera is off'
                )}
            </p>

            <button className="scan-toggle" onClick={handleReset}>
                Reset camera
            </button>
        </div>
    );
};

export default BarcodeScanner;
