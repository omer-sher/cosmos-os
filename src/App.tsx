import { useCallback, useEffect, useMemo, useState } from 'react';

import { CosmosMap } from './map/Map';
import { DomainBar } from './components/DomainBar';
import { ScenarioStatus } from './components/ScenarioStatus';
import { PlaybackControls } from './components/PlaybackControls';
import { StepPanel } from './components/StepPanel';
import { ActivityLog } from './components/ActivityLog';
import { IntroOverlay } from './components/IntroOverlay';
import { WarpTransition } from './components/WarpTransition';
import { HelpButton } from './components/HelpButton';
// import { CosmosChat } from './components/CosmosChat'; // disabled — see README § AI Chat
import { Spotlight } from './components/Spotlight';
import type { SpotlightTarget } from './components/Spotlight';
import { BrandStarfield } from './map/BrandStarfield';

import { SCENARIOS_BY_ID } from './scenarios/data';
import type { Step } from './scenarios/types';
import { useScenarioRunner } from './scenarios/runner';
import type { Shot } from './scenarios/runner';
import { readInitialDeepLink, useDeepLink } from './hooks/useDeepLink';

interface ActivityEntry { idx: number; step: Step }

export function App() {
  const initial = useMemo(readInitialDeepLink, []);
  const [showIntro, setShowIntro] = useState(
    () => initial.scenario == null && initial.domain == null && !localStorage.getItem('cosmos-intro-seen'),
  );
  // Plays the hyperspace warp between the intro CTA and the cosmos shell.
  const [warping, setWarping] = useState(false);
  const [activeDomain, setActiveDomain] = useState(() => initial.domain ?? 'shopping');

  const runner = useScenarioRunner();
  const { state, steps, scenario, setScenario, jumpTo, completeCurrentShot, onShot } = runner;

  // Hydrate from deep link on first paint.
  useEffect(() => {
    if (initial.scenario && SCENARIOS_BY_ID[initial.scenario]) {
      setScenario(initial.scenario);
      if (initial.step != null) {
        // Defer so steps array is populated.
        queueMicrotask(() => jumpTo(initial.step!));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push UI state into the URL.
  useDeepLink({
    domain: activeDomain,
    scenario: state.scenarioId,
    step: state.idx >= 0 ? state.idx : null,
  });

  // Latest shot from the runner — drives the comet animation in Map.
  const [shot, setShot] = useState<Shot | null>(null);
  const [history, setHistory] = useState<ActivityEntry[]>([]);
  const [spotlightTarget, setSpotlightTarget] = useState<SpotlightTarget | null>(null);
  // The step explainer panel can be dismissed by the user; it auto-reopens
  // whenever the user navigates (next/prev/dot/play) or picks a new scenario.
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    return onShot((s) => {
      setShot(s);
      // Append every step in the shot to the activity log (keep them in order).
      setHistory((h) => {
        const baseIdx = s.startIdx;
        const additions = s.steps.map((step, i) => ({ idx: baseIdx + i, step }));
        // Avoid duplicates if the same shot fires twice (e.g. user clicks Next mid-play).
        const lastIdx = h.length > 0 ? h[h.length - 1].idx : -1;
        const filtered = additions.filter((a) => a.idx > lastIdx);
        return [...h, ...filtered];
      });
    });
  }, [onShot]);

  const handleShotComplete = useCallback(
    (token: number) => {
      // Ignore late callbacks from invalidated shots.
      if (shot && token !== shot.token) return;
      completeCurrentShot();
    },
    [shot, completeCurrentShot],
  );

  const handlePickScenario = useCallback(
    (scenarioId: string) => {
      setScenario(scenarioId);
      setHistory([]);
      setShot(null);
      setPanelOpen(true);
    },
    [setScenario],
  );

  // Wrap navigation actions so they reopen the explainer panel if it
  // was dismissed. The user clicking a dot / next / prev / play is a
  // strong signal they want to see the description again.
  const navPrev    = useCallback(() => { setPanelOpen(true); runner.prev(); }, [runner]);
  const navNext    = useCallback(() => { setPanelOpen(true); runner.next(); }, [runner]);
  const navJump    = useCallback((i: number) => { setPanelOpen(true); runner.jumpTo(i); }, [runner]);
  const navPlay    = useCallback(() => { setPanelOpen(true); runner.play(); }, [runner]);
  // Restart: rewind to step 0 and play. Also clears the activity log so
  // it doesn't show entries from the last run.
  const navRestart = useCallback(() => {
    setPanelOpen(true);
    setHistory([]);
    setShot(null);
    runner.jumpTo(0);
    // jumpTo flips state to non-playing; defer play so the index update
    // is committed before play() reads it.
    queueMicrotask(() => runner.play());
  }, [runner]);

  const handlePickDomain = useCallback(
    (domainId: string) => {
      // Browsing other domains shouldn't kill the active scenario —
      // it stays running / framed until the user explicitly picks a
      // different scenario from the dropdown (or hits ESC).
      setActiveDomain(domainId);
    },
    [],
  );

  // ESC clears the active scenario and de-isolates the map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.target && (e.target as HTMLElement).matches('input, textarea, [contenteditable="true"]')) return;
      if (!state.scenarioId) return;
      setScenario(null);
      setHistory([]);
      setShot(null);
      setPanelOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.scenarioId, setScenario]);

  // Any active scenario isolates the map — the moment a scenario is
  // picked, fade everything outside its touch set so the active flow
  // is the only thing the eye lands on.
  const isolate = !!state.scenarioId;

  // Map is mounted ONLY after the intro CTA fires — otherwise the canvas
  // briefly paints behind the overlay on first render.
  // The warp can run UNDER the intro while it fades — so the user
  // sees hyperspace ignite first and the intro dissolves to reveal it.
  if (showIntro || warping) {
    return (
      <>
        {warping && <WarpTransition onDone={() => setWarping(false)} />}
        {showIntro && (
          <IntroOverlay
            onStart={() => {
              localStorage.setItem('cosmos-intro-seen', '1');
              setWarping(true);
            }}
            onExitComplete={() => setShowIntro(false)}
          />
        )}
      </>
    );
  }

  return <CosmosShell
    activeDomain={activeDomain}
    runner={runner}
    state={state}
    steps={steps}
    scenario={scenario}
    shot={shot}
    history={history}
    panelOpen={panelOpen}
    setPanelOpen={setPanelOpen}
    handlePickDomain={handlePickDomain}
    handlePickScenario={handlePickScenario}
    handleShotComplete={handleShotComplete}
    isolate={isolate}
    setHistory={setHistory}
    navPlay={navPlay}
    navPrev={navPrev}
    navNext={navNext}
    navJump={navJump}
    navRestart={navRestart}
    spotlightTarget={spotlightTarget}
    setSpotlightTarget={setSpotlightTarget}
  />;
}

