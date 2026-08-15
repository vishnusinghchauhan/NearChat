# NearChat — simplest Vercel + Render deployment

This version intentionally puts the React/Vite app at the repository root.

That means **Vercel does NOT need a Root Directory setting**.

## GitHub structure

```text
near-chat/
├── package.json
├── index.html
├── vite.config.ts
├── tsconfig.json
├── vercel.json
├── src/
└── server/
    ├── package.json
    └── src/
        └── server.js
```

## Vercel

Import this repository.

Use:

- Framework Preset: Vite
- Root Directory: `./` (repository root)
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

Environment variable:

```text
VITE_SERVER_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

## Render

Create a Web Service.

Use:

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

Environment variable:

```text
CLIENT_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app
```

## Local

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd server
npm install
npm run dev
```

## Why this version is simpler

The previous project had the frontend under `client/`. That requires Vercel's Root Directory to be configured correctly.

This version puts `index.html` and `package.json` directly at the repository root, so Vercel can detect the Vite application automatically.

The backend remains under `server/` and is deployed separately to Render.
