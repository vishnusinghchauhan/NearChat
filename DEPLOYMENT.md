# NearChat — Vercel + Render Deployment

This version is prepared for:

- **Frontend:** Vercel
- **Socket.IO backend:** Render
- **Database:** none for the MVP
- **Redis:** none for the MVP

## 1. Put the project on GitHub

Create a GitHub repository and upload this project with this structure:

```text
near-chat/
├── client/
├── server/
├── render.yaml
└── README.md
```

## 2. Deploy the server to Render

Go to Render and create a new **Web Service** from your GitHub repository.

Use:

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

Environment variables:

```text
CLIENT_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app
```

Render supplies `PORT` automatically.

After deployment, Render will give you a URL similar to:

```text
https://near-chat-server-xxxx.onrender.com
```

Keep this URL.

## 3. Deploy the client to Vercel

Import the same GitHub repository into Vercel.

Set:

- Root Directory: `client`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

Environment variable:

```text
VITE_SERVER_URL=https://YOUR-RENDER-SERVER.onrender.com
```

Deploy.

Vercel will give you a URL similar to:

```text
https://near-chat.vercel.app
```

## 4. Update Render CORS

Go back to Render and set:

```text
CLIENT_ORIGIN=https://near-chat.vercel.app
```

Redeploy/restart the Render service.

## 5. Test

Open the Vercel URL in two browser windows or two devices.

Allow location access on both.

Click:

```text
Find Stranger
```

The server will try:

1. within 5 km
2. within 25 km
3. within 100 km
4. global fallback

Then the two users can chat through Socket.IO.

## Important production notes

This is an MVP. The server currently stores waiting users, rooms, blocks and reports in memory.

That means:

- restarting Render clears the waiting queue
- multiple server instances are not supported
- reports are not permanently stored

For production, add:

- Redis for distributed matching
- MongoDB for reports/users
- authentication or durable anonymous IDs
- rate limiting
- abuse detection
- moderation
- age/safety controls
- HTTPS/WSS
- stronger privacy controls

## Troubleshooting

### CORS error

Make sure Render has:

```text
CLIENT_ORIGIN=https://your-exact-vercel-domain.vercel.app
```

Do not add a trailing slash.

### Socket connection error

Make sure Vercel has:

```text
VITE_SERVER_URL=https://your-render-server.onrender.com
```

Then redeploy Vercel.

### Location doesn't work

Browser geolocation requires HTTPS in production. Vercel provides HTTPS automatically.

### Render sleeps

On some Render plans, an inactive service can spin down. The first connection after inactivity may take longer. For a public real-time chat app, use a plan suitable for an always-on service.
