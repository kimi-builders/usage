import { preferences } from './preferences.js';
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { normalizeVibe } from "./visual-preferences.js";
import "./styles.css";

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

preferences.initialize().then(() => {
const savedTheme = preferences.getItem("kbu.theme");
document.documentElement.dataset.vibe = normalizeVibe(preferences.getItem("kbu.vibe"));
document.documentElement.dataset.theme = savedTheme
  || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DashboardErrorBoundary>
      <App />
    </DashboardErrorBoundary>
  </React.StrictMode>,
);

}).catch(() => {
  createRoot(document.getElementById('root')).render(<main className="state-page"><h1>无法读取本机偏好 / Could not load local preferences</h1><p>请确认本地服务仍在运行后重试。 / Check that the local service is running, then retry.</p><button type="button" onClick={() => window.location.reload()}>重新加载 / Reload</button></main>);
});
