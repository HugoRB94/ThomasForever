// Efectos: emojis flotantes (corazones, zzz, notas) y la barra de estado al pasar el ratón.
/* global PIXI */
const { Container, Graphics, Text } = PIXI;

export class Fx {
  constructor() {
    this.layer = new Container();
    this.particles = [];
  }

  emit(char, x, y, size = 26) {
    const t = new Text({ text: char, style: { fontSize: size, fill: 0xffffff, stroke: { color: 0x2a2030, width: 3 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.layer.addChild(t);
    this.particles.push({ t, life: 1.3, max: 1.3, vx: (Math.random() - 0.5) * 40 });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.t.y -= 50 * dt;
      p.t.x += p.vx * dt;
      p.t.alpha = Math.max(p.life / p.max, 0);
      if (p.life <= 0) {
        this.layer.removeChild(p.t);
        p.t.destroy();
        this.particles.splice(i, 1);
      }
    }
  }
}

// Tres barritas (comida, energía, cariño) sobre la mascota.
export class NeedsHud {
  constructor() {
    this.root = new Container();
    this.bg = new Graphics();
    this.bars = new Graphics();
    this.root.addChild(this.bg, this.bars);
    this.rows = [
      { icon: '🍗', key: 'food', color: 0xf2a65a },
      { icon: '⚡', key: 'energy', color: 0x7bc8f6 },
      { icon: '❤', key: 'love', color: 0xff7a93 },
    ];
    this.bg.roundRect(-62, -8, 124, 62, 10).fill({ color: 0x1c1822, alpha: 0.82 });
    this.rows.forEach((row, i) => {
      const label = new Text({ text: row.icon, style: { fontSize: 12 } });
      label.anchor.set(0.5);
      label.position.set(-46, 4 + i * 17);
      this.root.addChild(label);
    });
    this.root.alpha = 0;
    this.root.visible = false;
  }

  update(dt, show, x, y, needs) {
    const target = show ? 1 : 0;
    this.root.alpha += (target - this.root.alpha) * Math.min(1, dt * 10);
    this.root.visible = this.root.alpha > 0.02;
    if (!this.root.visible) return;
    this.root.position.set(x, y);
    this.bars.clear();
    this.rows.forEach((row, i) => {
      const v = needs[row.key] / 100;
      const by = i * 17;
      this.bars.roundRect(-32, by, 84, 8, 4).fill({ color: 0xffffff, alpha: 0.16 });
      if (v > 0.02) this.bars.roundRect(-32, by, 84 * v, 8, 4).fill(v < 0.25 ? 0xff5a5a : row.color);
    });
  }
}
