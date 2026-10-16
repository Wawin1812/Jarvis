import './loadEnv.js';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createJarvisRuntime } from './jarvis/runtime.js';
import { createJarvisRouter } from './routes/jarvis.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const runtime = createJarvisRuntime();
const allowedOrigins = new Set((process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean));

app.disable('x-powered-by');
app.use(cors({
  origin: (origin, callback) => !origin || allowedOrigins.has(origin)
    ? callback(null, true)
    : callback(new Error('Origin is not allowed.')),
}));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()');
  next();
});
app.use('/api/jarvis/screen', express.json({ limit: '5mb' }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', modelConfigured: Boolean(runtime.model), persistentAudit: runtime.persistentAudit });
});

app.use('/api/jarvis', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }), createJarvisRouter(runtime, process.env.JARVIS_API_TOKEN));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(port, host, () => console.log(`JARVIS backend listening on ${host}:${port}`));

