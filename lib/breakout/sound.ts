// ─────────────────────────────────────────────────────────────────────────────
// breakout/sound.ts — tiny WebAudio bleeps, no audio files needed.
//
// HOW IT WORKS (the 30-second WebAudio tour):
//   An `AudioContext` is a little modular synth in the browser. We create an
//   oscillator (a tone generator) → connect it through a gain node (volume)
//   → connect that to the speakers. To avoid clicks, the volume ramps up
//   instantly and decays exponentially — that decay envelope is what makes it
//   sound like a "blip" instead of a buzzer.
//
// BROWSER GOTCHA this file handles: pages may not make sound before the user
// interacts (autoplay policy). So the context is created LAZILY on the first
// `play()` call — which always follows a Space/click that launched the ball —
// and `resume()`d in case it started suspended.
//
// A future mute toggle just flips `sound.enabled`. Persist it to localStorage
// next to the future high-score table.
// ─────────────────────────────────────────────────────────────────────────────

export class SoundBank {
  /** Public mute switch — a future settings UI binds a checkbox to this. */
  enabled = true;

  private ctx: AudioContext | null = null;

  /** Create (or wake) the context. Must run after a user gesture. */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null; // server prerender: silent
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null; // ancient browser: stay silent, never crash
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** One enveloped tone: pitch slides slightly down for a retro feel. */
  private blip(
    freqHz: number,
    seconds: number,
    type: OscillatorType = "square",
    volume = 0.04,
  ): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, now);
    // Slight downward slide — the "pew" character of arcade sounds.
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqHz * 0.6), now + seconds);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + seconds + 0.02);
  }

  // ── Game vocabulary: each event gets a distinct voice ──
  launch(): void {
    this.blip(330, 0.12, "square");
  }
  paddle(): void {
    this.blip(220, 0.07, "square");
  }
  wall(): void {
    this.blip(180, 0.05, "square", 0.025);
  }
  brickHit(): void {
    this.blip(520, 0.06, "square");
  }
  brickDestroyed(): void {
    this.blip(660, 0.09, "square");
  }
  lifeLost(): void {
    this.blip(140, 0.3, "sawtooth", 0.05);
  }
  win(): void {
    // Little arpeggio: three ascending blips scheduled in the future.
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    [523, 659, 784].forEach((f, i) => {
      window.setTimeout(() => this.blip(f, 0.12, "square"), i * 110);
    });
  }
}
