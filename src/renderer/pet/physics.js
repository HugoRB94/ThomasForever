// Físicas mínimas: gravedad, suelo y plataformas de un solo sentido (los bordes
// superiores de las ventanas). Solo se aterriza en una plataforma cayendo desde arriba.

export const GRAVITY = 2600; // px/s²

// body: { x, y, vx, vy, dropT }   world: { floor, platforms: [{ x1, x2, y }] }
// Devuelve { landed: null | { kind: 'floor' } | { kind: 'platform', p }, impact }
export function stepBody(body, dt, world, usePlatforms = true) {
  const prevY = body.y;
  body.vy += GRAVITY * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  let landed = null;
  if (usePlatforms && body.vy >= 0 && !(body.dropT > 0)) {
    let best = null;
    for (const p of world.platforms) {
      if (body.x >= p.x1 && body.x <= p.x2 && prevY <= p.y + 1 && body.y >= p.y && (!best || p.y < best.y)) best = p;
    }
    if (best) {
      body.y = best.y;
      landed = { kind: 'platform', p: best };
    }
  }
  if (body.y >= world.floor) {
    body.y = world.floor;
    landed = { kind: 'floor' };
  }

  let impact = 0;
  if (landed) {
    impact = body.vy;
    body.vy = 0;
  }
  return { landed, impact };
}

// Velocidad inicial para saltar de (x, y) a (tx, ty) pasando `clearance` px por encima
// del punto más alto de los dos. Devuelve null si el salto sería absurdo.
export function jumpVelocity(x, y, tx, ty, clearance = 80, maxSpeedX = 1500) {
  const rise = Math.max(y - ty, 0) + clearance;
  const vy0 = Math.sqrt(2 * GRAVITY * rise);
  const fall = rise - (y - ty);
  const time = vy0 / GRAVITY + Math.sqrt((2 * fall) / GRAVITY);
  const vx = (tx - x) / time;
  if (Math.abs(vx) > maxSpeedX) return null;
  return { vx, vy: -vy0 };
}
