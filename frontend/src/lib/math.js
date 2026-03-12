// Math.js
// Handles precise high-frequency precision tapping calculations

export class SyncStats {
  constructor() {
    this.taps = [];
  }

  // Returns array [currentBPM, variance] or null if not enough
  pushLocalTap(now) {
    this.taps.push(now);
    
    // Only keep last 8 taps
    if (this.taps.length > 8) {
      this.taps.shift();
    }
    
    if (this.taps.length < 2) return null;

    let intervals = [];
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i] - this.taps[i - 1]);
    }
    
    // Simple arithmetic mean of intervals
    const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
    
    // Variance/Jitter
    const variance = intervals.reduce((v, t) => v + Math.pow(t - avgInterval, 2), 0) / intervals.length;
    
    // Convert ms interval to Beats Per Minute
    const bpm = 60000 / avgInterval;
    
    if (bpm > 300 || bpm < 30) return null; // Reject impossible outliers
    
    return {
      bpm: Number(bpm.toFixed(2)),
      variance: Number(variance.toFixed(2))
    };
  }
}

// Global Order Parameter (Kuramoto R value calculation for the backend)
export function calculateKuramoto(phaseAngles) {
  if (!phaseAngles || phaseAngles.length === 0) return 0;
  
  let sumSin = 0;
  let sumCos = 0;
  
  for (let theta of phaseAngles) {
    sumSin += Math.sin(theta);
    sumCos += Math.cos(theta);
  }
  
  const N = phaseAngles.length;
  // Kuramoto Order Parameter `R`
  const r = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / N;
  return r; // 0 is Total Chaos, 1 is Perfect Pulse Synchronization
}
