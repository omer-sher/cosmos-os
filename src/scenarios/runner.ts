/**
 * Scenario runner — pure state machine. Owns the cursor through a
 * scenario's STEPS, exposes play/pause/scrub controls, and emits a
 * "shot" each time the cursor advances. The visual side (comet packets)
 * subscribes to those shots and renders them via GSAP.
 *
 * Phase numbering: STEP.phase is a GLOBAL phase id (matches Scenario.phaseId).
 * Step indices in this file are LOCAL to the active scenario's steps array
 * — never the global STEPS index. This way scenarios are independent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SCENARIOS_BY_ID, stepsForScenario } from './data';
import type { Scenario, Step } from './types';

export interface Shot {
  /** Scenario being played. */
  scenarioId: string;
  /** Local step index in the scenario's steps array. */
  startIdx: number;
  /** Steps fired together (length 1 unless they are flagged `parallel: true`). */
  steps: Step[];
  /** Token used to ignore late onComplete callbacks after a stop / scenario switch. */
  token: number;
}

export type ShotListener = (shot: Shot) => void;

export interface RunnerState {
  scenarioId: string | null;
  /** Local step index within the scenario's steps array. -1 = idle / pre-start. */
  idx: number;
  playing: boolean;
  /** Playback rate. Maps directly to GSAP timeScale. */
  speed: number;
  /** When true, restart the scenario from step 0 after the last step. */
  loop: boolean;
}

const DEFAULT_STATE: RunnerState = {
  scenarioId: null,
  idx: -1,
  playing: false,
  speed: 1,
  loop: false,
};

export interface RunnerApi {
  state: RunnerState;
  /** Steps for the active scenario (memoised). */
  steps: Step[];
  scenario: Scenario | null;

  setScenario: (scenarioId: string | null) => void;
  setSpeed: (speed: number) => void;
  setLoop: (loop: boolean) => void;

  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (idx: number) => void;

  /** Subscribe to shots fired as the cursor advances. */
  onShot: (listener: ShotListener) => () => void;
  /** Mark the current shot as complete — runner advances to the next group. */
  completeCurrentShot: () => void;
}

/**
 * Build the runs for a scenario as an array of "shots".
 * Each shot is the group of steps that fire together (the lead step
 * plus any consecutive `parallel: true` followers). The runner walks
 * shots one at a time.
 */
function buildShotsFromIdx(steps: Step[], fromIdx: number): { startIdx: number; steps: Step[] }[] {
  const shots: { startIdx: number; steps: Step[] }[] = [];
  let i = Math.max(0, fromIdx);
  while (i < steps.length) {
    const group = [steps[i]];
    let j = i + 1;
    while (j < steps.length && steps[j].parallel) {
      group.push(steps[j]);
      j++;
    }
    shots.push({ startIdx: i, steps: group });
    i = j;
  }
  return shots;
}

