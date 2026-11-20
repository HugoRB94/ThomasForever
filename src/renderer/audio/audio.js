// Sonido: grabaciones reales incluidas con la app (assets/sounds) para el maullido y el
// ronroneo; los audios que suba el usuario sustituyen al maullido. La síntesis solo se
// usa como último recurso si faltan las grabaciones.
const MEOW_LEVEL = 2.2; // los filtros de formantes atenúan mucho: se compensa aquí

export class PetAudio {
  constructor(tf) {
    this.tf = tf;
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.custom = [];
    this.meows = []; // grabaciones reales incluidas: [{ name, buffer }]
    this.muted = new Set(); // nombres de maullidos incluidos que el usuario ha desmarcado
    this.purrs = [];
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // Limitador: permite sonidos con cuerpo sin riesgo de saturar.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  async decode(bytes) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return this.ensure().decodeAudioData(copy);
  }

  // Deja una grabación lista para usar: mono, sin silencios al principio y al final
  // (si trim) y con el volumen igualado, para que todas suenen al mismo nivel.
  prepare(buffer, { trim, targetRms }) {
    const ctx = this.ensure();
    const n = buffer.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += ch[i] / buffer.numberOfChannels;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak === 0) return null;

    let start = 0, end = n;
    if (trim) {
      const floor = peak * 0.05, pad = Math.floor(buffer.sampleRate * 0.03);
      while (start < n && Math.abs(mono[start]) < floor) start++;
      while (end > start && Math.abs(mono[end - 1]) < floor) end--;
      start = Math.max(0, start - pad);
      end = Math.min(n, end + pad * 4);
    }
    const len = end - start;
    if (len < buffer.sampleRate * 0.1) return null;

