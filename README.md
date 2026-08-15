# NearChat

Omegle-style 1-to-1 text chat that prioritizes nearby users.

## Deployment

This repository is prepared for:

- Vercel → React frontend
- Render → Node.js + Socket.IO backend

See `DEPLOYMENT.md`.

## Local development

Server:

```bash
cd server
npm install
npm run dev
```

Client:

```bash
cd client
npm install
npm run dev
```

For local development, copy:

```text
client/.env.example → client/.env
```

and use:

```text
VITE_SERVER_URL=http://localhost:4000
```
