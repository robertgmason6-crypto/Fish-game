/**
 * Fish Tank Simulator
 *
 * Rules:
 *  - Press "Add Fish" ($100) to spawn a guppy.
 *  - Fish swim randomly around the tank.
 *  - After HUNGER_START_MS (20 s) without eating, a fish becomes hungry.
 *  - Click inside the tank to drop food ($5 per pellet); food drifts to the bottom and disappears.
 *  - A hungry fish detects food and swims rapidly toward it; eating resets hunger.
 *  - If a hungry fish is not fed within DEATH_AFTER_HUNGRY_MS (15 s) it dies.
 *  - Dead fish are shown briefly then removed.
 *  - Fish grow: guppy (2 pellets) → medium (5 more pellets) → large.
 *  - Medium fish drop $15 coins every 15 s; large fish drop $30 coins.
 *  - Coins drift to the bottom and disappear; click a coin to collect it.
 */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  const HUNGER_START_MS         = 20_000;
  const DEATH_AFTER_HUNGRY_MS   = 15_000;
  const NORMAL_SPEED            = 1.2;
  const HUNGRY_SEEK_SPEED       = 3.0;
  const WANDER_SPEED_RANGE      = 0.6;
  const DIRECTION_CHANGE_INTERVAL = 90;
  const DEAD_LINGER_MS          = 2_000;

  // Fish sizes per growth stage
  const FISH_RADIUS_GUPPY  = 10;
  const FISH_RADIUS_MEDIUM = 15;
  const FISH_RADIUS_LARGE  = 22;

  // Growth thresholds (cumulative pellets eaten)
  const PELLETS_TO_MEDIUM = 2;
  const PELLETS_TO_LARGE  = 2 + 5;   // 7 total

  // Fish drawing ratios
  const TAIL_LENGTH_RATIO  = 0.57;   // tail overhang relative to radius
  const SMALL_FISH_LABEL_THRESHOLD = 12;  // radius below which smaller label font is used

  // Food
  const FOOD_RADIUS      = 5;
  const FOOD_DRIFT_SPEED = 0.5;      // px per frame

  // Coins
  const COIN_RADIUS       = 7;
  const COIN_DRIFT_SPEED  = 0.4;
  const COIN_CLICK_TOLERANCE = 4;  // extra px around coin radius for easier clicking
  const COIN_INTERVAL_MS  = 15_000;
  const COIN_VALUE_MEDIUM = 15;
  const COIN_VALUE_LARGE  = 30;

  // Economy
  const STARTING_MONEY = 500;
  const FISH_COST      = 100;
  const FOOD_COST      = 5;

  // ── State ────────────────────────────────────────────────────────────────────
  const canvas   = document.getElementById('tank');
  const ctx      = canvas.getContext('2d');
  const countEl  = document.getElementById('fish-count');
  const moneyEl  = document.getElementById('money-display');
  const noMoneyEl = document.getElementById('no-money-msg');

  const W = canvas.width;
  const H = canvas.height;

  /** @type {Fish[]} */
  const fishes = [];
  /** @type {Food[]} */
  const foods  = [];
  /** @type {Coin[]} */
  const coins  = [];

  let money      = STARTING_MONEY;
  let nextFishId = 1;
  let noMoneyTimer = null;

  // ── Fish class ───────────────────────────────────────────────────────────────
  class Fish {
    constructor(x, y) {
      this.id    = nextFishId++;
      this.x     = x;
      this.y     = y;

      const angle = Math.random() * Math.PI * 2;
      this.vx = Math.cos(angle) * NORMAL_SPEED;
      this.vy = Math.sin(angle) * NORMAL_SPEED;

      this.dirTimer      = 0;
      this.lastEatenTime = performance.now();
      this.hungryTime    = null;
      this.state         = 'normal';   // 'normal' | 'hungry' | 'dead'
      this.deadTime      = null;
      this.facingRight   = this.vx >= 0;

      this.hue = Math.floor(Math.random() * 360);

      // Growth
      this.stage        = 'guppy';             // 'guppy' | 'medium' | 'large'
      this.radius       = FISH_RADIUS_GUPPY;
      this.pelletsEaten = 0;

      // Coin drops
      this.lastCoinTime = performance.now();
    }

    /** Dynamic eat distance based on current size */
    get eatDistance() {
      return this.radius + FOOD_RADIUS + 4;
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
        this.state    = 'dead';
        this.deadTime = now;
        return;
      }

      // ── Coin drops (medium and large fish only) ─────────────────────────────
      if ((this.stage === 'medium' || this.stage === 'large') &&
          now - this.lastCoinTime >= COIN_INTERVAL_MS) {
        const value = this.stage === 'medium' ? COIN_VALUE_MEDIUM : COIN_VALUE_LARGE;
        coins.push(new Coin(this.x, this.y, value));
        this.lastCoinTime = now;
      }

      // ── Movement ────────────────────────────────────────────────────────────
      if (this.state === 'hungry' && foods.length > 0) {
        const target = this._nearestFood();
        if (target) {
          const dx   = target.x - this.x;
          const dy   = target.y - this.y;
          const dist = Math.hypot(dx, dy);

          if (dist < this.eatDistance) {
            this._eatFood(target, now);
          } else {
            this.vx = (dx / dist) * HUNGRY_SEEK_SPEED;
            this.vy = (dy / dist) * HUNGRY_SEEK_SPEED;
          }
        } else {
          this._wander(HUNGRY_SEEK_SPEED);
        }
      } else {
        this._wander(NORMAL_SPEED);
      }

      this.x += this.vx;
      this.y += this.vy;

      const r = this.radius;
      if (this.x - r < 0)  { this.x = r;     this.vx =  Math.abs(this.vx); }
      if (this.x + r > W)  { this.x = W - r;  this.vx = -Math.abs(this.vx); }
      if (this.y - r < 0)  { this.y = r;     this.vy =  Math.abs(this.vy); }
      if (this.y + r > H)  { this.y = H - r;  this.vy = -Math.abs(this.vy); }

      if (Math.abs(this.vx) > 0.01) this.facingRight = this.vx > 0;
    }

    _wander(baseSpeed) {
      this.dirTimer--;
      if (this.dirTimer <= 0) {
        this.dirTimer = DIRECTION_CHANGE_INTERVAL + Math.floor(Math.random() * 61 - 30);
        const angle   = Math.random() * Math.PI * 2;
        const speed   = baseSpeed + (Math.random() - 0.5) * WANDER_SPEED_RANGE;
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
      this.pelletsEaten++;
      this._checkGrowth();
    }

    _checkGrowth() {
      if (this.stage === 'guppy' && this.pelletsEaten >= PELLETS_TO_MEDIUM) {
        this.stage        = 'medium';
        this.radius       = FISH_RADIUS_MEDIUM;
        this.lastCoinTime = performance.now();
      } else if (this.stage === 'medium' && this.pelletsEaten >= PELLETS_TO_LARGE) {
        this.stage  = 'large';
        this.radius = FISH_RADIUS_LARGE;
      }
    }

    draw(now) {
      const isDead   = this.state === 'dead';
      const isHungry = this.state === 'hungry';
      const alpha    = isDead ? 0.35 : 1;
      const r        = this.radius;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x, this.y);
      if (!this.facingRight) ctx.scale(-1, 1);

      // ── Body ──────────────────────────────────────────────────────────────
      const bodyColor = isDead   ? '#888888'
                      : isHungry ? `hsl(${this.hue}, 90%, 55%)`
                                 : `hsl(${this.hue}, 70%, 70%)`;

      // Body ellipse (scaled with radius)
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // Tail
      ctx.beginPath();
      ctx.moveTo(-r + 2, 0);
      ctx.lineTo(-r - r * TAIL_LENGTH_RATIO, -r * 0.5);
      ctx.lineTo(-r - r * TAIL_LENGTH_RATIO,  r * 0.5);
      ctx.closePath();
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // Dorsal fin for medium and large fish
      if (this.stage === 'medium' || this.stage === 'large') {
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, -r * 0.6);
        ctx.quadraticCurveTo(0, -r * 1.2, r * 0.3, -r * 0.6);
        ctx.closePath();
        ctx.fillStyle = `hsl(${this.hue}, 60%, 55%)`;
        ctx.fill();
      }

      // Extra details for fully grown (large) fish: pectoral fin
      if (this.stage === 'large') {
        ctx.beginPath();
        ctx.ellipse(0, r * 0.4, r * 0.35, r * 0.18, Math.PI / 5, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${this.hue}, 50%, 60%)`;
        ctx.fill();
      }

      // Eye
      ctx.beginPath();
      ctx.arc(r * 0.5, -r * 0.14, r * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = isDead ? '#555' : '#000';
      ctx.fill();
      if (!isDead) {
        ctx.beginPath();
        ctx.arc(r * 0.5 + 0.5, -r * 0.18, r * 0.07, 0, Math.PI * 2);
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
        ctx.arc(this.x, this.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = '#ffa040';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Hungry!', this.x, this.y - r - 10);
        ctx.restore();
      }

      // ── Dead label ────────────────────────────────────────────────────────
      if (isDead) {
        ctx.save();
        ctx.fillStyle = '#ff4444';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💀', this.x, this.y - r - 6);
        ctx.restore();
      }

      // ── Stage label ───────────────────────────────────────────────────────
      if (!isDead && !isHungry) {
        const label = this.stage === 'guppy'  ? 'guppy'
                    : this.stage === 'medium' ? 'medium'
                                              : 'large';
        ctx.save();
        ctx.fillStyle    = 'rgba(200,230,255,0.7)';
        ctx.font         = `${r < SMALL_FISH_LABEL_THRESHOLD ? 8 : 9}px Arial`;
        ctx.textAlign    = 'center';
        ctx.fillText(label, this.x, this.y + r + 13);
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
      this.x       = x;
      this.y       = y;
      this.gone    = false;  // true once the pellet hits the bottom
    }

    update() {
      if (!this.gone) {
        this.y += FOOD_DRIFT_SPEED;
        if (this.y >= H - FOOD_RADIUS) {
          this.gone = true;  // disappear at the bottom
        }
      }
    }

    draw() {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.x, this.y, FOOD_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle   = '#c8f060';
      ctx.shadowColor = '#aaff00';
      ctx.shadowBlur  = 6;
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Coin class ───────────────────────────────────────────────────────────────
  class Coin {
    constructor(x, y, value) {
      this.x     = x;
      this.y     = y;
      this.value = value;
      this.gone  = false;  // true once collected or it hits the bottom
    }

    update() {
      if (!this.gone) {
        this.y += COIN_DRIFT_SPEED;
        if (this.y >= H - COIN_RADIUS) {
          this.gone = true;  // disappear at the bottom uncollected
        }
      }
    }

    /** Returns true if canvas point (cx, cy) is inside this coin. */
    contains(cx, cy) {
      return Math.hypot(cx - this.x, cy - this.y) <= COIN_RADIUS + COIN_CLICK_TOLERANCE;
    }

    /** Collect the coin: award money and mark it gone. */
    collect() {
      this.gone = true;
      money += this.value;
      updateMoney();
    }

    draw() {
      ctx.save();

      // Coin body
      ctx.beginPath();
      ctx.arc(this.x, this.y, COIN_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle   = '#ffd700';
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur  = 8;
      ctx.fill();

      // Coin rim
      ctx.beginPath();
      ctx.arc(this.x, this.y, COIN_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 0;
      ctx.stroke();

      // Value label
      ctx.fillStyle    = '#7a4e00';
      ctx.font         = 'bold 7px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur   = 0;
      ctx.fillText(`$${this.value}`, this.x, this.y);

      ctx.restore();
    }
  }

  // ── Game loop ────────────────────────────────────────────────────────────────
  function loop(timestamp) {
    const now = timestamp;
    ctx.clearRect(0, 0, W, H);

    drawBackground();

    // Update & draw food
    for (const food of foods) {
      food.update();
      food.draw();
    }

    // Update & draw coins
    for (const coin of coins) {
      coin.update();
      coin.draw();
    }

    // Update & draw fish
    for (const fish of fishes) {
      fish.update(now);
      fish.draw(now);
    }

    // Remove food pellets that have gone (reached the bottom or been eaten)
    for (let i = foods.length - 1; i >= 0; i--) {
      if (foods[i].gone) foods.splice(i, 1);
    }

    // Remove fish that have lingered dead long enough
    for (let i = fishes.length - 1; i >= 0; i--) {
      if (fishes[i].shouldRemove(now)) fishes.splice(i, 1);
    }

    // Remove coins that have been collected or reached the bottom
    for (let i = coins.length - 1; i >= 0; i--) {
      if (coins[i].gone) coins.splice(i, 1);
    }

    updateCount();
    requestAnimationFrame(loop);
  }

  function drawBackground() {
    const t = performance.now() / 1000;
    ctx.save();
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 6; i++) {
      const bx = ((Math.sin(t * 0.4 + i * 1.9) + 1) / 2) * W;
      const by = ((Math.cos(t * 0.3 + i * 2.3) + 1) / 2) * H;
      const r  = 30 + Math.sin(t + i) * 10;
      const g  = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, '#7ecfff');
      g.addColorStop(1, 'transparent');
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

  function updateMoney() {
    moneyEl.textContent = `💰 $${money}`;
  }

  function flashNoMoney() {
    noMoneyEl.classList.remove('hidden');
    if (noMoneyTimer) clearTimeout(noMoneyTimer);
    noMoneyTimer = setTimeout(() => noMoneyEl.classList.add('hidden'), 1500);
  }

  // ── User input ───────────────────────────────────────────────────────────────
  document.getElementById('add-fish-btn').addEventListener('click', () => {
    if (money < FISH_COST) {
      flashNoMoney();
      return;
    }
    money -= FISH_COST;
    updateMoney();

    const margin = FISH_RADIUS_GUPPY + 10;
    const x = margin + Math.random() * (W - margin * 2);
    const y = margin + Math.random() * (H - margin * 2);
    fishes.push(new Fish(x, y));
    updateCount();
  });

  canvas.addEventListener('click', (e) => {
    const rect  = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    // Check if a coin was clicked first
    for (let i = coins.length - 1; i >= 0; i--) {
      if (!coins[i].gone && coins[i].contains(cx, cy)) {
        coins[i].collect();
        return;   // consume the click — don't drop food
      }
    }

    // Otherwise drop a food pellet
    if (money < FOOD_COST) {
      flashNoMoney();
      return;
    }
    money -= FOOD_COST;
    updateMoney();
    foods.push(new Food(cx, cy));
  });

  // ── Start ────────────────────────────────────────────────────────────────────
  updateMoney();
  requestAnimationFrame(loop);
})();
