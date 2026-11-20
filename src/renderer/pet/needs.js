// Necesidades tipo Tamagotchi (0–100): comida, energía y cariño.
// Bajan con el tiempo (también con la app cerrada) y condicionan el comportamiento.
const clamp = (v) => Math.min(100, Math.max(0, v));

const PER_MIN = {
  food: -100 / 240,        // de lleno a vacío en ~4 h
  energyAwake: -100 / 300, // ~5 h despierto
  energyAsleep: 100 / 25,  // ~25 min de siesta completa
  love: -100 / 360,        // ~6 h sin caricias
};

export class Needs {
  constructor() {
    this.food = 80;
    this.energy = 85;
    this.love = 70;
  }

  load(saved) {
    if (!saved || typeof saved.food !== 'number') return;
    this.food = clamp(saved.food);
    this.energy = clamp(saved.energy);
    this.love = clamp(saved.love);
    // Tiempo con la app cerrada: se aplica el desgaste (máx. 8 h) sin dejarla a cero.
    const minutes = Math.min((Date.now() - (saved.savedAt || Date.now())) / 60000, 480);
    if (minutes > 1) {
      this.food = Math.max(10, this.food + PER_MIN.food * minutes);
      this.love = Math.max(10, this.love + PER_MIN.love * minutes);
      this.energy = clamp(this.energy + PER_MIN.energyAsleep * minutes); // ha descansado
    }
  }

  update(dt, asleep, activity) {
    const min = dt / 60;
    this.food = clamp(this.food + PER_MIN.food * min);
    this.love = clamp(this.love + PER_MIN.love * min);
    this.energy = clamp(this.energy + (asleep ? PER_MIN.energyAsleep : PER_MIN.energyAwake * (0.6 + activity * 0.8)) * min);
  }

  feed() { this.food = clamp(this.food + 35); this.love = clamp(this.love + 4); }
  stroke() { this.love = clamp(this.love + 3); }

  toJSON() {
    return { food: this.food, energy: this.energy, love: this.love, savedAt: Date.now() };
  }
}
