const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');
const Redis = require('ioredis');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Environment
const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://kuramoto:development_password@localhost:5432/kuramoto_db';

// DB Pool
const pool = new Pool({ connectionString: DATABASE_URL });

// Setup DB Schema
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.sessions (
        session_id UUID PRIMARY KEY,
        avg_bpm DECIMAL(5,2),
        variance DECIMAL(10,2),
        timezone VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DB] Sessions table ready.');
  } catch (e) {
    console.warn('[DB] Running memory-only mode.', e.message);
  }
}
initDB();

// Redis Pub/Sub
let pubClient, subClient;
let useRedis = process.env.REDIS_URL ? true : false;

if (useRedis) {
  try {
    pubClient = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    subClient = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
    subClient.subscribe('taps', (err) => {
      if (err) console.error('[Redis] Failed to subscribe');
      else console.log('[Redis] Subscribed to global taps queue.');
    });
  } catch(e) {
    useRedis = false;
  }
} else {
  console.log('[Redis] Disabled. Memory-only broadcast active.');
}

// ─── ANALYTICS ENGINE ────────────────────────────────────────────────
let activeConnections = 0;
let recentBPMs = [];
const BPM_MEMORY_LIMIT = 2000;

// Time-series: store BPM snapshots bucketed by minute
const timeSeriesData = [];        // { timestamp, avgBPM, syncPhase, activeUsers }
const TIME_SERIES_LIMIT = 1440;   // 24 hours of minute-level data

// BPM Distribution histogram (buckets of 5 BPM from 30 to 250)
const bpmHistogram = {};
for (let b = 30; b <= 250; b += 5) bpmHistogram[b] = 0;

// Timezone analytics
const timezoneStats = {};  // { "Asia/Kolkata": { totalBPM: 0, count: 0, sessions: 0 } }

// Session-level tracking per connected user
const sessionData = {};    // sessionId -> { taps: [], bpms: [], timezone, connectedAt }

// Hourly patterns (0-23)
const hourlyBPMs = {};
for (let h = 0; h < 24; h++) hourlyBPMs[h] = { total: 0, count: 0 };

// Device type tracking
const deviceStats = { mobile: { total: 0, count: 0 }, desktop: { total: 0, count: 0 } };

// Total lifetime stats
let totalTapsEver = 0;
let totalSessionsEver = 0;
let peakConcurrentUsers = 0;
let peakSyncPhase = 0;

// ─── CORE MATH ────────────────────────────────────────────────────────

function pushGlobalTap(bpm, timezone, device, hour) {
  recentBPMs.push(bpm);
  if (recentBPMs.length > BPM_MEMORY_LIMIT) recentBPMs.shift();
  totalTapsEver++;

  // Histogram
  const bucket = Math.round(bpm / 5) * 5;
  if (bpmHistogram[bucket] !== undefined) bpmHistogram[bucket]++;

  // Timezone
  if (timezone) {
    if (!timezoneStats[timezone]) timezoneStats[timezone] = { totalBPM: 0, count: 0, sessions: 0 };
    timezoneStats[timezone].totalBPM += bpm;
    timezoneStats[timezone].count++;
  }

  // Hourly
  if (hour !== undefined && hourlyBPMs[hour] !== undefined) {
    hourlyBPMs[hour].total += bpm;
    hourlyBPMs[hour].count++;
  }

  // Device
  if (device === 'mobile' || device === 'desktop') {
    deviceStats[device].total += bpm;
    deviceStats[device].count++;
  }
}

// Kuramoto Order Parameter
function calculateKuramoto(bpms) {
  if (!bpms || bpms.length === 0) return 0;
  // Convert BPMs to phase angles (2*PI * fractional beat position)
  const now = Date.now();
  let sumSin = 0, sumCos = 0;
  for (const bpm of bpms) {
    const freq = bpm / 60; // beats per second
    const phase = (2 * Math.PI * freq * (now / 1000)) % (2 * Math.PI);
    sumSin += Math.sin(phase);
    sumCos += Math.cos(phase);
  }
  const N = bpms.length;
  return Math.sqrt(sumSin * sumSin + sumCos * sumCos) / N;
}

