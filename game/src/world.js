// The game's rules and state, with no drawing and no browser in it: the player, the walls and
// cover, the guards and their vision cones, the keycard, the exit, the alarm and the clock.
// step() advances one fixed step and returns what happened as bit flags, so the caller can react
// (sound, screens) without the world knowing about them. Nothing here allocates after createWorld.
import { ALARM, FIELD, GUARD, LEVEL, MAP, OBJECTIVE, PLAYER } from './config.js';

export const EVENT_SPOTTED = 1;
export const EVENT_CAUGHT = 2;
export const EVENT_KEYCARD = 4;
export const EVENT_ESCAPED = 8;
export const EVENT_ALARM = 16;

export const PHASE_HUNT = 0; // the player has the keycard and must reach the exit
export const PHASE_INFILTRATE = 1; // the player must reach the keycard first

/** A guard's mode: walking its route, pausing at a waypoint, or chasing a seen player. */
export const MODE_PATROL = 0;
export const MODE_PAUSE = 1;
export const MODE_CHASE = 2;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** Distance from a point to a segment, used for line-of-sight against cover. */
function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** True when the circle at (x,y,r) overlaps the axis-aligned rectangle. */
function circleRect(x, y, r, rect) {
  const nx = clamp(x, rect.x, rect.x + rect.w);
  const ny = clamp(y, rect.y, rect.y + rect.h);
  return (x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r;
}

/** True when the segment (ax,ay)-(bx,by) passes through the rectangle. */
function segmentRect(ax, ay, bx, by, rect) {
  // Liang-Barsky clip of the segment against the rectangle.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - rect.x, rect.x + rect.w - ax, ay - rect.y, rect.y + rect.h - ay];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

export function createWorld(random) {
  // The static geometry: the outer frame plus the map's walls, and the cover crates.
  const walls = [
    { x: 0, y: 0, w: FIELD.width, h: LEVEL.wall },
    { x: 0, y: FIELD.height - LEVEL.wall, w: FIELD.width, h: LEVEL.wall },
    { x: 0, y: 0, w: LEVEL.wall, h: FIELD.height },
    { x: FIELD.width - LEVEL.wall, y: 0, w: LEVEL.wall, h: FIELD.height },
  ];
  for (const wall of MAP.walls) walls.push({ x: wall.x, y: wall.y, w: wall.w, h: wall.h });

  const half = LEVEL.coverSize / 2;
  const covers = MAP.covers.map((c) => ({ x: c.x - half, y: c.y - half, w: LEVEL.coverSize, h: LEVEL.coverSize }));

  const player = { x: MAP.spawn.x, y: MAP.spawn.y, radius: PLAYER.radius, crouch: false, lit: 0, alive: true };

  const guards = MAP.guards.map((spec, index) => {
    const start = spec.route[0];
    return {
      id: index,
      x: start.x,
      y: start.y,
      radius: GUARD.radius,
      route: spec.route,
      sweep: spec.sweep,
      leg: 0,
      dir: 1,
      heading: 0,
      mode: MODE_PATROL,
      pauseTimer: 0,
      memoryTimer: 0,
      jitter: (random() - 0.5) * 0.6,
    };
  });

  const state = {
    player,
    guards,
    walls,
    covers,
    keycard: { x: MAP.keycard.x, y: MAP.keycard.y, taken: false },
    exit: { x: MAP.exit.x, y: MAP.exit.y },
    phase: PHASE_INFILTRATE,
    alarm: 0,
    time: 0,
    caughtBy: -1,
    escaped: false,
    spotted: false,
  };

  function reset() {
    player.x = MAP.spawn.x;
    player.y = MAP.spawn.y;
    player.crouch = false;
    player.lit = 0;
    player.alive = true;
    for (const guard of guards) {
      const start = guard.route[0];
      guard.x = start.x;
      guard.y = start.y;
      guard.leg = 0;
      guard.dir = 1;
      guard.heading = 0;
      guard.mode = MODE_PATROL;
      guard.pauseTimer = 0;
      guard.memoryTimer = 0;
    }
    state.keycard.taken = false;
    state.phase = PHASE_INFILTRATE;
    state.alarm = 0;
    state.time = 0;
    state.caughtBy = -1;
    state.escaped = false;
    state.spotted = false;
  }

  /** Move a circle by (dx,dy), sliding along walls and cover-free geometry (walls block, cover does not). */
  function moveCircle(body, dx, dy) {
    // Resolve each axis separately so the body slides along a wall instead of sticking to it.
    let nx = body.x + dx;
    for (const wall of walls) {
      if (circleRect(nx, body.y, body.radius, wall)) {
        nx = dx > 0 ? wall.x - body.radius - 0.01 : wall.x + wall.w + body.radius + 0.01;
      }
    }
    body.x = clamp(nx, body.radius, FIELD.width - body.radius);
    let ny = body.y + dy;
    for (const wall of walls) {
      if (circleRect(body.x, ny, body.radius, wall)) {
        ny = dy > 0 ? wall.y - body.radius - 0.01 : wall.y + wall.h + body.radius + 0.01;
      }
    }
    body.y = clamp(ny, body.radius, FIELD.height - body.radius);
  }

  /** True when nothing solid blocks the straight line between two points (cover does block sight). */
  function lineOfSight(ax, ay, bx, by) {
    for (const wall of walls) if (segmentRect(ax, ay, bx, by, wall)) return false;
    for (const cover of covers) if (segmentRect(ax, ay, bx, by, cover)) return false;
    return true;
  }

  /** Angle difference wrapped into [-PI, PI]. */
  function angleDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Turn a guard's heading toward `target` by at most turnRate*dt. */
  function turnToward(guard, target, dt) {
    const delta = angleDelta(guard.heading, target);
    const maxTurn = GUARD.turnRate * dt;
    guard.heading += clamp(delta, -maxTurn, maxTurn);
  }

  /** Walk a guard toward a point at `speed`, sliding along walls. */
  function walkToward(guard, tx, ty, speed, dt) {
    const dx = tx - guard.x;
    const dy = ty - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const step = Math.min(speed * dt, dist);
    moveCircle(guard, (dx / dist) * step, (dy / dist) * step);
    return dist <= step + 0.5;
  }

  /** Whether a guard sees the player right now: in range, inside the cone, nothing solid between. */
  function guardSees(guard, target) {
    const dx = target.x - guard.x;
    const dy = target.y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist > GUARD.sight) return false;
    const angleTo = Math.atan2(dy, dx);
    if (Math.abs(angleDelta(guard.heading, angleTo)) > GUARD.halfFov) return false;
    return lineOfSight(guard.x, guard.y, target.x, target.y);
  }

  /** Whether a guard hears the player: close enough, and the player is not crouching still. */
  function guardHears(guard, target) {
    const dist = Math.hypot(target.x - guard.x, target.y - guard.y);
    const radius = target.crouch ? PLAYER.crouchNoise : PLAYER.walkNoise;
    return dist <= Math.min(radius, GUARD.hearing);
  }

  /**
   * One fixed step. `moveX` and `moveY` are -1, 0 or 1. With `harmless` set (the title screen's
   * backdrop) guards patrol but nothing catches the player and the clock does not run.
   */
  function step(dt, moveX, moveY, crouch, harmless) {
    let events = 0;
    if (!harmless) state.time += dt;

    player.crouch = crouch;
    if (player.alive) {
      const speed = crouch ? PLAYER.crouchSpeed : PLAYER.speed;
      let dx = moveX;
      let dy = moveY;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        dx = (dx / len) * speed * dt;
        dy = (dy / len) * speed * dt;
        moveCircle(player, dx, dy);
      }
    }

    // The keycard: pick it up on contact, then the goal flips to the exit.
    if (!state.keycard.taken) {
      if (Math.hypot(player.x - state.keycard.x, player.y - state.keycard.y) < OBJECTIVE.keycardRadius + player.radius) {
        state.keycard.taken = true;
        state.phase = PHASE_HUNT;
        events |= EVENT_KEYCARD;
      }
    } else if (player.alive) {
      if (Math.hypot(player.x - state.exit.x, player.y - state.exit.y) < OBJECTIVE.exitRadius + player.radius) {
        state.escaped = true;
        player.alive = false;
        events |= EVENT_ESCAPED;
      }
    }

    if (state.alarm > 0 && !harmless) {
      state.alarm = Math.max(0, state.alarm - dt);
    }

    let anySees = false;
    for (const guard of guards) {
      const sees = !harmless && player.alive && guardSees(guard, player);
      const hears = !harmless && player.alive && !sees && guardHears(guard, player);
      if (sees || hears) {
        guard.mode = MODE_CHASE;
        guard.memoryTimer = GUARD.memory;
        if (sees) anySees = true;
      } else if (guard.mode === MODE_CHASE) {
        guard.memoryTimer -= dt;
        if (guard.memoryTimer <= 0) {
          guard.mode = MODE_PATROL;
          guard.pauseTimer = 0;
        }
      }

      if (guard.mode === MODE_CHASE) {
        // Chase the player's last known spot, sweeping the cone toward them as it runs.
        const targetAngle = Math.atan2(player.y - guard.y, player.x - guard.x);
        turnToward(guard, targetAngle, dt);
        walkToward(guard, player.x, player.y, GUARD.chaseSpeed, dt);
      } else if (guard.mode === MODE_PAUSE) {
        guard.pauseTimer -= dt;
        // Sweep the cone back and forth while paused.
        guard.heading += Math.sin(state.time * 1.6 + guard.jitter * 6) * guard.sweep * dt * 2.2;
        if (guard.pauseTimer <= 0) guard.mode = MODE_PATROL;
      } else {
        const waypoint = guard.route[guard.leg];
        const arrived = walkToward(guard, waypoint.x, waypoint.y, GUARD.patrolSpeed, dt);
        const targetAngle = Math.atan2(waypoint.y - guard.y, waypoint.x - guard.x);
        turnToward(guard, targetAngle, dt);
        if (arrived) {
          guard.mode = MODE_PAUSE;
          guard.pauseTimer = GUARD.pause;
          // Advance the route: bounce back and forth along it.
          guard.leg += guard.dir;
          if (guard.leg >= guard.route.length) {
            guard.leg = guard.route.length - 2;
            guard.dir = -1;
          } else if (guard.leg < 0) {
            guard.leg = 1;
            guard.dir = 1;
          }
          guard.leg = clamp(guard.leg, 0, guard.route.length - 1);
        }
      }
    }

    // Being seen: the player lights up, and after the grace window a guard reaches them.
    if (anySees) {
      if (player.lit === 0) events |= EVENT_SPOTTED;
      player.lit = Math.min(PLAYER.grace, player.lit + dt);
      if (player.lit >= PLAYER.grace && !harmless) {
        // Caught: raise the alarm and end the run.
        player.alive = false;
        state.caughtBy = guards.findIndex((g) => guardSees(g, player));
        state.alarm = ALARM.duration;
        events |= EVENT_CAUGHT | EVENT_ALARM;
      }
    } else {
      player.lit = Math.max(0, player.lit - dt * 2.2);
    }

    return events;
  }

  reset();
  return { state, reset, step, lineOfSight };
}
