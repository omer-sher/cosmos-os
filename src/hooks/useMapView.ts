import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pan + zoom for an SVG cosmos. Owns the world transform
 * (translate + scale) and attaches wheel / pointer listeners
 * to the host SVG element.
 *
 *   • wheel → zoom around the cursor (Δscale = ±10%)
 *   • drag  → pan
 *   • +/−   → zoom (small step)
 *   • 0     → reset
 */

export interface MapView {
  tx: number;
  ty: number;
  scale: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapViewApi {
  view: MapView;
  /** Stable ref — attach to the host <svg>. */
  bind: (el: SVGSVGElement | null) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
  /**
   * Animate pan + zoom so a world-space bbox lands inside a padded
   * region of the SVG viewport. Use this to reframe the map for an
   * active scenario.
   */
  fitTo: (bbox: BBox, padding?: Partial<FitPadding>) => void;
  /** Convert client (screen) coordinates to SVG world coordinates. */
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** True while the user is mid-drag — useful for cursor styling. */
  panning: boolean;
}

interface Options {
  worldW: number;
  worldH: number;
  worldMinX?: number;
  worldMinY?: number;
  minScale?: number;
  maxScale?: number;
  /**
   * World bbox of the whole map's content. When set, it defines the
   * "home" view: the initial view, the reset() target, and the max
   * zoom-out (you can't wheel out past seeing the whole map).
   */
  homeBBox?: BBox;
}

const DEFAULT: MapView = { tx: 0, ty: 0, scale: 1 };

export function useMapView({
  worldW,
  worldH,
  worldMinX = 0,
  worldMinY = 0,
  minScale = 0.35,
  maxScale = 3,
  homeBBox,
}: Options): MapViewApi {
  const [view, setView] = useState<MapView>(DEFAULT);
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  /** Compute (without animating) the view that fits a bbox into the padded viewport. */
  const fitTarget = useCallback((bbox: BBox, padding: Partial<FitPadding> = {}): MapView | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pad: FitPadding = {
      top:    padding.top ?? 60,
      right:  padding.right ?? 60,
      bottom: padding.bottom ?? 60,
      left:   padding.left ?? 60,
    };
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scaleFit = Math.min(rect.width / worldW, rect.height / worldH);
    const offsetX = (rect.width - worldW * scaleFit) / 2;
    const offsetY = (rect.height - worldH * scaleFit) / 2;
    // Available rect (CSS px) → viewBox (world units, before user transform):
    const availLeftVb = (pad.left - offsetX) / scaleFit;
    const availTopVb  = (pad.top  - offsetY) / scaleFit;
    const availWVb    = (rect.width  - pad.left - pad.right)  / scaleFit;
    const availHVb    = (rect.height - pad.top  - pad.bottom) / scaleFit;
    if (availWVb <= 0 || availHVb <= 0) return null;
    const bboxW = Math.max(1, bbox.maxX - bbox.minX);
    const bboxH = Math.max(1, bbox.maxY - bbox.minY);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    let target = Math.min(availWVb / bboxW, availHVb / bboxH);
    target *= 0.88; // breathing room inside the padded box
    target = Math.max(minScale, Math.min(maxScale, target));
    // Padded-area center in viewBox coords (origin is worldMin, not 0).
    const targetTx = (availLeftVb + availWVb / 2 + worldMinX) - cx * target;
    const targetTy = (availTopVb  + availHVb / 2 + worldMinY) - cy * target;
    return { tx: targetTx, ty: targetTy, scale: target };
  }, [worldW, worldH, worldMinX, worldMinY, minScale, maxScale]);

  const homeTarget = useCallback(
    (): MapView | null => (homeBBox ? fitTarget(homeBBox) : null),
    [homeBBox, fitTarget],
  );

  // clamp() runs on every wheel tick — cache the home scale (it only
  // changes with the viewport size) instead of re-fitting each time.
  const homeScaleRef = useRef<number | null>(null);
  useEffect(() => {
    const invalidate = () => { homeScaleRef.current = null; };
    window.addEventListener('resize', invalidate);
    return () => window.removeEventListener('resize', invalidate);
  }, []);

  const clamp = useCallback((s: number) => {
    if (homeScaleRef.current == null) homeScaleRef.current = homeTarget()?.scale ?? minScale;
    return Math.max(homeScaleRef.current, Math.min(maxScale, s));
  }, [homeTarget, minScale, maxScale]);

