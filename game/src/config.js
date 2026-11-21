// Every tuning number and colour in one place. The playfield is a fixed 1280x720 logical area;
// the renderer scales it to the window, so no rule below depends on the screen size.
//
// The game is a top-down stealth infiltration: a night-time vault floor, patrolling guards with
// vision cones, cover to break line of sight, a keycard to pick up and an exit to reach unseen.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The player: a small agent that moves in eight directions and crouches to move quietly. */
export const PLAYER = {
  radius: 13,
  speed: 210,
  crouchSpeed: 108,
  /** How loudly the player is heard: the radius a guard notices a walking step. */
  walkNoise: 150,
  crouchNoise: 62,
  /** Seconds the player is lit up after a guard's cone first touches them, before capture. */
  grace: 0.85,
};

/** Guard behaviour: patrol between waypoints, sweep a cone, and chase a seen player. */
export const GUARD = {
  radius: 14,
  patrolSpeed: 74,
  chaseSpeed: 148,
  /** Half-angle of the vision cone, in radians (about 55 degrees each side). */
  halfFov: 0.78,
  /** How far a guard sees, in world units. */
  sight: 200,
  /** How close a guard must be to hear a walking player, in world units. */
  hearing: 170,
  /** Seconds a guard keeps chasing after losing sight. */
  memory: 2.6,
  /** How fast a guard's cone turns, radians a second. */
  turnRate: 2.2,
  /** Seconds a guard pauses at a waypoint before walking on. */
  pause: 1.3,
  /** How far a guard wanders off its patrol line while searching, in world units. */
  searchSpread: 120,
};

/** The alarm: a full alert spreads to every guard and the run is failed after a short hunt. */
export const ALARM = {
  /** Seconds the alarm stays hot once raised. */
  duration: 9,
  /** How far the alarm's own noise carries, in world units. */
  radius: 620,
};

/** The objective: reach the keycard, then the exit. */
export const OBJECTIVE = {
  keycardRadius: 22,
  exitRadius: 30,
};

/** The level: walls the player and guards cannot pass, and cover that blocks sight but not feet. */
export const LEVEL = {
  /** Wall thickness, in world units. */
  wall: 26,
  /** Cover crates: block sight, not movement. */
  coverSize: 54,
};

export const PALETTE = {
  floor: '#141a20',
  floorAlt: '#11161b',
  grid: '#1b232b',
  wall: '#2b3742',
  wallTop: '#3a4a58',
  cover: '#3d4b3a',
  coverTop: '#55684f',
  player: '#7fe3c0',
  playerCrouch: '#4fbfa0',
  guard: '#e0563f',
  guardCalm: '#c9704a',
  coneCalm: 'rgba(224,86,63,0.13)',
  coneAlert: 'rgba(255,64,40,0.30)',
  coneEdge: 'rgba(224,86,63,0.34)',
  keycard: '#f2c94c',
  exit: '#54b6c9',
  exitLocked: '#5a6a72',
  ink: '#e9eef2',
  muted: '#8b98a3',
  panel: 'rgba(12,17,22,0.86)',
  accent: '#f2c94c',
  danger: '#ff5a3c',
  ok: '#7fe3c0',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

/** Where the best run (fewest seconds) is kept between visits (this browser only). */
export const BEST_KEY = 'nightvault.best';

/** The level layout: the floor plan, guards' patrol routes, the keycard and the exit. */
export const MAP = {
  /** Spawns the player at the south-west service door. */
  spawn: { x: 92, y: 628 },
  keycard: { x: 170, y: 120 },
  exit: { x: 1188, y: 636 },
  /** Walls as {x, y, w, h} rectangles. The outer frame is added by the world. */
  walls: [
    { x: 300, y: 0, w: 26, h: 300 },
    { x: 300, y: 420, w: 26, h: 300 },
    { x: 560, y: 180, w: 300, h: 26 },
    { x: 860, y: 300, w: 26, h: 300 },
    { x: 980, y: 0, w: 26, h: 240 },
    { x: 640, y: 440, w: 300, h: 26 },
    { x: 180, y: 340, w: 120, h: 26 },
  ],
  /** Cover crates as {x, y} centres; each is LEVEL.coverSize square. */
  covers: [
    { x: 200, y: 200 },
    { x: 430, y: 120 },
    { x: 470, y: 360 },
    { x: 760, y: 90 },
    { x: 760, y: 400 },
    { x: 940, y: 470 },
    { x: 1100, y: 300 },
    { x: 1120, y: 120 },
    { x: 380, y: 600 },
    { x: 300, y: 200 },
    { x: 560, y: 300 },
    { x: 880, y: 620 },
  ],
  /** Guards: a route of waypoints they walk between, and how far their cone sweeps at each. */
  guards: [
    { route: [{ x: 520, y: 250 }, { x: 520, y: 470 }], sweep: 1.5 },
    { route: [{ x: 720, y: 320 }, { x: 720, y: 470 }, { x: 560, y: 470 }], sweep: 1.9 },
    { route: [{ x: 1050, y: 180 }, { x: 1050, y: 420 }, { x: 900, y: 420 }], sweep: 1.7 },
    { route: [{ x: 640, y: 620 }, { x: 900, y: 620 }], sweep: 1.3 },
  ],
};
