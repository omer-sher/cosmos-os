import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BRAND } from '../scenarios/brand';

/**
 * "?" pill in the top-right that opens a modal explaining what the
 * cosmos is, what's clickable, and how to run a flow. Owned state so
 * the App doesn't have to know about it.
 */
export function HelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="lc-help-btn"
        onClick={() => setOpen(true)}
        aria-label="What is this?"
      >
        ?
      </button>

      {createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            className="lc-help-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="lc-help-modal"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.28, ease: [0.2, 0.9, 0.3, 1.1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="lc-help-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <svg width={14} height={14} viewBox="0 0 14 14">
                  <path
                    d="M3 3 L11 11 M11 3 L3 11"
                    stroke="currentColor"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              <div className="lc-help-eyebrow">Welcome to the cosmos</div>
              <h2 className="lc-help-title">{BRAND.helpTitle}</h2>
              <p className="lc-help-lede">
                Every star is a service, every dashed ring is a Kafka topic, every
                line is a connection. Pick a scenario and watch a real request
                travel through the system in real time.
              </p>

              <div className="lc-help-grid">
                <section className="lc-help-section">
                  <div className="lc-help-section-eyebrow">What you can do</div>
                  <ul>
                    <li>Watch any scenario play end-to-end with packets flying.</li>
                    <li>Step through a flow message-by-message and read the actual payload.</li>
                    <li>Click any service to see its tech stack + GitHub repo.</li>
                    <li>Click any topic to see who produces and who consumes it.</li>
                  </ul>
                </section>

                <section className="lc-help-section">
                  <div className="lc-help-section-eyebrow">What's clickable</div>
                  <ul>
                    <li>
                      <span className="lc-help-kbd">Domain tab</span> opens the scenarios dropdown.
                    </li>
                    <li>
                      <span className="lc-help-kbd">Service capsule</span> opens the inspector on the left.
                    </li>
                    <li>
                      <span className="lc-help-kbd">Topic ring</span> opens producers / consumers on the left.
                    </li>
                    <li>
                      <span className="lc-help-kbd">Step dot</span> in the bottom panel jumps to that step.
                    </li>
                  </ul>
                </section>

                <section className="lc-help-section">
                  <div className="lc-help-section-eyebrow">How to run a flow</div>
                  <ol>
                    <li>Click a domain tab (e.g. <em>Shopping</em> or <em>Fulfillment</em>).</li>
                    <li>Pick a scenario from the dropdown that opens beneath it.</li>
                    <li>The map zooms to the relevant services and dims the rest.</li>
                    <li>
                      Hit <span className="lc-help-kbd">▶</span> in the floating panel.
                      Use <span className="lc-help-kbd">‹ ›</span> to step,
                      <span className="lc-help-kbd">0.5× / 1× / 2×</span> for speed.
                    </li>
                    <li>The right-side explainer shows narrative + payload per step.</li>
                  </ol>
                </section>

                <section className="lc-help-section">
                  <div className="lc-help-section-eyebrow">Map controls</div>
                  <ul>
                    <li><span className="lc-help-kbd">Drag</span> the background to pan.</li>
                    <li><span className="lc-help-kbd">Scroll</span> to zoom around the cursor.</li>
                    <li><span className="lc-help-kbd">+ / −</span> zoom from keyboard, <span className="lc-help-kbd">0</span> resets.</li>
                    <li><span className="lc-help-kbd">Esc</span> clears the active scenario.</li>
                  </ul>
                </section>
              </div>

              <div className="lc-help-foot">
                <span className="lc-help-foot-eyebrow">Pro tip</span>
                <span>
                  When no scenario is selected the cosmos hums on its own —
                  ambient packets keep flying so you can see the shape of the system at rest.
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </>
  );
}