  /** Convert client px → SVG world coords using current view. */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    // The SVG viewBox is mapped via preserveAspectRatio="xMidYMid meet".
    // Compute the effective fit so wheel-zoom anchors correctly.
    const scaleFit = Math.min(rect.width / worldW, rect.height / worldH);
    const offsetX = (rect.width - worldW * scaleFit) / 2;
    const offsetY = (rect.height - worldH * scaleFit) / 2;
    // viewBox coords — the frame the world transform actually applies in
    // (the viewBox origin is (worldMinX, worldMinY), not (0,0)).
    const vbX = (clientX - rect.left - offsetX) / scaleFit + worldMinX;
    const vbY = (clientY - rect.top - offsetY) / scaleFit + worldMinY;
    // Account for current pan/zoom transform: vb = world * scale + t.
    const v = viewRef.current;
    return {
      x: (vbX - v.tx) / v.scale,
      y: (vbY - v.ty) / v.scale,
    };
  }, [worldW, worldH, worldMinX, worldMinY]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const v = viewRef.current;
    const nextScale = clamp(v.scale * factor);
    if (nextScale === v.scale) return;
    // Pin the world point under the cursor: solve for tx, ty such that
    //   vbX = world.x * nextScale + nextTx  (and same for y)
    const world = toWorld(clientX, clientY);
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleFit = Math.min(rect.width / worldW, rect.height / worldH);
    const offsetX = (rect.width - worldW * scaleFit) / 2;
    const offsetY = (rect.height - worldH * scaleFit) / 2;
    const vbX = (clientX - rect.left - offsetX) / scaleFit + worldMinX;
    const vbY = (clientY - rect.top - offsetY) / scaleFit + worldMinY;
    setView({
      scale: nextScale,
      tx: vbX - world.x * nextScale,
      ty: vbY - world.y * nextScale,
    });
  }, [clamp, toWorld, worldW, worldH, worldMinX, worldMinY]);

  const zoomBy = useCallback((factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }, [zoomAt]);

  // Forward declaration — defined below.
  const animateRef = useRef<(target: MapView, ms?: number) => void>(() => {});

  const reset = useCallback(() => {
    // Smoothly fly back to the home view rather than snapping.
    animateRef.current(homeTarget() ?? DEFAULT, 700);
  }, [homeTarget]);

  // Animated tween from current view to a target view (eased rAF lerp).
  const animRef = useRef<number>(0);
  const animateTo = useCallback((target: MapView, ms = 600) => {
    cancelAnimationFrame(animRef.current);
    const start = { ...viewRef.current };
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const k = ease(t);
      setView({
        tx: start.tx + (target.tx - start.tx) * k,
        ty: start.ty + (target.ty - start.ty) * k,
        scale: start.scale + (target.scale - start.scale) * k,
      });
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, []);
  // Wire the forward-declared ref so reset() can use animateTo.
  animateRef.current = animateTo;

  const fitTo = useCallback((bbox: BBox, padding: Partial<FitPadding> = {}) => {
    const target = fitTarget(bbox, padding);
    if (target) animateTo(target);
  }, [fitTarget, animateTo]);

  // First mount: snap straight to the home view (no fly-in from the raw
  // viewBox origin), so the map appears centered from the first frame.
  const snappedRef = useRef(false);
  useEffect(() => {
    if (snappedRef.current) return;
    const home = homeTarget();
    if (!home) return;
    snappedRef.current = true;
    setView(home);
  }, [homeTarget]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  // Bind wheel + pointer listeners to the SVG element.
  const bind = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Gentle exponential scaling — small wheel ticks barely move the
      // zoom; trackpad pinches (ctrlKey + larger deltaY) zoom faster.
      // Clamped per-event so an aggressive flick can't over-shoot.
      const k = e.ctrlKey ? 0.012 : 0.0035;
      const raw = Math.exp(-e.deltaY * k);
      const factor = Math.max(0.7, Math.min(1.45, raw));
      zoomAt(e.clientX, e.clientY, factor);
    };

    let dragId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startTx = 0;
    let startTy = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Only start a drag on primary button + non-interactive targets.
      // Clicks on services / topics are handled before this via stopPropagation.
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest('[data-no-pan="true"]')) return;
      // Kill the native text selection that would otherwise start
      // when the user drags across SVG <text> nodes or HTML overlays.
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      dragId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startTx = viewRef.current.tx;
      startTy = viewRef.current.ty;
      svg.setPointerCapture(e.pointerId);
      setPanning(true);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return;
      setView({
        scale: viewRef.current.scale,
        tx: startTx + (e.clientX - startX),
        ty: startTy + (e.clientY - startY),
      });
    };
    const endDrag = (e: PointerEvent) => {
      if (dragId !== e.pointerId) return;
      svg.releasePointerCapture(e.pointerId);
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      dragId = null;
      setPanning(false);
      if (dist > 4) {
        // Suppress the click the browser fires after a drag pointerup so
        // selections are not cleared when the user pans the map.
        svg.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
      }
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).matches('input, textarea, [contenteditable="true"]')) return;
      if (e.key === '+' || e.key === '=') zoomBy(1.15);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.15);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', endDrag);
      svg.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('keydown', onKey);
    };
  }, [zoomAt, zoomBy, reset]);

  return { view, bind, zoomBy, reset, fitTo, toWorld, panning };
}
