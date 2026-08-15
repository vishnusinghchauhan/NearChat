# NearChat — Global Random Chat

NearChat now matches **any available online user**. Location is completely removed.

## What changed

- No browser location permission
- No GPS/geolocation code
- No nearby/radius filtering
- No distance shown
- Any two waiting online users can be matched
- Matching is randomized
- Next Stranger
- Leave chat
- Typing indicator
- Report
- Block

Socket.IO provides the real-time bidirectional connection used for chat. citeturn0search1

## Vercel

This repository is structured so the React/Vite app is at the root.

Use:

- Framework: Vite
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

Environment variable:

```text
VITE_SERVER_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

## Render

Create a Web Service:

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

Environment variable:

```text
CLIENT_ORIGIN=https://YOUR-VERCEL-APP.vercel.app
```

## Local development

Terminal 1:

```bash
npm install
npm run dev
```

Terminal 2:

```bash
cd server
npm install
npm run dev
```

## Test

Open the Vercel URL in two different browsers/devices.

Click:

**Find Random Stranger**

in both.

The first user waits. When the second user clicks the button, the server matches them.

## Important

This is still an MVP. Matching state is held in server memory. If the Render process restarts, the waiting queue is cleared.

For a public production service, add Redis, persistent reports/blocks, authentication or anonymous durable identities, rate limits, abuse detection, moderation, and age/safety controls.
