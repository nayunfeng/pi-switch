import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "32px", maxWidth: "560px", margin: "80px auto", fontFamily: "inherit" }}>
          <h2 style={{ marginTop: 0 }}>应用渲染出错 / Render error</h2>
          <p style={{ color: "var(--muted, #6b5b4e)" }}>
            配置文件可能已损坏，请检查 <code>~/PiSwitch/config.json</code>。
          </p>
          <pre style={{ fontSize: "12px", whiteSpace: "pre-wrap", opacity: 0.7 }}>
            {(this.state.error as Error).message}
          </pre>
          <button type="button" onClick={() => window.location.reload()}>重新加载 / Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
