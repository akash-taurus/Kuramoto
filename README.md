# Kuramoto - The Internet's Collective Heartbeat

Your application is fully developed and completely optimized for Vercel/Railway deployments.

## The Architecture
1. **Frontend (Svelte + Canvas)**: Handles the UI, complex tap variance logic, and draws up to 10,000 real-time particles synced with Kuramoto Math without lagging. Setup to deploy on **Vercel** with zero-config (via `vercel.json`).
2. **Backend (Node + WebSockets + Redis + Postgres)**: Because **Vercel does not support WebSockets**, the real-time engine has been built separately and specifically designed for platforms like **Railway** or **Render**. It uses Redis to scale across multiple servers, instantly synchronizing global events.

## 🚀 1. Deploying the Backend (Railway / Fly.io / Render)
You must deploy this first, since the Frontend needs to know where it's pointing!
1. Connect this repo to [Railway](https://railway.app/).
2. Select the `backend/` folder as your root directory.
3. Railway will auto-detect the `Dockerfile` and build it.
4. Add a Database (PostgreSQL) and Redis add-on to your Railway project.
5. In your Railway service settings, add the following Environment Variables (Railway automatically provisions these URLs):
   - `DATABASE_URL`
   - `REDIS_URL`
6. Get your new public Railway app URL (e.g., `kuramoto-production.up.railway.app`).

---

## 🚀 2. Deploying the Frontend (Vercel)
Vercel is exactly where you want this! Svelte compiles into static files, loading instantly, which is perfect here.
1. Connect this repo to your [Vercel](https://vercel.com) account.
2. In the setup wizard, configure the **Root Directory** to point to `frontend/`.
3. Vercel will automatically detect `Vite`/Svelte.
4. Add the following **Environment Variable** in Vercel:
   - Name: `VITE_WS_URL`
   - Value: `wss://YOUR_RAILWAY_URL.app` (e.g., `wss://kuramoto-production.up.railway.app`)
     *(Note: Ensure you use `wss://` for secure WebSockets!)*
5. Click **Deploy**.

---

## 💻 Local Testing (Everything works out of the box!)

Want to run the full stack locally without deploying?

**Terminal 1: Start Databases**
```bash
docker-compose up -d
```

**Terminal 2: Start Backend Server**
```bash
cd backend
npm install
npm run start
```

**Terminal 3: Start Frontend Dev Server**
```bash
cd frontend
npm install
npm run dev
```

The frontend will start at `http://localhost:5173`. Open it in two different tabs or browsers, tap the screen, and watch the data synchronize instantly!
