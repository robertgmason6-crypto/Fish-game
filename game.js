/**
 * Fish Tank Simulator
 *
 * Rules:
 *  - Press "Add Fish" to spawn a fish.
 *  - Fish swim randomly around the tank.
 *  - After HUNGER_START_MS (20 s) without eating, a fish becomes hungry.
 *  - Click inside the tank to drop food.
 *  - A hungry fish detects food and swims rapidly toward it; eating resets hunger.
 *  - If a hungry fish is not fed within DEATH_AFTER_HUNGRY_MS (15 s) it dies.
 *  - Dead fish are shown briefly then removed.
 */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  const HUNGER_START_MS      = 20_000;   // time until fish becomes hungry
  const DEATH_AFTER_HUNGRY_MS = 15_000; // time hungry fish survives without food
  const NORMAL_SPEED         = 1.2;      // pixels per frame (~60 fps)
  const HUNGRY_SEEK_SPEED    = 3.0;
  const WANDER_SPEED_RANGE   = 0.6;      // random variation on top of base speed
  const DIRECTION_CHANGE_INTERVAL = 90;  // frames between random direction changes
  const FISH_RADIUS          = 14;
  const FOOD_RADIUS          = 5;
  const EAT_DISTANCE         = FISH_RADIUS + FOOD_RADIUS + 4;
  const DEAD_LINGER_MS       = 2_000;    // how long a dead fish is shown before removal

  // ── State ────────────────────────────────────────────────────────────────────
  const canvas  = document.getElementById('tank');
  const ctx     = canvas.getContext('2d');
  const countEl = document.getElementById('fish-count');

  const W = canvas.width;
  const H = canvas.height;

  /** @type {Fish[]} */
  const fishes = [];
  /** @type {Food[]} */
  const foods  = [];

  let lastTime  = 0;
  let nextFishId = 1;

  // ── Fish class ───────────────────────────────────────────────────────────────
  class Fish {
    constructor(x, y) {
      this.id    = nextFishId++;
      this.x     = x;
      this.y     = y;

      // choose a random initial heading
      const angle = Math.random() * Math.PI * 2;
      this.vx = Math.cos(angle) * NORMAL_SPEED;
      this.vy = Math.sin(angle) * NORMAL_SPEED;

      this.dirTimer      = 0;                 // frames until next random turn
      this.lastEatenTime = performance.now(); // timestamp of last meal
      this.hungryTime    = null;              // timestamp fish became hungry
      this.state         = 'normal';          // 'normal' | 'hungry' | 'dead'
      this.deadTime      = null;              // timestamp of death
      this.facingRight   = this.vx >= 0;

      // random hue so fish look different
      this.hue = Math.floor(Math.random() * 360);
    }

    /** @param {number} now  current timestamp in ms */
    update(now) {
      if (this.state === 'dead') return;

      // ── Hunger progression ──────────────────────────────────────────────────
      if (this.state === 'normal' && now - this.lastEatenTime >= HUNGER_START_MS) {
        this.state      = 'hungry';
        this.hungryTime = now;
      }

      if (this.state === 'hungry' && now - this.hungryTime >= DEATH_AFTER_HUNGRY_MS) {
        this.state   = 'dead';
        this.deadTime = now;
        return;
      }

      // ── Movement ────────────────────────────────────────────────────────────
      if (this.state === 'hungry' && foods.length > 0) {
        // seek nearest food
        const target = this._nearestFood();
        if (target) {
          const dx = target.x - this.x;
          const dy = target.y - this.y;
          const dist = Math.hypot(dx, dy);

          if (dist < EAT_DISTANCE) {
            // eat the food
            this._eatFood(target, now);
          } else {
            // steer toward food
            this.vx = (dx / dist) * HUNGRY_SEEK_SPEED;
            this.vy = (dy / dist) * HUNGRY_SEEK_SPEED;
          }
        } else {
          this._wander(HUNGRY_SEEK_SPEED);
        }
      } else {
        this._wander(NORMAL_SPEED);
      }

      // Move
      this.x += this.vx;
      this.y += this.vy;

      // Bounce off walls
      if (this.x - FISH_RADIUS < 0)  { this.x = FISH_RADIUS;  this.vx =  Math.abs(this.vx); }
      if (this.x + FISH_RADIUS > W)  { this.x = W - FISH_RADIUS; this.vx = -Math.abs(this.vx); }
      if (this.y - FISH_RADIUS < 0)  { this.y = FISH_RADIUS;  this.vy =  Math.abs(this.vy); }
      if (this.y + FISH_RADIUS > H)  { this.y = H - FISH_RADIUS; this.vy = -Math.abs(this.vy); }

      // Track facing direction for drawing
      if (Math.abs(this.vx) > 0.01) this.facingRight = this.vx > 0;
    }

    _wander(baseSpeed) {
      this.dirTimer--;
      if (this.dirTimer <= 0) {
        this.dirTimer = DIRECTION_CHANGE_INTERVAL + Math.floor(Math.random() * 61 - 30);
        const angle  = Math.random() * Math.PI * 2;
        const speed  = baseSpeed + (Math.random() - 0.5) * WANDER_SPEED_RANGE;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
      }
    }

    _nearestFood() {
      let best = null;
      let bestDist = Infinity;
      for (const f of foods) {
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < bestDist) { bestDist = d; best = f; }
      }
      return best;
    }

    _eatFood(food, now) {
      const idx = foods.indexOf(food);
      if (idx !== -1) foods.splice(idx, 1);
      this.lastEatenTime = now;
      this.state         = 'normal';
      this.hungryTime    = null;
    }

    draw() {
      const isDead   = this.state === 'dead';
      const isHungry = this.state === 'hungry';
      const alpha    = isDead ? 0.35 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x, this.y);
      if (!this.facingRight) ctx.scale(-1, 1);

      // ── Body ──────────────────────────────────────────────────────────────
      const bodyColor = isDead   ? '#888888'
                      : isHungry ? `hsl(${this.hue}, 90%, 55%)`
                                 : `hsl(${this.hue}, 70%, 70%)`;

      // body ellipse
      ctx.beginPath();
      ctx.ellipse(0, 0, FISH_RADIUS, FISH_RADIUS * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // tail
      ctx.beginPath();
      ctx.moveTo(-FISH_RADIUS + 2, 0);
      ctx.lineTo(-FISH_RADIUS - 8, -7);
      ctx.lineTo(-FISH_RADIUS - 8,  7);
      ctx.closePath();
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // eye
      ctx.beginPath();
      ctx.arc(FISH_RADIUS * 0.5, -2, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isDead ? '#555' : '#000';
      ctx.fill();
      if (!isDead) {
        ctx.beginPath();
        ctx.arc(FISH_RADIUS * 0.5 + 0.5, -2.5, 1, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }

      ctx.restore();

      // ── Hunger indicator (orange ring) ────────────────────────────────────
      if (isHungry) {
        ctx.save();
        ctx.strokeStyle = '#ffa040';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, FISH_RADIUS + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // "Hungry!" label
        ctx.save();
        ctx.fillStyle = '#ffa040';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Hungry!', this.x, this.y - FISH_RADIUS - 10);
        ctx.restore();
      }

      // ── Dead label ────────────────────────────────────────────────────────
      if (isDead) {
        ctx.save();
        ctx.fillStyle = '#ff4444';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💀', this.x, this.y - FISH_RADIUS - 6);
        ctx.restore();
      }
    }

    /** Returns true once the dead-linger period is over */
    shouldRemove(now) {
      return this.state === 'dead' && now - this.deadTime >= DEAD_LINGER_MS;
    }
  }

  // ── Food class ───────────────────────────────────────────────────────────────
  class Food {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }

    draw() {
      // Pellet
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.x, this.y, FOOD_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#c8f060';
      ctx.shadowColor = '#aaff00';
      ctx.shadowBlur  = 6;
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Game loop ────────────────────────────────────────────────────────────────
  function loop(timestamp) {
    const now = performance.now();
    ctx.clearRect(0, 0, W, H);

    // Draw water caustic shimmer (subtle)
    drawBackground();

    // Update & draw food
    for (const food of foods) food.draw();

    // Update & draw fish
    for (const fish of fishes) {
      fish.update(now);
      fish.draw();
    }

    // Remove fish that have lingered dead long enough
    for (let i = fishes.length - 1; i >= 0; i--) {
      if (fishes[i].shouldRemove(now)) fishes.splice(i, 1);
    }

    updateCount();
    requestAnimationFrame(loop);
  }

  function drawBackground() {
    // subtle bubble / caustic overlay to add depth
    const t = performance.now() / 1000;
    ctx.save();
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 6; i++) {
      const bx = ((Math.sin(t * 0.4 + i * 1.9) + 1) / 2) * W;
      const by = ((Math.cos(t * 0.3 + i * 2.3) + 1) / 2) * H;
      const r  = 30 + Math.sin(t + i) * 10;
      const g  = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0,   '#7ecfff');
      g.addColorStop(1,   'transparent');
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  function updateCount() {
    const alive = fishes.filter(f => f.state !== 'dead').length;
    countEl.textContent = `Fish: ${alive}`;
  }

  // ── User input ───────────────────────────────────────────────────────────────
  document.getElementById('add-fish-btn').addEventListener('click', () => {
    const margin = FISH_RADIUS + 10;
    const x = margin + Math.random() * (W - margin * 2);
    const y = margin + Math.random() * (H - margin * 2);
    fishes.push(new Fish(x, y));
    updateCount();
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;
    foods.push(new Food(x, y));
  });

  // ── Start ────────────────────────────────────────────────────────────────────
  requestAnimationFrame(loop);
})();
