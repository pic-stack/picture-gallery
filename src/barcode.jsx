import React, { useState, useEffect } from "react";
import { BrowserMultiFormatReader } from "@zxing/library";


const BarcodeScanner = ({ onScan }) => {
    const [result, setResult] = useState(null);
    const [videoDevice, setVideoDevice] = useState(null);
    // Camera starts on automatically so scanning is the first thing the user sees.
    const [cameraOn, setCameraOn] = useState(true);

    function handleButton() {
        
        setCameraOn((on) => !on);
        if(!cameraOn){
            location.reload();
        }
    }

    // Effect #1: find a video device, but only once scanning is turned on
    useEffect(() => {
        if (!cameraOn) return;

        const reader = new BrowserMultiFormatReader();
        async function init() {
            const videoDevices = await reader.listVideoInputDevices();
            if (videoDevices.length > 0) {
                setVideoDevice(videoDevices[0]);
            }
        }

        init();
    }, [cameraOn]);

    // Effect #2: start decoding once we have a device, but only while turned on
    useEffect(() => {
        if (!cameraOn || !videoDevice) return;

        const reader = new BrowserMultiFormatReader();
        // Local flag (not React state) so it's always current, even across
        // multiple frames decoded before a re-render happens.
        let hasScanned = false;

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
        });

        // cleanup so it doesn't keep decoding after turning off / unmounting
        return () => {
            reader.reset();
        };
    }, [cameraOn, videoDevice]);

    return (
        <div className="scanner-section">
            <div className={`scanner-frame${cameraOn ? ' is-active' : ''}`}>
                {cameraOn ? (
                    <video id="video" playsInline muted autoPlay />
                ) : (
                    <div className="scanner-placeholder">Camera off</div>
                )}
                <span className="corner tl" />
                <span className="corner tr" />
                <span className="corner bl" />
                <span className="corner br" />
            </div>

            <p className="scan-status">
                {result ? (
                    <>Scanned: <strong>{result}</strong></>
                ) : cameraOn ? (
                    'Point the camera at a barcode…'
                ) : (
                    'Camera is off'
                )}
            </p>

            <button className="scan-toggle" onClick={handleButton}>
                {cameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
            </button>
        </div>
    );
};

export default BarcodeScanner;
