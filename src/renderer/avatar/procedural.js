// Avatar por defecto: un gato dibujado por código. Sirve de referencia de la interfaz
// común a todos los avatares:
//   root        Container con el origen en los pies y mirando a la derecha
//   bounds      { halfW, h } en px a escala 1 (para la detección del ratón)
//   sleepSquash cuánto se "aplasta" al dormir (0 si ya tiene pose propia)
//   update(view) con view = { t, dt, asleep, walking, eating, happy, dragging, airborne }
//   destroy()
/* global PIXI */
const { Container, Graphics } = PIXI;

export function createProceduralAvatar() {
  const root = new Container();
  const fur = 0xf2a65a, dark = 0x3a2a20, pink = 0xff8fa3;

  const tail = new Graphics().roundRect(-6, -64, 12, 64, 6).fill(fur);
  tail.position.set(-40, -30);

  const legs = new Graphics();
  for (const lx of [-34, -16, 8, 26]) legs.roundRect(lx, -14, 11, 14, 4).fill(dark);

  const body = new Graphics().ellipse(0, -36, 50, 32).fill(fur);

  const head = new Container();
  head.addChild(new Graphics()
    .poly([12, -84, 18, -112, 34, -92]).fill(fur)
    .poly([38, -94, 54, -112, 58, -84]).fill(fur)
    .circle(36, -68, 28).fill(fur)
    .circle(42, -60, 3).fill(pink));
  const eyesOpen = new Graphics().circle(28, -70, 4).fill(dark).circle(48, -70, 4).fill(dark);
  const eyesClosed = new Graphics().rect(23, -70, 10, 2).fill(dark).rect(43, -70, 10, 2).fill(dark);
  head.addChild(eyesOpen, eyesClosed);
  head.pivot.set(20, -50);
  head.position.set(20, -50);

  root.addChild(tail, legs, body, head);

  return {
    root,
    bounds: { halfW: 64, h: 118 },
    sleepSquash: 0.18,
    update(v) {
      tail.rotation = -0.6 + Math.sin(v.t * (v.happy ? 14 : 2.5)) * 0.35;
      head.rotation = v.eating ? 0.55 + Math.sin(v.t * 20) * 0.08 : v.asleep ? 0.25 : 0;
      const closed = v.asleep || v.happy;
      eyesOpen.visible = !closed;
      eyesClosed.visible = closed;
    },
    destroy() { root.destroy({ children: true }); },
  };
}