    let sum = 0;
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / len);
    const gain = Math.min(targetRms / rms, 1 / peak); // iguala el volumen sin llegar a saturar

    const out = ctx.createBuffer(1, len, buffer.sampleRate);
    const d = out.getChannelData(0);
    const fade = Math.floor(buffer.sampleRate * 0.012);
    for (let i = 0; i < len; i++) d[i] = mono[start + i] * gain * Math.min(1, i / fade, (len - 1 - i) / fade);
    return out;
  }

  async loadAll(list, opts, label) {
    const out = [];
    for (const item of list) {
      try {
        const bytes = typeof item === 'string' ? await this.tf.readSound(item) : item;
        const prepared = this.prepare(await this.decode(bytes), opts);
        if (prepared) out.push(prepared);
      } catch (err) {
        console.warn(label + ' no reproducible:', typeof item === 'string' ? item : '', err.message);
      }
    }
    return out;
  }

  async reloadCustom() {
    this.custom = await this.loadAll(await this.tf.listSounds(), { trim: false, targetRms: 0.22 }, 'audio');
  }

  async loadBuiltin() {
    const data = await this.tf.getBuiltinSounds();
    const load = async (list, opts) => {
      const out = [];
      for (const { name, bytes } of list) {
        try {
          const buffer = this.prepare(await this.decode(bytes), opts);
          if (buffer) out.push({ name, buffer });
        } catch (err) {
          console.warn('grabación incluida no reproducible:', name, err.message);
        }
      }
      return out;
    };
    this.meows = await load(data.meows, { trim: true, targetRms: 0.22 });
    this.purrs = (await load(data.purrs, { trim: false, targetRms: 0.2 })).map((x) => x.buffer);
  }

  play(buffer, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(this.master);
    src.start();
  }

  // Sonido "de voz": un audio del usuario al azar; si no hay, una grabación incluida.
  // name: reproduce ese maullido incluido en concreto (para probarlo desde Ajustes).
  meow(name) {
    if (this.volume <= 0) return;
    const ctx = this.ensure();
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const named = name && this.meows.find((m) => m.name === name);
    if (named) return this.play(named.buffer);
    if (this.custom.length) return this.play(pick(this.custom));
    // Grabación real elegida entre las que el usuario tiene marcadas, con una ligera
    // variación para que no suene siempre idéntica.
    const enabled = this.meows.filter((m) => !this.muted.has(m.name));
    const pool = enabled.length ? enabled : this.meows;
    if (pool.length) return this.play(pick(pool).buffer, 0.94 + Math.random() * 0.07);
    // Último recurso si no hay grabaciones: maullido sintético.
    const t = ctx.currentTime;
    const dur = 0.5 + Math.random() * 0.3;
    const pitch = 0.72 + Math.random() * 0.16; // agudo, pero sin chillar

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520 * pitch, t);
    osc.frequency.linearRampToValueAtTime(840 * pitch, t + dur * 0.3);
    osc.frequency.exponentialRampToValueAtTime(430 * pitch, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(MEOW_LEVEL, t + 0.06);
    gain.gain.setValueAtTime(MEOW_LEVEL, t + dur * 0.6);
    gain.gain.linearRampToValueAtTime(0, t + dur);

    // Dos formantes que se abren y se cierran: "mi-a-u".
    for (const [f0, f1, f2, q] of [[680, 1200, 600, 5], [1500, 2200, 1150, 8]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.linearRampToValueAtTime(f1, t + dur * 0.35);
      bp.frequency.linearRampToValueAtTime(f2, t + dur);
      osc.connect(bp);
      bp.connect(gain);
    }
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Ronroneo: un gato no emite un zumbido continuo sino ~25 golpecitos por segundo, más
  // rápidos y fuertes al inspirar que al espirar, con una pausa mínima entre ambos.
  // Se sintetiza pulso a pulso (cada uno, una vibración amortiguada con algo de aire).
  purr(dur = 3) {
    if (this.volume <= 0) return;
    const ctx = this.ensure();
    if (this.purrs.length) {
      // Grabación real en bucle, empezando en un punto al azar, con entrada y salida suaves.
      const buffer = this.purrs[Math.floor(Math.random() * this.purrs.length)];
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const env = ctx.createGain();
      const t0 = ctx.currentTime;
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(1, t0 + 0.5);
      env.gain.setValueAtTime(1, t0 + Math.max(0.6, dur - 0.8));
      env.gain.linearRampToValueAtTime(0, t0 + dur);
      src.connect(env);
      env.connect(this.master);
      src.start(t0, Math.random() * Math.max(0, buffer.duration - 1));
      src.stop(t0 + dur + 0.05);
      return;
    }
    // Último recurso si no hay grabaciones: ronroneo sintético.
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * dur);
    const buffer = ctx.createBuffer(1, n, sr);
    const d = buffer.getChannelData(0);
    const TAU = 2 * Math.PI;
    const cycle = 1.45; // una respiración completa, en segundos

    for (let t = 0; t < dur;) {
      const phase = (t % cycle) / cycle;
      const inhale = phase < 0.42;
      const pause = (phase >= 0.42 && phase < 0.47) || phase >= 0.96;
      const rate = (inhale ? 27 : 22.5) * (0.96 + Math.random() * 0.08);
      if (!pause) {
        const amp = (inhale ? 1 : 0.7) * (0.82 + Math.random() * 0.36);
        const f1 = (inhale ? 125 : 104) * (0.93 + Math.random() * 0.14);
        const f2 = f1 * 2.1 * (0.95 + Math.random() * 0.1);
        const start = Math.floor(t * sr);
        const len = Math.floor(sr * 0.05);
        for (let i = 0; i < len && start + i < n; i++) {
          const x = i / sr;
          const env = Math.exp(-x / 0.011) * Math.min(1, x / 0.0015);
          d[start + i] += amp * env * (0.6 * Math.sin(TAU * f1 * x) + 0.3 * Math.sin(TAU * f2 * x + 1) + 0.2 * (Math.random() * 2 - 1));
        }
      }
      t += 1 / rate;
    }

    // Entrada y salida suaves, y normalizado.
    const fadeIn = Math.floor(sr * 0.3), fadeOut = Math.floor(sr * 0.5);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      d[i] *= Math.min(1, i / fadeIn, (n - i) / fadeOut);
      peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak > 0) for (let i = 0; i < n; i++) d[i] *= 0.9 / peak;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 1100;
    src.connect(soften);
    soften.connect(this.master);
    src.start();
  }

  // Toque breve: la mascota "pulsa" un botón de ventana.
  tap() {
    if (this.volume <= 0) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.07);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  chomp() {
    if (this.volume <= 0) return;
    const ctx = this.ensure();
    for (let i = 0; i < 4; i++) {
      const t = ctx.currentTime + i * 0.32;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }
}
