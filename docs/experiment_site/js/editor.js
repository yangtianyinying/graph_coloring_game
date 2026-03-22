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

  /** 当前 Trial 内独立编号：优先使用 A–Z 中尚未占用的字母，超过 26 个则用 N2、N3… 避免与单字母冲突 */
  function allocNextLetterId(trial) {
    const used = new Set((trial.nodes || []).map((n) => n.id));
    for (let i = 0; i < 26; i++) {
      const id = String.fromCharCode(65 + i);
      if (!used.has(id)) return id;
    }
    let k = 2;
    for (;;) {
      const id = `N${k}`;
      if (!used.has(id)) return id;
      k++;
    }
  }

  /** 与 alloc 一致：第 i 个节点（从 0 起）对应的字母 id */
  function sequentialLetterIds(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      if (i < 26) out.push(String.fromCharCode(65 + i));
      else out.push(`N${i - 26 + 2}`);
    }
    return out;
  }

  /**
   * 应用初始信念后：将「刚着色」的节点移到 trial.nodes 最前，并整体重编号为 A、B、C…
   * （旧 B 着色后变为 A，其余按原相对顺序顺延为 B、C…）
   * @returns {Object<string,string>} oldId -> newId
   */
  function renumberTrialNodesAfterApplyBelief(trial, chosenId) {
    const nodes = trial.nodes;
    if (!nodes.length) return {};
    const idx = nodes.findIndex((n) => n.id === chosenId);
    if (idx < 0) return {};
    const chosen = nodes[idx];
    const others = nodes.filter((_, i) => i !== idx);
    trial.nodes = [chosen, ...others];

    const oldIds = trial.nodes.map((n) => n.id);
    const newIds = sequentialLetterIds(oldIds.length);
    const map = {};
    for (let i = 0; i < oldIds.length; i++) map[oldIds[i]] = newIds[i];

    for (const n of trial.nodes) {
      n.id = map[n.id];
      n.label = n.id;
    }
    trial.edges = (trial.edges || []).map(([u, v]) => [map[u], map[v]]);
    const ib = trial.initialBeliefs || {};
    const nb = {};
    for (const [k, v] of Object.entries(ib)) {
      const nk = map[k];
      if (nk != null) nb[nk] = v;
    }
    trial.initialBeliefs = nb;
    trial.reportOrder = (trial.reportOrder || []).map((rid) => map[rid]).filter((x) => x != null);
    return map;
  }

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

  /** 节点 id 顺序与矩阵行列一致 */
  function edgesToMatrixLines(nodeIds, edges) {
    const n = nodeIds.length;
    const adj = Array.from({ length: n }, () => Array(n).fill(0));
    for (const [u, v] of edges || []) {
      const i = nodeIds.indexOf(u);
      const j = nodeIds.indexOf(v);
      if (i >= 0 && j >= 0 && i !== j) {
        adj[i][j] = 1;
        adj[j][i] = 1;
      }
    }
    return adj.map((row) => row.join(" ")).join("\n");
  }

  function parseAdjacencyMatrix(text, nodeIds) {
    const n = nodeIds.length;
    if (n === 0) throw new Error("请先添加节点");
    const lines = [];
    for (const line of text.split(/\n/)) {
      const cut = line.split("#")[0].trim();
      if (cut.length) lines.push(cut);
    }
    if (lines.length === 0) throw new Error("矩阵为空");
    if (lines.length !== n) throw new Error(`矩阵应为 ${n} 行（与节点数相同），当前为 ${lines.length} 行`);
    const rows = lines.map((line) =>
      line.split(/[\s,]+/).filter((x) => x !== "").map((x) => parseInt(x, 10))
    );
    const edges = [];
    for (let i = 0; i < n; i++) {
      if (rows[i].length !== n) throw new Error(`第 ${i + 1} 行应有 ${n} 个数`);
      for (let j = 0; j < n; j++) {
        const v = rows[i][j];
        if (v !== 0 && v !== 1) throw new Error(`第 ${i + 1} 行第 ${j + 1} 列须为 0 或 1`);
      }
      if (rows[i][i] !== 0) throw new Error("对角线须全为 0");
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rows[i][j] !== rows[j][i]) throw new Error("矩阵须对称（无向图）");
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rows[i][j] === 1) edges.push([nodeIds[i], nodeIds[j]]);
      }
    }
    return edges;
  }

  function updateNodeOrderHint() {
    const el = document.getElementById("editor-node-order-hint");
    if (!el) return;
    const trial = getCurrentTrial();
    const ids = trial.nodes.map((n) => n.id);
    el.textContent = ids.length
      ? `矩阵行列顺序：${ids.join(" → ")}`
      : "（请先添加节点再填矩阵）";
  }

  function syncBeliefNodeSelect(preferredId) {
    const trial = getCurrentTrial();
    const sel = document.getElementById("editor-belief-node");
    if (!sel) return;
    const prev = sel.value;
    const ids = trial.nodes.map((n) => n.id);
    sel.innerHTML = '<option value="">— 请选择 —</option>';
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    }
    const pick =
      preferredId != null && preferredId !== "" && ids.includes(preferredId)
        ? preferredId
        : ids.includes(prev)
          ? prev
          : ids[0] || "";
    sel.value = pick;
  }

  function loadPickerFromBeliefSelect() {
    if (!global._editorPicker) return;
    const trial = getCurrentTrial();
    const sel = document.getElementById("editor-belief-node");
    const id = sel && sel.value;
    if (id && trial.initialBeliefs && trial.initialBeliefs[id]) {
      const [r, g, b] = trial.initialBeliefs[id];
      global._editorPicker.setBelief(r, g, b);
    } else {
      global._editorPicker.setBelief(1 / 3, 1 / 3, 1 / 3);
    }
    drawEditorPicker();
  }

  function syncAdjMatrixTextareaFromEdges() {
    const ta = document.getElementById("editor-adj-matrix");
    if (!ta) return;
    const trial = getCurrentTrial();
    const ids = trial.nodes.map((n) => n.id);
    ta.value = edgesToMatrixLines(ids, trial.edges);
  }

  function normalizeRGB(r, g, b) {
    const s = Math.max(r + g + b, 1e-9);
    return [r / s, g / s, b / s];
  }

  /** 解析一行如 R=0.33 G=0.33 B=0.34（大小写不敏感，可含空格） */
  function parseRgbLine(text) {
    const tr = text.trim();
    if (!tr) return null;
    const num = "([-+]?[0-9]*\\.?[0-9]+(?:e[-+]?[0-9]+)?)";
    const rM = new RegExp(`R\\s*=\\s*${num}`, "i").exec(tr);
    const gM = new RegExp(`G\\s*=\\s*${num}`, "i").exec(tr);
    const bM = new RegExp(`B\\s*=\\s*${num}`, "i").exec(tr);
    if (rM && gM && bM) {
      return normalizeRGB(parseFloat(rM[1]), parseFloat(gM[1]), parseFloat(bM[1]));
    }
    return null;
  }

  function syncRgbInputsFromPicker() {
    const picker = global._editorPicker;
    if (!picker) return;
    const [r, g, b] = picker.getBelief();
    const set = (id, v) => {
      const inp = document.getElementById(id);
      if (inp) inp.value = String(Number(v.toFixed(6)));
    };
    set("editor-belief-r", r);
    set("editor-belief-g", g);
    set("editor-belief-b", b);
  }

  function syncBeliefRgbLineFromPicker() {
    const line = document.getElementById("editor-belief-rgb-line");
    if (!line || !global._editorPicker) return;
    const [r, g, b] = global._editorPicker.getBelief();
    line.value = `R=${r.toFixed(4)} G=${g.toFixed(4)} B=${b.toFixed(4)}`;
  }

  function applyRgbInputsToPicker() {
    if (!global._editorPicker) return;
    const r = parseFloat(document.getElementById("editor-belief-r").value);
    const g = parseFloat(document.getElementById("editor-belief-g").value);
    const b = parseFloat(document.getElementById("editor-belief-b").value);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return;
    const [nr, ng, nb] = normalizeRGB(r, g, b);
    global._editorPicker.setBelief(nr, ng, nb);
    drawEditorPicker();
  }

  function clearBlockTreeDragOver() {
    document.querySelectorAll(".block-tree-drag-over").forEach((n) => n.classList.remove("block-tree-drag-over"));
  }

  /**
   * 将 Trial 从 (fromBi,fromTi) 移到 toBi 的 insertTi（插入到该下标之前；末尾用 length）。
   */
  function moveTrial(fromBi, fromTi, toBi, insertTi) {
    ensureIds();
    const blocks = stimulus.blocks;
    if (fromBi < 0 || fromBi >= blocks.length) return;
    if (toBi < 0 || toBi >= blocks.length) return;
    const fromBlock = blocks[fromBi];
    if (fromTi < 0 || fromTi >= fromBlock.trials.length) return;
    const viewTrial = getCurrentTrial();
    const [trial] = fromBlock.trials.splice(fromTi, 1);
    if (fromBi === toBi && fromTi < insertTi) insertTi--;
    blocks[toBi].trials.splice(insertTi, 0, trial);
    stimulus.blocks.forEach((b, bi) => {
      b.trials.forEach((tr, ti) => {
        if (tr === viewTrial) {
          currentBlockIdx = bi;
          currentTrialIdx = ti;
        }
      });
    });
    loadTrialToForm();
    renderTree();
  }

  function readDragPayload(e) {
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    const plain = e.dataTransfer.getData("text/plain");
    if (plain) {
      const [a, b] = plain.split(",").map((x) => parseInt(x, 10));
      if (!Number.isNaN(a) && !Number.isNaN(b)) return { fromBi: a, fromTi: b };
    }
    return null;
  }

  function renderTree() {
    const el = document.getElementById("block-trial-tree");
    if (!el) return;
    el.innerHTML = "";
    stimulus.blocks.forEach((block, bi) => {
      const blockWrap = document.createElement("div");
      blockWrap.className = "block-tree-block";
      blockWrap.dataset.bi = String(bi);

      const head = document.createElement("div");
      head.className = "block-tree-head block-tree-drop-target";
      head.textContent = `Block ${bi + 1} (${block.blockId}) — 拖至标题可置顶`;
      head.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      head.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const p = readDragPayload(e);
        if (!p) return;
        if (p.fromBi === bi && p.fromTi === 0) return;
        moveTrial(p.fromBi, p.fromTi, bi, 0);
      });

      const trialsWrap = document.createElement("div");
      trialsWrap.className = "block-tree-trials";

      block.trials.forEach((trialObj, ti) => {
        const t = document.createElement("div");
        t.className =
          "trial-item" + (bi === currentBlockIdx && ti === currentTrialIdx ? " current" : "");
        t.draggable = true;
        t.textContent = `Trial ${ti + 1}: ${trialObj.graphId}`;
        t.dataset.bi = String(bi);
        t.dataset.ti = String(ti);
        t.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("application/json", JSON.stringify({ fromBi: bi, fromTi: ti }));
          e.dataTransfer.setData("text/plain", `${bi},${ti}`);
          e.dataTransfer.effectAllowed = "move";
        });
        t.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        });
        t.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const p = readDragPayload(e);
          if (!p) return;
          if (p.fromBi === bi && p.fromTi === ti) return;
          moveTrial(p.fromBi, p.fromTi, bi, ti);
        });
        t.addEventListener("click", () => {
          currentBlockIdx = bi;
          currentTrialIdx = ti;
          loadTrialToForm();
          renderTree();
        });
        trialsWrap.appendChild(t);
      });

      const dropEnd = document.createElement("div");
      dropEnd.className = "block-tree-drop-end";
      dropEnd.textContent = "拖至此处 → 追加到本 Block 末尾";
      dropEnd.dataset.bi = String(bi);
      dropEnd.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        dropEnd.classList.add("block-tree-drag-over");
      });
      dropEnd.addEventListener("dragleave", (e) => {
        if (!dropEnd.contains(e.relatedTarget)) dropEnd.classList.remove("block-tree-drag-over");
      });
      dropEnd.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropEnd.classList.remove("block-tree-drag-over");
        const p = readDragPayload(e);
        if (!p) return;
        const insertTi = stimulus.blocks[bi].trials.length;
        if (p.fromBi === bi && p.fromTi === insertTi - 1) return;
        moveTrial(p.fromBi, p.fromTi, bi, insertTi);
      });

      blockWrap.addEventListener("dragover", (e) => {
        if (e.target.closest(".trial-item") || e.target.closest(".block-tree-drop-end")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        blockWrap.classList.add("block-tree-drag-over");
      });
      blockWrap.addEventListener("dragleave", (e) => {
        if (!blockWrap.contains(e.relatedTarget)) blockWrap.classList.remove("block-tree-drag-over");
      });
      blockWrap.addEventListener("drop", (e) => {
        if (e.target.closest(".trial-item") || e.target.closest(".block-tree-drop-end")) return;
        e.preventDefault();
        blockWrap.classList.remove("block-tree-drag-over");
        const p = readDragPayload(e);
        if (!p) return;
        moveTrial(p.fromBi, p.fromTi, bi, stimulus.blocks[bi].trials.length);
      });

      blockWrap.appendChild(head);
      blockWrap.appendChild(trialsWrap);
      blockWrap.appendChild(dropEnd);
      el.appendChild(blockWrap);
    });
  }

  function loadTrialToForm() {
    ensureIds();
    const trial = getCurrentTrial();
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
    syncBeliefNodeSelect();
    loadPickerFromBeliefSelect();
    syncAdjMatrixTextareaFromEdges();
    updateNodeOrderHint();
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
    const ids = Object.keys(beliefs);
    if (ids.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "（尚无着色节点）";
      panel.appendChild(p);
      return;
    }
    for (const nodeId of ids) {
      const row = document.createElement("div");
      row.className = "colored-row";
      const [r, g, b] = beliefs[nodeId];
      const info = document.createElement("span");
      info.textContent = `${nodeId}: R=${r.toFixed(3)} G=${g.toFixed(3)} B=${b.toFixed(3)}`;
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "colored-btn-load";
      loadBtn.textContent = "载入";
      loadBtn.title = "载入到上方下拉框与三角盘，可继续修改";
      loadBtn.addEventListener("click", () => {
        const sel = document.getElementById("editor-belief-node");
        if (sel) sel.value = nodeId;
        loadPickerFromBeliefSelect();
      });
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "colored-btn-remove";
      rm.textContent = "移除";
      rm.addEventListener("click", () => {
        delete trial.initialBeliefs[nodeId];
        syncReportOrderFromUncolored(trial);
        syncBeliefNodeSelect();
        loadPickerFromBeliefSelect();
        renderColoredPanel();
        renderReportOrder();
        drawEditorCanvas();
      });
      row.appendChild(info);
      row.appendChild(loadBtn);
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
      const br = (global.GraphExperimentTheme.BASE_NODE && global.GraphExperimentTheme.BASE_NODE.nodeRadius) || 22;
      const lf = Math.max(10, Math.min(18, Math.round(14 * (THEME.nodeRadius / br))));
      ctx.font = `${lf}px sans-serif`;
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
    const br = (global.GraphExperimentTheme.BASE_NODE && global.GraphExperimentTheme.BASE_NODE.nodeRadius) || 22;
    const fontPx = Math.max(10, Math.min(18, Math.round(14 * (THEME.nodeRadius / br))));
    drawTrianglePicker(ctx, picker, fontPx);
    const el = document.getElementById("editor-rgb-readout");
    if (el) {
      const [r, g, b] = picker.getBelief();
      el.textContent = `R=${r.toFixed(4)}  G=${g.toFixed(4)}  B=${b.toFixed(4)}`;
    }
    syncRgbInputsFromPicker();
    syncBeliefRgbLineFromPicker();
  }

  function addNodeAt(x, y) {
    ensureIds();
    const trial = getCurrentTrial();
    const id = allocNextLetterId(trial);
    trial.nodes.push({ id, x, y, label: id });
    syncReportOrderFromUncolored(trial);
    syncBeliefNodeSelect();
    loadPickerFromBeliefSelect();
    syncAdjMatrixTextareaFromEdges();
    updateNodeOrderHint();
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
    syncAdjMatrixTextareaFromEdges();
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
      syncAdjMatrixTextareaFromEdges();
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

    document.getElementById("btn-duplicate-trial").addEventListener("click", () => {
      ensureIds();
      const block = stimulus.blocks[currentBlockIdx];
      const src = getCurrentTrial();
      const copy = JSON.parse(JSON.stringify(src));
      const n = block.trials.length + 1;
      copy.trialId = `t${n}`;
      const base = src.graphId && String(src.graphId).trim() ? String(src.graphId).trim() : "g";
      copy.graphId = `${base}_copy`;
      block.trials.push(copy);
      currentTrialIdx = block.trials.length - 1;
      loadTrialToForm();
      renderTree();
    });

    document.addEventListener("dragend", clearBlockTreeDragOver);

    ["editor-belief-r", "editor-belief-g", "editor-belief-b"].forEach((rid) => {
      const inp = document.getElementById(rid);
      if (inp) inp.addEventListener("input", applyRgbInputsToPicker);
    });

    document.getElementById("btn-parse-rgb-line").addEventListener("click", () => {
      const lineEl = document.getElementById("editor-belief-rgb-line");
      const parsed = parseRgbLine(lineEl && lineEl.value);
      if (!parsed) {
        alert("无法解析。请使用一行：R=0.33 G=0.33 B=0.34（字母与数字之间可有空格，大小写不敏感）");
        return;
      }
      global._editorPicker.setBelief(parsed[0], parsed[1], parsed[2]);
      drawEditorPicker();
    });

    document.getElementById("editor-belief-node").addEventListener("change", () => {
      loadPickerFromBeliefSelect();
    });

    document.getElementById("btn-apply-belief").addEventListener("click", () => {
      const sel = document.getElementById("editor-belief-node");
      const id = sel && sel.value;
      if (!id) {
        alert("请先在「选择节点」下拉框中选一个节点");
        return;
      }
      const trial = getCurrentTrial();
      if (!trial.nodes.some((n) => n.id === id)) {
        alert("该节点已不存在，请重新选择");
        syncBeliefNodeSelect();
        return;
      }
      if (!trial.initialBeliefs) trial.initialBeliefs = {};
      const [r, g, b] = global._editorPicker.getBelief();
      const chosenId = id;
      trial.initialBeliefs[chosenId] = [r, g, b];
      const idMap = renumberTrialNodesAfterApplyBelief(trial, chosenId);
      const newChosen = idMap[chosenId] != null ? idMap[chosenId] : chosenId;
      syncReportOrderFromUncolored(trial);
      syncBeliefNodeSelect(newChosen);
      syncAdjMatrixTextareaFromEdges();
      updateNodeOrderHint();
      renderColoredPanel();
      renderReportOrder();
      drawEditorCanvas();
    });

    document.getElementById("btn-apply-adj-matrix").addEventListener("click", () => {
      try {
        const trial = getCurrentTrial();
        const nodeIds = trial.nodes.map((n) => n.id);
        const text = document.getElementById("editor-adj-matrix").value;
        trial.edges = parseAdjacencyMatrix(text, nodeIds);
        drawEditorCanvas();
        syncAdjMatrixTextareaFromEdges();
      } catch (err) {
        alert(String(err.message || err));
      }
    });

    document.getElementById("btn-fill-matrix-from-edges").addEventListener("click", () => {
      syncAdjMatrixTextareaFromEdges();
    });

    document.getElementById("btn-export").addEventListener("click", () => {
      ensureIds();
      const sc = document.getElementById("editor-node-scale");
      if (sc) {
        const v = parseFloat(sc.value);
        if (!Number.isNaN(v)) stimulus.nodeVisualScale = v;
      }
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
          if (typeof data.nodeVisualScale === "number" && data.nodeVisualScale > 0) {
            const s = String(data.nodeVisualScale);
            const es = document.getElementById("editor-node-scale");
            const rs = document.getElementById("run-node-scale");
            if (es) es.value = s;
            if (rs) rs.value = s;
            localStorage.setItem("graphNodeVisualScale", s);
            window.GraphExperimentTheme.setNodeVisualScale(data.nodeVisualScale);
            const pct = Math.round(data.nodeVisualScale * 100);
            const v1 = document.getElementById("editor-node-scale-val");
            const v2 = document.getElementById("run-node-scale-val");
            if (v1) v1.textContent = `${pct}%`;
            if (v2) v2.textContent = `${pct}%`;
          }
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
    for (const block of data.blocks) {
      if (!Array.isArray(block.trials)) throw new Error("block 缺少 trials");
    }
    stimulus = data;
    currentBlockIdx = 0;
    currentTrialIdx = 0;
  }

  global.EditorApp = {
    initEditor,
    getStimulus: () => stimulus,
    refreshEditorView: () => {
      drawEditorCanvas();
      drawEditorPicker();
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
