const enableBtn = document.getElementById("enableBtn");
const notifyBtn = document.getElementById("notifyBtn");
const statusText = document.getElementById("status");

// --------------------------------------------------
// YOUR BACKEND URLS
// --------------------------------------------------

const BACKEND_URL = "https://test-repo-hxl2.onrender.com";

// Your public VAPID key from the backend
const VAPID_PUBLIC_KEY =
    "YOUR_PUBLIC_VAPID_KEY_HERE";


// --------------------------------------------------
// Convert VAPID key
// --------------------------------------------------

function urlBase64ToUint8Array(base64String) {

    const padding = "=".repeat(
        (4 - base64String.length % 4) % 4
    );

    const base64 = (
        base64String +
        padding
    )
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const rawData = window.atob(base64);

    return Uint8Array.from(
        [...rawData].map(char => char.charCodeAt(0))
    );
}


// --------------------------------------------------
// Register Service Worker
// --------------------------------------------------

async function registerServiceWorker() {

    if (!("serviceWorker" in navigator)) {
        throw new Error(
            "Service Workers are not supported."
        );
    }

    const registration =
        await navigator.serviceWorker.register("/sw.js");

    console.log(
        "Service Worker registered:",
        registration
    );

    return registration;
}


// --------------------------------------------------
// Enable notifications
// --------------------------------------------------

async function enableNotifications() {

    try {

        statusText.textContent =
            "Requesting notification permission...";

        // Ask user for permission
        const permission =
            await Notification.requestPermission();

        if (permission !== "granted") {

            statusText.textContent =
                "Notification permission denied.";

            return;
        }


        // Register service worker
        const registration =
            await registerServiceWorker();


        // Check whether subscription already exists
        let subscription =
            await registration.pushManager.getSubscription();


        // Create subscription if necessary
        if (!subscription) {

            subscription =
                await registration.pushManager.subscribe({

                    userVisibleOnly: true,

                    applicationServerKey:
                        urlBase64ToUint8Array(
                            VAPID_PUBLIC_KEY
                        )
                });
        }


        console.log(
            "Push subscription:",
            subscription
        );


        // Send subscription to backend
        const response =
            await fetch(
                `${BACKEND_URL}/subscribe`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        subscription:
                            subscription
                    })
                }
            );


        if (!response.ok) {
            throw new Error(
                "Backend rejected subscription."
            );
        }


        statusText.textContent =
            "✅ Phone notification enabled.";

        notifyBtn.disabled = false;

        enableBtn.disabled = true;


    } catch (error) {

        console.error(error);

        statusText.textContent =
            "❌ " + error.message;
    }
}


// --------------------------------------------------
// Send notification
// --------------------------------------------------

async function sendNotification() {

    try {

        notifyBtn.disabled = true;

        statusText.textContent =
            "Sending notification...";


        const response =
            await fetch(
                `${BACKEND_URL}/send-notification`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        title:
                            "Hello from your PC 👋",

                        message:
                            "This notification was triggered from the website."

                    })
                }
            );


        if (!response.ok) {
            throw new Error(
                "Failed to send notification."
            );
        }


        statusText.textContent =
            "✅ Notification sent.";


    } catch (error) {

        console.error(error);

        statusText.textContent =
            "❌ " + error.message;

    } finally {

        notifyBtn.disabled = false;
    }
}


// --------------------------------------------------
// Button events
// --------------------------------------------------

enableBtn.addEventListener(
    "click",
    enableNotifications
);

notifyBtn.addEventListener(
    "click",
    sendNotification
);

