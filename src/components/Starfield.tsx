import { useEffect, useRef } from 'react';

interface StarfieldProps {
  /** Density per 100k px². Higher = busier sky. */
  density?: number;
  /** Maximum drift speed in px / second. */
  speed?: number;
}

interface Star {
  x: number;
  y: number;
  z: number;       // depth, controls size + brightness + parallax
  vx: number;
  vy: number;
  twinkle: number; // phase
}

/**
 * Animated parallax starfield on a <canvas>. Three depth layers, very
 * gentle drift, soft twinkle. Cheap (one rAF, ~600 stars at 1080p).
 */
export function Starfield({ density = 0.18, speed = 6 }: StarfieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let stars: Star[] = [];
    let raf = 0;
    let tPrev = performance.now();
    let dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;

    const seedStars = () => {
      const area = w * h;
      const target = Math.max(150, Math.floor((area / 100_000) * density * 100));
      stars = new Array(target).fill(0).map(() => makeStar());
    };

    const makeStar = (): Star => {
      const z = Math.random();           // 0 = far, 1 = near
      const drift = (z * 0.6 + 0.4) * speed;
      const angle = Math.random() * Math.PI * 2;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z,
        vx: Math.cos(angle) * drift * 0.05,
        vy: Math.sin(angle) * drift * 0.05,
        twinkle: Math.random() * Math.PI * 2,
      };
    };

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedStars();
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - tPrev) / 1000);
      tPrev = now;

      ctx.clearRect(0, 0, w, h);

      // Subtle nebula wash — single radial gradient per frame, cheap.
      const g = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.65);
      g.addColorStop(0, 'rgba(80, 60, 180, 0.10)');
      g.addColorStop(0.45, 'rgba(40, 80, 160, 0.04)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      for (const s of stars) {
        s.x += s.vx;
        s.y += s.vy;
        s.twinkle += dt * (0.6 + s.z);
        if (s.x < -2) s.x = w + 2;
        else if (s.x > w + 2) s.x = -2;
        if (s.y < -2) s.y = h + 2;
        else if (s.y > h + 2) s.y = -2;

        const tw = (Math.sin(s.twinkle) + 1) * 0.5;          // 0..1
        const baseAlpha = 0.18 + s.z * 0.65;
        const alpha = baseAlpha * (0.55 + 0.45 * tw);
        const r = 0.4 + s.z * 1.6;

        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220, 235, 255, ${alpha.toFixed(3)})`;
        ctx.fill();

        // Soft halo on the brightest stars (cheap — only draws sometimes)
        if (s.z > 0.85) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200, 220, 255, ${(alpha * 0.08).toFixed(3)})`;
          ctx.fill();
        }
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
  }, [density, speed]);

  return <canvas ref={ref} className="lc-starfield" aria-hidden="true" />;
}
