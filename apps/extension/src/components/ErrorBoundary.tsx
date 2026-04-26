import { isContextInvalidatedError } from "@/lib/extension-context";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Last-line defense for the content-script React tree. On host pages, the
// failure mode should be "sidebar quietly disappears" — no fallback UI, no
// toast — because the most common cause is an orphaned context after the
// extension reloaded, and there's nothing the user can do from inside the
// dead tree.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isContextInvalidatedError(error)) {
      console.debug("[remarks/extension] context invalidated, unmounting sidebar");
      return;
    }
    console.error("[remarks/extension] sidebar crashed:", error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
