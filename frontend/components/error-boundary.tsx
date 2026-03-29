"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional fallback to render instead of the default error UI. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary — catches rendering errors in the component tree
 * and shows a recovery UI instead of crashing the entire application.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught rendering error:", error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[60vh] items-center justify-center p-8">
          <div className="panel-shell mx-auto max-w-lg px-8 py-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-[var(--danger)]" />
            <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
              Something went wrong
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              An unexpected error occurred while rendering the interface.
              Your data is safe — try recovering or reloading the page.
            </p>
            {this.state.error ? (
              <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-[var(--surface-soft)] p-3 text-left font-mono text-xs text-[var(--text-muted)]">
                {this.state.error.message}
              </pre>
            ) : null}
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                className="action-button"
                onClick={this.handleReload}
              >
                <RotateCcw className="h-4 w-4" />
                Try again
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={this.handleHardReload}
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
