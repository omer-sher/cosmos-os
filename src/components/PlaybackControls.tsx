import type { RunnerApi } from '../scenarios/runner';
import type { Step } from '../scenarios/types';

interface PlaybackControlsProps {
  runner: RunnerApi;
  /** Steps in the active scenario — used for the dot strip. */
  steps: Step[];
  /** Wrapped navigation that also reopens the step panel. */
  onPlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  /** Jump to step 0 then play. Wired separately so App can clear log etc. */
  onRestart: () => void;
}

const SPEEDS = [0.5, 1, 2];

/**
 * Floating playback control cluster: prev / play|restart / next + speed.
 * Renders as a panel in the bottom-center of the stage (NOT in the
 * top bar) — buttons are sized for a panel, not a header strip.
 */
export function PlaybackControls({
  runner, steps, onPlay, onPrev, onNext, onJump, onRestart,
}: PlaybackControlsProps) {
  const { state, scenario, pause, setSpeed } = runner;
  const disabled = !scenario || steps.length === 0;
  const atStart = state.idx <= 0;
  const atEnd = state.idx >= steps.length - 1;
  // We're "finished" when playback hit the last step and stopped on its own.
  const finished = atEnd && !state.playing && state.idx > 0;
  const playLabel = state.playing ? 'Pause' : finished ? 'Restart' : 'Play';
  const playGlyph = state.playing ? '❚❚' : finished ? '↻' : '▶';
  const playHandler = state.playing ? pause : finished ? onRestart : onPlay;

  if (disabled) return null;

  return (
    <div className="lc-controls" data-no-pan="true">
      <div className="lc-controls-row">
        <button
          type="button"
          className="lc-pb-btn"
          onClick={onPrev}
          disabled={atStart}
          aria-label="Previous step"
        >
          ‹
        </button>
        <button
          type="button"
          className="lc-pb-btn lc-pb-play"
          data-finished={finished ? 'true' : 'false'}
          onClick={playHandler}
          aria-label={playLabel}
        >
          {playGlyph}
        </button>
        <button
          type="button"
          className="lc-pb-btn"
          onClick={onNext}
          disabled={atEnd}
          aria-label="Next step"
        >
          ›
        </button>

        <div className="lc-pb-group" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              type="button"
              role="radio"
              aria-checked={state.speed === sp}
              data-active={state.speed === sp ? 'true' : 'false'}
              className="lc-pb-pill"
              onClick={() => setSpeed(sp)}
            >
              {sp}×
            </button>
          ))}
        </div>
      </div>

      {/* Step dots — evenly spaced across the panel width. */}
      <div className="lc-controls-dots" role="presentation">
        {steps.map((s, i) => (
          <button
            key={i}
            type="button"
            className="lc-controls-dot"
            data-current={i === state.idx ? 'true' : 'false'}
            data-done={i < state.idx ? 'true' : 'false'}
            onClick={() => onJump(i)}
            aria-label={`Jump to step ${i + 1}: ${s.label}`}
            title={`${i + 1}. ${s.label}`}
          />
        ))}
      </div>
    </div>
  );
}
