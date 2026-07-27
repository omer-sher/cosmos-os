import { useEffect, useRef } from 'react';

// Four-point sparkle star, drawn in a 55×57 box (center ≈ 27.5, 28.5)
// so the transform math below can scale it uniformly by size/55.
const STAR_PATH =
  'M27.5 0 C29.5 16.5 38.5 26 55 28.5 C38.5 31 29.5 40.5 27.5 57 C25.5 40.5 16.5 31 0 28.5 C16.5 26 25.5 16.5 27.5 0 Z';

interface FloatingStar {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  alpha: number;        // base opacity (0..1)
  twinkle: number;      // twinkle phase
  hue: 'blue' | 'cyan' | 'violet' | 'white';
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  age: number;
  life: number;         // seconds
}

const HUE_COLORS: Record<FloatingStar['hue'], string> = {
  blue:   'rgba(79, 143, 247, ',
  cyan:   'rgba(34, 211, 238, ',
  violet: 'rgba(167, 139, 250, ',
  white:  'rgba(220, 235, 255, ',
};

interface BrandStarfieldProps {
  /** Stars per 100k px². Higher = busier. */
  density?: number;
  /** Drift speed multiplier. */
  speed?: number;
  /** Average time between shooting-star events (seconds). */
  shootingEvery?: number;
}

/**
 * Animated sparkle starfield — drifts in random directions, twinkles,
 * occasionally a shooting star arcs across with a fading trail.
 *
 * One <canvas>, single rAF loop, ~80 stars at 1080p. Cheap.
 */
