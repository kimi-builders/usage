import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { normalizeVibe } from "./visual-preferences.js";
import "./styles.css";

const savedTheme = localStorage.getItem("kbu.theme");
document.documentElement.dataset.vibe = normalizeVibe(localStorage.getItem("kbu.vibe"));
document.documentElement.dataset.theme = savedTheme
  || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

class DashboardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("Local usage dashboard render failed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="state-page">
        <img src="/brand/logo-tile.svg" alt="" />
        <h1>本地看板显示异常</h1>
        <p>{this.state.error?.message || "页面组件未能完成渲染。"}</p>
        <button className="primary-btn" type="button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DashboardErrorBoundary>
      <App />
    </DashboardErrorBoundary>
  </React.StrictMode>,
);
