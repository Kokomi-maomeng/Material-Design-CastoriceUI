import { Component, type ReactNode } from "react";
import { Button } from "./Button";

type DataBoundaryProps = { children: ReactNode; resetKey: string } & (
  { fallback: ReactNode } | { message: string; retry: string; onRetry: () => void }
);

export class DataBoundary extends Component<DataBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if ("fallback" in this.props) return this.props.fallback;
    const { message, retry, onRetry } = this.props;
    return <div className="page-content" role="alert"><p>{message}</p><Button onClick={() => { this.setState({ failed: false }); onRetry(); }}>{retry}</Button></div>;
  }
}
