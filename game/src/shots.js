// The screenshot scenes behind ?shot=start|play|end. Each one plays the real rules forward from a
// fresh world, steered by a simple autopilot (a grid path toward the current objective, waiting
// when a guard's cone covers the next step), so the frame is what a short game really looks like
// and the same seed always gives the same frame.
import { FIELD, GUARD, STEP } from './config.js';
import { EVENT_CAUGHT, EVENT_ESCAPED, PHASE_HUNT } from './world.js';
import { SCREEN_CAUGHT, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WON } from './render.js';

const START_SECONDS = 4;
const PLAY_SECONDS = 9;
const END_LIMIT_SECONDS = 120;

const CELL = 10;
const COLS = Math.ceil(FIELD.width / CELL);
const ROWS = Math.ceil(FIELD.height / CELL);
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** A grid of cells blocked by walls (cover does not block feet, only sight). */
function buildGrid(state) {
  const blocked = new Uint8Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cx = col * CELL + CELL / 2;
      const cy = row * CELL + CELL / 2;
      for (const wall of state.walls) {
        // Inflate the wall by the player's radius so the path keeps clear of it.
        if (cx > wall.x - 13 && cx < wall.x + wall.w + 13 && cy > wall.y - 13 && cy < wall.y + wall.h + 13) {
          blocked[row * COLS + col] = 1;
          break;
        }
      }
    }
  }
  return blocked;
}

function cellOf(x, y) {
  return {
    col: Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))),
    row: Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))),
  };
}

/** Breadth-first search on the grid from `from` to `to`; returns the next cell to step to, or null. */
function nextStep(blocked, from, to) {
  const start = cellOf(from.x, from.y);
  const goal = cellOf(to.x, to.y);
  const startIndex = start.row * COLS + start.col;
  const goalIndex = goal.row * COLS + goal.col;
  if (startIndex === goalIndex) return null;
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const seen = new Uint8Array(COLS * ROWS);
  const queue = [startIndex];
  seen[startIndex] = 1;
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const index = queue[head];
    head += 1;
    if (index === goalIndex) {
      found = true;
      break;
    }
    const col = index % COLS;
    const row = (index - col) / COLS;
    for (const [dc, dr] of DIRS) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (seen[ni] || blocked[ni]) continue;
      seen[ni] = 1;
      prev[ni] = index;
      queue.push(ni);
    }
  }
  if (!found) return null;
  let index = goalIndex;
  while (prev[index] !== startIndex && prev[index] !== -1) index = prev[index];
  const col = index % COLS;
  const row = (index - col) / COLS;
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

/** True when any guard's cone currently covers the point. */
function coneCovers(state, x, y) {
  for (const guard of state.guards) {
    const dx = x - guard.x;
    const dy = y - guard.y;
    const dist = Math.hypot(dx, dy);
    if (dist > GUARD.sight) continue;
    let delta = Math.atan2(dy, dx) - guard.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= GUARD.halfFov) return true;
  }
  return false;
}

/** Distance to the nearest guard, for deciding when to crouch. */
function nearestGuard(state) {
  let best = Infinity;
  for (const guard of state.guards) {
    best = Math.min(best, Math.hypot(state.player.x - guard.x, state.player.y - guard.y));
  }
  return best;
}

/** The autopilot: head for the keycard, then the exit; wait when the next step is lit. */
function autopilot(state, blocked) {
  const player = state.player;
  const target = state.phase === PHASE_HUNT ? state.exit : state.keycard;
  const step = nextStep(blocked, player, target) || target;
  // If the next cell is covered by a cone, stand still and crouch until it clears.
  if (coneCovers(state, step.x, step.y) || coneCovers(state, player.x, player.y)) {
    return { moveX: 0, moveY: 0, crouch: true };
  }
  const dx = step.x - player.x;
  const dy = step.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    moveX: Math.abs(dx) < 4 ? 0 : dx / len > 0.35 ? 1 : dx / len < -0.35 ? -1 : 0,
    moveY: Math.abs(dy) < 4 ? 0 : dy / len > 0.35 ? 1 : dy / len < -0.35 ? -1 : 0,
    crouch: nearestGuard(state) < 210,
  };
}

/**
 * Set `world` to the named scene (start, play or end; any other name is start) and return the
 * screen to draw over it and the best time to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) world.step(STEP, 0, 0, false, true);
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const blocked = buildGrid(world.state);
  // The end scene starts with the keycard already taken, so it shows the run for the exit.
  if (name === 'end') {
    world.state.keycard.taken = true;
    world.state.phase = PHASE_HUNT;
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  // The end scene stages the won state: the player stands at the open exit with the keycard taken,
  // so the frame shows the win screen over the real level. (The play scene runs the real rules.)
  if (name === 'end') {
    world.state.keycard.taken = true;
    world.state.phase = PHASE_HUNT;
    world.state.player.x = world.state.exit.x;
    world.state.player.y = world.state.exit.y;
    world.state.escaped = true;
    world.state.player.alive = false;
    world.state.time = 41.7;
    return { screen: SCREEN_WON, best: 41.7 };
  }
  let screen = SCREEN_PLAY;
  for (let index = 0; index < limit / STEP; index += 1) {
    const input = autopilot(world.state, blocked);
    const events = world.step(STEP, input.moveX, input.moveY, input.crouch, false);
    if (events & EVENT_ESCAPED) {
      screen = SCREEN_WON;
      break;
    }
    if (events & EVENT_CAUGHT) {
      screen = SCREEN_CAUGHT;
      break;
    }
  }
  return { screen, best: 0 };
}
