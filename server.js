require("dotenv").config();

const express = require("express");
const cors = require("cors");
const webpush = require("web-push");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// --------------------------------------------------
// VAPID setup
// --------------------------------------------------

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error(
        "Missing VAPID keys. Run `node generate-vapid.js` and put the output in your .env file."
    );
    process.exit(1);
}

webpush.setVapidDetails(
    // This can be any mailto: address, it's just how push services
    // contact you if something is wrong with your usage.
    "mailto:you@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// --------------------------------------------------
// Simple file-based subscription storage
// --------------------------------------------------
// Good enough for a personal project with a handful of devices.
// Swap for a real database if this ever needs to scale.

const DB_FILE = path.join(__dirname, "subscriptions.json");

function loadSubscriptions() {
    if (!fs.existsSync(DB_FILE)) {
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
        return [];
    }
}

function saveSubscriptions(subs) {
    fs.writeFileSync(DB_FILE, JSON.stringify(subs, null, 2));
}

// --------------------------------------------------
// Routes
// --------------------------------------------------

// Frontend calls this to get the public key (optional convenience route,
// so you don't have to hardcode the key in app.js).
app.get("/vapid-public-key", (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Phone (or PC) calls this once after granting notification permission.
app.post("/subscribe", (req, res) => {
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: "Invalid subscription object." });
    }

    const subs = loadSubscriptions();

    // Avoid storing duplicates of the same endpoint
    const alreadyExists = subs.some(
        (s) => s.endpoint === subscription.endpoint
    );

    if (!alreadyExists) {
        subs.push(subscription);
        saveSubscriptions(subs);
        console.log("New subscription stored. Total:", subs.length);
    } else {
        console.log("Subscription already existed.");
    }

    res.status(201).json({ success: true });
});

// PC calls this when you click "Send Notification".
// It pushes to every stored subscription (i.e. every device that opted in).
app.post("/send-notification", async (req, res) => {
    const { title, message, url } = req.body;

    const subs = loadSubscriptions();

    if (subs.length === 0) {
        return res.status(400).json({
            error: "No subscriptions yet. Open the site on your phone and enable notifications first."
        });
    }

    const payload = JSON.stringify({
        title: title || "Notification",
        message: message || "",
        url: url || "/"
    });

    const results = await Promise.allSettled(
        subs.map((subscription) =>
            webpush.sendNotification(subscription, payload)
        )
    );

    // Clean up subscriptions that are dead (expired/unsubscribed).
    // Push services return 404/410 in that case.
    const stillValid = [];
    results.forEach((result, i) => {
        const statusCode = result.reason?.statusCode;
        if (result.status === "rejected" && (statusCode === 404 || statusCode === 410)) {
            console.log("Removing expired subscription:", subs[i].endpoint);
        } else {
            stillValid.push(subs[i]);
        }
    });

    if (stillValid.length !== subs.length) {
        saveSubscriptions(stillValid);
    }

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - successCount;

    res.json({ success: true, sent: successCount, failed: failCount });
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
