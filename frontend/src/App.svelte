<script>
  import { onMount } from 'svelte';
  import { SyncStats } from './lib/math.js';
  import { Visualizer } from './lib/canvas.js';
  
  let ws;
  let canvasEl;
  let visualizer;
  let localStats = new SyncStats();
  
  // UI State
  let bpm = $state("-");
  let globalBPM = $state(null);
  let syncPercentage = $state(null);
  let activeUsers = $state(0);
  let tapping = $state(false);
  let showDashboard = $state(false);
  
  // Analytics State
  let stdDev = $state(null);
  let median = $state(null);
  let bpmRange = $state(null);
  let totalTaps = $state(0);
  let totalSessions = $state(0);
  let peakUsers = $state(0);
  let peakSync = $state(0);
  let histogram = $state(null);
  let topTimezones = $state([]);
  let hourlyAvg = $state(null);
  let deviceStats = $state(null);
  let timeSeries = $state([]);
  
  // Personal Stats
  let personalAvg = $state(null);
  let consistency = $state(null);
  let personalTaps = $state(0);
  let sessionDuration = $state(0);
  let fingerprint = $state([]);

  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

  // Only show data when it actually exists
  function hasHistogramData(hist) {
    if (!hist) return false;
    return Object.values(hist).some(v => v > 0);
  }
  function hasHourlyData(hourly) {
    if (!hourly) return false;
    return Object.values(hourly).some(v => v !== null && v !== undefined);
  }
  function hasDeviceData(ds) {
    if (!ds) return false;
    return (ds.mobileCount > 0 || ds.desktopCount > 0);
  }

  onMount(() => {
    visualizer = new Visualizer(canvasEl);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.hostname}:8080`;
    connect(wsUrl);
    return () => { if (ws) ws.close(); };
  });

  function connect(url) {
    ws = new WebSocket(url);
    ws.onopen = () => console.log('Connected to Pulse Stream');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'global_sync') {
        if (data.totalTaps > 0) {
          globalBPM = Number(data.avgBPM).toFixed(1);
          syncPercentage = (data.syncPhase * 100).toFixed(1);
          stdDev = Number(data.stdDev).toFixed(1);
          median = Number(data.median).toFixed(1);
          bpmRange = data.bpmRange;
          histogram = data.histogram;
          topTimezones = data.topTimezones || [];
          hourlyAvg = data.hourlyAvg;
          deviceStats = data.deviceStats;
          timeSeries = data.timeSeries || [];
          peakSync = (data.peakSync * 100).toFixed(1);
          visualizer.updateGlobalBPM(data.avgBPM, data.syncPhase);
        }
        activeUsers = data.activeUsers || 0;
        totalTaps = data.totalTaps || 0;
        totalSessions = data.totalSessions || 0;
        peakUsers = data.peakUsers || 0;
      }
      
      if (data.type === 'remote_tap') {
        visualizer.addTap(data.bpm, false);
      }
      
      if (data.type === 'personal_stats') {
        personalAvg = data.avgBPM;
        consistency = data.consistency;
        personalTaps = data.totalTaps;
        sessionDuration = data.sessionDuration;
        fingerprint = data.fingerprint || [];
      }
    };
    ws.onclose = () => setTimeout(() => connect(url), 2000);
  }

  function handleTap(e) {
    if (showDashboard) return;
    if (e) e.preventDefault();
    tapping = true;
    const now = performance.now();
    const result = localStats.pushLocalTap(now);
    if (result) {
      bpm = result.bpm.toFixed(1);
      visualizer.addTap(result.bpm, true);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'client_tap',
          bpm: result.bpm,
          variance: result.variance,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          device: isMobile ? 'mobile' : 'desktop'
        }));
      }
    } else {
      visualizer.addTap(100, true);
    }
  }

  function releaseTap() { tapping = false; }
  function toggleDashboard() { showDashboard = !showDashboard; }

  function getHistogramBars(hist) {
    if (!hist) return [];
    const entries = Object.entries(hist).filter(([, v]) => v > 0).map(([k, v]) => ({ bpm: Number(k), count: v }));
    const maxCount = Math.max(...entries.map(e => e.count), 1);
    return entries.map(e => ({ ...e, height: (e.count / maxCount) * 100 }));
  }

  function getHourlyBars(hourly) {
    if (!hourly) return [];
    const bars = [];
    for (let h = 0; h < 24; h++) bars.push({ hour: h, bpm: hourly[h] || null });
    const validBpms = bars.filter(b => b.bpm !== null).map(b => b.bpm);
    if (validBpms.length === 0) return bars.map(b => ({ ...b, height: 0 }));
    const minBpm = Math.min(...validBpms);
    const maxBpm = Math.max(...validBpms);
    const range = maxBpm - minBpm || 1;
    return bars.map(b => ({
      ...b,
      height: b.bpm !== null ? Math.max(5, ((b.bpm - minBpm) / range) * 100) : 0
    }));
  }

  function getWsHost() {
    try { return window.location.hostname; } catch { return 'localhost'; }
  }
</script>

<svelte:window 
  onpointerdown={handleTap} 
  onpointerup={releaseTap} 
  onkeydown={(e) => { if (e.code === 'Space' && !showDashboard) handleTap(); }}
  onkeyup={(e) => { if (e.code === 'Space') releaseTap(); }}
/>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap');

  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    overflow: hidden;
    background-color: #060608;
    color: #e8e8ec;
    font-family: 'Inter', -apple-system, sans-serif;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  canvas {
    position: fixed;
    inset: 0;
    width: 100vw; height: 100vh;
    z-index: 0;
  }

  /* ── MAIN UI LAYER ──────────────────── */
  .ui-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 10;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 1rem;
  }
  @media (min-width: 640px) { .ui-layer { padding: 1.5rem 2rem; } }

  /* ── HEADER ─────────────────────────── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .brand-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #6366f1;
    animation: pulse-dot 2s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.5); }
  }
  h1 {
    font-weight: 300; letter-spacing: 3px; font-size: 0.85rem;
    text-transform: uppercase; color: #a0a0b0;
  }
  @media (min-width: 640px) { h1 { font-size: 1rem; } }

  .header-right {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .dashboard-btn {
    pointer-events: all;
    cursor: pointer;
    background: rgba(99, 102, 241, 0.12);
    border: 1px solid rgba(99, 102, 241, 0.25);
    color: #a5b4fc;
    padding: 0.4rem 0.7rem;
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 1px;
    text-transform: uppercase;
    transition: all 0.2s;
    backdrop-filter: blur(10px);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .dashboard-btn:hover { background: rgba(99, 102, 241, 0.25); }

  /* ── STAT CARDS (top right) ─────────── */
  .stats-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    padding: 0.5rem 0.6rem;
    border-radius: 8px;
    backdrop-filter: blur(12px);
  }
  @media (min-width: 640px) { .stat-card { padding: 0.6rem 0.8rem; } }
  .stat-card .label {
    font-size: 0.55rem; opacity: 0.5; text-transform: uppercase;
    letter-spacing: 0.8px; font-weight: 500;
  }
  @media (min-width: 640px) { .stat-card .label { font-size: 0.6rem; } }
  .stat-card .value {
    font-size: 0.9rem; font-weight: 600; margin-top: 0.15rem;
    font-family: 'JetBrains Mono', monospace;
  }
  @media (min-width: 640px) { .stat-card .value { font-size: 1rem; } }
  .stat-card .value.accent { color: #6366f1; }
  .stat-card .value.green { color: #34d399; }
  .stat-card .value.amber { color: #fbbf24; }

  /* ── HERO BPM ──────────────────────── */
  .hero-bignumber {
    align-self: center;
    text-align: center;
    padding-bottom: 10vh;
  }
  @media (min-width: 640px) { .hero-bignumber { padding-bottom: 15vh; } }

  .bignum {
    font-size: 4rem;
    font-weight: 200;
    line-height: 1;
    font-family: 'JetBrains Mono', monospace;
    transition: transform 0.08s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    background: linear-gradient(135deg, #e8e8ec, #6366f1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    user-select: none;
  }
  @media (min-width: 640px) { .bignum { font-size: 7rem; } }
  .bignum.tapped { transform: scale(0.92); }

  .bpm-unit {
    font-size: 0.8rem; font-weight: 400;
    opacity: 0.4; letter-spacing: 2px; margin-top: 0.4rem;
  }
  .hint {
    opacity: 0.3; letter-spacing: 2px; text-transform: uppercase;
    font-size: 0.65rem; margin-top: 1.2rem;
  }

  /* Personal stats */
  .personal-bar {
    display: flex;
    gap: 0.8rem; flex-wrap: wrap;
    align-items: center; justify-content: center;
    margin-top: 0.8rem;
    opacity: 0.7;
    font-size: 0.65rem;
    font-family: 'JetBrains Mono', monospace;
  }
  @media (min-width: 640px) { .personal-bar { gap: 1.2rem; font-size: 0.75rem; } }
  .personal-bar span { color: #6366f1; font-weight: 500; }

  .fingerprint {
    display: flex;
    gap: 3px; justify-content: center;
    align-items: flex-end;
    height: 24px; margin-top: 0.6rem;
  }
  .fp-bar {
    width: 5px;
    background: linear-gradient(to top, #6366f1, #a5b4fc);
    border-radius: 2px;
    transition: height 0.3s ease;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    font-size: 0.6rem;
    opacity: 0.2; letter-spacing: 1px;
    flex-wrap: wrap; gap: 0.5rem;
  }
  @media (min-width: 640px) { .footer { font-size: 0.7rem; } }

  /* ── DASHBOARD OVERLAY ─────────────── */
  .dashboard-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(6, 6, 8, 0.96);
    backdrop-filter: blur(20px);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 1rem;
    pointer-events: all;
  }
  @media (min-width: 640px) { .dashboard-overlay { padding: 2rem; } }

  .dash-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    flex-wrap: wrap; gap: 0.5rem;
  }
  .dash-title {
    font-size: 1rem; font-weight: 300;
    letter-spacing: 3px; text-transform: uppercase; color: #a5b4fc;
  }
  @media (min-width: 640px) { .dash-title { font-size: 1.2rem; } }

  .close-btn {
    cursor: pointer;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e8e8ec;
    padding: 0.4rem 0.8rem;
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 0.75rem;
  }
  .close-btn:hover { background: rgba(255, 255, 255, 0.1); }

  .dash-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 540px) { .dash-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 960px) { .dash-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1280px) { .dash-grid { grid-template-columns: repeat(4, 1fr); } }

  .dash-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 1rem 1.2rem;
  }
  .dash-card h3 {
    margin: 0 0 0.8rem 0;
    font-size: 0.65rem; font-weight: 500;
    text-transform: uppercase; letter-spacing: 2px; color: #6366f1;
  }

  .empty-state {
    opacity: 0.25; font-size: 0.8rem; text-align: center;
    padding: 1rem 0; font-style: italic;
  }

  /* Lifetime stats */
  .lifetime-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  .lifetime-item .lt-value {
    font-size: 1.2rem; font-weight: 600;
    font-family: 'JetBrains Mono', monospace; color: #e8e8ec;
  }
  @media (min-width: 640px) { .lifetime-item .lt-value { font-size: 1.4rem; } }
  .lifetime-item .lt-label {
    font-size: 0.6rem; opacity: 0.4;
    text-transform: uppercase; letter-spacing: 1px; margin-top: 0.15rem;
  }

  /* Mini histogram */
  .mini-histogram {
    display: flex;
    align-items: flex-end;
    gap: 2px; height: 70px;
  }
  .hist-bar {
    flex: 1;
    background: linear-gradient(to top, rgba(99, 102, 241, 0.3), rgba(99, 102, 241, 0.8));
    border-radius: 2px 2px 0 0;
    min-width: 3px;
    transition: height 0.4s ease;
  }
  .hist-bar:hover { background: linear-gradient(to top, rgba(99, 102, 241, 0.5), #6366f1); }

  /* Hourly chart */
  .hourly-chart {
    display: flex;
    align-items: flex-end;
    gap: 2px; height: 55px;
  }
  .hourly-bar {
    flex: 1;
    background: linear-gradient(to top, rgba(52, 211, 153, 0.2), rgba(52, 211, 153, 0.7));
    border-radius: 2px 2px 0 0;
    min-width: 4px;
    transition: height 0.4s ease;
  }
  .hourly-bar.empty { background: rgba(255,255,255,0.03); }
  .hour-labels {
    display: flex; gap: 2px; margin-top: 0.25rem;
  }
  .hour-labels span {
    flex: 1; text-align: center;
    font-size: 0.45rem; opacity: 0.3;
    font-family: 'JetBrains Mono', monospace;
  }

  /* Timezone list */
  .tz-list { list-style: none; }
  .tz-list li {
    display: flex;
    justify-content: space-between;
    padding: 0.35rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: 0.75rem;
    font-family: 'JetBrains Mono', monospace;
    gap: 0.5rem;
  }
  .tz-list .tz-name { color: #a0a0b0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .tz-list .tz-bpm { color: #6366f1; font-weight: 500; white-space: nowrap; }
  .tz-list .tz-count { color: #555; font-size: 0.65rem; white-space: nowrap; }

  /* SVG Sparkline */
  .sparkline { width: 100%; height: 55px; }
  .sparkline polyline { fill: none; stroke: #6366f1; stroke-width: 1.5; }
  .sparkline .area { fill: url(#sparkGrad); stroke: none; }

  /* Device */
  .device-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.4rem 0;
    flex-wrap: wrap; gap: 0.3rem;
  }
  .device-row .device-name { font-size: 0.8rem; color: #a0a0b0; }
  .device-row .device-bpm { font-family: 'JetBrains Mono', monospace; font-weight: 500; color: #fbbf24; }
  .device-row .device-count { font-size: 0.65rem; color: #555; }

  .export-btn {
    display: inline-block;
    margin-top: 0.8rem;
    cursor: pointer;
    background: rgba(52, 211, 153, 0.1);
    border: 1px solid rgba(52, 211, 153, 0.3);
    color: #34d399;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 1px;
    text-decoration: none;
  }
  .export-btn:hover { background: rgba(52, 211, 153, 0.2); }
</style>

<canvas bind:this={canvasEl}></canvas>

<div class="ui-layer">
  <div class="header">
    <div class="brand">
      <div class="brand-dot"></div>
      <h1>Kuramoto</h1>
    </div>
    
    <div class="header-right">
      {#if totalTaps > 0}
        <div class="stats-row">
          {#if globalBPM !== null}
            <div class="stat-card">
              <div class="label">Global Tempo</div>
              <div class="value accent">{globalBPM}</div>
            </div>
          {/if}
          {#if syncPercentage !== null}
            <div class="stat-card">
              <div class="label">Sync</div>
              <div class="value green">{syncPercentage}%</div>
            </div>
          {/if}
          <div class="stat-card">
            <div class="label">Live</div>
            <div class="value">{activeUsers}</div>
          </div>
          {#if stdDev !== null && Number(stdDev) > 0}
            <div class="stat-card">
              <div class="label">σ</div>
              <div class="value amber">{stdDev}</div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="stat-card">
          <div class="label">Live</div>
          <div class="value">{activeUsers}</div>
        </div>
      {/if}
      <button class="dashboard-btn" onclick={toggleDashboard}>
        {showDashboard ? '✕' : '◈ Analytics'}
      </button>
    </div>
  </div>

  {#if !showDashboard}
    <div class="hero-bignumber">
      <div class="bignum" class:tapped={tapping}>{bpm}</div>
      <div class="bpm-unit">BPM</div>
      
      {#if personalAvg !== null}
        <div class="personal-bar">
          <div>Avg <span>{personalAvg}</span></div>
          <div>Consistency <span>{consistency}%</span></div>
          <div>Taps <span>{personalTaps}</span></div>
          <div>Session <span>{sessionDuration}s</span></div>
        </div>
        {#if fingerprint.length > 0}
          <div class="fingerprint">
            {#each fingerprint as val}
              <div class="fp-bar" style="height: {Math.max(3, val * 22)}px"></div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="hint">Tap anywhere · Spacebar · Touch</div>
      {/if}
    </div>

    <div class="footer">
      <div>The Internet's Collective Heartbeat</div>
      {#if totalTaps > 0}
        <div>{totalTaps} taps · {totalSessions} sessions</div>
      {/if}
    </div>
  {/if}
</div>

<!-- ── ANALYTICS DASHBOARD ──────────────────────────── -->
{#if showDashboard}
  <div class="dashboard-overlay">
    <div class="dash-header">
      <div class="dash-title">◈ Research Dashboard</div>
      <button class="close-btn" onclick={toggleDashboard}>← Back</button>
    </div>

    {#if totalTaps === 0}
      <div class="empty-state" style="padding:3rem 0; font-size:1rem;">
        No data yet — go back and start tapping to generate live analytics.
      </div>
    {:else}
      <div class="dash-grid">
        <!-- Lifetime Stats -->
        <div class="dash-card">
          <h3>Lifetime</h3>
          <div class="lifetime-grid">
            <div class="lifetime-item">
              <div class="lt-value">{totalTaps.toLocaleString()}</div>
              <div class="lt-label">Total Taps</div>
            </div>
            <div class="lifetime-item">
              <div class="lt-value">{totalSessions.toLocaleString()}</div>
              <div class="lt-label">Sessions</div>
            </div>
            {#if peakUsers > 0}
              <div class="lifetime-item">
                <div class="lt-value">{peakUsers}</div>
                <div class="lt-label">Peak Concurrent</div>
              </div>
            {/if}
            {#if Number(peakSync) > 0}
              <div class="lifetime-item">
                <div class="lt-value">{peakSync}%</div>
                <div class="lt-label">Peak Sync</div>
              </div>
            {/if}
          </div>
        </div>

        <!-- Current State -->
        {#if globalBPM !== null}
          <div class="dash-card">
            <h3>Current Pulse</h3>
            <div class="lifetime-grid">
              <div class="lifetime-item">
                <div class="lt-value">{globalBPM}</div>
                <div class="lt-label">Avg BPM</div>
              </div>
              <div class="lifetime-item">
                <div class="lt-value">{median}</div>
                <div class="lt-label">Median</div>
              </div>
              {#if stdDev !== null}
                <div class="lifetime-item">
                  <div class="lt-value">{stdDev}</div>
                  <div class="lt-label">Std Dev</div>
                </div>
              {/if}
              {#if bpmRange}
                <div class="lifetime-item">
                  <div class="lt-value">{bpmRange[0]?.toFixed(0)}–{bpmRange[1]?.toFixed(0)}</div>
                  <div class="lt-label">Range</div>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- BPM Distribution -->
        {#if hasHistogramData(histogram)}
          <div class="dash-card">
            <h3>BPM Distribution</h3>
            <div class="mini-histogram">
              {#each getHistogramBars(histogram) as bar}
                <div class="hist-bar" style="height: {bar.height}%" title="{bar.bpm} BPM: {bar.count}"></div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Hourly Pattern -->
        {#if hasHourlyData(hourlyAvg)}
          <div class="dash-card">
            <h3>Tempo by Hour</h3>
            <div class="hourly-chart">
              {#each getHourlyBars(hourlyAvg) as bar}
                <div class="hourly-bar" class:empty={bar.bpm === null} style="height: {bar.height}%" title="{bar.hour}:00 — {bar.bpm ?? '—'} BPM"></div>
              {/each}
            </div>
            <div class="hour-labels">
              {#each Array(24) as _, h}
                <span>{h % 4 === 0 ? h + 'h' : ''}</span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Time Series Sparkline -->
        {#if timeSeries.length > 1}
          {@const minB = Math.min(...timeSeries.map(d => d.avgBPM))}
          {@const maxB = Math.max(...timeSeries.map(d => d.avgBPM))}
          {@const rangeB = maxB - minB || 1}
          <div class="dash-card">
            <h3>Avg BPM Over Time</h3>
            <svg class="sparkline" viewBox="0 0 {timeSeries.length - 1} 55" preserveAspectRatio="none">
              <defs>
                <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="rgba(99,102,241,0.3)" />
                  <stop offset="100%" stop-color="rgba(99,102,241,0)" />
                </linearGradient>
              </defs>
              <polyline class="area" points="{timeSeries.map((d, i) => `${i},${50 - ((d.avgBPM - minB) / rangeB) * 45}`).join(' ')} {timeSeries.length - 1},55 0,55" />
              <polyline points="{timeSeries.map((d, i) => `${i},${50 - ((d.avgBPM - minB) / rangeB) * 45}`).join(' ')}" />
            </svg>
          </div>
        {/if}

        <!-- Timezones -->
        {#if topTimezones.length > 0}
          <div class="dash-card">
            <h3>Timezones</h3>
            <ul class="tz-list">
              {#each topTimezones as tz}
                <li>
                  <span class="tz-name">{tz.tz}</span>
                  <span>
                    <span class="tz-bpm">{tz.avgBPM.toFixed(1)}</span>
                    <span class="tz-count"> · {tz.count}</span>
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Device Comparison -->
        {#if hasDeviceData(deviceStats)}
          <div class="dash-card">
            <h3>Device Comparison</h3>
            {#if deviceStats.mobileCount > 0}
              <div class="device-row">
                <span class="device-name">📱 Mobile</span>
                <span>
                  <span class="device-bpm">{deviceStats.mobile} BPM</span>
                  <span class="device-count"> · {deviceStats.mobileCount}</span>
                </span>
              </div>
            {/if}
            {#if deviceStats.desktopCount > 0}
              <div class="device-row">
                <span class="device-name">💻 Desktop</span>
                <span>
                  <span class="device-bpm">{deviceStats.desktop} BPM</span>
                  <span class="device-count"> · {deviceStats.desktopCount}</span>
                </span>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Export -->
        <div class="dash-card">
          <h3>Research Export</h3>
          <p style="font-size:0.75rem; opacity:0.4; margin-bottom:0.5rem;">Download time-series data as CSV for Excel, R, or Python.</p>
          <a class="export-btn" href="http://{getWsHost()}:8080/api/export" target="_blank">⬇ Download CSV</a>
        </div>
      </div>
    {/if}
  </div>
{/if}
