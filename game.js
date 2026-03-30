/**
 * Fish Tank Simulator
 *
 * Tank 1 – Original tank with guppies, carnivore, growth, coins/diamonds.
 * Tank 2 – Clown-fish tank: male/female clownfish, coral, nesting, sell tool.
 *
 * Changes vs. original:
 *  - All fish, coin and diamond sizes doubled.
 *  - Drift mode velocity capped to DRIFT_MAX_SPEED (momentum neutered).
 *  - Multi-food rework: upgrade raises max pellets allowed in tank at once
 *    (starts at 1); clicking drops one pellet; blocked when at cap.
 *  - Auto feeder drops pellet at top-centre of tank when a fish gets hungry.
 *  - Carnivore is bigger than king fish and follows the same hunger/death
 *    timing as a regular fish (eating a guppy resets its hunger).
 */

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────────
  const HUNGER_START_MS       = 20_000;
  const DEATH_AFTER_HUNGRY_MS = 15_000;
  const NORMAL_SPEED          = 1.2;
  const HUNGRY_SEEK_SPEED     = 3.0;

  // Dead-fish drift
  const DEAD_DRIFT_MAX         = 0.5;
  const DEAD_DRIFT_ACCEL       = 0.01;
  const DEAD_BOTTOM_LINGER_MS  = 1500;

  // Fish sizes – all doubled from the original
  const FISH_RADIUS_GUPPY     = 20;
  const FISH_RADIUS_MEDIUM    = 30;
  const FISH_RADIUS_LARGE     = 44;
  const FISH_RADIUS_KING      = 60;
  const FISH_RADIUS_CARNIVORE = 75;   // bigger than king

  // Growth thresholds (cumulative pellets)
  const PELLETS_TO_MEDIUM = 2;
  const PELLETS_TO_LARGE  = 7;   // 2 + 5
  const PELLETS_TO_KING   = 47;  // 7 + 40

  // Drawing
  const TAIL_LENGTH_RATIO          = 0.57;
  const SMALL_FISH_LABEL_THRESHOLD = 24;

  // Swim behaviour
  const SWIM_DRIFT_CHANCE    = 0.60;
  const SWIM_SLOW_CHANCE     = 0.95;
  const SWIM_SLOW_MIN_SPEED  = 0.4;
  const SWIM_SLOW_MAX_SPEED  = 1.5;
  const SWIM_DART_SPEED      = 4.5;
  const SWIM_ACCEL           = 0.06;
  const DRIFT_INTERVAL_MIN   = 120;
  const DRIFT_INTERVAL_RANGE = 120;
  const DRIFT_MAX_SPEED      = 0.3;  // velocity cap while drifting

  // Food – doubled
  const FOOD_RADIUS      = 10;
  const FOOD_DRIFT_SPEED = 1.0;

  // Coins / Diamonds – doubled
  const COIN_RADIUS          = 28;
  const DIAMOND_RADIUS       = 24;
  const COIN_DRIFT_SPEED     = 0.8;
  const COIN_CLICK_TOLERANCE = 4;
  const COIN_INTERVAL_MS     = 15_000;
  const COIN_VALUE_MEDIUM    = 15;
  const COIN_VALUE_LARGE     = 30;
  const COIN_VALUE_KING      = 200;
  const COIN_VALUE_CARNIVORE = 200;

  // Tank 2 – coral
  const CORAL_GROWTH_MS = 15 * 60 * 1000;  // 15 minutes per stage
  const NEST_BABY_MS    = 15_000;           // one baby every 15 seconds
  const CORAL_NEST_DIST = 150;              // proximity for nesting
  const CORAL_COST      = 500;

  // Tank 2 – clown-fish sell values
  const CLOWNFISH_SELL_SMALL   = 50;
  const CLOWNFISH_SELL_MEDIUM  = 100;
  const CLOWNFISH_SELL_LARGE   = 200;
  const MARRIAGE_DIAMOND_VALUE = 200;

  // Bonding check interval
  const BONDING_CHECK_MS = 5_000;

  // Economy
  const STARTING_MONEY       = 500;
  const FISH_COST            = 100;
  const CARNIVORE_COST       = 1000;
  const FOOD_COST            = 5;
  const FOOD_QUALITY_COST    = 200;
  const FOOD_QUALITY_MAX     = 2;
  const MULTI_FOOD_COST      = 200;
  const MULTI_FOOD_MAX       = 10;
  const AUTO_FEEDER_COST     = 1000;
  const TANK_LEVEL_BASE_COST = 1000;

  // ── Canvas / DOM ─────────────────────────────────────────────────────────────
  const canvas    = document.getElementById('tank');
  const ctx       = canvas.getContext('2d');
  const countEl   = document.getElementById('fish-count');
  const moneyEl   = document.getElementById('money-display');
  const noMoneyEl = document.getElementById('no-money-msg');

  const W = canvas.width;
  const H = canvas.height;

  // ── Shared state ─────────────────────────────────────────────────────────────
  let money        = STARTING_MONEY;
  let nextFishId   = 1;
  let noMoneyTimer = null;
  let activeTank   = 0;   // 0 = Tank 1, 1 = Tank 2

  /** Create a fresh per-tank state object. */
  function mkTank() {
    return {
      fishes:           [],
      foods:            [],
      coins:            [],
      corals:           [],
      foodQualityLevel: 0,
      multiFoodLevel:   1,   // max pellets allowed in tank at once
      autoFeeder:       false,
      tankLevel:        0,
      sellToolActive:   false,
      lastBondingCheck: 0,
    };
  }

  const tanks = [mkTank(), mkTank()];

  /** Returns the currently active tank's state. */
  function T() { return tanks[activeTank]; }

  // ── Fish class ───────────────────────────────────────────────────────────────
  class Fish {
    /**
     * @param {number} x
     * @param {number} y
     * @param {'normal'|'carnivore'|'clownfish'} type
     * @param {'male'|'female'|null} gender
     */
    constructor(x, y, type = 'normal', gender = null) {
      this.id     = nextFishId++;
      this.x      = x;
      this.y      = y;
      this.type   = type;
      this.gender = gender;

      const angle = Math.random() * Math.PI * 2;
      this.vx = Math.cos(angle) * NORMAL_SPEED;
      this.vy = Math.sin(angle) * NORMAL_SPEED;

      this.lastEatenTime = performance.now();
      this.hungryTime    = null;
      this.state         = 'normal';  // 'normal' | 'hungry' | 'dead'
      this.deadDriftVy   = 0;
      this.bottomTime    = null;
      this.facingRight   = this.vx >= 0;

      // Colour hue
      if (type === 'carnivore') {
        this.hue = Math.floor(Math.random() * 30);
      } else if (type === 'clownfish') {
        this.hue = 25;  // orange
      } else {
        this.hue = Math.floor(Math.random() * 360);
      }

      // Size / growth
      this.stage        = 'guppy';
      this.radius       = (type === 'carnivore') ? FISH_RADIUS_CARNIVORE : FISH_RADIUS_GUPPY;
      this.pelletsEaten = 0;

      // Coin/diamond drops
      this.lastCoinTime = performance.now();

      // Behaviour system
      this.behaviorType  = 'drift';
      this.behaviorTimer = DRIFT_INTERVAL_MIN + Math.floor(Math.random() * DRIFT_INTERVAL_RANGE);
      this.targetX       = null;
      this.targetY       = null;
      this.swimSpeed     = NORMAL_SPEED;

      // Clown-fish bonding
      this.bonded       = false;
      this.bondPartner  = null;
      this.lastBabyTime = null;
    }

    /** Dynamic eat-distance based on current size */
    get eatDistance() {
      return this.radius + FOOD_RADIUS + 4;
    }

    /** @param {number} now  current timestamp in ms */
    update(now) {
      // ── Dead fish drift down ─────────────────────────────────────────────────
      if (this.state === 'dead') {
        this.deadDriftVy = Math.min(this.deadDriftVy + DEAD_DRIFT_ACCEL, DEAD_DRIFT_MAX);
        this.y += this.deadDriftVy;
        if (this.y >= H - this.radius) {
          this.y = H - this.radius;
          if (this.bottomTime === null) this.bottomTime = now;
        }
        return;
      }

      // Clean up dead bond-partner reference
      if (this.bonded && this.bondPartner && this.bondPartner.state === 'dead') {
        this.bonded       = false;
        this.bondPartner  = null;
        this.lastBabyTime = null;
      }

      // ── Hunger progression ───────────────────────────────────────────────────
      if (this.state === 'normal' && now - this.lastEatenTime >= HUNGER_START_MS) {
        this.state      = 'hungry';
        this.hungryTime = now;
        // Auto feeder: drop pellet at top centre (not for carnivore)
        if (this.type !== 'carnivore' && T().autoFeeder && money >= FOOD_COST) {
          money -= FOOD_COST;
          updateMoney();
          T().foods.push(new Food(W / 2, FOOD_RADIUS));
        }
      }

      if (this.state === 'hungry' && now - this.hungryTime >= DEATH_AFTER_HUNGRY_MS) {
        this.state = 'dead';
        return;
      }

      // ── Coin / diamond drops (tank 1 fish and carnivore only) ────────────────
      if (this.type !== 'clownfish') {
        const dropsCoin =
          this.stage === 'medium' || this.stage === 'large' ||
          this.stage === 'king'   || this.type  === 'carnivore';
        if (dropsCoin && now - this.lastCoinTime >= COIN_INTERVAL_MS) {
          let value    = COIN_VALUE_MEDIUM;
          let coinType = 'coin';
          if (this.stage === 'large')     { value = COIN_VALUE_LARGE;     coinType = 'coin';    }
          if (this.stage === 'king')      { value = COIN_VALUE_KING;      coinType = 'diamond'; }
          if (this.type  === 'carnivore') { value = COIN_VALUE_CARNIVORE; coinType = 'diamond'; }
          T().coins.push(new Coin(this.x, this.y, value, coinType));
          this.lastCoinTime = now;
        }
      }

      // ── Movement ─────────────────────────────────────────────────────────────
      if (this.type === 'carnivore') {
        this._carnivoreMove(now);
      } else if (this.state === 'hungry' && T().foods.length > 0) {
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

    // ── Carnivore: seek and eat nearest guppy / small clownfish ──────────────
    _carnivoreMove(now) {
      const prey = this._nearestPrey();
      if (prey) {
        const dx   = prey.x - this.x;
        const dy   = prey.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < this.radius + prey.radius + 4) {
          // Unbond partner if clownfish
          if (prey.bonded && prey.bondPartner) {
            prey.bondPartner.bonded       = false;
            prey.bondPartner.bondPartner  = null;
            prey.bondPartner.lastBabyTime = null;
          }
          const idx = T().fishes.indexOf(prey);
          if (idx !== -1) T().fishes.splice(idx, 1);
          this.lastEatenTime = now;
          this.state         = 'normal';
          this.hungryTime    = null;
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

    /** Nearest edible prey (guppy in T1; small clownfish in T2). */
    _nearestPrey() {
      let best = null, bestDist = Infinity;
      for (const f of T().fishes) {
        if (f === this || f.state === 'dead') continue;
        const edible = activeTank === 0
          ? (f.type === 'normal'    && f.stage === 'guppy')
          : (f.type === 'clownfish' && f.stage === 'guppy');
        if (!edible) continue;
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < bestDist) { bestDist = d; best = f; }
      }
      return best;
    }

    // ── 3-mode wander ─────────────────────────────────────────────────────────
    _wander(baseSpeed) {
      if (this.behaviorType === 'drift') {
        this.behaviorTimer--;
        if (this.behaviorTimer <= 0) this._pickBehavior(baseSpeed);
        // Neuter momentum – cap velocity to DRIFT_MAX_SPEED
        const spd = Math.hypot(this.vx, this.vy);
        if (spd > DRIFT_MAX_SPEED) {
          const s = DRIFT_MAX_SPEED / spd;
          this.vx *= s;
          this.vy *= s;
        }

      } else if (this.behaviorType === 'swim') {
        const dx   = this.targetX - this.x;
        const dy   = this.targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 5) {
          this._pickBehavior(baseSpeed);
        } else {
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
      for (const f of T().foods) {
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < bestDist) { bestDist = d; best = f; }
      }
      return best;
    }

    _eatFood(food, now) {
      const idx = T().foods.indexOf(food);
      if (idx !== -1) T().foods.splice(idx, 1);
      this.lastEatenTime = now;
      this.state         = 'normal';
      this.hungryTime    = null;
      this.pelletsEaten += 1 + T().foodQualityLevel;
      this._checkGrowth();
    }

    _checkGrowth() {
      if (this.type === 'carnivore') return;
      if (this.stage === 'guppy' && this.pelletsEaten >= PELLETS_TO_MEDIUM) {
        this.stage        = 'medium';
        this.radius       = FISH_RADIUS_MEDIUM;
        this.lastCoinTime = performance.now();
      } else if (this.stage === 'medium' && this.pelletsEaten >= PELLETS_TO_LARGE) {
        this.stage  = 'large';
        this.radius = FISH_RADIUS_LARGE;
      } else if (this.type === 'normal' && this.stage === 'large' && this.pelletsEaten >= PELLETS_TO_KING) {
        this.stage  = 'king';
        this.radius = FISH_RADIUS_KING;
      }
    }

    // ── Drawing ───────────────────────────────────────────────────────────────
    draw(now) {
      if (this.type === 'clownfish') {
        this._drawClownfish();
      } else {
        this._drawNormalFish();
      }
    }

    _drawNormalFish() {
      const isDead      = this.state === 'dead';
      const isHungry    = this.state === 'hungry';
      const isCarnivore = this.type  === 'carnivore';
      const isKing      = this.stage === 'king';
      const alpha       = isDead ? 0.45 : 1;
      const r           = this.radius;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x, this.y);
      if (isDead) ctx.scale(1, -1);
      if (!this.facingRight) ctx.scale(-1, 1);

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

      // King crown
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

      // Dorsal fin
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

      // Pectoral fin
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
      this._drawOverlays(r);
    }

    _drawClownfish() {
      const isDead   = this.state === 'dead';
      const isHungry = this.state === 'hungry';
      const r        = this.radius;
      const alpha    = isDead ? 0.45 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x, this.y);
      if (isDead) ctx.scale(1, -1);
      if (!this.facingRight) ctx.scale(-1, 1);

      const bodyColor = isDead ? '#888' : (isHungry ? '#cc5500' : '#ff6b00');

      // Body
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // White stripes
      if (!isDead) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(r * 0.35, 0, r * 0.1, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        if (this.stage !== 'guppy') {
          ctx.beginPath();
          ctx.ellipse(-r * 0.1, 0, r * 0.1, r * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Tail
      ctx.beginPath();
      ctx.moveTo(-r + 2, 0);
      ctx.lineTo(-r - r * TAIL_LENGTH_RATIO, -r * 0.5);
      ctx.lineTo(-r - r * TAIL_LENGTH_RATIO,  r * 0.5);
      ctx.closePath();
      ctx.fillStyle = isDead ? '#888' : '#ff8c00';
      ctx.fill();

      // Dorsal fin
      if (this.stage !== 'guppy') {
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, -r * 0.6);
        ctx.quadraticCurveTo(0, -r * 1.2, r * 0.3, -r * 0.6);
        ctx.closePath();
        ctx.fillStyle = isDead ? '#888' : '#ff8c00';
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

      // Gender tint dot
      if (!isDead && this.gender) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = this.gender === 'male'
          ? 'rgba(50,150,255,0.45)'
          : 'rgba(255,100,160,0.45)';
        ctx.fill();
      }

      // Bonded heart
      if (this.bonded && !isDead) {
        ctx.fillStyle    = '#ff3333';
        ctx.font         = `${Math.max(12, r * 0.55)}px Arial`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u2665', 0, -r * 0.85);
      }

      ctx.restore();
      this._drawOverlays(r);

      // Clownfish label
      if (!isDead && !isHungry) {
        const sym = this.gender === 'male' ? '\u2642' : (this.gender === 'female' ? '\u2640' : '');
        const stg = this.stage === 'guppy' ? 'small' : this.stage;
        ctx.save();
        ctx.fillStyle = 'rgba(255,200,100,0.9)';
        ctx.font      = '9px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${sym} clown (${stg})`, this.x, this.y + r + 15);
        ctx.restore();
      }
    }

    _drawOverlays(r) {
      const isDead      = this.state === 'dead';
      const isHungry    = this.state === 'hungry';
      const isCarnivore = this.type  === 'carnivore';
      const isKing      = this.stage === 'king';

      if (isHungry) {
        ctx.save();
        ctx.strokeStyle = '#ffa040';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#ffa040';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Hungry!', this.x, this.y - r - 10);
        ctx.restore();
      }

      if (isDead) {
        ctx.save();
        ctx.fillStyle = '#ff4444';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💀', this.x, this.y - r - 6);
        ctx.restore();
      }

      if (this.type !== 'clownfish' && !isDead && !isHungry) {
        const label = isCarnivore ? 'carnivore'
                    : isKing      ? '👑 king'
                    : this.stage === 'guppy'  ? 'guppy'
                    : this.stage === 'medium' ? 'medium'
                                              : 'large';
        ctx.save();
        ctx.fillStyle = isKing ? 'rgba(255,215,0,0.9)' : 'rgba(200,230,255,0.7)';
        ctx.font      = `${r < SMALL_FISH_LABEL_THRESHOLD ? 8 : 9}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(label, this.x, this.y + r + 14);
        ctx.restore();
      }
    }

    shouldRemove(now) {
      return this.state === 'dead' &&
             this.bottomTime !== null &&
             now - this.bottomTime >= DEAD_BOTTOM_LINGER_MS;
    }
  }

  // ── Coral class (Tank 2) ─────────────────────────────────────────────────────
  class Coral {
    constructor(x) {
      this.x          = x;
      this.y          = H - 10;
      this.stage      = 0;   // 0 = small, 1 = medium, 2 = large
      this.lastGrowth = performance.now();
    }

    get radius() { return [22, 38, 55][this.stage]; }

    update(now) {
      if (this.stage < 2 && now - this.lastGrowth >= CORAL_GROWTH_MS) {
        this.stage++;
        this.lastGrowth = now;
      }
    }

    draw() {
      const r = this.radius;
      const x = this.x;
      const y = this.y;
      const colors = ['#e8856a', '#d45c3a', '#c04020'];
      const c = colors[this.stage];

      ctx.save();
      ctx.strokeStyle = c;
      ctx.lineWidth   = 4 + this.stage * 3;
      ctx.lineCap     = 'round';

      // Trunk
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - r * 0.6);
      ctx.stroke();

      // Left branch
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.4);
      ctx.lineTo(x - r * 0.55, y - r);
      ctx.stroke();

      // Right branch
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.4);
      ctx.lineTo(x + r * 0.55, y - r);
      ctx.stroke();

      if (this.stage >= 1) {
        ctx.lineWidth = 3 + this.stage;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.28, y - r * 0.72);
        ctx.lineTo(x - r * 0.65, y - r * 1.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + r * 0.28, y - r * 0.72);
        ctx.lineTo(x + r * 0.65, y - r * 1.35);
        ctx.stroke();
      }

      // Tips / polyps
      const tips = [
        [x, y - r * 0.6],
        [x - r * 0.55, y - r],
        [x + r * 0.55, y - r],
      ];
      if (this.stage >= 1) {
        tips.push(
          [x - r * 0.65, y - r * 1.35],
          [x + r * 0.65, y - r * 1.35]
        );
      }
      ctx.fillStyle = '#ff9966';
      for (const [tx, ty] of tips) {
        ctx.beginPath();
        ctx.arc(tx, ty, 5 + this.stage * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      const names = ['Small Coral', 'Medium Coral', 'Large Coral \u2736'];
      ctx.fillStyle    = 'rgba(255,200,150,0.85)';
      ctx.font         = '9px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(names[this.stage], x, y + 14);

      ctx.restore();
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

    contains(px, py) {
      return Math.hypot(px - this.x, py - this.y) <= this.radius + COIN_CLICK_TOLERANCE;
    }

    collect() {
      this.gone = true;
      money    += this.value;
      updateMoney();
    }

    draw() {
      if (this.type === 'diamond') this._drawDiamond();
      else                         this._drawCoin();
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

  // ── Clownfish bonding ─────────────────────────────────────────────────────────
  function checkClownfishBonding() {
    const tank = T();
    const singles = tank.fishes.filter(
      f => f.type === 'clownfish' && f.state !== 'dead' && !f.bonded
    );
    const males   = singles.filter(f => f.gender === 'male');
    const females = singles.filter(f => f.gender === 'female');
    const pairs   = Math.min(males.length, females.length);
    for (let i = 0; i < pairs; i++) {
      const male   = males[i];
      const female = females[i];
      male.bonded       = true;
      male.bondPartner  = female;
      female.bonded     = true;
      female.bondPartner = male;
      tank.coins.push(new Coin(
        (male.x + female.x) / 2,
        (male.y + female.y) / 2,
        MARRIAGE_DIAMOND_VALUE,
        'diamond'
      ));
    }
  }

  // ── Nesting ───────────────────────────────────────────────────────────────────
  function checkNesting(now) {
    const tank = T();
    const largeCoral = tank.corals.filter(c => c.stage === 2);
    if (largeCoral.length === 0) return;

    const processed = new Set();
    for (const fish of tank.fishes) {
      if (fish.type !== 'clownfish' || !fish.bonded || fish.state === 'dead') continue;
      if (!fish.bondPartner || fish.bondPartner.state === 'dead')             continue;
      if (fish.gender !== 'male') continue;   // process only via the male

      if (processed.has(fish.id)) continue;
      processed.add(fish.id);

      const midX = (fish.x + fish.bondPartner.x) / 2;
      const midY = (fish.y + fish.bondPartner.y) / 2;
      const nearCoral = largeCoral.find(
        c => Math.hypot(midX - c.x, midY - c.y) < CORAL_NEST_DIST
      );
      if (!nearCoral) continue;

      if (fish.lastBabyTime === null) fish.lastBabyTime = now;
      if (now - fish.lastBabyTime >= NEST_BABY_MS) {
        fish.lastBabyTime = now;
        const babyX   = nearCoral.x + (Math.random() - 0.5) * 70;
        const babyY   = nearCoral.y - nearCoral.radius - 20;
        const babyGen = Math.random() < 0.5 ? 'male' : 'female';
        tank.fishes.push(new Fish(babyX, babyY, 'clownfish', babyGen));
        updateCount();
      }
    }
  }

  // ── Game loop ────────────────────────────────────────────────────────────────
  function loop(timestamp) {
    const now  = timestamp;
    const tank = T();

    ctx.clearRect(0, 0, W, H);
    drawBackground();

    for (const coral of tank.corals) { coral.update(now); coral.draw(); }
    for (const food  of tank.foods)  { food.update();     food.draw();  }
    for (const coin  of tank.coins)  { coin.update();     coin.draw();  }
    for (const fish  of tank.fishes) { fish.update(now);  fish.draw(now); }

    for (let i = tank.foods.length  - 1; i >= 0; i--) { if (tank.foods[i].gone)              tank.foods.splice(i, 1);  }
    for (let i = tank.fishes.length - 1; i >= 0; i--) { if (tank.fishes[i].shouldRemove(now)) tank.fishes.splice(i, 1); }
    for (let i = tank.coins.length  - 1; i >= 0; i--) { if (tank.coins[i].gone)              tank.coins.splice(i, 1);  }

    if (activeTank === 1) {
      if (now - tank.lastBondingCheck >= BONDING_CHECK_MS) {
        checkClownfishBonding();
        tank.lastBondingCheck = now;
      }
      checkNesting(now);
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
    const alive = T().fishes.filter(f => f.state !== 'dead').length;
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

  // ── Shop helpers ─────────────────────────────────────────────────────────────
  function spawnFish(type = 'normal') {
    const cost = type === 'carnivore' ? CARNIVORE_COST : FISH_COST;
    if (money < cost) { flashNoMoney(); return; }
    money -= cost;
    updateMoney();
    const r      = type === 'carnivore' ? FISH_RADIUS_CARNIVORE : FISH_RADIUS_GUPPY;
    const margin = r + 10;
    const x = margin + Math.random() * (W - margin * 2);
    const y = margin + Math.random() * (H - margin * 2);
    T().fishes.push(new Fish(x, y, type));
    updateCount();
  }

  function refreshShopButtons() {
    const tank = T();

    const fqBtn = document.getElementById('food-quality-btn');
    const mfBtn = document.getElementById('multi-food-btn');
    const afBtn = document.getElementById('auto-feeder-btn');
    const tlBtn = document.getElementById('tank-level-btn');

    fqBtn.textContent = `Better Food ($${FOOD_QUALITY_COST}) [${tank.foodQualityLevel}/${FOOD_QUALITY_MAX}]`;
    fqBtn.disabled    = tank.foodQualityLevel >= FOOD_QUALITY_MAX;

    mfBtn.textContent = `Food Slots ($${MULTI_FOOD_COST}) [${tank.multiFoodLevel}/${MULTI_FOOD_MAX}]`;
    mfBtn.disabled    = tank.multiFoodLevel >= MULTI_FOOD_MAX;

    afBtn.textContent = tank.autoFeeder ? 'Auto Feeder (owned)' : `Auto Feeder ($${AUTO_FEEDER_COST})`;
    afBtn.disabled    = tank.autoFeeder;

    const tlCost = TANK_LEVEL_BASE_COST * Math.pow(2, tank.tankLevel);
    tlBtn.textContent = `Tank Level Up ($${tlCost}) [Lv.${tank.tankLevel}]`;

    // Tank 1 only
    const fishBtn = document.getElementById('add-fish-btn');
    fishBtn.style.display = activeTank === 0 ? '' : 'none';

    // Tank 2 only
    const coralBtn = document.getElementById('add-coral-btn');
    const sellBtn  = document.getElementById('sell-tool-btn');
    coralBtn.style.display = activeTank === 1 ? '' : 'none';
    sellBtn.style.display  = activeTank === 1 ? '' : 'none';
    if (activeTank === 1) {
      sellBtn.textContent = tank.sellToolActive
        ? '\uD83D\uDD27 Sell Tool (active)'
        : '\uD83D\uDD27 Sell Tool';
      sellBtn.classList.toggle('shop-btn-active', tank.sellToolActive);
    }
  }

  // ── Tank switching ────────────────────────────────────────────────────────────
  function switchTank(idx) {
    activeTank = idx;
    document.querySelectorAll('.tank-tab').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
    if (idx !== 1) tanks[1].sellToolActive = false;
    canvas.style.cursor = 'crosshair';
    refreshShopButtons();
    updateCount();
  }

  // ── Canvas click ──────────────────────────────────────────────────────────────
  canvas.addEventListener('click', (e) => {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;
    const tank = T();

    // Sell tool (Tank 2)
    if (activeTank === 1 && tank.sellToolActive) {
      for (let i = tank.fishes.length - 1; i >= 0; i--) {
        const f = tank.fishes[i];
        if (f.type !== 'clownfish' || f.state === 'dead') continue;
        if (Math.hypot(cx - f.x, cy - f.y) > f.radius + COIN_CLICK_TOLERANCE) continue;
        const sellValues = { guppy: CLOWNFISH_SELL_SMALL, medium: CLOWNFISH_SELL_MEDIUM, large: CLOWNFISH_SELL_LARGE };
        const value = sellValues[f.stage] ?? CLOWNFISH_SELL_LARGE;
        money += value;
        updateMoney();
        if (f.bonded && f.bondPartner) {
          f.bondPartner.bonded       = false;
          f.bondPartner.bondPartner  = null;
          f.bondPartner.lastBabyTime = null;
        }
        tank.fishes.splice(i, 1);
        updateCount();
        return;
      }
      return;
    }

    // Collect coins
    for (let i = tank.coins.length - 1; i >= 0; i--) {
      if (!tank.coins[i].gone && tank.coins[i].contains(cx, cy)) {
        tank.coins[i].collect();
        return;
      }
    }

    // Drop one pellet (if below the slot cap)
    if (tank.foods.length >= tank.multiFoodLevel) return;
    if (money < FOOD_COST) { flashNoMoney(); return; }
    money -= FOOD_COST;
    updateMoney();
    tank.foods.push(new Food(cx, cy));
  });

  // ── Shop wiring ───────────────────────────────────────────────────────────────
  document.getElementById('add-fish-btn').addEventListener('click', () => spawnFish('normal'));
  document.getElementById('add-carnivore-btn').addEventListener('click', () => spawnFish('carnivore'));

  document.getElementById('food-quality-btn').addEventListener('click', () => {
    const tank = T();
    if (tank.foodQualityLevel >= FOOD_QUALITY_MAX || money < FOOD_QUALITY_COST) { flashNoMoney(); return; }
    money -= FOOD_QUALITY_COST;
    tank.foodQualityLevel++;
    updateMoney();
    refreshShopButtons();
  });

  document.getElementById('multi-food-btn').addEventListener('click', () => {
    const tank = T();
    if (tank.multiFoodLevel >= MULTI_FOOD_MAX || money < MULTI_FOOD_COST) { flashNoMoney(); return; }
    money -= MULTI_FOOD_COST;
    tank.multiFoodLevel++;
    updateMoney();
    refreshShopButtons();
  });

  document.getElementById('auto-feeder-btn').addEventListener('click', () => {
    const tank = T();
    if (tank.autoFeeder || money < AUTO_FEEDER_COST) { flashNoMoney(); return; }
    money -= AUTO_FEEDER_COST;
    tank.autoFeeder = true;
    updateMoney();
    refreshShopButtons();
  });

  document.getElementById('tank-level-btn').addEventListener('click', () => {
    const tank = T();
    const cost = TANK_LEVEL_BASE_COST * Math.pow(2, tank.tankLevel);
    if (money < cost) { flashNoMoney(); return; }
    money -= cost;
    tank.tankLevel++;
    updateMoney();
    refreshShopButtons();
  });

  document.getElementById('add-coral-btn').addEventListener('click', () => {
    if (money < CORAL_COST) { flashNoMoney(); return; }
    money -= CORAL_COST;
    updateMoney();
    const x = FISH_RADIUS_LARGE + Math.random() * (W - FISH_RADIUS_LARGE * 2);
    T().corals.push(new Coral(x));
  });

  document.getElementById('sell-tool-btn').addEventListener('click', () => {
    const tank = T();
    tank.sellToolActive = !tank.sellToolActive;
    canvas.style.cursor = tank.sellToolActive ? 'pointer' : 'crosshair';
    refreshShopButtons();
  });

  document.querySelectorAll('.tank-tab').forEach((btn, i) => {
    btn.addEventListener('click', () => switchTank(i));
  });

  // ── Tank 2 initialisation ─────────────────────────────────────────────────────
  (function initTank2() {
    const t2 = tanks[1];
    t2.fishes.push(new Fish(W * 0.38, H * 0.5, 'clownfish', 'male'));
    t2.fishes.push(new Fish(W * 0.62, H * 0.5, 'clownfish', 'female'));
  })();

  // ── Start ─────────────────────────────────────────────────────────────────────
  updateMoney();
  refreshShopButtons();
  requestAnimationFrame(loop);
})();
