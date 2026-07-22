import { createContext, useContext } from 'react';

/**
 * Tiny imperative registry that maps `edgeKey` → rendered SVGPathElement.
 * Edges register themselves on mount; the comet packet looks paths up
 * by key when GSAP needs to call `getPointAtLength`.
 *
 * No React state — paths don't move once mounted, so we don't need
 * re-renders when one is registered.
 */
export interface EdgeRegistry {
  register: (key: string, el: SVGPathElement | null) => void;
  get: (key: string) => SVGPathElement | undefined;
}

export function createEdgeRegistry(): EdgeRegistry {
  const map = new Map<string, SVGPathElement>();
  return {
    register(key, el) {
      if (el) map.set(key, el);
      else map.delete(key);
    },
    get(key) {
      return map.get(key);
    },
  };
}

export const EdgeRegistryContext = createContext<EdgeRegistry | null>(null);

export function useEdgeRegistry(): EdgeRegistry {
  const ctx = useContext(EdgeRegistryContext);
  if (!ctx) throw new Error('useEdgeRegistry must be used inside <EdgeRegistryContext.Provider>');
  return ctx;
}
