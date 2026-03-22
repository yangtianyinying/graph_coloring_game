/**
 * Stimulus set editor: drag nodes, edges, initialBeliefs, orderMode, reportOrder, import/export.
 */
(function (global) {
  const { THEME, rgb } = global.GraphExperimentTheme;
  const {
    drawNode,
    drawEdges,
    drawTrianglePicker,
    layoutFromNodes,
    findNodeAt,
  } = global.GraphCanvasDraw;

  let stimulus = null;
  let currentBlockIdx = 0;
  let currentTrialIdx = 0;
  let edgeMode = false;
  let pendingEdgeNode = null;
  let dragState = null;
  let nextNodeId = 1;

  function createEmptyTrial() {
    return {
      trialId: "t1",
      graphId: "g1",
      orderMode: "sequential",
      nodes: [],
      edges: [],
      initialBeliefs: {},
      reportOrder: [],
    };
  }

  function createEmptyStimulus() {
    return {
      version: 1,
      name: "stimulus-set",
      canvasWidth: 960,
      canvasHeight: 620,
      blocks: [{ blockId: "b1", trials: [createEmptyTrial()] }],
    };
  }

  function getCurrentTrial() {
    const b = stimulus.blocks[currentBlockIdx];
    return b.trials[currentTrialIdx];
  }

  function ensureIds() {
    if (!stimulus) stimulus = createEmptyStimulus();
  }

  function syncReportOrderFromUncolored(trial) {
    const colored = new Set(Object.keys(trial.initialBeliefs || {}));
    const uncolored = trial.nodes.map((n) => n.id).filter((id) => !colored.has(id));
    const prev = trial.reportOrder || [];
    const prevSet = new Set(prev);
    if (trial.orderMode === "sequential") {
      const merged = [];
      for (const id of prev) {
        if (uncolored.includes(id) && !merged.includes(id)) merged.push(id);
      }
      for (const id of uncolored) {
        if (!merged.includes(id)) merged.push(id);
      }
      trial.reportOrder = merged;
    } else {
      trial.reportOrder = [];
    }
  }

  function renderTree() {
    const el = document.getElementById("block-trial-tree");
    if (!el) return;
    el.innerHTML = "";
    stimulus.blocks.forEach((block, bi) => {
      const div = document.createElement("div");
      div.className = "block-item";
      const head = document.createElement("div");
      head.innerHTML = `<strong>Block ${bi + 1}</strong> <span>(${block.blockId})</span>`;
      div.appendChild(head);
      block.trials.forEach((trial, ti) => {
        const t = document.createElement("div");
        t.className = "trial-item" + (bi === currentBlockIdx && ti === currentTrialIdx ? " current" : "");
        t.textContent = `Trial ${ti + 1}: ${trial.graphId}`;
        t.addEventListener("click", () => {
          currentBlockIdx = bi;
          currentTrialIdx = ti;
          loadTrialToForm();
          renderTree();
        });
        div.appendChild(t);
      });
      el.appendChild(div);
    });
  }

  function syncNextNodeIdFromTrial(trial) {
    let max = 0;
    for (const n of trial.nodes || []) {
      const m = /^n(\d+)$/.exec(n.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    nextNodeId = Math.max(nextNodeId, max + 1);
  }

  function loadTrialToForm() {
    ensureIds();
    const trial = getCurrentTrial();
    syncNextNodeIdFromTrial(trial);
    document.getElementById("trial-graph-id").value = trial.graphId || "";
    document.getElementById("trial-order-mode").value = trial.orderMode || "sequential";
    document.getElementById("editor-stimulus-name").value = stimulus.name || "";
    document.getElementById("editor-canvas-w").value = String(stimulus.canvasWidth);
    document.getElementById("editor-canvas-h").value = String(stimulus.canvasHeight);
    const c = document.getElementById("editor-canvas");
    if (c) {
      c.width = stimulus.canvasWidth;
      c.height = stimulus.canvasHeight;
    }
    syncReportOrderFromUncolored(trial);
    renderColoredPanel();
    renderReportOrder();
    updateOrderUiVisibility();
    drawEditorCanvas();
  }

  function updateOrderUiVisibility() {
    const trial = getCurrentTrial();
    const seq = trial.orderMode === "sequential";
    document.getElementById("report-order-heading").classList.toggle("hidden", !seq);
    document.getElementById("report-order-list").classList.toggle("hidden", !seq);
    document.getElementById("report-order-free-hint").classList.toggle("hidden", seq);
  }

  function renderColoredPanel() {
    const trial = getCurrentTrial();
    const panel = document.getElementById("colored-nodes-panel");
    panel.innerHTML = "";
    const beliefs = trial.initialBeliefs || {};
    for (const nodeId of Object.keys(beliefs)) {
      const row = document.createElement("div");
      row.className = "colored-row";
      const [r, g, b] = beliefs[nodeId];
      row.innerHTML = `<span>${nodeId}: R=${r.toFixed(3)} G=${g.toFixed(3)} B=${b.toFixed(3)}</span>`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "移除";
      rm.addEventListener("click", () => {
        delete trial.initialBeliefs[nodeId];
        syncReportOrderFromUncolored(trial);
        renderColoredPanel();
        renderReportOrder();
        drawEditorCanvas();
      });
      row.appendChild(rm);
      panel.appendChild(row);
    }
  }

  function renderReportOrder() {
    const ul = document.getElementById("report-order-list");
    const trial = getCurrentTrial();
    ul.innerHTML = "";
    (trial.reportOrder || []).forEach((id, idx) => {
      const li = document.createElement("li");
      li.textContent = id;
      li.draggable = true;
      li.dataset.id = id;
      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(idx));
      });
      li.addEventListener("dragover", (e) => e.preventDefault());
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
        const to = idx;
        const arr = trial.reportOrder.slice();
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        trial.reportOrder = arr;
        renderReportOrder();
      });
      ul.appendChild(li);
    });
  }

  function drawEditorCanvas() {
    ensureIds();
    const trial = getCurrentTrial();
    const canvas = document.getElementById("editor-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = rgb(THEME.background);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const layout = layoutFromNodes(trial.nodes);
    const nodeIds = trial.nodes.map((n) => n.id);
    drawEdges(ctx, layout, trial.edges);
    const beliefs = trial.initialBeliefs || {};
    for (const n of trial.nodes) {
      const pos = layout[n.id];
      const b = beliefs[n.id] || null;
      drawNode(ctx, pos, b, true, false);
      const label = n.label != null ? String(n.label) : n.id;
      ctx.font = "14px sans-serif";
      ctx.fillStyle = rgb(THEME.black);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, pos[0], pos[1]);
    }
  }

  function drawEditorPicker() {
    const canvas = document.getElementById("editor-picker-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = rgb(THEME.background);
    ctx.fillRect(0, 0, w, h);
    if (!global._editorPicker) {
      global._editorPicker = new global.TriangleColorPicker(w / 2, h / 2 + 10, Math.min(w, h) * 0.38);
    }
    const picker = global._editorPicker;
    drawTrianglePicker(ctx, picker, 14);
    const el = document.getElementById("editor-rgb-readout");
    if (el) {
      const [r, g, b] = picker.getBelief();
      el.textContent = `R=${r.toFixed(4)}  G=${g.toFixed(4)}  B=${b.toFixed(4)}`;
    }
  }

  function addNodeAt(x, y) {
    ensureIds();
    const trial = getCurrentTrial();
    const id = `n${nextNodeId++}`;
    trial.nodes.push({ id, x, y, label: id });
    syncReportOrderFromUncolored(trial);
    renderReportOrder();
    drawEditorCanvas();
  }

  function addEdge(u, v) {
    if (u === v) return;
    const trial = getCurrentTrial();
    const has = trial.edges.some(
      ([a, b]) => (a === u && b === v) || (a === v && b === u)
    );
    if (!has) trial.edges.push([u, v]);
    drawEditorCanvas();
  }

  function initEditor() {
    stimulus = createEmptyStimulus();
    loadTrialToForm();
    renderTree();
    drawEditorPicker();

    const canvas = document.getElementById("editor-canvas");
    const pickCanvas = document.getElementById("editor-picker-canvas");

    canvas.addEventListener("mousedown", (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const mx = (e.clientX - rect.left) * sx;
      const my = (e.clientY - rect.top) * sy;
      const trial = getCurrentTrial();
      const layout = layoutFromNodes(trial.nodes);
      const nodeIds = trial.nodes.map((n) => n.id);
      const hit = findNodeAt(layout, nodeIds, mx, my);
      if (edgeMode) {
        if (hit) {
          if (pendingEdgeNode == null) {
            pendingEdgeNode = hit;
          } else {
            addEdge(pendingEdgeNode, hit);
            pendingEdgeNode = null;
          }
        }
        return;
      }
      if (hit) {
        dragState = { id: hit, lastX: mx, lastY: my };
      }
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!dragState) return;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const mx = (e.clientX - rect.left) * sx;
      const my = (e.clientY - rect.top) * sy;
      const trial = getCurrentTrial();
      const node = trial.nodes.find((n) => n.id === dragState.id);
      if (node) {
        node.x = mx;
        node.y = my;
      }
      drawEditorCanvas();
    });

    canvas.addEventListener("mouseup", () => {
      dragState = null;
    });
    canvas.addEventListener("mouseleave", () => {
      dragState = null;
    });

    pickCanvas.addEventListener("mousedown", (e) => {
      const rect = pickCanvas.getBoundingClientRect();
      const sx = pickCanvas.width / rect.width;
      const sy = pickCanvas.height / rect.height;
      const mx = (e.clientX - rect.left) * sx;
      const my = (e.clientY - rect.top) * sy;
      global._editorPicker.handleClick(mx, my);
      drawEditorPicker();
    });
    pickCanvas.addEventListener("mousemove", (e) => {
      if (e.buttons !== 1) return;
      const rect = pickCanvas.getBoundingClientRect();
      const sx = pickCanvas.width / rect.width;
      const sy = pickCanvas.height / rect.height;
      const mx = (e.clientX - rect.left) * sx;
      const my = (e.clientY - rect.top) * sy;
      global._editorPicker.handleClick(mx, my);
      drawEditorPicker();
    });

    document.getElementById("btn-add-node").addEventListener("click", () => {
      ensureIds();
      const trial = getCurrentTrial();
      const cx = stimulus.canvasWidth / 2;
      const cy = stimulus.canvasHeight / 2;
      addNodeAt(cx, cy);
    });

    document.getElementById("btn-edge-mode").addEventListener("click", () => {
      edgeMode = !edgeMode;
      pendingEdgeNode = null;
      document.body.classList.toggle("edge-mode", edgeMode);
    });

    document.getElementById("btn-clear-edges").addEventListener("click", () => {
      getCurrentTrial().edges = [];
      drawEditorCanvas();
    });

    document.getElementById("trial-graph-id").addEventListener("input", (e) => {
      getCurrentTrial().graphId = e.target.value.trim();
      renderTree();
    });

    document.getElementById("trial-order-mode").addEventListener("change", (e) => {
      getCurrentTrial().orderMode = e.target.value;
      syncReportOrderFromUncolored(getCurrentTrial());
      renderReportOrder();
      updateOrderUiVisibility();
    });

    document.getElementById("editor-stimulus-name").addEventListener("input", (e) => {
      stimulus.name = e.target.value.trim() || "stimulus-set";
    });

    function applyCanvasSize() {
      const w = parseInt(document.getElementById("editor-canvas-w").value, 10);
      const h = parseInt(document.getElementById("editor-canvas-h").value, 10);
      if (w >= 400 && h >= 300) {
        stimulus.canvasWidth = w;
        stimulus.canvasHeight = h;
        canvas.width = w;
        canvas.height = h;
        drawEditorCanvas();
      }
    }
    document.getElementById("editor-canvas-w").addEventListener("change", applyCanvasSize);
    document.getElementById("editor-canvas-h").addEventListener("change", applyCanvasSize);

    document.getElementById("btn-add-block").addEventListener("click", () => {
      const n = stimulus.blocks.length + 1;
      stimulus.blocks.push({ blockId: `b${n}`, trials: [createEmptyTrial()] });
      currentBlockIdx = stimulus.blocks.length - 1;
      currentTrialIdx = 0;
      loadTrialToForm();
      renderTree();
    });

    document.getElementById("btn-add-trial").addEventListener("click", () => {
      const block = stimulus.blocks[currentBlockIdx];
      const idx = block.trials.length + 1;
      const nt = {
        trialId: `t${idx}`,
        graphId: `g${idx}`,
        orderMode: "sequential",
        nodes: [],
        edges: [],
        initialBeliefs: {},
        reportOrder: [],
      };
      block.trials.push(nt);
      currentTrialIdx = block.trials.length - 1;
      loadTrialToForm();
      renderTree();
    });

    document.getElementById("btn-add-colored").addEventListener("click", () => {
      const id = window.prompt("节点 ID（须已存在）");
      if (!id || !id.trim()) return;
      const trial = getCurrentTrial();
      const node = trial.nodes.find((n) => n.id === id.trim());
      if (!node) {
        alert("找不到该节点");
        return;
      }
      const [r, g, b] = global._editorPicker.getBelief();
      trial.initialBeliefs[id.trim()] = [r, g, b];
      syncReportOrderFromUncolored(trial);
      renderColoredPanel();
      renderReportOrder();
      drawEditorCanvas();
    });

    document.getElementById("btn-export").addEventListener("click", () => {
      ensureIds();
      const text = JSON.stringify(stimulus, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${stimulus.name || "stimulus"}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    document.getElementById("btn-import").addEventListener("click", () => {
      document.getElementById("file-import").click();
    });
    document.getElementById("file-import").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          validateAndLoadStimulus(data);
          loadTrialToForm();
          renderTree();
        } catch (err) {
          alert("JSON 解析失败: " + err);
        }
      };
      reader.readAsText(f, "utf-8");
      e.target.value = "";
    });
  }

  function validateAndLoadStimulus(data) {
    if (!data || data.version !== 1) throw new Error("需要 version: 1");
    if (!Array.isArray(data.blocks)) throw new Error("缺少 blocks");
    let maxN = 0;
    for (const block of data.blocks) {
      if (!Array.isArray(block.trials)) throw new Error("block 缺少 trials");
      for (const trial of block.trials) {
        for (const n of trial.nodes || []) {
          const m = /^n(\d+)$/.exec(n.id);
          if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
        }
      }
    }
    nextNodeId = maxN + 1;
    stimulus = data;
    currentBlockIdx = 0;
    currentTrialIdx = 0;
  }

  global.EditorApp = {
    initEditor,
    getStimulus: () => stimulus,
  };
})(typeof window !== "undefined" ? window : globalThis);
