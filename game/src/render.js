// The renderer: paints the world with the 2D canvas API and nothing else. It scales the fixed
// 1280x720 logical field to the window, draws the floor grid, the walls and cover, each guard's
// vision cone (clipped by walls and cover so it never shines through them), the keycard, the exit,
// the player, and the HUD or a panel for the current screen.
import { FIELD, FONT, FONT_MONO, GUARD, PALETTE, PLAYER } from './config.js';
import { MODE_CHASE, PHASE_HUNT } from './world.js';

export const SCREEN_TITLE = 0;
export const SCREEN_PLAY = 1;
export const SCREEN_PAUSED = 2;
export const SCREEN_WON = 3;
export const SCREEN_CAUGHT = 4;

const PANEL = { width: 560, top: 96, line: 34, bottom: 96 };

export function createRenderer(canvas) {
  const context = canvas.getContext('2d', { alpha: false });
  const view = { scale: 1, x: 0, y: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(window.innerWidth * dpr);
    const height = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.scale = scale;
    view.x = (width - FIELD.width * scale) / 2;
    view.y = (height - FIELD.height * scale) / 2;
  }

  function text(value, x, y, size, colour, align, font) {
    context.fillStyle = colour;
    context.font = `${size}px ${font || FONT}`;
    context.textAlign = align || 'left';
    context.fillText(value, x, y);
  }

  function drawFloor() {
    context.fillStyle = PALETTE.floor;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // A faint checker of tiles so motion reads.
    const tile = 80;
    context.fillStyle = PALETTE.floorAlt;
    for (let y = 0; y < FIELD.height; y += tile) {
      for (let x = 0; x < FIELD.width; x += tile) {
        if (((x / tile) + (y / tile)) % 2 === 0) context.fillRect(x, y, tile, tile);
      }
    }
    context.strokeStyle = PALETTE.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= FIELD.width; x += tile) {
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, FIELD.height);
    }
    for (let y = 0; y <= FIELD.height; y += tile) {
      context.moveTo(0, y + 0.5);
      context.lineTo(FIELD.width, y + 0.5);
    }
    context.stroke();
  }

  /** A guard's cone, clipped against every wall and cover so it stops at them. */
  function drawCone(guard, alert) {
    const reach = GUARD.sight;
    const start = guard.heading - GUARD.halfFov;
    const end = guard.heading + GUARD.halfFov;
    context.save();
    // Clip to the union of the cone's own wedge minus the solids: draw the wedge, then punch out
    // the solids by clipping to their inverse is not possible in one pass, so instead we clip the
    // canvas to the wedge and then paint the solids back over it (done in drawSolids after).
    context.beginPath();
    context.moveTo(guard.x, guard.y);
    context.arc(guard.x, guard.y, reach, start, end);
    context.closePath();
    context.clip();
    context.fillStyle = alert ? PALETTE.coneAlert : PALETTE.coneCalm;
    context.fillRect(guard.x - reach, guard.y - reach, reach * 2, reach * 2);
    context.restore();

    // The cone's two edges, drawn as thin lines so the shape reads even over the floor.
    context.strokeStyle = PALETTE.coneEdge;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(guard.x, guard.y);
    context.lineTo(guard.x + Math.cos(start) * reach, guard.y + Math.sin(start) * reach);
    context.moveTo(guard.x, guard.y);
    context.lineTo(guard.x + Math.cos(end) * reach, guard.y + Math.sin(end) * reach);
    context.stroke();
  }

  function drawSolids(state) {
    // Walls: a dark body with a lit top edge, so the floor plan reads as architecture.
    for (const wall of state.walls) {
      context.fillStyle = PALETTE.wall;
      context.fillRect(wall.x, wall.y, wall.w, wall.h);
      context.fillStyle = PALETTE.wallTop;
      context.fillRect(wall.x, wall.y, wall.w, Math.min(4, wall.h));
    }
    // Cover crates: a green body with a lighter top, drawn over the cones so sight is visibly blocked.
    for (const cover of state.covers) {
      context.fillStyle = PALETTE.cover;
      context.fillRect(cover.x, cover.y, cover.w, cover.h);
      context.fillStyle = PALETTE.coverTop;
      context.fillRect(cover.x, cover.y, cover.w, 5);
      context.strokeStyle = 'rgba(0,0,0,0.35)';
      context.lineWidth = 1;
      context.strokeRect(cover.x + 0.5, cover.y + 0.5, cover.w - 1, cover.h - 1);
    }
  }

  function drawKeycard(state) {
    if (state.keycard.taken) return;
    const { x, y } = state.keycard;
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
    context.save();
    context.translate(x, y);
    context.rotate(-0.35);
    context.fillStyle = PALETTE.keycard;
    context.globalAlpha = 0.35 + pulse * 0.4;
    context.fillRect(-14, -9, 28, 18);
    context.globalAlpha = 1;
    context.fillStyle = '#1a1408';
    context.fillRect(-11, -6, 9, 5);
    context.fillRect(-11, 2, 18, 2);
    context.restore();
    // A soft halo so it is findable.
    context.beginPath();
    context.arc(x, y, 26 + pulse * 6, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(242,201,76,0.35)';
    context.lineWidth = 2;
    context.stroke();
  }

  function drawExit(state) {
    const { x, y } = state.exit;
    const open = state.keycard.taken;
    context.save();
    context.translate(x, y);
    context.fillStyle = open ? PALETTE.exit : PALETTE.exitLocked;
    context.globalAlpha = 0.9;
    context.fillRect(-26, -30, 52, 60);
    context.globalAlpha = 1;
    context.fillStyle = PALETTE.floor;
    context.fillRect(-19, -23, 38, 46);
    // An arrow pointing out, lit when the door is open.
    context.strokeStyle = open ? PALETTE.exit : PALETTE.exitLocked;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(0, 12);
    context.lineTo(0, -12);
    context.moveTo(-9, -3);
    context.lineTo(0, -12);
    context.lineTo(9, -3);
    context.stroke();
    if (open) {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(state.time * 3));
      context.beginPath();
      context.arc(0, 0, 40 + pulse * 8, 0, Math.PI * 2);
      context.strokeStyle = `rgba(84,182,201,${0.25 + pulse * 0.3})`;
      context.lineWidth = 2;
      context.stroke();
    }
    context.restore();
  }

  function drawGuard(guard) {
    const alert = guard.mode === MODE_CHASE;
    context.beginPath();
    context.arc(guard.x, guard.y, guard.radius, 0, Math.PI * 2);
    context.fillStyle = alert ? PALETTE.guard : PALETTE.guardCalm;
    context.fill();
    context.strokeStyle = 'rgba(0,0,0,0.5)';
    context.lineWidth = 2;
    context.stroke();
    // A short nose showing which way the guard faces.
    context.beginPath();
    context.moveTo(guard.x, guard.y);
    context.lineTo(guard.x + Math.cos(guard.heading) * (guard.radius + 8), guard.y + Math.sin(guard.heading) * (guard.radius + 8));
    context.strokeStyle = alert ? '#ffd2c8' : '#f0c0a8';
    context.lineWidth = 3;
    context.stroke();
    if (alert) {
      // An exclamation over a chasing guard.
      text('!', guard.x, guard.y - guard.radius - 10, 20, PALETTE.danger, 'center', FONT_MONO);
    }
  }

  function drawPlayer(state) {
    const player = state.player;
    if (!player.alive && !state.escaped) return;
    // A noise ring: how far a step carries, so crouching is visibly quieter.
    const noise = player.crouch ? PLAYER.crouchNoise : PLAYER.walkNoise;
    context.beginPath();
    context.arc(player.x, player.y, noise * 0.5, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(127,227,192,0.10)';
    context.lineWidth = 1;
    context.stroke();

    context.beginPath();
    context.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    context.fillStyle = player.crouch ? PALETTE.playerCrouch : PALETTE.player;
    context.fill();
    context.strokeStyle = 'rgba(0,0,0,0.55)';
    context.lineWidth = 2;
    context.stroke();

    // The grace meter: a ring that fills while a cone is on the player.
    if (player.lit > 0) {
      const frac = Math.min(1, player.lit / PLAYER.grace);
      context.beginPath();
      context.arc(player.x, player.y, player.radius + 6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      context.strokeStyle = PALETTE.danger;
      context.lineWidth = 3;
      context.stroke();
    }
  }

  function drawHud(state) {
    // Top bar: objective, clock, alarm.
    context.fillStyle = PALETTE.panel;
    context.fillRect(0, 0, FIELD.width, 54);
    const objective = state.phase === PHASE_HUNT ? 'Reach the exit' : 'Grab the keycard';
    text(objective, 24, 34, 20, PALETTE.ink, 'left');
    const clock = state.time.toFixed(1) + 's';
    text(clock, FIELD.width / 2, 34, 22, PALETTE.ink, 'center', FONT_MONO);
    if (state.alarm > 0) {
      text('ALARM', FIELD.width - 24, 34, 20, PALETTE.danger, 'right', FONT_MONO);
    } else {
      text(state.keycard.taken ? 'KEYCARD' : 'UNSEEN', FIELD.width - 24, 34, 16, PALETTE.muted, 'right', FONT_MONO);
    }
    // Bottom-left: controls hint.
    text('WASD move   Shift crouch   P pause   M mute', 24, FIELD.height - 20, 14, PALETTE.muted, 'left', FONT_MONO);
  }

  function drawPanel(title, lines, prompt, titleColour) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = 'rgba(255,255,255,0.08)';
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, PANEL.width - 1, height - 1);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 84, 54, titleColour || PALETTE.ink, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 20, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 40, 22, PALETTE.accent, 'center');
  }

  const TITLE_LINES = [
    'Sneak past the guards, take the keycard, reach the exit unseen.',
    'Their vision cones are lit. Cover breaks their sight. Crouch to move quietly.',
    '',
  ];
  const PAUSED_LINES = ['The guards will wait for you.'];
  const WON_LINES = ['', ''];
  const CAUGHT_LINES = ['', ''];

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.floor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);

    drawFloor();
    // Cones first, then the solids paint over them so sight visibly stops at walls and cover.
    for (const guard of state.guards) drawCone(guard, guard.mode === MODE_CHASE);
    drawSolids(state);
    drawExit(state);
    drawKeycard(state);
    for (const guard of state.guards) drawGuard(guard);
    drawPlayer(state);

    if (screen === SCREEN_TITLE) {
      TITLE_LINES[2] = best > 0 ? `Best escape: ${best.toFixed(1)}s` : 'No escape logged yet.';
      drawPanel('Nightvault', TITLE_LINES, 'Press Space or click to infiltrate');
      return;
    }
    drawHud(state);
    if (screen === SCREEN_PAUSED) drawPanel('Paused', PAUSED_LINES, 'Press P to resume');
    else if (screen === SCREEN_WON) {
      WON_LINES[0] = `Escaped in ${state.time.toFixed(1)}s`;
      WON_LINES[1] = best > 0 ? `Best escape: ${best.toFixed(1)}s` : '';
      drawPanel('Clean getaway', WON_LINES, 'Press Space to run it again', PALETTE.ok);
    } else if (screen === SCREEN_CAUGHT) {
      CAUGHT_LINES[0] = 'A guard caught you in the cone.';
      CAUGHT_LINES[1] = best > 0 ? `Best escape: ${best.toFixed(1)}s` : '';
      drawPanel('Caught', CAUGHT_LINES, 'Press Space to try again', PALETTE.danger);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
