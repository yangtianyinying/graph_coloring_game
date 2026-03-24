/**
 * Tab switching、节点显示比例（与 graphTheme 联动）。
 */
(function () {
  const LS_KEY = "graphNodeVisualScale";

  function syncNodeScaleLabels(value) {
    const pct = Math.round(parseFloat(value) * 100);
    const v1 = document.getElementById("editor-node-scale-val");
    const v2 = document.getElementById("run-node-scale-val");
    if (v1) v1.textContent = `${pct}%`;
    if (v2) v2.textContent = `${pct}%`;
  }

  function syncNodeScaleInputs(value) {
    const s = String(value);
    const el = document.getElementById("editor-node-scale");
    const el2 = document.getElementById("run-node-scale");
    if (el) el.value = s;
    if (el2) el2.value = s;
    syncNodeScaleLabels(value);
  }

  function applyNodeVisualScale(value) {
    const v = parseFloat(value);
    if (Number.isNaN(v)) return;
    localStorage.setItem(LS_KEY, String(v));
    syncNodeScaleInputs(v);
    if (window.GraphExperimentTheme && window.GraphExperimentTheme.setNodeVisualScale) {
      window.GraphExperimentTheme.setNodeVisualScale(v);
    }
    if (window.EditorApp && window.EditorApp.refreshEditorView) {
      window.EditorApp.refreshEditorView();
    }
  }

  function showPanel(id) {
    document.querySelectorAll(".panel").forEach((p) => {
      p.classList.toggle("active", p.id === id);
    });
    document.querySelectorAll(".tabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.panel === id);
    });
  }

  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => showPanel(btn.dataset.panel));
  });

  if (window.EditorApp) {
    window.EditorApp.initEditor();
  }

  const stored = localStorage.getItem(LS_KEY);
  const initial = stored != null && stored !== "" ? parseFloat(stored) : 0.88;
  syncNodeScaleInputs(Number.isNaN(initial) ? 0.88 : initial);
  if (window.GraphExperimentTheme && window.GraphExperimentTheme.setNodeVisualScale) {
    window.GraphExperimentTheme.setNodeVisualScale(Number.isNaN(initial) ? 0.88 : initial);
  }
  if (window.EditorApp && window.EditorApp.refreshEditorView) {
    window.EditorApp.refreshEditorView();
  }

  document.getElementById("editor-node-scale")?.addEventListener("input", (e) => {
    applyNodeVisualScale(e.target.value);
  });
  document.getElementById("run-node-scale")?.addEventListener("input", (e) => {
    applyNodeVisualScale(e.target.value);
  });

  const tabRun = document.getElementById("tab-run");
  if (window.location.hash === "#editor") {
    showPanel("panel-editor");
  } else if (tabRun) {
    showPanel("panel-run");
  }
})();
