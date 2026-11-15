/**
 * Renders API failures with a safe message, an available request id and an optional retry
 * action. Feature pages share this component to keep request errors consistent.
 */

import { ApiError, userMessage } from "../api/errors";

/** A failed request: the user-facing message, the request id when the API sent one, and a retry. */
export function ErrorState(props: { error: unknown; onRetry?: () => void }) {
  const requestId = props.error instanceof ApiError ? props.error.requestId : undefined;
  return (
    <div role="alert" className="error-state">
      <p>{userMessage(props.error)}</p>
      {requestId && <p className="muted">Request ID: {requestId}</p>}
      {props.onRetry && (
        <button type="button" onClick={props.onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