export function BrandStarfield({
  density = 0.22,
  speed = 6,
  shootingEvery = 7,
}: BrandStarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pathRef = useRef<Path2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    pathRef.current = new Path2D(STAR_PATH);

    let stars: FloatingStar[] = [];
    const shooters: ShootingStar[] = [];
    let raf = 0;
    let dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let tPrev = performance.now();
    let nextShootAt = performance.now() + shootingEvery * 1000 * (0.5 + Math.random());

    const seed = () => {
      // Multiplier was 18, which made density values feel insensitive at
      // the low end. Bumped to 72 so each `density` step actually moves
      // the visible star count by a perceptible amount.
      // At density 0.1, 1080p: ~150 stars (was ~37).
      const target = Math.max(8, Math.floor((w * h / 100_000) * density * 72));
      stars = new Array(target).fill(0).map(() => makeStar());
    };

    const makeStar = (): FloatingStar => {
      // z is depth: 0 = far, 1 = near. Bias toward `far` so most stars
      // are dim and a few feel close-up.
      const zRaw = Math.random();
      const z = Math.pow(zRaw, 1.6); // skew distribution toward 0
      const angle = Math.random() * Math.PI * 2;
      const drift = (z * 0.7 + 0.25) * speed;
      // Small sparkles: 1–6.2px.
      const sizeBase = 1 + z * 5.2;
      const hueRoll = Math.random();
      const hue: FloatingStar['hue'] =
        hueRoll < 0.55 ? 'blue' : hueRoll < 0.78 ? 'cyan' : hueRoll < 0.93 ? 'violet' : 'white';
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        size: sizeBase,
        vx: Math.cos(angle) * drift * 0.04,
        vy: Math.sin(angle) * drift * 0.04,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.012,
        // Wide depth-driven opacity range. Far stars register at ~0.07α,
        // the rare near ones pop at ~0.58α peak twinkle (~+20% brightness).
        alpha: 0.072 + z * z * 0.504,
        twinkle: Math.random() * Math.PI * 2,
        hue,
      };
    };

    const launchShooter = (): ShootingStar => {
      // Shoot from a random edge across the canvas.
      const edge = Math.floor(Math.random() * 4);
      const speedPx = 380 + Math.random() * 220;
      let x: number, y: number, vx: number, vy: number;
      if (edge === 0) {
        x = Math.random() * w; y = -20;
        const angle = (Math.PI / 2) + (Math.random() - 0.5) * 0.7;
        vx = Math.cos(angle) * speedPx;
        vy = Math.sin(angle) * speedPx;
      } else if (edge === 1) {
        x = w + 20; y = Math.random() * h;
        const angle = Math.PI + (Math.random() - 0.5) * 0.7;
        vx = Math.cos(angle) * speedPx;
        vy = Math.sin(angle) * speedPx;
      } else if (edge === 2) {
        x = Math.random() * w; y = h + 20;
        const angle = -(Math.PI / 2) + (Math.random() - 0.5) * 0.7;
        vx = Math.cos(angle) * speedPx;
        vy = Math.sin(angle) * speedPx;
      } else {
        x = -20; y = Math.random() * h;
        const angle = 0 + (Math.random() - 0.5) * 0.7;
        vx = Math.cos(angle) * speedPx;
        vy = Math.sin(angle) * speedPx;
      }
      return {
        x, y, vx, vy,
        // Match the regular star size range (1 + z*5.2 → 1..6.2) so the
        // shooter feels like one of the stars, just moving fast.
        size: 1 + Math.random() * 5.2,
        rot: Math.atan2(vy, vx),
        age: 0,
        life: 1.4 + Math.random() * 0.8,
      };
    };

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - tPrev) / 1000);
      tPrev = now;

      ctx.clearRect(0, 0, w, h);

      // Soft nebula wash so the stars sit on a graded sky, not flat black.
      const grad = ctx.createRadialGradient(w * 0.55, h * 0.45, 0, w * 0.55, h * 0.45, Math.max(w, h) * 0.7);
      grad.addColorStop(0, 'rgba(60, 50, 160, 0.10)');
      grad.addColorStop(0.5, 'rgba(20, 60, 140, 0.04)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const path = pathRef.current!;
      // The sparkle path is roughly 55x57 — center is (27.5, 28.5).
      // Drawing it: translate to star center, scale, rotate, translate to path origin.

      for (const l of stars) {
        l.x += l.vx;
        l.y += l.vy;
        l.rot += l.vrot * dt * 60;
        l.twinkle += dt * (0.4 + l.alpha * 1.2);
        if (l.x < -l.size) l.x = w + l.size;
        else if (l.x > w + l.size) l.x = -l.size;
        if (l.y < -l.size) l.y = h + l.size;
        else if (l.y > h + l.size) l.y = -l.size;

        const tw = (Math.sin(l.twinkle) + 1) * 0.5;
        const a = l.alpha * (0.6 + 0.4 * tw);
        const scale = l.size / 55;
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(l.rot);
        ctx.scale(scale, scale);
        ctx.translate(-27.5, -28.5);
        ctx.fillStyle = HUE_COLORS[l.hue] + a.toFixed(3) + ')';
        ctx.fill(path);
        ctx.restore();
      }

      // Maybe launch a shooter.
      if (now >= nextShootAt) {
        shooters.push(launchShooter());
        nextShootAt = now + shootingEvery * 1000 * (0.6 + Math.random() * 0.8);
      }

      // Render shooters.
      for (let i = shooters.length - 1; i >= 0; i--) {
        const s = shooters[i];
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.age > s.life || s.x < -120 || s.y < -120 || s.x > w + 120 || s.y > h + 120) {
          shooters.splice(i, 1);
          continue;
        }
        const t = s.age / s.life;
        const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        const scale = s.size / 55;
        // Trail — a few prior positions
        for (let k = 1; k <= 6; k++) {
          const back = k * 0.04;
          const alpha = fade * (0.65 - k * 0.09);
          if (alpha <= 0) continue;
          ctx.save();
          ctx.translate(s.x - s.vx * back, s.y - s.vy * back);
          ctx.rotate(s.rot);
          ctx.scale(scale * (1 - k * 0.08), scale * (1 - k * 0.08));
          ctx.translate(-27.5, -28.5);
          ctx.fillStyle = `rgba(230, 247, 90, ${alpha.toFixed(3)})`;
          ctx.fill(path);
          ctx.restore();
        }
        // Bright head
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.scale(scale * 1.05, scale * 1.05);
        ctx.translate(-27.5, -28.5);
        ctx.fillStyle = `rgba(255, 255, 255, ${(fade * 0.95).toFixed(3)})`;
        ctx.fill(path);
        ctx.restore();
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
  }, [density, speed, shootingEvery]);

  return <canvas ref={canvasRef} className="lc-brand-starfield" aria-hidden="true" />;
}
