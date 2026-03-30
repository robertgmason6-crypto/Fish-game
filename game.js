/**
 * Fish Tank Simulator – multi-tank rewrite
 */
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  const W = 800;
  const H = 500;

  // Timing – fish hunger
  const HUNGER_START_MS       = 20_000;
  const DEATH_AFTER_HUNGRY_MS = 15_000;

  // Carnivore
  const CARNIVORE_SATIATED_MS         = 15_000;
  const CARNIVORE_HUNGRY_DEATH_MS     = 15_000;
  const CARNIVORE_DIAMOND_INTERVAL_MS = 15_000;
  const CARNIVORE_HUNGRY_SPEED_MULT   = 1.5;

  // Dead fish
  const DEAD_DRIFT_MAX        = 0.5;
  const DEAD_DRIFT_ACCEL      = 0.01;
  const DEAD_BOTTOM_LINGER_MS = 1500;

  // Fish sizes
  const FISH_RADIUS_GUPPY  = 10;
  const FISH_RADIUS_MEDIUM = 15;
  const FISH_RADIUS_LARGE  = 22;
  const FISH_RADIUS_KING   = 30;

  // Growth thresholds (cumulative pellets)
  const PELLETS_TO_MEDIUM = 2;
  const PELLETS_TO_LARGE  = 7;
  const PELLETS_TO_KING   = 47;

  // Fish drawing
  const TAIL_LENGTH_RATIO          = 0.57;
  const SMALL_FISH_LABEL_THRESHOLD = 12;

  // Swimming
  const SWIM_DRIFT_CHANCE    = 0.60;
  const SWIM_SLOW_CHANCE     = 0.95;
  const SWIM_SLOW_MIN_SPEED  = 0.4;
  const SWIM_SLOW_MAX_SPEED  = 1.5;
  const SWIM_DART_SPEED      = 4.5;
  const SWIM_ACCEL           = 0.06;
  const DRIFT_INTERVAL_MIN   = 120;
  const DRIFT_INTERVAL_RANGE = 120;
  const NORMAL_SPEED         = 1.2;
  const HUNGRY_SEEK_SPEED    = 3.0;

  // Food
  const FOOD_RADIUS      = 5;
  const FOOD_DRIFT_SPEED = 1.0;

  // Coins / Diamonds
  const COIN_RADIUS            = 14;
  const DIAMOND_RADIUS         = 12;
  const COIN_DRIFT_SPEED       = 0.8;
  const COIN_CLICK_TOLERANCE   = 4;
  const COIN_INTERVAL_MS       = 15_000;
  const COIN_VALUE_MEDIUM      = 15;
  const COIN_VALUE_LARGE       = 30;
  const COIN_VALUE_KING        = 200;
  const COIN_VALUE_CARNIVORE   = 200;
  const COIN_BOTTOM_LINGER_MS  = 2000;

  // Economy
  const STARTING_MONEY             = 500;
  const FISH_COST                  = 100;
  const CLOWN_FISH_COST            = 150;
  const CARNIVORE_COST             = 1000;
  const FOOD_COST                  = 5;
  const FOOD_QUALITY_COST          = 200;
  const FOOD_QUALITY_MAX           = 2;
  const MULTI_FOOD_COST            = 200;
  const MULTI_FOOD_MAX             = 10;
  const AUTO_FEEDER_COST           = 1000;
  const CARNIVORE_AUTO_FEEDER_COST = 10_000;
  const TANK_LEVEL_BASE_COST       = 1000;
  const CORAL_COST                 = 200;
  const OYSTER_ROCK_COST           = 300;
  const HERMIT_CRAB_COST           = 50;
  const RESEED_COST                = 150;
  const PEARL_VALUE                = 300;

  // Coral / fancy nodes
  const CORAL_SPAWN_INTERVAL_MS    = 30_000;
  const FANCY_NODE_LINGER_MS       = 10_000;
  const FANCY_NODE_VALUE           = 30;
  const MAX_FANCY_NODES_PER_CORAL  = 3;

  // Clownfish bonding
  const CLOWN_BOND_RADIUS     = 60;
  const CLOWN_BOND_PROXIMITY  = 80;
  const CLOWN_BOND_CORAL_RADIUS = 100;
  const CLOWN_BOND_COOLDOWN_MS  = 30_000;

  // Oyster growth
  const OYSTER_SMALL_MS  = 30_000;
  const OYSTER_MEDIUM_MS = 60_000;

  // Hermit crab
  const HERMIT_CRAB_SPEED           = 0.6;
  const HERMIT_CRAB_SHELL_TIMEOUT_MS = 10_000;
  const HERMIT_CRAB_GOLD_TARGET     = 500;
  const HERMIT_CRAB_COLLECT_RADIUS  = 80;

  // ── DOM ──────────────────────────────────────────────────────────────────────
  const canvas    = document.getElementById('tank');
  const ctx       = canvas.getContext('2d');
  const countEl   = document.getElementById('fish-count');
  const moneyEl   = document.getElementById('money-display');
  const noMoneyEl = document.getElementById('no-money-msg');

  // ── Global state ─────────────────────────────────────────────────────────────
  let money          = STARTING_MONEY;
  let noMoneyTimer   = null;
  let nextId         = 1;
  let activeTankIdx  = 0;

  function genId() { return nextId++; }

  // ── Food ─────────────────────────────────────────────────────────────────────
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

  // ── Coin / Diamond ───────────────────────────────────────────────────────────
  class Coin {
    constructor(x, y, value, type = 'coin') {
      this.x          = x;
      this.y          = y;
      this.value      = value;
      this.type       = type;
      this.gone       = false;
      this.radius     = type === 'diamond' ? DIAMOND_RADIUS : COIN_RADIUS;
      this.bottomTime = null;
    }
    update() {
      if (this.gone) return;
      if (this.y >= H - this.radius) {
        this.y = H - this.radius;
        if (this.bottomTime === null) this.bottomTime = performance.now();
        if (performance.now() - this.bottomTime >= COIN_BOTTOM_LINGER_MS) this.gone = true;
      } else {
        this.y += COIN_DRIFT_SPEED;
      }
    }
    contains(px, py) {
      return Math.hypot(px - this.x, py - this.y) <= this.radius + COIN_CLICK_TOLERANCE;
    }
    collect() {
      this.gone  = true;
      money     += this.value;
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

  // ── FancyCoralNode ───────────────────────────────────────────────────────────
  class FancyCoralNode {
    constructor(x, y) {
      this.x           = x;
      this.y           = y;
      this.gone        = false;
      this.spawnTime   = performance.now();
      this.driftAngle  = Math.random() * Math.PI * 2;
    }
    update() {
      if (this.gone) return;
      this.x += Math.cos(this.driftAngle) * 0.25;
      this.y += Math.sin(this.driftAngle) * 0.12;
      this.driftAngle += 0.008;
      this.x = Math.max(10, Math.min(W - 10, this.x));
      this.y = Math.max(10, Math.min(H - 10, this.y));
      if (performance.now() - this.spawnTime >= FANCY_NODE_LINGER_MS) this.gone = true;
    }
    contains(px, py) {
      return Math.hypot(px - this.x, py - this.y) <= 12;
    }
    collect() {
      this.gone  = true;
      money     += FANCY_NODE_VALUE;
      updateMoney();
    }
    draw() {
      if (this.gone) return;
      const t   = performance.now() / 500;
      const glow = 12 + 7 * Math.sin(t);
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.x, this.y, 7, 0, Math.PI * 2);
      ctx.fillStyle   = `hsl(330, 85%, ${55 + 15 * Math.sin(t)}%)`;
      ctx.shadowColor = '#ff69b4';
      ctx.shadowBlur  = glow;
      ctx.fill();
      // sparkle points
      for (let i = 0; i < 4; i++) {
        const a  = t + i * Math.PI / 2;
        const sx = this.x + Math.cos(a) * 11;
        const sy = this.y + Math.sin(a) * 11;
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fillStyle  = '#ffb8e0';
        ctx.shadowBlur = 4;
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.fillStyle    = '#ff69b4';
      ctx.font         = 'bold 9px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`$${FANCY_NODE_VALUE}`, this.x, this.y - 10);
      ctx.restore();
    }
  }

  // ── Coral ────────────────────────────────────────────────────────────────────
  class Coral {
    constructor(x, y) {
      this.x             = x;
      this.y             = y;
      this.lastSpawnTime = performance.now();
      // small per-coral angle offsets so each looks slightly different
      this._lOff = (Math.random() - 0.5) * 0.3;
      this._rOff = (Math.random() - 0.5) * 0.3;
    }
    update(now, tank) {
      if (now - this.lastSpawnTime < CORAL_SPAWN_INTERVAL_MS) return;
      const myNodes = tank.fancyCoralNodes.filter(
        n => !n.gone && Math.hypot(n.x - this.x, n.y - this.y) < 100
      );
      if (myNodes.length < MAX_FANCY_NODES_PER_CORAL) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = 20 + Math.random() * 35;
        tank.fancyCoralNodes.push(new FancyCoralNode(
          Math.max(10, Math.min(W - 10, this.x + Math.cos(angle) * dist)),
          Math.max(10, Math.min(H - 10, this.y + Math.sin(angle) * dist - 15))
        ));
      }
      this.lastSpawnTime = now;
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      this._branch(0, 0, -Math.PI / 2, 38, 5, 0);
      ctx.restore();
    }
    _branch(x, y, angle, len, width, depth) {
      if (len < 7 || depth > 4) return;
      const ex = x + Math.cos(angle) * len;
      const ey = y + Math.sin(angle) * len;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = `hsl(350, 72%, ${42 + depth * 7}%)`;
      ctx.lineWidth   = width;
      ctx.lineCap     = 'round';
      ctx.stroke();
      if (len < 13) {
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.fillStyle   = 'hsl(15, 85%, 62%)';
        ctx.shadowColor = 'hsl(350, 90%, 70%)';
        ctx.shadowBlur  = 5;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      this._branch(ex, ey, angle - 0.42 + this._lOff, len * 0.67, width * 0.70, depth + 1);
      this._branch(ex, ey, angle + 0.38 + this._rOff, len * 0.67, width * 0.70, depth + 1);
    }
  }

  // ── Shell ────────────────────────────────────────────────────────────────────
  class Shell {
    constructor(x, y) {
      this.x       = x;
      this.y       = y;
      this.vy      = 0;
      this.settled = false;
      this.gone    = false;
    }
    update() {
      if (this.settled) return;
      this.vy  = Math.min(this.vy + 0.05, 1.5);
      this.y  += this.vy;
      if (this.y >= H - 14) { this.y = H - 14; this.settled = true; }
    }
    draw() {
      if (this.gone) return;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle   = '#c8a878';
      ctx.strokeStyle = '#8a6840';
      ctx.lineWidth   = 1.5;
      ctx.fill();
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 5, -8);
        ctx.lineTo(i * 5,  8);
        ctx.strokeStyle = '#a07848';
        ctx.lineWidth   = 0.7;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── SpecialShell ─────────────────────────────────────────────────────────────
  class SpecialShell {
    constructor(x, y, value) {
      this.x     = x;
      this.y     = y;
      this.value = value;
      this.gone  = false;
    }
    contains(px, py) {
      return Math.hypot(px - this.x, py - this.y) <= 18;
    }
    collect() {
      this.gone  = true;
      money     += this.value;
      updateMoney();
    }
    draw() {
      if (this.gone) return;
      ctx.save();
      ctx.translate(this.x, this.y);
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 17);
      grad.addColorStop(0, '#ffd700');
      grad.addColorStop(1, '#ff8c00');
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle   = grad;
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur  = 14;
      ctx.fill();
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.fillStyle    = '#fff';
      ctx.font         = 'bold 8px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${this.value}`, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.fillStyle    = '#ffd700';
      ctx.font         = 'bold 9px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('✨ Click!', this.x, this.y - 16);
      ctx.restore();
    }
  }

  // ── Oyster ───────────────────────────────────────────────────────────────────
  class Oyster {
    constructor(x, y) {
      this.x          = x;
      this.y          = y;
      this.stage      = 'small';
      this.startTime  = performance.now();
      this.hasPearl   = false;
    }
    reset() {
      this.stage     = 'small';
      this.startTime = performance.now();
      this.hasPearl  = false;
    }
    update(now) {
      if (this.stage === 'small' && now - this.startTime >= OYSTER_SMALL_MS) {
        this.stage     = 'medium';
        this.startTime = now;
      } else if (this.stage === 'medium' && now - this.startTime >= OYSTER_MEDIUM_MS) {
        this.stage    = 'grown';
        this.hasPearl = true;
      }
    }
    contains(px, py) {
      return this.hasPearl && Math.hypot(px - this.x, py - this.y) <= 10;
    }
    collect(tank) {
      this.hasPearl  = false;
      money         += PEARL_VALUE;
      updateMoney();
      tank.shells.push(new Shell(this.x, this.y - 5));
      this.stage     = 'small';
      this.startTime = performance.now();
    }
    draw() {
      const r = this.stage === 'grown' ? 10 : (this.stage === 'medium' ? 7 : 5);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.5, r, 0, 0, Math.PI * 2);
      ctx.fillStyle   = this.stage === 'grown' ? '#c8a060' : '#a0805a';
      ctx.strokeStyle = '#7a5a30';
      ctx.lineWidth   = 1;
      ctx.fill();
      ctx.stroke();
      if (this.hasPearl) {
        ctx.beginPath();
        ctx.arc(0, -r * 0.6, 5, 0, Math.PI * 2);
        const pg = ctx.createRadialGradient(-1, -r * 0.6 - 1, 0, 0, -r * 0.6, 5);
        pg.addColorStop(0, '#ffffff');
        pg.addColorStop(0.5, '#e8e8f8');
        pg.addColorStop(1, '#b0b8c8');
        ctx.fillStyle   = pg;
        ctx.shadowColor = '#aaaaff';
        ctx.shadowBlur  = 8;
        ctx.fill();
        ctx.shadowBlur  = 0;
        ctx.fillStyle    = '#ffffff';
        ctx.font         = 'bold 8px Arial';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`$${PEARL_VALUE}`, 0, -r * 0.6 - 8);
      }
      ctx.restore();
    }
  }

  // ── OysterRock ───────────────────────────────────────────────────────────────
  class OysterRock {
    constructor(x, y) {
      this.x       = x;
      this.y       = y;
      const count  = 1 + Math.floor(Math.random() * 3);
      this.oysters = [];
      for (let i = 0; i < count; i++) {
        const ox = x + (i - (count - 1) / 2) * 26;
        this.oysters.push(new Oyster(ox, y - 14));
      }
    }
    reseed() {
      for (const o of this.oysters) o.reset();
    }
    update(now, tank) {
      for (const o of this.oysters) o.update(now);
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, 36, 20, 0, 0, Math.PI * 2);
      ctx.fillStyle   = '#7a6850';
      ctx.strokeStyle = '#5a4830';
      ctx.lineWidth   = 2;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6a5840';
      ctx.beginPath();
      ctx.ellipse(-11, -5, 10, 6, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(11, -3, 8, 5, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      for (const o of this.oysters) o.draw();
    }
  }

  // ── HermitCrab ───────────────────────────────────────────────────────────────
  class HermitCrab {
    constructor(x) {
      this.x           = x;
      this.y           = H - 20;
      this.vx          = (Math.random() < 0.5 ? -1 : 1) * HERMIT_CRAB_SPEED;
      this.hasShell    = false;
      this.goldCollected = 0;
      this.radius      = 12;
      this.spawnTime   = performance.now();
      this.gone        = false;
      this.targetShell = null;
    }
    update(now, tank) {
      if (this.gone) return;

      if (!this.hasShell) {
        // Invalidate target if it disappeared
        if (this.targetShell && this.targetShell.gone) this.targetShell = null;

        // Die if no shell found after timeout (check for any shell, settled or falling)
        if (now - this.spawnTime >= HERMIT_CRAB_SHELL_TIMEOUT_MS) {
          const available = tank.shells.filter(s => !s.gone);
          if (available.length === 0 && !this.targetShell) {
            this.gone = true;
            return;
          }
        }

        // Find nearest settled shell
        let nearest = null, nd = Infinity;
        for (const s of tank.shells) {
          if (s.gone || !s.settled) continue;
          const d = Math.hypot(s.x - this.x, s.y - this.y);
          if (d < nd) { nd = d; nearest = s; }
        }
        if (nearest) {
          this.targetShell = nearest;
          this.vx = Math.sign(nearest.x - this.x) * HERMIT_CRAB_SPEED * 1.5;
          if (nd < this.radius + 16) {
            nearest.gone  = true;
            this.hasShell = true;
            this.targetShell = null;
          }
        } else {
          this._wander();
        }
      } else {
        // Collect nearest coin/diamond within range
        let nearestCoin = null, ncd = Infinity;
        for (const c of tank.coins) {
          if (c.gone) continue;
          const d = Math.hypot(c.x - this.x, c.y - this.y);
          if (d < HERMIT_CRAB_COLLECT_RADIUS && d < ncd) { ncd = d; nearestCoin = c; }
        }
        if (nearestCoin) {
          this.vx = Math.sign(nearestCoin.x - this.x) * HERMIT_CRAB_SPEED * 1.2;
          if (ncd < this.radius + nearestCoin.radius) {
            this.goldCollected += nearestCoin.value;
            money              += nearestCoin.value;
            nearestCoin.gone    = true;
            updateMoney();
            if (this.goldCollected >= HERMIT_CRAB_GOLD_TARGET) {
              tank.specialShells.push(new SpecialShell(this.x, this.y, Math.round(this.goldCollected)));
              this.hasShell      = false;
              this.goldCollected = 0;
              this.radius       *= 1.1;
              this.spawnTime     = now;
            }
          }
        } else {
          this._wander();
        }
      }

      this.x += this.vx;
      this.y  = H - 20;
      if (this.x - this.radius < 0)  { this.x = this.radius;      this.vx =  Math.abs(this.vx); }
      if (this.x + this.radius > W)  { this.x = W - this.radius;  this.vx = -Math.abs(this.vx); }
    }
    _wander() {
      if (Math.random() < 0.005) this.vx = (Math.random() < 0.5 ? -1 : 1) * HERMIT_CRAB_SPEED;
    }
    draw() {
      if (this.gone) return;
      const r = this.radius;
      ctx.save();
      ctx.translate(this.x, this.y);
      if (this.vx < 0) ctx.scale(-1, 1);

      // Shell behind crab
      if (this.hasShell) {
        const p    = Math.min(1, this.goldCollected / HERMIT_CRAB_GOLD_TARGET);
        const hue  = 30 + p * 20;
        const sat  = 45 + p * 35;
        const lig  = 52 - p * 12;
        ctx.beginPath();
        ctx.ellipse(2, 3, r * 1.35, r * 0.9, 0.25, 0, Math.PI * 2);
        ctx.fillStyle   = `hsl(${hue},${sat}%,${lig}%)`;
        ctx.strokeStyle = p > 0.4 ? '#b8860b' : '#8a6840';
        ctx.lineWidth   = 1.5;
        ctx.fill();
        ctx.stroke();
      }

      // Body
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.18, r * 0.72, r * 0.52, 0, 0, Math.PI * 2);
      ctx.fillStyle   = '#cc6633';
      ctx.strokeStyle = '#aa4422';
      ctx.lineWidth   = 1;
      ctx.fill();
      ctx.stroke();

      // Claws
      ctx.beginPath();
      ctx.arc(r * 0.82, -r * 0.3, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#cc6633';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-r * 0.82, -r * 0.3, r * 0.25, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.beginPath();
      ctx.arc(r * 0.3,  -r * 0.52, r * 0.14, 0, Math.PI * 2);
      ctx.arc(-r * 0.3, -r * 0.52, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();

      ctx.restore();
    }
  }

  // ── Fish ─────────────────────────────────────────────────────────────────────
  class Fish {
    constructor(x, y, type = 'normal') {
      this.id   = genId();
      this.x    = x;
      this.y    = y;
      this.type = type; // 'normal' | 'clown' | 'carnivore'

      const angle = Math.random() * Math.PI * 2;
      this.vx = Math.cos(angle) * NORMAL_SPEED;
      this.vy = Math.sin(angle) * NORMAL_SPEED;

      this.lastEatenTime = performance.now();
      this.hungryTime    = null;
      this.state         = 'normal'; // 'normal' | 'hungry' | 'dead'
      this.deadDriftVy   = 0;
      this.bottomTime    = null;
      this.facingRight   = this.vx >= 0;

      // Hue: carnivore → red; normal/clown → warm orange/yellow 20-65; king overridden to gold
      this.hue = type === 'carnivore'
        ? Math.floor(Math.random() * 30)
        : 20 + Math.floor(Math.random() * 46);

      // Growth
      this.stage        = 'guppy';
      this.radius       = FISH_RADIUS_GUPPY;
      this.pelletsEaten = 0;

      // Coin drops
      this.lastCoinTime = performance.now();

      // Wander behaviour
      this.behaviorType  = 'drift';
      this.behaviorTimer = DRIFT_INTERVAL_MIN + Math.floor(Math.random() * DRIFT_INTERVAL_RANGE);
      this.targetX       = null;
      this.targetY       = null;
      this.swimSpeed     = NORMAL_SPEED;

      // Carnivore-specific
      if (type === 'carnivore') {
        this.carnivoreState        = 'satiated';
        this.carnivoreSatiatedTime = performance.now();
        this.carnivoreHungryTime   = null;
        this.lastDiamondTime       = performance.now();
        this.lastAutoFeedTime      = 0;
      }

      // Clownfish-specific
      if (type === 'clown') {
        this.lastBondTime = 0;
      }
    }

    get eatDistance() { return this.radius + FOOD_RADIUS + 4; }

    update(now, tank) {
      if (this.state === 'dead') {
        this.deadDriftVy = Math.min(this.deadDriftVy + DEAD_DRIFT_ACCEL, DEAD_DRIFT_MAX);
        this.y += this.deadDriftVy;
        if (this.y >= H - this.radius) {
          this.y = H - this.radius;
          if (this.bottomTime === null) this.bottomTime = now;
        }
        return;
      }

      if (this.type === 'carnivore') {
        this._updateCarnivore(now, tank);
        return;
      }

      // Hunger progression
      if (this.state === 'normal' && now - this.lastEatenTime >= HUNGER_START_MS) {
        this.state      = 'hungry';
        this.hungryTime = now;
        if (tank.autoFeeder && money >= FOOD_COST) {
          money -= FOOD_COST;
          updateMoney();
          tank.foods.push(new Food(this.x, this.y));
        }
      }
      if (this.state === 'hungry' && now - this.hungryTime >= DEATH_AFTER_HUNGRY_MS) {
        this.state = 'dead';
        return;
      }

      // Coin drops
      this._dropCoins(now, tank);

      // Movement
      if (this.state === 'hungry') {
        this._seekFood(tank.foods);
      } else if (this.type === 'clown' && (this.stage === 'large' || this.stage === 'king')) {
        this._clownAdultBehavior(tank);
      } else {
        this._wander();
      }

      this._applyMovement();
      this._eatFood(now, tank);

      // Clownfish bonding
      if (this.type === 'clown' && (this.stage === 'large' || this.stage === 'king')) {
        this._checkBonding(now, tank);
      }
    }

    _updateCarnivore(now, tank) {
      // State transitions
      if (this.carnivoreState === 'satiated' &&
          now - this.carnivoreSatiatedTime >= CARNIVORE_SATIATED_MS) {
        this.carnivoreState      = 'hungry';
        this.carnivoreHungryTime = now;
      }
      if (this.carnivoreState === 'hungry' &&
          now - this.carnivoreHungryTime >= CARNIVORE_HUNGRY_DEATH_MS) {
        this.state = 'dead';
        return;
      }

      // Diamond drops (independent of state)
      if (now - this.lastDiamondTime >= CARNIVORE_DIAMOND_INTERVAL_MS) {
        tank.coins.push(new Coin(this.x, this.y, COIN_VALUE_CARNIVORE, 'diamond'));
        this.lastDiamondTime = now;
      }

      // Carnivore auto feeder: spawn one guppy when first becoming hungry
      if (this.carnivoreState === 'hungry' && tank.carnivoreAutoFeeder &&
          this.lastAutoFeedTime < this.carnivoreHungryTime) {
        const margin = FISH_RADIUS_GUPPY + 10;
        tank.fishes.push(new Fish(
          margin + Math.random() * (W - margin * 2),
          margin + Math.random() * (H - margin * 2),
          'normal'
        ));
        this.lastAutoFeedTime = now;
      }

      // Movement
      if (this.carnivoreState === 'satiated') {
        this._wander();
      } else {
        const prey = this._findPrey(tank);
        if (prey) {
          const dx    = prey.x - this.x;
          const dy    = prey.y - this.y;
          const dist  = Math.hypot(dx, dy);
          const speed = NORMAL_SPEED * CARNIVORE_HUNGRY_SPEED_MULT;
          if (dist > 0) {
            this.vx += ((dx / dist) * speed - this.vx) * SWIM_ACCEL * 2;
            this.vy += ((dy / dist) * speed - this.vy) * SWIM_ACCEL * 2;
          }
          if (dist <= this.radius + prey.radius + 4) {
            prey.state               = 'dead';
            this.carnivoreState      = 'satiated';
            this.carnivoreSatiatedTime = now;
          }
        } else {
          this._wander();
        }
      }
      this._applyMovement();
    }

    _findPrey(tank) {
      let nearest = null, nd = Infinity;
      for (const f of tank.fishes) {
        if (f === this || f.state === 'dead' || f.type === 'carnivore') continue;
        if (f.stage !== 'guppy') continue;
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < nd) { nd = d; nearest = f; }
      }
      return nearest;
    }

    _dropCoins(now, tank) {
      if (this.stage === 'guppy') return;
      if (now - this.lastCoinTime < COIN_INTERVAL_MS) return;
      let value    = COIN_VALUE_MEDIUM;
      let coinType = 'coin';
      if (this.stage === 'large') value = COIN_VALUE_LARGE;
      if (this.stage === 'king')  { value = COIN_VALUE_KING; coinType = 'diamond'; }
      tank.coins.push(new Coin(this.x, this.y, value, coinType));
      this.lastCoinTime = now;
    }

    _seekFood(foods) {
      let nearest = null, nd = Infinity;
      for (const f of foods) {
        if (f.gone) continue;
        const d = Math.hypot(f.x - this.x, f.y - this.y);
        if (d < nd) { nd = d; nearest = f; }
      }
      if (nearest) {
        const dx = nearest.x - this.x, dy = nearest.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          this.vx += ((dx / dist) * HUNGRY_SEEK_SPEED - this.vx) * SWIM_ACCEL * 2;
          this.vy += ((dy / dist) * HUNGRY_SEEK_SPEED - this.vy) * SWIM_ACCEL * 2;
        }
      }
    }

    _clownAdultBehavior(tank) {
      let nearestCoral = null, nd = Infinity;
      for (const c of tank.corals) {
        const d = Math.hypot(c.x - this.x, c.y - this.y);
        if (d < nd) { nd = d; nearestCoral = c; }
      }
      if (!nearestCoral) { this._wander(); return; }
      if (nd > CLOWN_BOND_RADIUS) {
        const dx = nearestCoral.x - this.x, dy = nearestCoral.y - this.y;
        const dist = Math.hypot(dx, dy);
        this.vx += ((dx / dist) * NORMAL_SPEED - this.vx) * SWIM_ACCEL;
        this.vy += ((dy / dist) * NORMAL_SPEED - this.vy) * SWIM_ACCEL;
      } else {
        this._wander();
        // gentle nudge back toward coral centre if drifting away
        const dx = nearestCoral.x - this.x, dy = nearestCoral.y - this.y;
        if (nd > CLOWN_BOND_RADIUS * 0.75) {
          this.vx += dx * 0.01;
          this.vy += dy * 0.01;
        }
      }
    }

    _checkBonding(now, tank) {
      if (now - this.lastBondTime < CLOWN_BOND_COOLDOWN_MS) return;
      // Find a coral within bonding range
      let nearestCoral = null, ncd = Infinity;
      for (const c of tank.corals) {
        const d = Math.hypot(c.x - this.x, c.y - this.y);
        if (d < CLOWN_BOND_CORAL_RADIUS && d < ncd) { ncd = d; nearestCoral = c; }
      }
      if (!nearestCoral) return;
      // Find another eligible adult clownfish near same coral
      for (const other of tank.fishes) {
        if (other === this || other.type !== 'clown') continue;
        if (other.stage !== 'large' && other.stage !== 'king') continue;
        if (now - other.lastBondTime < CLOWN_BOND_COOLDOWN_MS) continue;
        const otherCD = Math.hypot(nearestCoral.x - other.x, nearestCoral.y - other.y);
        if (otherCD > CLOWN_BOND_CORAL_RADIUS) continue;
        const fishD = Math.hypot(other.x - this.x, other.y - this.y);
        if (fishD > CLOWN_BOND_PROXIMITY) continue;
        // Bond!
        const sx = nearestCoral.x + (Math.random() - 0.5) * 40;
        const sy = nearestCoral.y - 20 - Math.random() * 25;
        tank.fishes.push(new Fish(
          Math.max(FISH_RADIUS_GUPPY, Math.min(W - FISH_RADIUS_GUPPY, sx)),
          Math.max(FISH_RADIUS_GUPPY, Math.min(H - FISH_RADIUS_GUPPY, sy)),
          'clown'
        ));
        this.lastBondTime  = now;
        other.lastBondTime = now;
        return;
      }
    }

    _wander() {
      this.behaviorTimer--;
      if (this.behaviorTimer <= 0) {
        const r = Math.random();
        if (r < SWIM_DRIFT_CHANCE) {
          this.behaviorType  = 'drift';
          this.behaviorTimer = DRIFT_INTERVAL_MIN + Math.floor(Math.random() * DRIFT_INTERVAL_RANGE);
        } else if (r < SWIM_SLOW_CHANCE) {
          this.behaviorType  = 'swim';
          this.swimSpeed     = SWIM_SLOW_MIN_SPEED + Math.random() * (SWIM_SLOW_MAX_SPEED - SWIM_SLOW_MIN_SPEED);
          const a            = Math.random() * Math.PI * 2;
          this.targetX       = this.x + Math.cos(a) * 100;
          this.targetY       = this.y + Math.sin(a) * 80;
          this.behaviorTimer = 60 + Math.floor(Math.random() * 60);
        } else {
          this.behaviorType  = 'dart';
          const a            = Math.random() * Math.PI * 2;
          this.vx            = Math.cos(a) * SWIM_DART_SPEED;
          this.vy            = Math.sin(a) * SWIM_DART_SPEED;
          this.behaviorTimer = 15 + Math.floor(Math.random() * 15);
        }
      }
      if (this.behaviorType === 'swim' && this.targetX !== null) {
        const dx = this.targetX - this.x, dy = this.targetY - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
          this.vx += ((dx / dist) * this.swimSpeed - this.vx) * SWIM_ACCEL;
          this.vy += ((dy / dist) * this.swimSpeed - this.vy) * SWIM_ACCEL;
        }
      }
    }

    _applyMovement() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x - this.radius < 0) { this.x = this.radius;     this.vx =  Math.abs(this.vx); }
      if (this.x + this.radius > W) { this.x = W - this.radius; this.vx = -Math.abs(this.vx); }
      if (this.y - this.radius < 0) { this.y = this.radius;     this.vy =  Math.abs(this.vy); }
      if (this.y + this.radius > H) { this.y = H - this.radius; this.vy = -Math.abs(this.vy); }
      this.facingRight = this.vx >= 0;
    }

    _eatFood(now, tank) {
      for (const food of tank.foods) {
        if (food.gone) continue;
        if (Math.hypot(food.x - this.x, food.y - this.y) > this.eatDistance) continue;
        food.gone          = true;
        this.lastEatenTime = now;
        if (this.state === 'hungry') { this.state = 'normal'; this.hungryTime = null; }
        this.pelletsEaten += 1 + tank.foodQualityLevel;
        this._checkGrowth();
        break;
      }
    }

    _checkGrowth() {
      if (this.pelletsEaten >= PELLETS_TO_KING && this.stage !== 'king') {
        this.stage  = 'king';
        this.radius = FISH_RADIUS_KING;
        if (this.type !== 'carnivore') this.hue = 45; // gold
      } else if (this.pelletsEaten >= PELLETS_TO_LARGE && this.stage !== 'large' && this.stage !== 'king') {
        this.stage  = 'large';
        this.radius = FISH_RADIUS_LARGE;
      } else if (this.pelletsEaten >= PELLETS_TO_MEDIUM && this.stage === 'guppy') {
        this.stage  = 'medium';
        this.radius = FISH_RADIUS_MEDIUM;
      }
    }

    shouldRemove(now) {
      return this.state === 'dead' &&
             this.bottomTime !== null &&
             now - this.bottomTime >= DEAD_BOTTOM_LINGER_MS;
    }

    draw(now) {
      const isCarnivore = this.type === 'carnivore';
      const isClown     = this.type === 'clown';
      const isKing      = this.stage === 'king';
      const isDead      = this.state === 'dead';
      const isHungry    = this.state === 'hungry';
      const r           = this.radius;

      ctx.save();
      ctx.translate(this.x, this.y);
      if (!this.facingRight) ctx.scale(-1, 1);
      if (isDead)            ctx.scale(1, -1);

      // Body colour
      let bodyColor;
      if (isCarnivore)      bodyColor = isDead ? '#555' : `hsl(${this.hue}, 80%, 55%)`;
      else if (isKing)      bodyColor = isDead ? '#555' : 'hsl(45, 100%, 65%)';
      else if (isClown)     bodyColor = isDead ? '#555' : '#FF6B35';
      else                  bodyColor = isDead ? '#555' : `hsl(${this.hue}, 70%, 60%)`;

      // Body ellipse
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
      if (!isDead && isKing) { ctx.shadowColor = 'hsl(45,100%,75%)'; ctx.shadowBlur = 12; }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Clownfish white stripes with black outline (clipped to body)
      if (isClown && !isDead) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(-r * 0.22, -r * 0.6, r * 0.32, r * 1.2);
        ctx.fillRect( r * 0.12, -r * 0.6, r * 0.26, r * 1.2);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth   = 1;
        ctx.strokeRect(-r * 0.22, -r * 0.6, r * 0.32, r * 1.2);
        ctx.strokeRect( r * 0.12, -r * 0.6, r * 0.26, r * 1.2);
        ctx.restore();
      }

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
        if (isClown)       ctx.fillStyle = '#e05010';
        else if (isCarnivore) ctx.fillStyle = `hsl(${this.hue}, 70%, 40%)`;
        else if (isKing)   ctx.fillStyle = 'hsl(45,80%,50%)';
        else               ctx.fillStyle = `hsl(${this.hue}, 60%, 55%)`;
        ctx.fill();
      }

      // Pectoral fin
      if (this.stage === 'large' || isKing) {
        ctx.beginPath();
        ctx.ellipse(0, r * 0.4, r * 0.35, r * 0.18, Math.PI / 5, 0, Math.PI * 2);
        ctx.fillStyle = isClown ? '#e05010' : `hsl(${this.hue}, 50%, 60%)`;
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

      // Hunger / hunting indicator
      const showHungry = isHungry || (isCarnivore && this.carnivoreState === 'hungry');
      if (showHungry) {
        ctx.save();
        ctx.strokeStyle = isCarnivore ? '#ff2200' : '#ffa040';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = isCarnivore ? '#ff2200' : '#ffa040';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(isCarnivore ? 'Hunting!' : 'Hungry!', this.x, this.y - r - 10);
        ctx.restore();
      }

      // Dead label
      if (isDead) {
        ctx.save();
        ctx.fillStyle = '#ff4444';
        ctx.font      = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💀', this.x, this.y - r - 6);
        ctx.restore();
      }

      // Stage label
      if (!isDead && !showHungry) {
        let label;
        if (isCarnivore) label = 'carnivore';
        else if (isKing) label = '👑 king';
        else if (isClown) {
          label = this.stage === 'guppy' ? 'clown' : `clown ${this.stage}`;
        } else {
          label = this.stage;
        }
        ctx.save();
        ctx.fillStyle = isKing ? 'rgba(255,215,0,0.9)' : 'rgba(200,230,255,0.7)';
        ctx.font      = `${r < SMALL_FISH_LABEL_THRESHOLD ? 8 : 9}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(label, this.x, this.y + r + 13);
        ctx.restore();
      }
    }
  }

  // ── TankInstance ─────────────────────────────────────────────────────────────
  class TankInstance {
    constructor() {
      this.fishes          = [];
      this.foods           = [];
      this.coins           = [];
      this.corals          = [];
      this.fancyCoralNodes = [];
      this.oysterRocks     = [];
      this.shells          = [];
      this.specialShells   = [];
      this.hermitCrabs     = [];
      // upgrades
      this.foodQualityLevel    = 0;
      this.multiFoodLevel      = 1;
      this.autoFeeder          = false;
      this.carnivoreAutoFeeder = false;
      this.tankLevel           = 0;
    }
    get aliveFishCount() {
      return this.fishes.filter(f => f.state !== 'dead').length;
    }
  }

  // ── Tanks ─────────────────────────────────────────────────────────────────────
  const tanks = [new TankInstance(), new TankInstance(), new TankInstance()];
  // Tank 2 starts with one coral
  tanks[1].corals.push(new Coral(150 + Math.random() * 500, H - 42));

  // ── Game loop ────────────────────────────────────────────────────────────────
  function loop(timestamp) {
    const now  = timestamp;
    const tank = tanks[activeTankIdx];

    ctx.clearRect(0, 0, W, H);
    drawBackground();

    // Corals
    for (const c of tank.corals) { c.update(now, tank); c.draw(); }

    // Fancy coral nodes
    for (const n of tank.fancyCoralNodes) { n.update(); n.draw(); }

    // Oyster rocks
    for (const rock of tank.oysterRocks) { rock.update(now, tank); rock.draw(); }

    // Shells
    for (const s of tank.shells) { s.update(); s.draw(); }

    // Special shells
    for (const ss of tank.specialShells) { ss.draw(); }

    // Foods
    for (const f of tank.foods) { f.update(); f.draw(); }

    // Coins
    for (const c of tank.coins) { c.update(); c.draw(); }

    // Fish
    for (const f of tank.fishes) { f.update(now, tank); f.draw(now); }

    // Hermit crabs
    for (const crab of tank.hermitCrabs) { crab.update(now, tank); crab.draw(); }

    // Cleanup
    removeGone(tank.foods);
    removeGone(tank.coins);
    removeGone(tank.fancyCoralNodes);
    removeGone(tank.specialShells);
    removeGone(tank.hermitCrabs);
    for (let i = tank.fishes.length - 1; i >= 0; i--) {
      if (tank.fishes[i].shouldRemove(now)) tank.fishes.splice(i, 1);
    }

    updateCount();
    updateCarnivoreAutoFeederBtn();

    requestAnimationFrame(loop);
  }

  function removeGone(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].gone) arr.splice(i, 1);
    }
  }

  function drawBackground() {
    const t = performance.now() / 1000;
    ctx.save();
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 6; i++) {
      const bx = ((Math.sin(t * 0.4 + i * 1.9) + 1) / 2) * W;
      const by = ((Math.cos(t * 0.3 + i * 2.3) + 1) / 2) * H;
      const bubbleRadius = 30 + Math.sin(t + i) * 10;
      const g  = ctx.createRadialGradient(bx, by, 0, bx, by, bubbleRadius);
      g.addColorStop(0, '#7ecfff');
      g.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(bx, by, bubbleRadius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function updateCount() {
    countEl.textContent = `Fish: ${tanks[activeTankIdx].aliveFishCount}`;
  }

  function updateMoney() {
    moneyEl.textContent = `💰 $${Math.round(money)}`;
  }

  function flashNoMoney() {
    noMoneyEl.classList.remove('hidden');
    if (noMoneyTimer) clearTimeout(noMoneyTimer);
    noMoneyTimer = setTimeout(() => noMoneyEl.classList.add('hidden'), 1500);
  }

  function updateCarnivoreAutoFeederBtn() {
    const tank = tanks[activeTankIdx];
    const btn  = document.getElementById('carnivore-auto-feeder-btn');
    if (!btn) return;
    const hasCarnivore = tank.fishes.some(f => f.type === 'carnivore' && f.state !== 'dead');
    btn.style.display = (activeTankIdx !== 2 && hasCarnivore) ? '' : 'none';
  }

  function refreshShopButtons() {
    const tank = tanks[activeTankIdx];
    const idx  = activeTankIdx;

    // Section visibility
    document.getElementById('coral-section').style.display   = (idx !== 2) ? '' : 'none';
    document.getElementById('oyster-section').style.display  = (idx === 2) ? '' : 'none';
    document.getElementById('hermit-section').style.display  = (idx === 2) ? '' : 'none';
    document.getElementById('add-carnivore-btn').style.display = (idx !== 2) ? '' : 'none';
    document.getElementById('add-clown-btn').style.display     = (idx !== 2) ? '' : 'none';

    // Food quality
    const fqBtn = document.getElementById('food-quality-btn');
    fqBtn.textContent = `Better Food ($${FOOD_QUALITY_COST}) [${tank.foodQualityLevel}/${FOOD_QUALITY_MAX}]`;
    fqBtn.disabled    = tank.foodQualityLevel >= FOOD_QUALITY_MAX;

    // Multi-food
    const mfBtn = document.getElementById('multi-food-btn');
    mfBtn.textContent = `Multi-Food ($${MULTI_FOOD_COST}) [${tank.multiFoodLevel}×/${MULTI_FOOD_MAX}×]`;
    mfBtn.disabled    = tank.multiFoodLevel >= MULTI_FOOD_MAX;

    // Auto feeder
    const afBtn = document.getElementById('auto-feeder-btn');
    afBtn.textContent = tank.autoFeeder ? 'Auto Feeder (owned)' : `Auto Feeder ($${AUTO_FEEDER_COST})`;
    afBtn.disabled    = tank.autoFeeder;

    // Carnivore auto feeder
    const cafBtn = document.getElementById('carnivore-auto-feeder-btn');
    cafBtn.textContent = tank.carnivoreAutoFeeder
      ? 'Carnivore Auto Feeder (owned)'
      : `Carnivore Auto Feeder ($${CARNIVORE_AUTO_FEEDER_COST})`;
    cafBtn.disabled = tank.carnivoreAutoFeeder;

    // Tank level
    const tlBtn  = document.getElementById('tank-level-btn');
    const tlCost = TANK_LEVEL_BASE_COST * Math.pow(2, tank.tankLevel);
    tlBtn.textContent = `Tank Level Up ($${tlCost}) [Lv.${tank.tankLevel}]`;

    updateCarnivoreAutoFeederBtn();
  }

  function switchTank(idx) {
    activeTankIdx = idx;
    document.querySelectorAll('.tank-tab').forEach((tab, i) => {
      tab.classList.toggle('active', i === idx);
    });
    refreshShopButtons();
    updateCount();
  }

  function spawnFish(type) {
    const cost = type === 'carnivore' ? CARNIVORE_COST
               : type === 'clown'     ? CLOWN_FISH_COST
               :                        FISH_COST;
    if (money < cost) { flashNoMoney(); return; }
    money -= cost;
    updateMoney();
    const tank   = tanks[activeTankIdx];
    const margin = FISH_RADIUS_GUPPY + 10;
    tank.fishes.push(new Fish(
      margin + Math.random() * (W - margin * 2),
      margin + Math.random() * (H - margin * 2),
      type
    ));
    updateCount();
  }

  // ── Canvas click handler ──────────────────────────────────────────────────────
  canvas.addEventListener('click', (e) => {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const cx     = (e.clientX - rect.left) * scaleX;
    const cy     = (e.clientY - rect.top)  * scaleY;
    const tank   = tanks[activeTankIdx];

    // Special shells (player only)
    for (let i = tank.specialShells.length - 1; i >= 0; i--) {
      const ss = tank.specialShells[i];
      if (!ss.gone && ss.contains(cx, cy)) { ss.collect(); return; }
    }

    // Fancy coral nodes
    for (let i = tank.fancyCoralNodes.length - 1; i >= 0; i--) {
      const n = tank.fancyCoralNodes[i];
      if (!n.gone && n.contains(cx, cy)) { n.collect(); return; }
    }

    // Coins / diamonds
    for (let i = tank.coins.length - 1; i >= 0; i--) {
      const c = tank.coins[i];
      if (!c.gone && c.contains(cx, cy)) { c.collect(); return; }
    }

    // Oyster pearls (tank 3)
    if (activeTankIdx === 2) {
      for (const rock of tank.oysterRocks) {
        for (const oyster of rock.oysters) {
          if (oyster.contains(cx, cy)) { oyster.collect(tank); return; }
        }
      }
    }

    // Drop food
    const totalCost = FOOD_COST * tank.multiFoodLevel;
    if (money < totalCost) { flashNoMoney(); return; }
    money -= totalCost;
    updateMoney();
    const spread = tank.multiFoodLevel > 1 ? 20 : 0;
    for (let i = 0; i < tank.multiFoodLevel; i++) {
      tank.foods.push(new Food(
        cx + (Math.random() - 0.5) * spread,
        cy + (Math.random() - 0.5) * spread
      ));
    }
  });

  // ── Shop button wiring ────────────────────────────────────────────────────────
  document.getElementById('add-fish-btn').addEventListener('click', () => spawnFish('normal'));
  document.getElementById('add-clown-btn').addEventListener('click', () => spawnFish('clown'));
  document.getElementById('add-carnivore-btn').addEventListener('click', () => spawnFish('carnivore'));

  document.getElementById('food-quality-btn').addEventListener('click', () => {
    const tank = tanks[activeTankIdx];
    if (tank.foodQualityLevel >= FOOD_QUALITY_MAX || money < FOOD_QUALITY_COST) { flashNoMoney(); return; }
    money -= FOOD_QUALITY_COST; tank.foodQualityLevel++;
    updateMoney(); refreshShopButtons();
  });

  document.getElementById('multi-food-btn').addEventListener('click', () => {
    const tank = tanks[activeTankIdx];
    if (tank.multiFoodLevel >= MULTI_FOOD_MAX || money < MULTI_FOOD_COST) { flashNoMoney(); return; }
    money -= MULTI_FOOD_COST; tank.multiFoodLevel++;
    updateMoney(); refreshShopButtons();
  });

  document.getElementById('auto-feeder-btn').addEventListener('click', () => {
    const tank = tanks[activeTankIdx];
    if (tank.autoFeeder || money < AUTO_FEEDER_COST) { flashNoMoney(); return; }
    money -= AUTO_FEEDER_COST; tank.autoFeeder = true;
    updateMoney(); refreshShopButtons();
  });

  document.getElementById('carnivore-auto-feeder-btn').addEventListener('click', () => {
    const tank = tanks[activeTankIdx];
    if (tank.carnivoreAutoFeeder || money < CARNIVORE_AUTO_FEEDER_COST) { flashNoMoney(); return; }
    money -= CARNIVORE_AUTO_FEEDER_COST; tank.carnivoreAutoFeeder = true;
    updateMoney(); refreshShopButtons();
  });

  document.getElementById('tank-level-btn').addEventListener('click', () => {
    const tank = tanks[activeTankIdx];
    const cost = TANK_LEVEL_BASE_COST * Math.pow(2, tank.tankLevel);
    if (money < cost) { flashNoMoney(); return; }
    money -= cost; tank.tankLevel++;
    updateMoney(); refreshShopButtons();
  });

  document.getElementById('add-coral-btn').addEventListener('click', () => {
    if (money < CORAL_COST) { flashNoMoney(); return; }
    money -= CORAL_COST; updateMoney();
    const tank = tanks[activeTankIdx];
    tank.corals.push(new Coral(60 + Math.random() * (W - 120), H - 42));
  });

  document.getElementById('add-oyster-btn').addEventListener('click', () => {
    if (money < OYSTER_ROCK_COST) { flashNoMoney(); return; }
    money -= OYSTER_ROCK_COST; updateMoney();
    const tank = tanks[activeTankIdx];
    tank.oysterRocks.push(new OysterRock(60 + Math.random() * (W - 120), H - 30));
  });

  document.getElementById('add-hermit-btn').addEventListener('click', () => {
    if (money < HERMIT_CRAB_COST) { flashNoMoney(); return; }
    money -= HERMIT_CRAB_COST; updateMoney();
    const tank = tanks[activeTankIdx];
    tank.hermitCrabs.push(new HermitCrab(80 + Math.random() * (W - 160)));
  });

  document.getElementById('reseed-btn').addEventListener('click', () => {
    const tank      = tanks[activeTankIdx];
    const totalCost = RESEED_COST * tank.oysterRocks.length;
    if (tank.oysterRocks.length === 0 || money < totalCost) { flashNoMoney(); return; }
    money -= totalCost; updateMoney();
    for (const rock of tank.oysterRocks) rock.reseed();
  });

  document.getElementById('test-money-btn').addEventListener('click', () => {
    money += 1000;
    updateMoney();
  });

  // Tab buttons
  document.querySelectorAll('.tank-tab').forEach((tab, i) => {
    tab.addEventListener('click', () => switchTank(i));
  });

  // ── Boot ─────────────────────────────────────────────────────────────────────
  updateMoney();
  switchTank(0);
  requestAnimationFrame(loop);
})();
