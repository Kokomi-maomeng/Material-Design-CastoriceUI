import { Component, type ReactNode } from "react";
import { Button } from "./Button";

export class DataBoundary extends Component<{ children: ReactNode; message: string; retry: string; onRetry: () => void; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <div className="page-content" role="alert"><p>{this.props.message}</p><Button onClick={() => { this.setState({ failed: false }); this.props.onRetry(); }}>{this.props.retry}</Button></div> : this.props.children;
  }
}
