// Sound, made with the Web Audio API and no files: a soft footstep tick, a rising alarm, a keycard
// chime and a victory motif. The context is created lazily on the first user gesture (browsers
// refuse to start audio before one) and every sound is guarded, so a browser without Web Audio
// simply plays silently.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
    return ctx;
  }

  /** Resume the context after a gesture; safe to call on every start. */
  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function tone(freq, start, duration, type, gain) {
    const c = ensure();
    if (!c || muted) return;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime + start);
    env.gain.setValueAtTime(0.0001, c.currentTime + start);
    env.gain.exponentialRampToValueAtTime(gain || 0.2, c.currentTime + start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration);
    osc.connect(env);
    env.connect(master);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + duration + 0.02);
  }

  function noise(start, duration, gain) {
    const c = ensure();
    if (!c || muted) return;
    const frames = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    const env = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    env.gain.value = gain || 0.1;
    src.buffer = buffer;
    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(c.currentTime + start);
  }

  return {
    unlock,
    /** A soft step: a short filtered noise tick. */
    step() {
      noise(0, 0.06, 0.05);
    },
    /** The keycard chime: two rising notes. */
    keycard() {
      tone(660, 0, 0.14, 'triangle', 0.22);
      tone(990, 0.1, 0.2, 'triangle', 0.2);
    },
    /** A guard first sees you: a sharp two-tone sting. */
    spotted() {
      tone(880, 0, 0.1, 'square', 0.16);
      tone(660, 0.09, 0.16, 'square', 0.16);
    },
    /** Caught: a falling alarm siren. */
    caught() {
      for (let i = 0; i < 4; i += 1) {
        tone(520 - i * 40, i * 0.16, 0.15, 'sawtooth', 0.14);
      }
      noise(0, 0.5, 0.08);
    },
    /** Escaped: a small victory motif. */
    escaped() {
      tone(523, 0, 0.16, 'triangle', 0.2);
      tone(659, 0.14, 0.16, 'triangle', 0.2);
      tone(784, 0.28, 0.28, 'triangle', 0.22);
    },
    /** Toggle mute; returns the new state. */
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