export function useScenarioRunner(): RunnerApi {
  const [state, setState] = useState<RunnerState>(DEFAULT_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const tokenRef = useRef(0);
  const listenersRef = useRef<Set<ShotListener>>(new Set());

  const scenario = state.scenarioId ? SCENARIOS_BY_ID[state.scenarioId] ?? null : null;
  const steps = useMemo<Step[]>(() => (scenario ? stepsForScenario(scenario) : []), [scenario]);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const emitShot = useCallback((startIdx: number, group: Step[]) => {
    if (!stateRef.current.scenarioId) return;
    const shot: Shot = {
      scenarioId: stateRef.current.scenarioId,
      startIdx,
      steps: group,
      token: tokenRef.current,
    };
    listenersRef.current.forEach((l) => l(shot));
  }, []);

  const stopAllInFlight = useCallback(() => {
    // Bumping the token invalidates any in-flight onComplete callbacks
    // from previous shots so they can't accidentally advance us.
    tokenRef.current += 1;
  }, []);

  const setScenario = useCallback((scenarioId: string | null) => {
    stopAllInFlight();
    setState((s) => ({
      ...s,
      scenarioId,
      idx: scenarioId ? 0 : -1,
      playing: false,
    }));
  }, [stopAllInFlight]);

  const setSpeed = useCallback((speed: number) => setState((s) => ({ ...s, speed })), []);
  const setLoop = useCallback((loop: boolean) => setState((s) => ({ ...s, loop })), []);

  const pause = useCallback(() => {
    stopAllInFlight();
    setState((s) => ({ ...s, playing: false }));
  }, [stopAllInFlight]);

  const play = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.scenarioId || stepsRef.current.length === 0) return;

    // If we're past the end, restart from 0.
    let startIdx = cur.idx;
    if (startIdx < 0 || startIdx >= stepsRef.current.length) startIdx = 0;

    stopAllInFlight();
    tokenRef.current += 1;

    setState((s) => ({ ...s, playing: true, idx: startIdx }));

    // Fire the first shot immediately. Subsequent shots fire on
    // completeCurrentShot() (called by the renderer when the GSAP
    // timeline finishes the active group).
    const firstShots = buildShotsFromIdx(stepsRef.current, startIdx);
    if (firstShots.length === 0) return;
    const firstShot = firstShots[0];
    emitShot(firstShot.startIdx, firstShot.steps);
  }, [emitShot, stopAllInFlight]);

  const completeCurrentShot = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.playing || !cur.scenarioId) return;
    const allSteps = stepsRef.current;
    if (allSteps.length === 0) return;

    // Find the current shot's group end index, then move to the next shot.
    const shots = buildShotsFromIdx(allSteps, 0);
    const here = shots.findIndex((s) => s.startIdx === cur.idx);
    const nextShot = here >= 0 ? shots[here + 1] : null;

    if (!nextShot) {
      // End of scenario.
      if (cur.loop) {
        const reset = buildShotsFromIdx(allSteps, 0);
        if (reset.length > 0) {
          setState((s) => ({ ...s, idx: 0 }));
          emitShot(reset[0].startIdx, reset[0].steps);
          return;
        }
      }
      setState((s) => ({ ...s, playing: false }));
      return;
    }

    setState((s) => ({ ...s, idx: nextShot.startIdx }));
    emitShot(nextShot.startIdx, nextShot.steps);
  }, [emitShot]);

  const jumpTo = useCallback((idx: number) => {
    stopAllInFlight();
    const clamped = Math.max(0, Math.min(stepsRef.current.length - 1, idx));
    setState((s) => ({ ...s, idx: clamped, playing: false }));
  }, [stopAllInFlight]);

  const next = useCallback(() => {
    const cur = stateRef.current;
    const len = stepsRef.current.length;
    if (len === 0) return;
    const target = Math.min(len - 1, cur.idx + 1);
    if (target === cur.idx) return;
    stopAllInFlight();
    setState((s) => ({ ...s, idx: target, playing: false }));
    // Briefly preview the step's packet so the user sees what they jumped to.
    emitShot(target, [stepsRef.current[target]]);
  }, [emitShot, stopAllInFlight]);

  const prev = useCallback(() => {
    const cur = stateRef.current;
    const target = Math.max(0, cur.idx - 1);
    if (target === cur.idx) return;
    stopAllInFlight();
    setState((s) => ({ ...s, idx: target, playing: false }));
    emitShot(target, [stepsRef.current[target]]);
  }, [emitShot, stopAllInFlight]);

  const onShot = useCallback((listener: ShotListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // When the scenario changes out from under us, ensure we're paused.
  useEffect(() => {
    return () => {
      stopAllInFlight();
    };
  }, [stopAllInFlight]);

  return {
    state,
    steps,
    scenario,
    setScenario,
    setSpeed,
    setLoop,
    play,
    pause,
    next,
    prev,
    jumpTo,
    onShot,
    completeCurrentShot,
  };
}
