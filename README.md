# NearChat Multi-User Global Random Chat

This version is designed for **multiple simultaneous users** on one Render server.

## Features

- Global random matching — no location
- Many users can be online simultaneously
- Each user gets an independent private Socket.IO room
- Randomly matches two available users
- Waiting queue
- Next Stranger
- Leave
- Typing indicator
- Report
- Block
- Online user counter
- Message rate limiting
- Health endpoint

## Vercel

The frontend is at the repository root.

Set:

- Framework: Vite
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

Environment variable:

`VITE_SERVER_URL=https://YOUR-RENDER-SERVICE.onrender.com`

## Render

Create a Web Service:

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

Environment variable:

`CLIENT_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app`

## Test with multiple users

Open the Vercel URL in multiple browsers/devices.

Each person clicks **Find Random Stranger**.

The server keeps unmatched users in a waiting queue and creates a separate private room for every matched pair.

Example with 6 users:

```text
User 1 ─┐
        ├─ Room A
User 2 ─┘

User 3 ─┐
        ├─ Room B
User 4 ─┘

User 5 ─┐
        ├─ Room C
User 6 ─┘
```

One user's messages cannot be delivered to another room.

## Important scaling note

This version supports many concurrent users on a **single Render server instance**.

If you later run multiple backend instances for high traffic, the in-memory queue/rooms must be moved to Redis and Socket.IO must use the Redis adapter. That is the next scaling step.

For public launch, also add persistent moderation/report storage, rate limiting at the edge, abuse detection, authentication or durable anonymous IDs, and age/safety controls.
