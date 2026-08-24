import React, { useState, useEffect } from "react";
import { BrowserMultiFormatReader } from "@zxing/library";


const BarcodeScanner = ({ onScan }) => {
    const [result, setResult] = useState(null);
    const [videoDevice, setVideoDevice] = useState(null);
    const [buttonText, setButtonText] = useState("Turn On Camera");

    function handleButton() {
        setButtonText(buttonText === "Turn On Camera" ? "Turn Off Camera" : "Turn On Camera");
    }

    // Effect #1: find a video device, but only once scanning is turned on
    useEffect(() => {
        if (buttonText !== "Turn Off Camera") return;

        const reader = new BrowserMultiFormatReader();
        async function init() {
            const videoDevices = await reader.listVideoInputDevices();
            if (videoDevices.length > 0) {
                setVideoDevice(videoDevices[0]);
            }
        }

        init();
    }, [buttonText]);

    // Effect #2: start decoding once we have a device, but only while turned on
    useEffect(() => {
        if (buttonText !== "Turn Off Camera" || !videoDevice) return;

        const reader = new BrowserMultiFormatReader();
        reader.decodeFromVideoDevice(videoDevice.deviceId, 'video', (result) => {
            if (result) {
                setResult(result.text);
                onScan?.(result.text);
                setButtonText("Turn On Camera");
            }
        });

        // cleanup so it doesn't keep decoding after turning off / unmounting
        return () => {
            reader.reset();
        };
    }, [buttonText, videoDevice]);





    return (
        <div>
            <button onClick={handleButton}>{buttonText}</button>

            {result ? (
                <p>Scanned Code: {result}</p>
            ) : (
                <p>Scanning...</p>
            )}
            <video id='video' width='600' height='400' />
        </div>
    );
};

export default BarcodeScanner;