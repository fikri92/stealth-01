// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between five screens: title, play, paused, won and caught.
//
// ?seed=N fixes the guard jitter. ?shot=start|play|end (with &seed=N) stages that scene instead of
// running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_CAUGHT, EVENT_ESCAPED, EVENT_KEYCARD, EVENT_SPOTTED } from './world.js';
import { ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  createRenderer,
  SCREEN_CAUGHT,
  SCREEN_PAUSED,
  SCREEN_PLAY,
  SCREEN_TITLE,
  SCREEN_WON,
} from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    const value = Number.parseFloat(window.localStorage.getItem(BEST_KEY) ?? '0');
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let stepSoundTimer = 0;

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    accumulator = 0;
    stepSoundTimer = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    announce('Infiltrating. Reach the keycard, then the exit.');
  }

  function winGame() {
    screen = SCREEN_WON;
    const time = world.state.time;
    if (best === 0 || time < best) {
      best = time;
      saveBest(best);
    }
    audio.escaped();
    announce(`Escaped in ${time.toFixed(1)} seconds.`);
  }

  function caughtGame() {
    screen = SCREEN_CAUGHT;
    audio.caught();
    announce('Caught by a guard.');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_WON || screen === SCREEN_CAUGHT)) startGame();
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, 0, 0, false, true);
      return;
    }
    const moveX = input.moveX();
    const moveY = input.moveY();
    const crouch = input.crouching();
    const events = world.step(STEP, moveX, moveY, crouch, false);
    if (events & EVENT_ESCAPED) {
      winGame();
      return;
    }
    if (events & EVENT_CAUGHT) {
      caughtGame();
      return;
    }
    if (events & EVENT_KEYCARD) {
      audio.keycard();
      announce('Keycard taken. Reach the exit.');
    }
    if (events & EVENT_SPOTTED) audio.spotted();
    // A footstep tick while walking, faster when upright.
    if ((moveX !== 0 || moveY !== 0) && screen === SCREEN_PLAY) {
      stepSoundTimer -= STEP;
      if (stepSoundTimer <= 0) {
        audio.step();
        stepSoundTimer = crouch ? 0.42 : 0.26;
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best);
  }

  // Mute key, handled outside the input's action set so it works on every screen.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM') audio.toggleMute();
  });

  requestAnimationFrame(frame);
}

if (shot === 'start' || shot === 'play' || shot === 'end') runShot(shot);
else runGame();
