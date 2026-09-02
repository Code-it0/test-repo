# Push Notification Backend

Minimal Express + web-push backend for the PC → phone notification project.

## Setup

```bash
npm install
node generate-vapid.js
```

Copy the printed `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` into a `.env` file
(use `.env.example` as a template).

```bash
npm start
```

Server runs on `http://localhost:3000` by default.

## Endpoints

- `GET /vapid-public-key` — returns `{ publicKey }` so your frontend doesn't
  need the key hardcoded.
- `POST /subscribe` — body: `{ subscription }` (the object from
  `pushManager.subscribe()`). Called once per device.
- `POST /send-notification` — body: `{ title, message, url }`. Pushes to
  every stored subscription.

Subscriptions are stored in `subscriptions.json` (created automatically).
Fine for personal use; swap for a real DB if you need multiple users.

## Wiring up the frontend

In `app.js`, set:

```js
const BACKEND_URL = "https://your-deployed-backend.com";
const VAPID_PUBLIC_KEY = "the VAPID_PUBLIC_KEY value";
```

## Deploying

This needs to run somewhere reachable over HTTPS from your phone (localhost
won't work for the phone). Easiest free options: Render, Railway, Fly.io, or
a small VPS behind a reverse proxy with a real TLS cert. Deploy this whole
`backend/` folder there, set the two VAPID env vars in the host's dashboard,
and point `BACKEND_URL` in the frontend at the deployed URL.

## Flow recap

1. Phone opens the site → grants permission → `POST /subscribe`.
2. PC opens the site → clicks button → `POST /send-notification`.
3. Backend pushes to all subscriptions → phone shows the notification.
