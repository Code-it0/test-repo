// --------------------------------------------------
// Configuration
// --------------------------------------------------

const BACKEND_URL = "https://test-repo-hxl2.onrender.com";
const VAPID_PUBLIC_KEY =
    "BP-6bQcdt6TsbV7AHUtimGALJfanLWRNa_tQoIMUX1lv2QxG3juQ7PbS-HUf6XoU-bGN9dtAx8mXFMb5znwlUbw";

// --------------------------------------------------
// State
// --------------------------------------------------

let currentRole = "pc"; // "pc" or "phone"
let currentPairId = null;
let currentPairCode = null;
let currentSubscription = null;

// --------------------------------------------------
// DOM Elements
// --------------------------------------------------

const pcModeBtn = document.getElementById("pcModeBtn");
const phoneModeBtn = document.getElementById("phoneModeBtn");
const pcModeDiv = document.getElementById("pc-mode");
const phoneModeDiv = document.getElementById("phone-mode");
const statusText = document.getElementById("status");

// PC mode elements
const pairingNotStarted = document.getElementById("pairing-not-started");
const pairingDisplay = document.getElementById("pairing-display");
const generatePairBtn = document.getElementById("generatePairBtn");
const regenerateBtn = document.getElementById("regenerateBtn");
const pairCodeDisplay = document.getElementById("pairCode");
const qrContainer = document.getElementById("qrContainer");
const enableBtn = document.getElementById("enableBtn");
const notifyBtn = document.getElementById("notifyBtn");
const pcStatus = document.getElementById("pc-status");

// Phone mode elements
const pairingCodeInput = document.getElementById("pairingCodeInput");
const submitPairCodeBtn = document.getElementById("submitPairCodeBtn");
const scanQrBtn = document.getElementById("scanQrBtn");
const qrScannerDiv = document.getElementById("qr-scanner");
const video = document.getElementById("video");
const stopScanBtn = document.getElementById("stopScanBtn");
const phoneEnableBtn = document.getElementById("phoneEnableBtn");
const phoneStatus = document.getElementById("phone-status");

let qrScannerActive = false;
let pairStatusTimer = null;

// --------------------------------------------------
// Utility: Convert VAPID key
// --------------------------------------------------

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

// --------------------------------------------------
// Mode switching
// --------------------------------------------------

function setMode(role) {
    currentRole = role;
    if (role === "pc") {
        pcModeBtn.classList.add("active");
        phoneModeBtn.classList.remove("active");
        pcModeDiv.classList.remove("hidden");
        phoneModeDiv.classList.add("hidden");
        statusText.textContent = "PC mode - Generate a pairing code to pair with your phone.";
    } else {
        phoneModeBtn.classList.add("active");
        pcModeBtn.classList.remove("active");
        phoneModeDiv.classList.remove("hidden");
        pcModeDiv.classList.add("hidden");
        statusText.textContent = "Phone mode - Enter the pairing code from your PC.";
    }
}

pcModeBtn.addEventListener("click", () => setMode("pc"));
phoneModeBtn.addEventListener("click", () => setMode("phone"));

// --------------------------------------------------
// Service Worker Registration
// --------------------------------------------------

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
        throw new Error("Service Workers are not supported.");
    }
    const registration = await navigator.serviceWorker.register("sw.js");
    console.log("Service Worker registered:", registration);
    return registration;
}

// --------------------------------------------------
// PC Mode: Generate Pairing Code
// --------------------------------------------------

async function generatePairingCode() {
    try {
        generatePairBtn.disabled = true;
        statusText.textContent = "Generating pairing code...";

        const response = await fetch(`${BACKEND_URL}/generate-pair-code`);
        if (!response.ok) throw new Error("Failed to generate pairing code");

        const data = await response.json();
        currentPairId = data.pairId;
        currentPairCode = data.code;

        // Display pairing code
        pairCodeDisplay.textContent = currentPairCode;

        // Generate QR code. qrcodejs renders directly into the QR container.
        const qrUrl = `${window.location.origin}/?pair=${currentPairCode}`;
        if (typeof QRCode !== "undefined") {
            qrContainer.innerHTML = "";
            new QRCode(qrContainer, {
                text: qrUrl,
                width: 300,
                height: 300,
                correctLevel: QRCode.CorrectLevel.H
            });
        } else {
            console.warn("QR library did not load. The pairing code is still available above.");
        }

        // Show pairing display
        pairingNotStarted.classList.add("hidden");
        pairingDisplay.classList.remove("hidden");
        enableBtn.classList.remove("hidden");

        statusText.textContent = "✅ Pairing code generated. Show this to your phone.";
        startPairStatusPolling();
    } catch (error) {
        console.error(error);
        statusText.textContent = "❌ " + error.message;
        generatePairBtn.disabled = false;
    }
}

