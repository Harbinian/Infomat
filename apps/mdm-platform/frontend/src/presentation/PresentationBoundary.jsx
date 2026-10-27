import { Component } from 'react';
export class PresentationBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.monitor?.record('fallback', this.props.reason); }
  render() { return this.state.failed ? this.props.fallback || null : this.props.children; }
}
