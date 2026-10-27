// Presentation diagnostics never accept URLs, identity or business payloads.
export const effectIds = new Set(['scene', 'pointer', 'ripple', 'entrance', 'lottie-loading', 'lottie-success', 'lottie-error']);
export const percentile = (values, fraction = .95) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
export function frameWindow(intervals, period) {
  if (!intervals.length || !period) return null;
  const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  return { estimatedFps: 1000 / average, intervalP95: percentile(intervals), droppedRatio: intervals.filter(value => value > period * 1.5).length / intervals.length, samples: intervals.length, refreshPeriod: period };
}
export function lowerQuality(quality) { return quality === 'high' ? 'standard' : 'basic'; }
export function badWindow(sample) { return sample && (sample.estimatedFps < 55 || sample.droppedRatio > .05); }
export function createDiagnostics() {
  const effects = new Map(), windows = [], events = [], costs = [];
  const resources = { workers: 0, observers: 0, listeners: 0, scenes: 0, lottie: 0, schedules: 0 };
  const support = globalThis.PerformanceObserver?.supportedEntryTypes || [];
  const metrics = { longtask: support.includes('longtask') ? [] : null, 'long-animation-frame': support.includes('long-animation-frame') ? [] : null, event: support.includes('event') ? [] : null };
  return {
    effects, resources, metrics, costs,
    effect(id, continuous = false) {
      if (!effectIds.has(id)) throw new Error('Unknown presentation effect');
      const token = Symbol(id), started = performance.now(); effects.set(token, { id, continuous });
      events.push({ type: 'effect-start', reason: id, at: started }); if (events.length > 80) events.shift();
      return () => {
        if (!effects.delete(token)) return;
        const at = performance.now(); events.push({ type: 'effect-stop', reason: id, at, duration: at - started }); if (events.length > 80) events.shift();
      };
    },
    resource(name, delta) { if (Object.hasOwn(resources, name)) resources[name] = Math.max(0, resources[name] + delta); },
    record(type, reason) { events.push({ type, reason, at: Math.round(performance.now()) }); if (events.length > 80) events.shift(); },
    window(sample) { windows.push(sample); if (windows.length > 60) windows.shift(); },
    snapshot() { return { version: 1, estimateOnly: true, inp: null, inpReason: 'Event Timing observations are not an aggregated page INP.', effects: [...effects.values()], resources: { ...resources }, windows: [...windows], events: [...events], callbackP95: percentile(costs), metrics: structuredClone(metrics), support }; }
  };
}
