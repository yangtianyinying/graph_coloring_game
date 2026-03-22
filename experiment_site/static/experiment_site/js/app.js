/**
 * Tab switching and editor bootstrap.
 */
(function () {
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

  const tabEditor = document.getElementById("tab-editor");
  const tabRun = document.getElementById("tab-run");
  if (window.location.hash === "#run" && tabRun) {
    showPanel("panel-run");
  } else if (tabEditor) {
    showPanel("panel-editor");
  }
})();
