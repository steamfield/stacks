/**
 * Catches render errors below it, logs them once and shows the mapped message. A retryable error
 * offers "Try again", which remounts the children.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "../components/error-state";
import { type AppError, isRetryable, toAppError, userMessage } from "../errors";
import type { Logger } from "../logging";

type Props = { logger: Logger; children: ReactNode };
type State = { error: AppError | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: toAppError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const appError = toAppError(error);
    this.props.logger.error("render.failed", {
      kind: appError.kind,
      message: appError.message,
      component:
        info.componentStack
          ?.split("\n")
          .find((line) => line.trim() !== "")
          ?.trim() ?? null,
    });
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <ErrorState
        title="Something went wrong"
        message={userMessage(error)}
        onRetry={isRetryable(error) ? this.reset : undefined}
      />
    );
  }
}
