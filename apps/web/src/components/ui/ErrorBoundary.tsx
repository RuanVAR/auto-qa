import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  /**
   * Fullscreen renders a full-page error screen (use for top-level app errors).
   * Inline renders inside the current layout (use for route-level errors — keeps nav visible).
   */
  variant?: 'fullscreen' | 'inline';
  /** Custom fallback element, overrides the default UI */
  fallback?: ReactNode;
  /**
   * When this value changes, the boundary resets and re-renders children.
   * Pass the current route pathname so a nav event clears a stuck error.
   */
  resetKey?: string | number;
  /** Optional label shown in the error card — e.g. "Feature page" */
  scope?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.scope ?? 'app', error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    // Reset when the resetKey changes (typically on route change)
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const variant = this.props.variant ?? 'fullscreen';
    const message = this.state.error?.message ?? 'An unexpected error occurred.';

    const card = (
      <div
        className="max-w-md w-full mx-auto rounded-2xl p-8 text-center"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.10)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.40)',
        }}
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.28)',
          }}
        >
          <AlertTriangle size={22} style={{ color: '#f87171' }} />
        </div>
        <h2 className="text-lg font-semibold mb-1.5" style={{ color: 'rgba(238,238,248,0.92)' }}>
          Something went wrong
        </h2>
        {this.props.scope && (
          <p className="text-xs mb-2" style={{ color: 'rgba(238,238,248,0.40)' }}>
            in {this.props.scope}
          </p>
        )}
        <p className="text-sm mb-6 leading-relaxed" style={{ color: 'rgba(238,238,248,0.60)' }}>
          {message}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: 'rgba(var(--accent-rgb),0.20)',
              color: 'var(--accent-300)',
              border: '1px solid rgba(var(--accent-rgb),0.35)',
            }}
          >
            <RefreshCw size={13} /> Try again
          </button>
          {variant === 'inline' && (
            <a
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(238,238,248,0.70)',
                border: '1px solid rgba(255,255,255,0.10)',
              }}
            >
              <Home size={13} /> Home
            </a>
          )}
        </div>
      </div>
    );

    if (variant === 'fullscreen') {
      return (
        <div
          className="min-h-screen flex items-center justify-center px-4"
          style={{ background: 'var(--bg-base, #0a0a14)' }}
        >
          {card}
        </div>
      );
    }

    // Inline — keeps the app shell visible so the user can still navigate
    return <div className="py-12 px-4">{card}</div>;
  }
}