function calculateGlobalSync() {
  if (recentBPMs.length === 0) return { avgBPM: 100, phase: 0, stdDev: 0, median: 100, min: 0, max: 0 };

  const N = recentBPMs.length;
  const sum = recentBPMs.reduce((a, b) => a + b, 0);
  const avg = sum / N;

  // Standard deviation
  const variance = recentBPMs.reduce((v, b) => v + Math.pow(b - avg, 2), 0) / N;
  const stdDev = Math.sqrt(variance);

  // Median
  const sorted = [...recentBPMs].sort((a, b) => a - b);
  const median = N % 2 === 0 ? (sorted[N/2 - 1] + sorted[N/2]) / 2 : sorted[Math.floor(N/2)];

  // True Kuramoto order parameter
  const phase = calculateKuramoto(recentBPMs.slice(-200)); // last 200 for performance

  return { avgBPM: avg, phase, stdDev, median, min: sorted[0], max: sorted[N - 1] };
}

// ─── TIME SERIES SNAPSHOT (every 60s) ──────────────────────────────
setInterval(() => {
  const stats = calculateGlobalSync();
  timeSeriesData.push({
    t: Date.now(),
    avgBPM: Number(stats.avgBPM.toFixed(1)),
    sync: Number(stats.phase.toFixed(3)),
    users: activeConnections,
    taps: recentBPMs.length
  });
  if (timeSeriesData.length > TIME_SERIES_LIMIT) timeSeriesData.shift();

  if (stats.phase > peakSyncPhase) peakSyncPhase = stats.phase;
  if (activeConnections > peakConcurrentUsers) peakConcurrentUsers = activeConnections;
}, 60000);