async function regeneratePairingCode() {
    stopPairStatusPolling();
    pairingDisplay.classList.add("hidden");
    pairingNotStarted.classList.remove("hidden");
    enableBtn.classList.add("hidden");
    currentPairId = null;
    currentPairCode = null;
    generatePairingCode();
}

function startPairStatusPolling() {
    stopPairStatusPolling();
    pollPairStatus();
    pairStatusTimer = setInterval(pollPairStatus, 3000);
}

function stopPairStatusPolling() {
    if (pairStatusTimer) {
        clearInterval(pairStatusTimer);
        pairStatusTimer = null;
    }
}

async function pollPairStatus() {
    if (!currentPairId || currentRole !== "pc") return;

    try {
        const response = await fetch(`${BACKEND_URL}/pair-status/${currentPairId}`);
        if (!response.ok) return;

        const status = await response.json();
        if (status.phoneConnected) {
            statusText.textContent = "✅ Phone paired. PC is ready to send notifications.";
            stopPairStatusPolling();
        }
    } catch (error) {
        console.warn("Could not check pair status:", error);
    }
}

generatePairBtn.addEventListener("click", generatePairingCode);
regenerateBtn.addEventListener("click", regeneratePairingCode);

// --------------------------------------------------
// Enable Notifications
// --------------------------------------------------

async function enableNotifications() {
    try {
        if (currentRole === "pc") {
            statusText.textContent = "Requesting notification permission...";
        } else {
            phoneStatus.classList.remove("hidden");
            phoneStatus.textContent = "Requesting notification permission...";
        }

        // Ask user for permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            if (currentRole === "pc") {
                statusText.textContent = "Notification permission denied.";
            } else {
                phoneStatus.textContent = "Notification permission denied.";
            }
            return;
        }

        // Register service worker
        const registration = await registerServiceWorker();

        // Check whether subscription already exists
        let subscription = await registration.pushManager.getSubscription();

        // Create subscription if necessary
        if (!subscription) {
            const appKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: appKey
            });
        }

        currentSubscription = subscription;
        console.log("Push subscription:", subscription);

        // Determine which pairId to use
        if (!currentPairId) {
            throw new Error("No pairing code. Generate or enter a pairing code first.");
        }

        // Send subscription to backend with pairId and role
        const response = await fetch(`${BACKEND_URL}/subscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                subscription: subscription,
                pairId: currentPairId,
                role: currentRole
            })
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "<no body>");
            throw new Error(`Backend rejected subscription (status ${response.status}): ${body}`);
        }

        const result = await response.json();

        if (currentRole === "pc") {
            statusText.textContent = "✅ PC notification enabled. Waiting for phone to pair...";
            enableBtn.disabled = true;
            notifyBtn.disabled = false;
        } else {
            phoneStatus.textContent = "✅ Phone paired successfully!";
            phoneEnableBtn.disabled = true;
            submitPairCodeBtn.disabled = true;
            pairingCodeInput.disabled = true;
        }
    } catch (error) {
        console.error(error);
        if (currentRole === "pc") {
            statusText.textContent = "❌ " + error.message;
        } else {
            phoneStatus.classList.remove("hidden");
            phoneStatus.textContent = "❌ " + error.message;
        }
    }
}

enableBtn.addEventListener("click", enableNotifications);
phoneEnableBtn.addEventListener("click", enableNotifications);

// --------------------------------------------------
// Send Notification (PC mode)
// --------------------------------------------------

async function sendNotification() {
    try {
        notifyBtn.disabled = true;
        statusText.textContent = "Sending notification...";

        const response = await fetch(`${BACKEND_URL}/send-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "Hello from your PC 👋",
                message: "This notification was triggered from the website.",
                pairId: currentPairId,
                targetRole: "phone"
            })
        });

        if (!response.ok) {
            throw new Error("Failed to send notification.");
        }

        const result = await response.json();
        statusText.textContent = `✅ Notification sent to ${result.sent} device(s).`;
    } catch (error) {
        console.error(error);
        statusText.textContent = "❌ " + error.message;
    } finally {
        notifyBtn.disabled = false;
    }
}

