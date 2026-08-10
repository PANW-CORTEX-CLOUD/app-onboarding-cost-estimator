/**
 * Section-level error boundary — catches render errors so sibling sections stay up.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  sectionId: string;
  children: ReactNode;
};

type State = { error: string | null };

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: Error): State {
    return { error: err.message || "Section failed to render" };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error(
      `[section:${this.props.sectionId}]`,
      err.message,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-testid={`section-boundary-${this.props.sectionId}`}
        >
          <p>This section failed. Other sections remain available.</p>
          <p>{this.state.error}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
          >
            Retry section
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
