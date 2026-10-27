import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { usePresentation } from './PresentationProvider.jsx';
const LottieFeedback = lazy(() => import('./LottieFeedback.jsx'));
export function StaticStatus({ kind }) {
  return <svg viewBox="0 0 48 48" className="status-symbol" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" strokeWidth="2"/>{kind === 'success' ? <path d="m14 24 7 7 14-15"/> : kind === 'error' ? <path d="M24 13v13m0 7v1"/> : kind === 'loading' ? <path d="M24 8a16 16 0 0 1 16 16"/> : <path d="M15 19h18M15 26h12"/>}</svg>;
}
class DecorationBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.monitor?.record('fallback', 'lottie-module-failed'); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
export function StatusDecoration({ kind }) {
  const view = usePresentation(), [ready, setReady] = useState(false);
  useEffect(() => { setReady(false); if (!view?.running) return; const timer = setTimeout(() => setReady(true), kind === 'loading' ? 220 : 0); return () => clearTimeout(timer); }, [kind, view?.running]);
  const fallback = <StaticStatus kind={kind}/>;
  return <span className="status-decoration" aria-hidden="true">{ready && ['loading', 'success', 'error'].includes(kind) ? <DecorationBoundary monitor={view.monitor} fallback={fallback}><Suspense fallback={fallback}><LottieFeedback key={kind} kind={kind}/></Suspense></DecorationBoundary> : fallback}</span>;
}