notifyBtn.addEventListener("click", sendNotification);

// --------------------------------------------------
// Phone Mode: Pairing Code Input
// --------------------------------------------------

async function submitPairingCode() {
    const code = pairingCodeInput.value.toUpperCase().trim();
    if (!code || code.length !== 6) {
        phoneStatus.classList.remove("hidden");
        phoneStatus.textContent = "❌ Please enter a valid 6-character code.";
        return;
    }

    try {
        submitPairCodeBtn.disabled = true;
        phoneStatus.classList.remove("hidden");
        phoneStatus.textContent = "Validating pairing code...";

        // Validate the code by resolving it to a pairId
        const resolveResponse = await fetch(`${BACKEND_URL}/resolve-pair-code/${code}`);
        if (!resolveResponse.ok) {
            throw new Error("Invalid or expired pairing code.");
        }

        const resolveData = await resolveResponse.json();
        currentPairId = resolveData.pairId;
        currentPairCode = code;

        // Show enable button
        phoneEnableBtn.classList.remove("hidden");
        phoneStatus.textContent = "✅ Code accepted. Click 'Enable Notifications' to pair.";
    } catch (error) {
        phoneStatus.textContent = "❌ " + error.message;
        submitPairCodeBtn.disabled = false;
    }
}

submitPairCodeBtn.addEventListener("click", submitPairingCode);

// Handle Enter key in pairing code input
pairingCodeInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        submitPairingCode();
    }
});

// --------------------------------------------------
// Phone Mode: QR Code Scanner
// --------------------------------------------------

async function startQRScanner() {
    try {
        qrScannerDiv.classList.remove("hidden");
        qrScannerActive = true;

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = stream;
        video.play();

        const canvasElement = document.createElement("canvas");
        const canvas = canvasElement.getContext("2d", { willReadFrequently: true });

        const scanQRCode = () => {
            if (!qrScannerActive) return;

            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvasElement.width = video.videoWidth;
                canvasElement.height = video.videoHeight;
                canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
                const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "dontInvert",
                });

                if (code) {
                    // Extract pair code from URL
                    try {
                        const url = new URL(code.data);
                        const pairCode = url.searchParams.get("pair");
                        if (pairCode && pairCode.length === 6) {
                            currentPairCode = pairCode.toUpperCase();
                            pairingCodeInput.value = currentPairCode;
                            stopQRScanner();
                            submitPairingCode();
                            return;
                        }
                    } catch (e) {
                        // URL parsing failed, continue scanning
                    }
                }
            }
            requestAnimationFrame(scanQRCode);
        };

        scanQRCode();
    } catch (error) {
        phoneStatus.classList.remove("hidden");
        phoneStatus.textContent = "❌ Camera access denied or unavailable.";
    }
}

function stopQRScanner() {
    qrScannerActive = false;
    qrScannerDiv.classList.add("hidden");
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
}

scanQrBtn.addEventListener("click", startQRScanner);
stopScanBtn.addEventListener("click", stopQRScanner);

// --------------------------------------------------
// Check for pairing code in URL (auto-fill phone mode)
// --------------------------------------------------

function checkURLForPairingCode() {
    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get("pair");
    if (pairCode) {
        setMode("phone");
        pairingCodeInput.value = pairCode.toUpperCase();
        phoneStatus.classList.remove("hidden");
        phoneStatus.textContent = "✅ Pairing code detected. Review and click 'Pair & Continue'.";
    }
}

// --------------------------------------------------
// Initialize
// --------------------------------------------------

setMode("pc");
checkURLForPairingCode();

