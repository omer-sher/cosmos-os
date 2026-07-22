import { useState } from 'react';
import { motion } from 'framer-motion';

import { Starfield } from './Starfield';

interface IntroOverlayProps {
  /** Fires the moment the CTA is pressed — App kicks off the warp. */
  onStart: () => void;
  /** Fires after the intro's fade-out completes — App unmounts the intro. */
  onExitComplete: () => void;
}

const stagger = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { delayChildren: 0.9, staggerChildren: 0.32 },
  },
};

const child = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.2, 0.9, 0.3, 1.1] } },
};

const RING_COLORS = [
  'var(--svc-cyan)',
  'var(--svc-violet)',
  'var(--svc-amber)',
  'var(--svc-pink)',
  'var(--svc-green)',
  'var(--svc-blue)',
  'var(--svc-orange)',
  'var(--svc-purple)',
];

/**
 * Cosmos welcome — animated starfield + a slowly-rotating orbital
 * constellation as the centerpiece. Three orbital rings, each carrying
 * a few "service stars" that drift around their orbit. The whole thing
 * sits behind the wordmark so it feels like the cosmos is already
 * humming before the user enters.
 *
 * Performance: stars are on a single canvas; orbits use SVG SMIL
 * (browser-native, GPU-cheap). No JS rAF for the orbits.
 */
const EXIT_MS = 2000;

export function IntroOverlay({ onStart, onExitComplete }: IntroOverlayProps) {
  const [exiting, setExiting] = useState(false);

  const handleStart = () => {
    if (exiting) return;
    // Kick the warp off RIGHT NOW so it runs underneath…
    onStart();
    setExiting(true);
    // …then unmount the intro after the fade finishes.
    window.setTimeout(onExitComplete, EXIT_MS);
  };

  return (
    <motion.div
      className="lc-intro"
      initial={{ opacity: 0 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: exiting ? EXIT_MS / 1000 : 0.6, ease: [0.4, 0, 0.2, 1] }}
    >
      <Starfield />

      {/* Orbital constellation — sits behind the title, slowly rotates */}
      <svg className="lc-intro-orbits" viewBox="-300 -300 600 600" aria-hidden="true">
        <defs>
          <radialGradient id="lc-intro-core-grad" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="40%" stopColor="#E6F75A" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#E6F75A" stopOpacity="0" />
          </radialGradient>
          <filter id="lc-intro-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        {/* central star — the cosmos heartbeat (dim, breathing) */}
        <circle r="120" fill="url(#lc-intro-core-grad)" opacity="0.32">
          <animate attributeName="r" values="115;130;115" dur="6s" repeatCount="indefinite" />
        </circle>
        <circle r="3.5" fill="#E8ECF4" opacity="0.7">
          <animate attributeName="r" values="3;4;3" dur="3.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.55;0.85;0.55" dur="3.2s" repeatCount="indefinite" />
        </circle>

        {/* orbital rings + the "service stars" riding them */}
        {[120, 180, 245].map((radius, ringIdx) => {
          const items = ringIdx === 0 ? 4 : ringIdx === 1 ? 6 : 7;
          const dur = 28 + ringIdx * 18;
          const dir = ringIdx % 2 === 0 ? 1 : -1;
          return (
            <g key={ringIdx}>
              <circle
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
                strokeDasharray="2 6"
              />
              <g>
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from={`0 0 0`}
                  to={`${360 * dir} 0 0`}
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                />
                {Array.from({ length: items }).map((_, i) => {
                  const a = (i / items) * Math.PI * 2;
                  const x = Math.cos(a) * radius;
                  const y = Math.sin(a) * radius;
                  const c = RING_COLORS[(ringIdx * 3 + i) % RING_COLORS.length];
                  const r = 3 + (i % 3 === 0 ? 1.5 : 0);
                  return (
                    <g key={i} transform={`translate(${x},${y})`}>
                      <circle r={r * 4.5} fill={c} opacity={0.18} filter="url(#lc-intro-glow)" />
                      <circle r={r} fill={c}>
                        <animate
                          attributeName="r"
                          values={`${r};${r * 1.4};${r}`}
                          dur={`${2.4 + (i % 3) * 0.6}s`}
                          repeatCount="indefinite"
                        />
                      </circle>
                    </g>
                  );
                })}
              </g>
            </g>
          );
        })}

        {/* a single packet sweeping the outermost orbit, completing the "flow" feel */}
        <circle r="2.5" fill="#FFFFFF" filter="url(#lc-intro-glow)">
          <animateMotion
            dur="11s"
            repeatCount="indefinite"
            path="M 245 0 A 245 245 0 1 1 244.99 0.01 Z"
            rotate="auto"
          />
        </circle>
      </svg>

      {/* Vignette so the centerpiece reads as the focal point */}
      <div className="lc-intro-vignette" aria-hidden="true" />

      <motion.div className="lc-intro-inner" variants={stagger} initial="hidden" animate="visible">
        <motion.span className="lc-intro-eyebrow" variants={child}>COSMOS · ASTROMART DEMO · 0.1</motion.span>
        <motion.h1 className="lc-intro-title" variants={child}>
          <span className="lc-intro-title-line">AstroMart</span>
          <span className="lc-intro-title-line lc-intro-title-line--accent">
            Cosmos
          </span>
        </motion.h1>
        <motion.p className="lc-intro-sub" variants={child}>
          A live schematic of AstroMart — a fictional space-gear shop, outfitting
          the galaxy since 2199. Pick a domain, pick a scenario, watch the request
          travel along constellations of services and topics.
        </motion.p>
        <motion.div variants={child} className="lc-intro-cta-row">
          <button type="button" className="lc-intro-cta" onClick={handleStart} disabled={exiting}>
            Jump in
            <span className="lc-intro-cta-glyph">→</span>
          </button>
          <span className="lc-intro-hint">drag to pan · scroll to zoom · 0 to reset</span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
