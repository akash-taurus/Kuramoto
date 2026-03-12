export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.particles = [];
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.globalBPM = 100;
    this.syncPhase = 0;
    
    // Resize hook
    window.addEventListener('resize', this.resize.bind(this));
    this.resize();
    this.loop();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  addTap(bpm, isLocal = false) {
    this.particles.push({
      x: this.width / 2 + (Math.random() * 200 - 100),
      y: this.height / 2 + (Math.random() * 200 - 100),
      bpm: bpm,
      life: 1.0,
      isLocal: isLocal,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2
    });
  }

  updateGlobalBPM(bpm, syncRatio = 0) {
    this.globalBPM = bpm;
    // syncRatio is between 0 and 1, mapping to Kuramoto Parameter
    this.syncPhase = syncRatio;
  }

  loop() {
    // Fading effect for trail
    this.ctx.fillStyle = 'rgba(13, 13, 13, 0.15)';
    this.ctx.fillRect(0, 0, this.width, this.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      let p = this.particles[i];

      // Pulse visualizer based on their explicit BPM
      p.life -= 0.005;
      
      p.x += p.vx;
      p.y += p.vy;

      // Draw
      const radius = p.isLocal ? 10 : 4;
      const alpha = p.life > 0 ? p.life : 0;
      
      // Color shifts based on sync
      const r = Math.floor(Math.min(255, p.bpm * 1.5));
      const g = Math.floor(this.syncPhase * 255);
      const b = 255 - r;

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      this.ctx.fill();

      // Core glow
      if (p.isLocal) {
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
      } else {
        this.ctx.shadowBlur = 5;
        this.ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
      }

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
    
    // Draw Global Ring pulse
    const beatInterval = 60000 / (this.globalBPM || 100);
    const time = performance.now();
    const phase = (time % beatInterval) / beatInterval;
    
    this.ctx.beginPath();
    this.ctx.arc(this.width / 2, this.height / 2, 50 + (phase * 150), 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(255, 255, 255, ${Math.max(0, 0.3 - phase)})`;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.shadowBlur = 0; // reset
    requestAnimationFrame(this.loop.bind(this));
  }
}
