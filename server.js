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
// Pairing code generation
// --------------------------------------------------

const ACTIVE_PAIR_CODES = {}; // { code: { pairId, expiresAt } }

function generatePairCode() {
    // Generate a random 6-character alphanumeric code (e.g., X7K2Q9)
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function generatePairId() {
    // Generate a unique ID for the pair
    return "pair_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

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

// PC calls this to get a pairing code and pairId
app.get("/generate-pair-code", (req, res) => {
    let code = generatePairCode();

    // Ensure code doesn't already exist
    while (ACTIVE_PAIR_CODES[code]) {
        code = generatePairCode();
    }

    const pairId = generatePairId();
    const expiresAt = Date.now() + (15 * 60 * 1000); // Expire in 15 minutes

    ACTIVE_PAIR_CODES[code] = { pairId, expiresAt };

    console.log(`New pairing code generated: ${code} -> ${pairId}`);

    res.json({ code, pairId, expiresAt });
});

// Phone calls this to look up the pairId from a pairing code
app.get("/resolve-pair-code/:code", (req, res) => {
    const { code } = req.params;
    const upperCode = code.toUpperCase();

    if (!ACTIVE_PAIR_CODES[upperCode]) {
        return res.status(404).json({ error: "Invalid or expired pairing code." });
    }

    const pairData = ACTIVE_PAIR_CODES[upperCode];

    // Check if code has expired
    if (Date.now() > pairData.expiresAt) {
        delete ACTIVE_PAIR_CODES[upperCode];
        return res.status(404).json({ error: "Pairing code has expired." });
    }

    res.json({ pairId: pairData.pairId, expiresAt: pairData.expiresAt });
});

// PC uses this to learn when the phone has subscribed to the same pair.
app.get("/pair-status/:pairId", (req, res) => {
    const subs = loadSubscriptions();
    const pairSubscriptions = subs.filter((sub) => sub.pairId === req.params.pairId);

    res.json({
        pcConnected: pairSubscriptions.some((sub) => sub.role === "pc"),
        phoneConnected: pairSubscriptions.some((sub) => sub.role === "phone")
    });
});

// Phone (or PC) calls this once after granting notification permission.
// Now requires pairId and role in the request body.
app.post("/subscribe", (req, res) => {
    const { subscription, pairId, role } = req.body;

    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: "Invalid subscription object." });
    }

    if (!pairId) {
        return res.status(400).json({ error: "Missing pairId. Call /generate-pair-code first." });
    }

    if (!role || (role !== "pc" && role !== "phone")) {
        return res.status(400).json({ error: "Missing or invalid role. Must be 'pc' or 'phone'." });
    }

    const subs = loadSubscriptions();

    // Replace an existing endpoint so it can move to a new pair or role.
    const subscriptionIndex = subs.findIndex(
        (s) => (s.subscription?.endpoint || s.endpoint) === subscription.endpoint
    );
    const storedSubscription = {
        subscription,
        pairId,
        role,
        subscribedAt: new Date().toISOString()
    };

    if (subscriptionIndex === -1) {
        subs.push(storedSubscription);
        saveSubscriptions(subs);
        console.log(`New subscription stored. PairId: ${pairId}, Role: ${role}, Total: ${subs.length}`);
    } else {
        subs[subscriptionIndex] = storedSubscription;
        saveSubscriptions(subs);
        console.log(`Subscription updated. PairId: ${pairId}, Role: ${role}`);
    }

    res.status(201).json({ success: true, pairId });
});

// PC or Phone calls this to send a notification to the paired device(s).
// Targets subscriptions by pairId and optionally by role.
app.post("/send-notification", async (req, res) => {
    const { title, message, url, pairId, targetRole } = req.body;

    if (!pairId) {
        return res.status(400).json({
            error: "Missing pairId. Cannot send notification without a pair."
        });
    }

    const subs = loadSubscriptions();

    // Filter subscriptions by pairId and optional targetRole
    let targetSubs = subs.filter((s) => s.pairId === pairId);

    if (targetRole) {
        targetSubs = targetSubs.filter((s) => s.role === targetRole);
    }

    if (targetSubs.length === 0) {
        return res.status(400).json({
            error: `No subscriptions found for pairId: ${pairId}${targetRole ? ` and role: ${targetRole}` : ""}`
        });
    }

    const payload = JSON.stringify({
        title: title || "Notification",
        message: message || "",
        url: url || "/"
    });

    const results = await Promise.allSettled(
        targetSubs.map((sub) =>
            webpush.sendNotification(sub.subscription, payload)
        )
    );

    // Clean up subscriptions that are dead (expired/unsubscribed).
    // Push services return 404/410 in that case.
    const stillValid = [];
    results.forEach((result, i) => {
        const statusCode = result.reason?.statusCode;
        if (result.status === "rejected" && (statusCode === 404 || statusCode === 410)) {
            console.log("Removing expired subscription:", targetSubs[i].subscription.endpoint);
        } else {
            stillValid.push(targetSubs[i]);
        }
    });

    // Rebuild full subscriptions list, removing expired ones
    if (stillValid.length !== targetSubs.length) {
        const expiredEndpoints = targetSubs
            .filter((s) => !stillValid.some((v) => v.subscription.endpoint === s.subscription.endpoint))
            .map((s) => s.subscription.endpoint);
        const filtered = subs.filter((s) => !expiredEndpoints.includes(s.subscription.endpoint));
        saveSubscriptions(filtered);
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