// ─── BROADCASTING (every 2s) ──────────────────────────────────────
setInterval(() => {
  if (wss.clients.size === 0) return;

  const stats = calculateGlobalSync();

  // Build top timezones
  const topTimezones = Object.entries(timezoneStats)
    .map(([tz, d]) => ({ tz, avgBPM: d.count > 0 ? d.totalBPM / d.count : 0, count: d.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Build hourly averages
  const hourlyAvg = {};
  for (let h = 0; h < 24; h++) {
    hourlyAvg[h] = hourlyBPMs[h].count > 0 ? Number((hourlyBPMs[h].total / hourlyBPMs[h].count).toFixed(1)) : null;
  }

  const payload = JSON.stringify({
    type: 'global_sync',
    avgBPM: stats.avgBPM,
    syncPhase: stats.phase,
    stdDev: stats.stdDev,
    median: stats.median,
    bpmRange: [stats.min, stats.max],
    activeUsers: activeConnections,
    totalTaps: totalTapsEver,
    totalSessions: totalSessionsEver,
    peakUsers: peakConcurrentUsers,
    peakSync: peakSyncPhase,
    histogram: bpmHistogram,
    topTimezones: topTimezones,
    hourlyAvg: hourlyAvg,
    deviceStats: {
      mobile: deviceStats.mobile.count > 0 ? Number((deviceStats.mobile.total / deviceStats.mobile.count).toFixed(1)) : null,
      desktop: deviceStats.desktop.count > 0 ? Number((deviceStats.desktop.total / deviceStats.desktop.count).toFixed(1)) : null,
      mobileCount: deviceStats.mobile.count,
      desktopCount: deviceStats.desktop.count
    },
    timeSeries: timeSeriesData.slice(-60) // last 60 minutes
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}, 2000);

// Redis Cross-Server Listener
if (useRedis && subClient) {
  subClient.on('message', (channel, message) => {
    if (channel === 'taps') {
      const data = JSON.parse(message);
      pushGlobalTap(data.bpm, data.timezone, data.device, data.hour);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.sessionId !== data.sessionId) {
          client.send(JSON.stringify({ type: 'remote_tap', bpm: data.bpm }));
        }
      });
    }
  });
}

// ─── WEBSOCKET CONNECTIONS ────────────────────────────────────────────
wss.on('connection', (ws) => {
  activeConnections++;
  totalSessionsEver++;
  ws.sessionId = crypto.randomUUID();

  sessionData[ws.sessionId] = {
    bpms: [],
    taps: 0,
    connectedAt: Date.now(),
    timezone: null
  };

  // Send initial snapshot
  const stats = calculateGlobalSync();
  ws.send(JSON.stringify({
    type: 'global_sync',
    avgBPM: stats.avgBPM,
    syncPhase: stats.phase,
    stdDev: stats.stdDev,
    median: stats.median,
    bpmRange: [stats.min, stats.max],
    activeUsers: activeConnections,
    totalTaps: totalTapsEver,
    totalSessions: totalSessionsEver,
    peakUsers: peakConcurrentUsers,
    peakSync: peakSyncPhase,
    histogram: bpmHistogram,
    topTimezones: [],
    hourlyAvg: {},
    deviceStats: { mobile: null, desktop: null, mobileCount: 0, desktopCount: 0 },
    timeSeries: timeSeriesData.slice(-60)
  }));

  ws.on('message', async (dataStr) => {
    try {
      const data = JSON.parse(dataStr);

      if (data.type === 'client_tap') {
        const hour = new Date().getHours();
        const device = data.device || 'desktop';

        // Track per-session
        const sess = sessionData[ws.sessionId];
        if (sess) {
          sess.bpms.push(data.bpm);
          sess.taps++;
          sess.timezone = data.timezone;
        }

        // Send personal analytics back to the tapper
        if (sess && sess.bpms.length >= 3) {
          const personalAvg = sess.bpms.reduce((a, b) => a + b, 0) / sess.bpms.length;
          const personalVar = sess.bpms.reduce((v, b) => v + Math.pow(b - personalAvg, 2), 0) / sess.bpms.length;
          const consistency = Math.max(0, 100 - Math.sqrt(personalVar));

          // Rhythm fingerprint: normalized interval pattern
          const last8 = sess.bpms.slice(-8);
          const fpMin = Math.min(...last8);
          const fpMax = Math.max(...last8);
          const fingerprint = last8.map(b => fpMax === fpMin ? 0.5 : (b - fpMin) / (fpMax - fpMin));

          ws.send(JSON.stringify({
            type: 'personal_stats',
            avgBPM: Number(personalAvg.toFixed(1)),
            consistency: Number(consistency.toFixed(1)),
            totalTaps: sess.taps,
            sessionDuration: Math.floor((Date.now() - sess.connectedAt) / 1000),
            fingerprint: fingerprint
          }));
        }

        // DB write (non-blocking)
        pool.query(
          `INSERT INTO sessions (session_id, avg_bpm, variance, timezone) VALUES ($1, $2, $3, $4)
           ON CONFLICT(session_id) DO UPDATE SET avg_bpm=$2, variance=$3`,
          [ws.sessionId, data.bpm, data.variance, data.timezone]
        ).catch(() => {});

        // Broadcast
        if (useRedis && pubClient) {
          pubClient.publish('taps', JSON.stringify({
            bpm: data.bpm, sessionId: ws.sessionId,
            timezone: data.timezone, device, hour
          }));
        } else {
          pushGlobalTap(data.bpm, data.timezone, device, hour);
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'remote_tap', bpm: data.bpm }));
            }
          });
        }
      }
    } catch(e) { /* ignore */ }
  });

  ws.on('close', () => {
    activeConnections--;
    delete sessionData[ws.sessionId];
  });
});

// ─── REST API ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', activeUsers: activeConnections }));

app.get('/api/stats', (req, res) => {
  const stats = calculateGlobalSync();
  res.json({
    avgBPM: stats.avgBPM,
    syncPhase: stats.phase,
    stdDev: stats.stdDev,
    activeUsers: activeConnections,
    totalTaps: totalTapsEver,
    totalSessions: totalSessionsEver,
    peakUsers: peakConcurrentUsers,
    histogram: bpmHistogram,
    timezones: timezoneStats,
    hourly: hourlyBPMs,
    deviceStats
  });
});

app.get('/api/timeseries', (req, res) => {
  res.json(timeSeriesData);
});

app.get('/api/export', (req, res) => {
  // CSV export for researchers
  let csv = 'timestamp,avgBPM,syncPhase,activeUsers,totalTaps\n';
  for (const row of timeSeriesData) {
    csv += row.t + ',' + row.avgBPM + ',' + row.sync + ',' + row.users + ',' + row.taps + '\n';
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kuramoto_data.csv"');
  res.send(csv);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log("[Kuramoto Server] Listening on port " + PORT);
});
