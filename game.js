/**
 * Fish Tank Simulator
 *
 * Rules:
 *  - Use the shop bar to buy guppy fish ($100) or carnivore fish ($200).
 *  - Fish use a 3-mode movement system: drift (60%), swim (35%), dart (5%).
 *  - After HUNGER_START_MS (20 s) without eating, a fish becomes hungry.
 *  - Click inside the tank to drop food ($5 per pellet); food drifts to the bottom.
 *  - A hungry fish detects food and swims rapidly toward it; eating resets hunger.
 *  - If a hungry fish is not fed within DEATH_AFTER_HUNGRY_MS (15 s) it dies.
 *  - Dead fish flip upside-down and slowly drift to the tank bottom.
 *  - Fish grow: guppy (2 pellets) → medium (5 more) → large → king (40 more).
 *  - Medium fish drop $15 coins; large fish drop $30 coins; king and carnivore drop $200 diamonds.
 *  - Coins/diamonds drift down; click to collect.
 *  - Shop upgrades: better food, multi-food drop, auto feeder, tank level.
 */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  const HUNGER_START_MS       = 20_000;
  const DEATH_AFTER_HUNGRY_MS = 15_000;
  const NORMAL_SPEED          = 1.2;
  const HUNGRY_SEEK_SPEED     = 3.0;

  // Dead fish drift
  const DEAD_DRIFT_MAX   = 0.5;   // max downward px per frame
  const DEAD_DRIFT_ACCEL = 0.01;  // acceleration per frame
  const DEAD_BOTTOM_LINGER_MS = 1500; // ms to wait at bottom before removal

  // Fish sizes per growth stage
  const FISH_RADIUS_GUPPY  = 10;
  const FISH_RADIUS_MEDIUM = 15;
  const FISH_RADIUS_LARGE  = 22;
  const FISH_RADIUS_KING   = 30;

  // Growth thresholds (cumulative development points)
  const PELLETS_TO_MEDIUM = 2;
  const PELLETS_TO_LARGE  = 7;   // 2 + 5
  const PELLETS_TO_KING   = 47;  // 7 + 40

  // Fish drawing
  const TAIL_LENGTH_RATIO          = 0.57;
  const SMALL_FISH_LABEL_THRESHOLD = 12;

  // Swimming behaviour
  const SWIM_DRIFT_CHANCE   = 0.60;
  const SWIM_SLOW_CHANCE    = 0.95;  // cumulative: 0.60 + 0.35
  const SWIM_SLOW_MIN_SPEED = 0.4;
  const SWIM_SLOW_MAX_SPEED = 1.5;
  const SWIM_DART_SPEED     = 4.5;
  const SWIM_ACCEL          = 0.06;
  const DRIFT_INTERVAL_MIN  = 120;
  const DRIFT_INTERVAL_RANGE = 120;

  // Food
  const FOOD_RADIUS      = 5;
  const FOOD_DRIFT_SPEED = 1.0;   // doubled

  // Coins / Diamonds
  const COIN_RADIUS          = 14;  // doubled
  const DIAMOND_RADIUS       = 12;
  const COIN_DRIFT_SPEED     = 0.8; // doubled
  const COIN_CLICK_TOLERANCE = 4;
  const COIN_INTERVAL_MS     = 15_000;
  const COIN_VALUE_MEDIUM    = 15;
  const COIN_VALUE_LARGE     = 30;
  const COIN_VALUE_KING      = 200;
  const COIN_VALUE_CARNIVORE = 200;

  // Economy
  const STARTING_MONEY  = 500;
  const FISH_COST       = 100;
  const CARNIVORE_COST  = 1000;
  const FOOD_COST       = 5;

  // Upgrade costs / limits
  const FOOD_QUALITY_COST    = 200;
  const FOOD_QUALITY_MAX     = 2;
  const MULTI_FOOD_COST      = 200;
  const MULTI_FOOD_MAX       = 10;
  const AUTO_FEEDER_COST     = 1000;
  const TANK_LEVEL_BASE_COST = 1000;

  // ── State ────────────────────────────────────────────────────────────────────
  const canvas    = document.getElementById('tank');
  const ctx       = canvas.getContext('2d');
  const countEl   = document.getElementById('fish-count');
  const moneyEl   = document.getElementById('money-display');
  const noMoneyEl = document.getElementById('no-money-msg');

  const W = canvas.width;
  const H = canvas.height;

  /** @type {Fish[]} */
  const fishes = [];
  /** @type {Food[]} */
  const foods  = [];
  /** @type {Coin[]} */
  const coins  = [];

  let money        = STARTING_MONEY;
  let nextFishId   = 1;
  let noMoneyTimer = null;

  // Upgrades
  let foodQualityLevel = 0;   // 0–2; each level adds +1 dev point per pellet eaten
  let multiFoodLevel   = 1;   // 1–10 pellets dropped per click
  let autoFeeder       = false;
  let tankLevel        = 0;

  // ── Fish class ───────────────────────────────────────────────────────────────
  class Fish {
    /**
     * @param {number} x
     * @param {number} y
     * @param {'normal'|'carnivore'} type
     */
    constructor(x, y, type = 'normal') {
      this.id   = nextFishId++;
      this.x    = x;
      this.y    = y;
      this.type = type;

      const angle = Math.random() * Math.PI * 2;
      this.vx = Math.cos(angle) * NORMAL_SPEED;
      this.vy = Math.sin(angle) * NORMAL_SPEED;

      this.lastEatenTime = performance.now();
      this.hungryTime    = null;
      this.state         = 'normal';  // 'normal' | 'hungry' | 'dead'
      this.deadDriftVy   = 0;
      this.bottomTime    = null;      // timestamp when dead fish reached the bottom
      this.facingRight   = this.vx >= 0;

      // Carnivore fish have reddish hues; normal fish have any hue
      this.hue = type === 'carnivore'
        ? Math.floor(Math.random() * 30)
        : Math.floor(Math.random() * 360);

      // Growth (normal fish only)
      this.stage        = 'guppy';
      this.radius       = FISH_RADIUS_GUPPY;
      this.pelletsEaten = 0;

      // Coin drops
      this.lastCoinTime = performance.now();

      // Behaviour system
      this.behaviorType  = 'drift';
      this.behaviorTimer = DRIFT_INTERVAL_MIN + Math.floor(Math.random() * DRIFT_INTERVAL_RANGE);
      this.targetX       = null;
      this.targetY       = null;
      this.swimSpeed     = NORMAL_SPEED;
    }

    /** Dynamic eat distance based on current size */
    get eatDistance() {
      return this.radius + FOOD_RADIUS + 4;
    }

    /** @param {number} now  current timestamp in ms */
    update(now) {
      if (this.state === 'dead') {
        // Flip upside-down and slowly drift to the bottom
        this.deadDriftVy = Math.min(this.deadDriftVy + DEAD_DRIFT_ACCEL, DEAD_DRIFT_MAX);
        this.y += this.deadDriftVy;
        if (this.y >= H - this.radius) {
          this.y = H - this.radius;
          if (this.bottomTime === null) this.bottomTime = now;
        }
        return;
      }

      // ── Hunger progression ──────────────────────────────────────────────────
      if (this.state === 'normal' && now - this.lastEatenTime >= HUNGER_START_MS) {
        this.state      = 'hungry';
        this.hungryTime = now;
        // Auto feeder: drop a pellet near the fish when it becomes hungry
        if (autoFeeder && money >= FOOD_COST) {
          money -= FOOD_COST;
          updateMoney();
          foods.push(new Food(this.x, this.y));
        }
      }

      if (this.state === 'hungry' && now - this.hungryTime >= DEATH_AFTER_HUNGRY_MS) {
        this.state = 'dead';
        return;
      }

      // ── Coin drops ──────────────────────────────────────────────────────────
      const dropsCoin = this.stage === 'medium' || this.stage === 'large' ||
                        this.stage === 'king'   || this.type  === 'carnivore';
      if (dropsCoin && now - this.lastCoinTime >= COIN_INTERVAL_MS) {
        let value = COIN_VALUE_MEDIUM;
        let coinType = 'coin';
        if (this.stage === 'large')      { value = COIN_VALUE_LARGE;     coinType = 'coin';    }
        if (this.stage === 'king')       { value = COIN_VALUE_KING;      coinType = 'diamond'; }
        if (this.type  === 'carnivore')  { value = COIN_VALUE_CARNIVORE; coinType = 'diamond'; }
        coins.push(new Coin(this.x, this.y, value, coinType));
        this.lastCoinTime = now;
      }

      // ── Movement ────────────────────────────────────────────────────────────
      if (this.type === 'carnivore') {
        this._carnivoreMove();
      } else if (this.state === 'hungry' && foods.length > 0) {
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
      if (this.x + r > W)  { this.x = W - r; this.vx = -Math.abs(this.vx); }
      if (this.y - r < 0)  { this.y = r;     this.vy =  Math.abs(this.vy); }
      if (this.y + r > H)  { this.y = H - r; this.vy = -Math.abs(this.vy); }

      if (Math.abs(this.vx) > 0.01) this.facingRight = this.vx > 0;
    }

    // ── Carnivore movement: seek and eat the nearest guppy ───────────────────
    _carnivoreMove() {
      const prey = this._nearestGuppy();
      if (prey) {
        const dx   = prey.x - this.x;
        const dy   = prey.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < this.radius + prey.radius + 4) {
          // Eat the guppy
          const idx = fishes.indexOf(prey);
          if (idx !== -1) fishes.splice(idx, 1);
          updateCount();
        } else {
          const speed = NORMAL_SPEED * 1.5;
          this.vx = (dx / dist) * speed;
          this.vy = (dy / dist) * speed;
        }
      } else {
        this._wander(NORMAL_SPEED);
      }
    }

    _nearestGuppy() {
      let best = null, bestDist = Infinity;
      for (const f of fishes) {
        if (f === this || f.type !== 'normal' || f.stage !== 'guppy' || f.state === 'dead') continue;
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < bestDist) { bestDist = d; best = f; }
      }
      return best;
    }

    // ── 3-mode wander system ─────────────────────────────────────────────────
    _wander(baseSpeed) {
      if (this.behaviorType === 'drift') {
        this.behaviorTimer--;
        if (this.behaviorTimer <= 0) this._pickBehavior(baseSpeed);
        // Coast — no velocity change

      } else if (this.behaviorType === 'swim') {
        const dx   = this.targetX - this.x;
        const dy   = this.targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 5) {
          this._pickBehavior(baseSpeed);
        } else {
          // Gradually accelerate towards target
          const targetVx = (dx / dist) * this.swimSpeed;
          const targetVy = (dy / dist) * this.swimSpeed;
          this.vx += (targetVx - this.vx) * SWIM_ACCEL;
          this.vy += (targetVy - this.vy) * SWIM_ACCEL;
        }

      } else {  // 'dart'
        const dx   = this.targetX - this.x;
        const dy   = this.targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 5) {
          this._pickBehavior(baseSpeed);
        } else {
          this.vx = (dx / dist) * SWIM_DART_SPEED;
          this.vy = (dy / dist) * SWIM_DART_SPEED;
        }
      }
    }

    /** Pick the next behaviour: drift 60%, swim 35%, dart 5% */
    _pickBehavior(baseSpeed) {
      const roll = Math.random();
      if (roll < SWIM_DRIFT_CHANCE) {
        this.behaviorType  = 'drift';
        this.behaviorTimer = DRIFT_INTERVAL_MIN + Math.floor(Math.random() * DRIFT_INTERVAL_RANGE);
      } else if (roll < SWIM_SLOW_CHANCE) {
        this.behaviorType = 'swim';
        this.targetX      = this.radius + Math.random() * (W - this.radius * 2);
        this.targetY      = this.radius + Math.random() * (H - this.radius * 2);
        this.swimSpeed    = SWIM_SLOW_MIN_SPEED +
                            Math.random() * (SWIM_SLOW_MAX_SPEED - SWIM_SLOW_MIN_SPEED);
      } else {
        this.behaviorType = 'dart';
        const angle = Math.random() * Math.PI * 2;
        this.targetX = Math.max(this.radius, Math.min(W - this.radius,
                                this.x + Math.cos(angle) * 250));
        this.targetY = Math.max(this.radius, Math.min(H - this.radius,
                                this.y + Math.sin(angle) * 250));
      }
    }

    _nearestFood() {
      let best = null, bestDist = Infinity;
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
      // Each upgrade level adds +1 development point per pellet
      this.pelletsEaten += 1 + foodQualityLevel;
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
      } else if (this.stage === 'large' && this.pelletsEaten >= PELLETS_TO_KING) {
        this.stage  = 'king';
        this.radius = FISH_RADIUS_KING;
      }
    }

    draw(now) {
      const isDead      = this.state === 'dead';
      const isHungry    = this.state === 'hungry';
      const isCarnivore = this.type  === 'carnivore';
      const isKing      = this.stage === 'king';
      const alpha       = isDead ? 0.45 : 1;
      const r           = this.radius;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x, this.y);
      if (isDead) ctx.scale(1, -1);           // flip upside-down when dead
      if (!this.facingRight) ctx.scale(-1, 1);

      // Body colour
      let bodyColor;
      if (isDead) {
        bodyColor = '#888888';
      } else if (isCarnivore) {
        bodyColor = isHungry ? `hsl(${this.hue}, 90%, 45%)` : `hsl(${this.hue}, 80%, 55%)`;
      } else if (isKing) {
        bodyColor = isHungry ? 'hsl(50,90%,55%)' : 'hsl(45,100%,65%)';
      } else {
        bodyColor = isHungry ? `hsl(${this.hue}, 90%, 55%)` : `hsl(${this.hue}, 70%, 70%)`;
      }

      // Body ellipse
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // King fish crown
      if (isKing && !isDead) {
        ctx.beginPath();
        ctx.fillStyle = '#ffd700';
        ctx.moveTo(-r * 0.3, -r * 0.6);
        ctx.lineTo(-r * 0.1, -r * 1.05);
        ctx.lineTo( r * 0.1, -r * 0.72);
        ctx.lineTo( r * 0.3, -r * 1.05);
        ctx.lineTo( r * 0.5, -r * 0.6);
        ctx.fill();
      }

      // Tail
      ctx.beginPath();
      ctx.moveTo(-r + 2, 0);
      ctx.lineTo(-r - r * TAIL_LENGTH_RATIO, -r * 0.5);
      ctx.lineTo(-r - r * TAIL_LENGTH_RATIO,  r * 0.5);
      ctx.closePath();
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // Dorsal fin (medium, large, king, carnivore)
      if (this.stage !== 'guppy' || isCarnivore) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, -r * 0.6);
        ctx.quadraticCurveTo(0, -r * 1.2, r * 0.3, -r * 0.6);
        ctx.closePath();
        ctx.fillStyle = isCarnivore
          ? `hsl(${this.hue}, 70%, 40%)`
          : (isKing ? 'hsl(45,80%,50%)' : `hsl(${this.hue}, 60%, 55%)`);
        ctx.fill();
      }

      // Pectoral fin (large and king)
      if (this.stage === 'large' || isKing) {
        ctx.beginPath();
        ctx.ellipse(0, r * 0.4, r * 0.35, r * 0.18, Math.PI / 5, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${this.hue}, 50%, 60%)`;
        ctx.fill();
      }

      // Eye
      ctx.beginPath();
      ctx.arc(r * 0.5, -r * 0.14, r * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = isDead ? '#555' : (isCarnivore ? '#cc0000' : '#000');
      ctx.fill();
      if (!isDead) {
        ctx.beginPath();
        ctx.arc(r * 0.5 + 0.5, -r * 0.18, r * 0.07, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }

      ctx.restore();

      // ── Hunger indicator (drawn in world-space so it's never flipped) ─────
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

      // ── Stage / type label ────────────────────────────────────────────────
      if (!isDead && !isHungry) {
        const label = isCarnivore ? 'carnivore'
                    : isKing      ? '👑 king'
                    : this.stage === 'guppy'  ? 'guppy'
                    : this.stage === 'medium' ? 'medium'
                                              : 'large';
        ctx.save();
        ctx.fillStyle = isKing ? 'rgba(255,215,0,0.9)' : 'rgba(200,230,255,0.7)';
        ctx.font      = `${r < SMALL_FISH_LABEL_THRESHOLD ? 8 : 9}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(label, this.x, this.y + r + 13);
        ctx.restore();
      }
    }

    /** Remove dead fish once they have settled at the bottom for a short time */
    shouldRemove(now) {
      return this.state === 'dead' &&
             this.bottomTime !== null &&
             now - this.bottomTime >= DEAD_BOTTOM_LINGER_MS;
    }
  }

  // ── Food class ───────────────────────────────────────────────────────────────
  class Food {
    constructor(x, y) {
      this.x    = x;
      this.y    = y;
      this.gone = false;
    }

    update() {
      if (!this.gone) {
        this.y += FOOD_DRIFT_SPEED;
        if (this.y >= H - FOOD_RADIUS) this.gone = true;
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

  // ── Coin / Diamond class ─────────────────────────────────────────────────────
  class Coin {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} value
     * @param {'coin'|'diamond'} type
     */
    constructor(x, y, value, type = 'coin') {
      this.x      = x;
      this.y      = y;
      this.value  = value;
      this.type   = type;
      this.gone   = false;
      this.radius = type === 'diamond' ? DIAMOND_RADIUS : COIN_RADIUS;
    }

    update() {
      if (!this.gone) {
        this.y += COIN_DRIFT_SPEED;
        if (this.y >= H - this.radius) this.gone = true;
      }
    }

    /** Returns true if canvas point (px, py) is inside this coin/diamond. */
    contains(px, py) {
      return Math.hypot(px - this.x, py - this.y) <= this.radius + COIN_CLICK_TOLERANCE;
    }

    /** Collect the coin: award money and mark it gone. */
    collect() {
      this.gone  = true;
      money     += this.value;
      updateMoney();
    }

    draw() {
      if (this.type === 'diamond') {
        this._drawDiamond();
      } else {
        this._drawCoin();
      }
    }

    _drawCoin() {
      const r = this.radius;
      ctx.save();

      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle   = '#ffd700';
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur  = 8;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 0;
      ctx.stroke();

      ctx.fillStyle    = '#7a4e00';
      ctx.font         = 'bold 9px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${this.value}`, this.x, this.y);

      ctx.restore();
    }

    _drawDiamond() {
      const r = this.radius;
      ctx.save();

      ctx.beginPath();
      ctx.moveTo(this.x,           this.y - r);
      ctx.lineTo(this.x + r * 0.7, this.y);
      ctx.lineTo(this.x,           this.y + r);
      ctx.lineTo(this.x - r * 0.7, this.y);
      ctx.closePath();

      const grad = ctx.createLinearGradient(this.x - r, this.y - r, this.x + r, this.y + r);
      grad.addColorStop(0,   '#b0e8ff');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(1,   '#7ec8ff');
      ctx.fillStyle   = grad;
      ctx.shadowColor = '#00aaff';
      ctx.shadowBlur  = 10;
      ctx.fill();

      ctx.strokeStyle = '#4080c0';
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 0;
      ctx.stroke();

      ctx.fillStyle    = '#004080';
      ctx.font         = 'bold 8px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${this.value}`, this.x, this.y + 2);

      ctx.restore();
    }
  }

  // ── Game loop ────────────────────────────────────────────────────────────────
  function loop(timestamp) {
    const now = timestamp;
    ctx.clearRect(0, 0, W, H);

    drawBackground();

    for (const food of foods) { food.update(); food.draw(); }
    for (const coin of coins) { coin.update(); coin.draw(); }
    for (const fish of fishes) { fish.update(now); fish.draw(now); }

    for (let i = foods.length  - 1; i >= 0; i--) { if (foods[i].gone)             foods.splice(i, 1); }
    for (let i = fishes.length - 1; i >= 0; i--) { if (fishes[i].shouldRemove(now)) fishes.splice(i, 1); }
    for (let i = coins.length  - 1; i >= 0; i--) { if (coins[i].gone)             coins.splice(i, 1); }

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

  /** Spawn a fish at a random location inside the tank */
  function spawnFish(type = 'normal') {
    const cost   = type === 'carnivore' ? CARNIVORE_COST : FISH_COST;
    const radius = FISH_RADIUS_GUPPY;
    if (money < cost) { flashNoMoney(); return; }
    money -= cost;
    updateMoney();
    const margin = radius + 10;
    const x = margin + Math.random() * (W - margin * 2);
    const y = margin + Math.random() * (H - margin * 2);
    fishes.push(new Fish(x, y, type));
    updateCount();
  }

  // ── Shop button helpers ───────────────────────────────────────────────────────
  function refreshShopButtons() {
    const fqBtn  = document.getElementById('food-quality-btn');
    const mfBtn  = document.getElementById('multi-food-btn');
    const afBtn  = document.getElementById('auto-feeder-btn');
    const tlBtn  = document.getElementById('tank-level-btn');

    fqBtn.textContent = `Better Food ($${FOOD_QUALITY_COST}) [${foodQualityLevel}/${FOOD_QUALITY_MAX}]`;
    fqBtn.disabled    = foodQualityLevel >= FOOD_QUALITY_MAX;

    mfBtn.textContent = `Multi-Food ($${MULTI_FOOD_COST}) [${multiFoodLevel}×/${MULTI_FOOD_MAX}×]`;
    mfBtn.disabled    = multiFoodLevel >= MULTI_FOOD_MAX;

    afBtn.textContent = autoFeeder ? 'Auto Feeder (owned)' : `Auto Feeder ($${AUTO_FEEDER_COST})`;
    afBtn.disabled    = autoFeeder;

    const tlCost = TANK_LEVEL_BASE_COST * Math.pow(2, tankLevel);
    tlBtn.textContent = `Tank Level Up ($${tlCost}) [Lv.${tankLevel}]`;
  }

  // ── User input ───────────────────────────────────────────────────────────────
  document.getElementById('add-fish-btn').addEventListener('click', () => spawnFish('normal'));
  document.getElementById('add-carnivore-btn').addEventListener('click', () => spawnFish('carnivore'));

  document.getElementById('food-quality-btn').addEventListener('click', () => {
    if (foodQualityLevel >= FOOD_QUALITY_MAX || money < FOOD_QUALITY_COST) { flashNoMoney(); return; }
    money -= FOOD_QUALITY_COST;
    foodQualityLevel++;
    updateMoney();
    refreshShopButtons();
  });

  document.getElementById('multi-food-btn').addEventListener('click', () => {
    if (multiFoodLevel >= MULTI_FOOD_MAX || money < MULTI_FOOD_COST) { flashNoMoney(); return; }
    money -= MULTI_FOOD_COST;
    multiFoodLevel++;
    updateMoney();
    refreshShopButtons();
  });

  document.getElementById('auto-feeder-btn').addEventListener('click', () => {
    if (autoFeeder || money < AUTO_FEEDER_COST) { flashNoMoney(); return; }
    money -= AUTO_FEEDER_COST;
    autoFeeder = true;
    updateMoney();
    refreshShopButtons();
  });

  document.getElementById('tank-level-btn').addEventListener('click', () => {
    const cost = TANK_LEVEL_BASE_COST * Math.pow(2, tankLevel);
    if (money < cost) { flashNoMoney(); return; }
    money -= cost;
    tankLevel++;
    updateMoney();
    refreshShopButtons();
  });

  canvas.addEventListener('click', (e) => {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    // Check if a coin was clicked first
    for (let i = coins.length - 1; i >= 0; i--) {
      if (!coins[i].gone && coins[i].contains(cx, cy)) {
        coins[i].collect();
        return;  // consume the click — don't drop food
      }
    }

    // Drop multiFoodLevel pellets (costs FOOD_COST each)
    const totalCost = FOOD_COST * multiFoodLevel;
    if (money < totalCost) { flashNoMoney(); return; }
    money -= totalCost;
    updateMoney();

    const spread = multiFoodLevel > 1 ? 20 : 0;
    for (let i = 0; i < multiFoodLevel; i++) {
      const px = cx + (Math.random() - 0.5) * spread;
      const py = cy + (Math.random() - 0.5) * spread;
      foods.push(new Food(px, py));
    }
  });

  // ── Start ────────────────────────────────────────────────────────────────────
  updateMoney();
  refreshShopButtons();
  requestAnimationFrame(loop);
})();
