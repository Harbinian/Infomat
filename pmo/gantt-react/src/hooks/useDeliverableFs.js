import { useEffect, useRef, useState } from 'react';

export function useDeliverableFsEvents(onChanged) {
  const callbackRef = useRef(onChanged);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    callbackRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    const notify = (payload = {}) => {
      setRevision(value => value + 1);
      callbackRef.current?.(payload);
    };

    if (!import.meta.env.DEV) return undefined;

    if (import.meta.hot) {
      import.meta.hot.on('pmo:deliverables-changed', notify);
      return () => {
        import.meta.hot.off?.('pmo:deliverables-changed', notify);
      };
    }

    const timer = window.setInterval(() => notify({ id: null, kind: 'poll' }), 5000);
    return () => window.clearInterval(timer);
  }, []);

  return revision;
}
