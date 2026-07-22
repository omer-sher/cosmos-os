import { useEffect, useRef } from 'react';

interface WarpTransitionProps {
  /** Fired when the warp animation finishes — App swaps to the cosmos shell. */
  onDone: () => void;
  /** Total warp duration in ms. */
  duration?: number;
}

/**
 * Star Wars hyperspace — proper 3D perspective.
 *
 * Each particle has a real (x, y, z) in space. The camera sits at the
 * origin looking down +z. Each frame z decreases (the particle flies
 * toward us). Screen position is the perspective projection
 *   sx = (x · f) / z + cx
 *   sy = (y · f) / z + cy
 *
 * As z → 0 the projection fans rapidly outward — that's why every
 * streak is radial from the centre vanishing point. The streak itself
 * is just `previousScreenPos → currentScreenPos`, which naturally
 * grows long as the particle accelerates toward the camera.
 *
 * Bg is deep navy. Streaks are white-cored with a soft cyan-blue halo.
 * No flashy colors, no flares — just the tunnel.
 */
export function WarpTransition({ onDone, duration = 2800 }: WarpTransitionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    type Star = {
      x: number;       // world X in [-1, 1]
      y: number;       // world Y in [-1, 1]
      z: number;       // depth, 1 = far, → 0 = passes camera
      psx: number;     // previous projected screen x
      psy: number;     // previous projected screen y
    };

    const STAR_COUNT = 600;
    const FOCAL = 1.2;

    let dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    const stars: Star[] = [];
    let raf = 0;
    const t0 = performance.now();
    let done = false;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      cx = w / 2;
      cy = h / 2;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (s: Star) => {
      // Scale world units by half the screen so x = 1 maps near the edge at z = 1.
      const k = Math.min(w, h) * 0.55 * FOCAL;
      return {
        x: (s.x * k) / s.z + cx,
        y: (s.y * k) / s.z + cy,
      };
    };

    const seedStar = (zStart = 1): Star => {
      // Avoid spawning on the optical axis — gives nothing to project.
      let x = (Math.random() - 0.5) * 2;
      let y = (Math.random() - 0.5) * 2;
      while (Math.abs(x) < 0.04 && Math.abs(y) < 0.04) {
        x = (Math.random() - 0.5) * 2;
        y = (Math.random() - 0.5) * 2;
      }
      const s: Star = { x, y, z: zStart, psx: cx, psy: cy };
      const p = project(s);
      s.psx = p.x;
      s.psy = p.y;
      return s;
    };

    const recycle = (s: Star) => {
      // Re-seed with z = 1 (far) and a fresh angle.
      let x = (Math.random() - 0.5) * 2;
      let y = (Math.random() - 0.5) * 2;
      while (Math.abs(x) < 0.04 && Math.abs(y) < 0.04) {
        x = (Math.random() - 0.5) * 2;
        y = (Math.random() - 0.5) * 2;
      }
      s.x = x;
      s.y = y;
      s.z = 1;
      const p = project(s);
      s.psx = p.x;
      s.psy = p.y;
    };

    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);

      // Speed profile: a small startup, then full warp, then decel.
      // `speed` is z-units per second.
      const speed = (() => {
        if (t < 0.15) return 0.3 + (t / 0.15) * 0.6;     // ease into 0.9
        if (t < 0.85) return 0.9 + (t - 0.15) / 0.7 * 1.7; // ramp 0.9 → 2.6
        return Math.max(0.4, 2.6 - ((t - 0.85) / 0.15) * 2.2); // settle to 0.4
      })();

      // Persistence trail — the lower this alpha, the longer the streaks linger.
      // Real-feeling tunnel sits around 0.18; bumped at the very end so the
      // canvas blacks out before the cosmos shell comes in.
      const trailAlpha =
        t < 0.92
          ? 0.18
          : 0.18 + ((t - 0.92) / 0.08) * 0.55;
      ctx.fillStyle = `rgba(2, 4, 12, ${trailAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);

      const dt = 1 / 60;

      // Lazy-init the field on the first tick (after we know w/h).
      if (stars.length === 0) {
        for (let i = 0; i < STAR_COUNT; i++) {
          // Stagger initial z so the field is full immediately, not a wave.
          stars.push(seedStar(0.05 + Math.random() * 0.95));
        }
      }

      ctx.lineCap = 'round';

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        // Move toward camera. Smaller z → bigger per-frame change.
        s.z -= dt * speed;

        if (s.z <= 0.02) {
          recycle(s);
          continue;
        }

        const { x, y } = project(s);

        // Line width and alpha both ramp as z shrinks (closer = bigger / brighter).
        const proximity = 1 - s.z; // 0 (far) … 1 (close)
        const lineW = 0.4 + Math.pow(proximity, 1.6) * 3.2;
        const alpha = 0.25 + Math.pow(proximity, 1.4) * 0.7;

        // Soft outer halo (cyan-blue) — low alpha, wider line.
        ctx.strokeStyle = `rgba(140, 200, 255, ${(alpha * 0.35).toFixed(3)})`;
        ctx.lineWidth = lineW * 2.4;
        ctx.beginPath();
        ctx.moveTo(s.psx, s.psy);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Inner core — pure white.
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(s.psx, s.psy);
        ctx.lineTo(x, y);
        ctx.stroke();

        s.psx = x;
        s.psy = y;
      }

      // Final blackout right at the end so the cosmos shell takes over clean.
      if (t > 0.95) {
        const k = (t - 0.95) / 0.05;
        ctx.fillStyle = `rgba(2, 4, 12, ${(k * 0.6).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (t >= 1) {
        if (!done) { done = true; onDoneRef.current(); }
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [duration]);

  return (
    <div className="lc-warp">
      <canvas ref={canvasRef} className="lc-warp-canvas" aria-hidden="true" />
    </div>
  );
}