interface CosmosShellProps {
  activeDomain: string;
  runner: ReturnType<typeof useScenarioRunner>;
  state: ReturnType<typeof useScenarioRunner>['state'];
  steps: Step[];
  scenario: ReturnType<typeof useScenarioRunner>['scenario'];
  shot: Shot | null;
  history: ActivityEntry[];
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  handlePickDomain: (d: string) => void;
  handlePickScenario: (s: string) => void;
  handleShotComplete: (token: number) => void;
  isolate: boolean;
  setHistory: (v: ActivityEntry[]) => void;
  navPlay: () => void;
  navPrev: () => void;
  navNext: () => void;
  navJump: (i: number) => void;
  navRestart: () => void;
  spotlightTarget: SpotlightTarget | null;
  setSpotlightTarget: (t: SpotlightTarget | null) => void;
}

function CosmosShell(p: CosmosShellProps) {
  // The first ~2.6s after the CTA we run the "ignite" sequence.
  const [revealing, setRevealing] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setRevealing(false), 2600);
    return () => window.clearTimeout(t);
  }, []);

  const {
    activeDomain, runner, state, steps, scenario, shot, history,
    panelOpen, setPanelOpen, handlePickDomain, handlePickScenario,
    handleShotComplete, isolate, setHistory, navPlay, navPrev, navNext, navJump, navRestart,
    spotlightTarget, setSpotlightTarget,
  } = p;

  return (
    <div className="lc-app" data-revealing={revealing ? 'true' : 'false'}>
      {/* Always-on sparkle starfield — sits behind everything. */}
      <div className="lc-app-bg" aria-hidden="true">
        <BrandStarfield density={0.1} speed={1.2} shootingEvery={60} />
      </div>

      {/* Brief radial flash that washes the scene during the reveal. */}
      {revealing && <div className="lc-reveal-flash" aria-hidden="true" />}

      <header className="lc-topbar">
        <div className="lc-topbar-row">
          <div className="lc-topbar-side lc-topbar-side--left">
            <span className="lc-topbar-brand">
              Cosmos
              <span
                style={{
                  marginLeft: 10,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.62em',
                  letterSpacing: '0.18em',
                  opacity: 0.55,
                  textTransform: 'uppercase',
                }}
              >
                AstroMart demo
              </span>
            </span>
            <DomainBar
              active={activeDomain}
              activeScenarioId={state.scenarioId}
              onPickDomain={handlePickDomain}
              onPickScenario={handlePickScenario}
            />
          </div>

          <div className="lc-topbar-center">
            <ScenarioStatus domainId={activeDomain} activeScenarioId={state.scenarioId} />
          </div>

          <div className="lc-topbar-side lc-topbar-side--right">
            <HelpButton />
          </div>
        </div>
      </header>

      <div className="lc-stage">
        <CosmosMap
          activeScenarioId={state.scenarioId}
          shot={shot}
          speed={state.speed}
          onShotComplete={handleShotComplete}
          isolate={isolate}
          revealing={revealing}
          spotlightTarget={spotlightTarget}
          onSpotlightConsumed={() => setSpotlightTarget(null)}
        />

        <StepPanel
          scenario={scenario}
          steps={steps}
          idx={state.idx}
          open={panelOpen}
          onPrev={navPrev}
          onNext={navNext}
          onClose={() => setPanelOpen(false)}
        />

        <ActivityLog
          history={history}
          visible={!!scenario && history.length > 0}
          onClear={() => setHistory([])}
        />

        <PlaybackControls
          runner={runner}
          steps={steps}
          onPlay={navPlay}
          onPrev={navPrev}
          onNext={navNext}
          onJump={navJump}
          onRestart={navRestart}
        />

        {/* <CosmosChat /> */}
      </div>

      <Spotlight
        onSelectScenario={handlePickScenario}
        onSelectNode={setSpotlightTarget}
      />
    </div>
  );
}
