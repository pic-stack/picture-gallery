import React, { useState, useEffect } from "react";
import { BrowserMultiFormatReader } from "@zxing/library";


const BarcodeScanner = ({ onScan }) => {
    const [result, setResult] = useState(null);
    const [videoDevice, setVideoDevice] = useState(null);
    // Camera starts on automatically so scanning is the first thing the user sees.
    const [cameraOn, setCameraOn] = useState(true);
    // Bumped every time "Reset camera" is pressed. Both effects below depend on it,
    // so changing it tears the camera down and starts it again from scratch.
    const [resetKey, setResetKey] = useState(0);
    const [error, setError] = useState(null);

    // Fully restart the camera: clear the last result, drop the old device,
    // make sure the camera is on, and bump resetKey to re-run the effects.
    function handleReset() {
        setResult(null);
        setError(null);
        setVideoDevice(null);
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

    // Effect #1: find a video device, but only once scanning is turned on
    useEffect(() => {
        if (!cameraOn) return;

        // If a reset happens while we're still waiting for the device list,
        // this flag stops the old request from setting state afterwards.
        let cancelled = false;
        const reader = new BrowserMultiFormatReader();

        async function init() {
            try {
                const videoDevices = await reader.listVideoInputDevices();
                if (cancelled) return;
                if (videoDevices.length > 0) {
                    setVideoDevice(videoDevices[0]);
                } else {
                    setError('No camera found.');
                }
            } catch (err) {
                if (!cancelled) {
                    setError('Camera unavailable. Allow camera access, then tap Reset camera.');
                }
            }
        }

        init();

        return () => {
            cancelled = true;
        };
    }, [cameraOn, resetKey]);

    // Effect #2: start decoding once we have a device, but only while turned on
    useEffect(() => {
        if (!cameraOn || !videoDevice) return;

        const reader = new BrowserMultiFormatReader();
        // Local flag (not React state) so it's always current, even across
        // multiple frames decoded before a re-render happens.
        let hasScanned = false;

        Promise.resolve(
            reader.decodeFromVideoDevice(videoDevice.deviceId, 'video', (result) => {
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
            })
        ).catch(() => {
            setError('Could not start the camera. Tap Reset camera to try again.');
        });

        // cleanup so it doesn't keep decoding after turning off / unmounting
        return () => {
            reader.reset();
        };
    }, [cameraOn, videoDevice, resetKey]);

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
