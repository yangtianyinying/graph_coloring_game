/**
 * jsPsych 7 runner: load stimulus JSON, sequential/free belief reporting, local download.
 */
import { initJsPsych } from "jspsych";
import htmlKeyboardResponse from "@jspsych/plugin-html-keyboard-response";
import callFunction from "@jspsych/plugin-call-function";

const { THEME, rgb } = window.GraphExperimentTheme;
const BASE_R = (window.GraphExperimentTheme.BASE_NODE && window.GraphExperimentTheme.BASE_NODE.nodeRadius) || 22;
const {
  drawNode,
  drawEdges,
  drawTrianglePicker,
  layoutFromNodes,
  findNodeAt,
} = window.GraphCanvasDraw;

function validateTrial(trial) {
  const ids = new Set(trial.nodes.map((n) => n.id));
  for (const [u, v] of trial.edges || []) {
    if (!ids.has(u) || !ids.has(v)) throw new Error(`边引用未知节点: ${u}-${v}`);
  }
  const colored = new Set(Object.keys(trial.initialBeliefs || {}));
  for (const id of colored) {
    if (!ids.has(id)) throw new Error(`initialBeliefs 含未知节点: ${id}`);
  }
  const uncolored = [...ids].filter((id) => !colored.has(id));
  if (trial.orderMode === "sequential") {
    const ro = trial.reportOrder || [];
    const setR = new Set(ro);
    if (ro.length !== uncolored.length || uncolored.some((id) => !setR.has(id))) {
      throw new Error("sequential 模式下 reportOrder 必须与未着色节点集合一致");
    }
  }
}

function buildContainer() {
  const wrap = document.createElement("div");
  wrap.className = "belief-trial-wrap";
  wrap.innerHTML = `
    <div class="belief-trial-inner">
      <div class="belief-graph-column">
        <canvas class="belief-graph-canvas"></canvas>
        <p class="belief-message"></p>
      </div>
      <div class="belief-picker-column">
        <canvas class="belief-picker-canvas" width="260" height="260"></canvas>
        <button type="button" class="belief-confirm">确认</button>
      </div>
    </div>
  `;
  const style = document.createElement("style");
  style.textContent = `
    .belief-trial-wrap { font-family: "Segoe UI","Microsoft YaHei",sans-serif; padding: 12px; }
    .belief-trial-inner { display: flex; flex-direction: row; flex-wrap: wrap; align-items: flex-start; gap: 20px; max-width: 100%; }
    .belief-graph-column { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
    .belief-graph-canvas { border: 1px solid #bbb; background: ${rgb(THEME.background)}; display: block; max-width: 100%; height: auto; }
    .belief-message { margin: 0; font-size: 15px; min-height: 2.5em; line-height: 1.45; }
    .belief-picker-column { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .belief-picker-canvas { cursor: pointer; border: 1px solid #ccc; display: block; border-radius: 8px; }
    .belief-confirm { padding: 10px 24px; font-size: 16px; cursor: pointer; width: 100%; max-width: 260px; box-sizing: border-box; }
    @media (max-width: 720px) {
      .belief-trial-inner { flex-direction: column; }
      .belief-picker-column { width: 100%; max-width: 100%; }
    }
  `;
  wrap.appendChild(style);
  return wrap;
}

function waitClick(el) {
  return new Promise((resolve) => {
    el.addEventListener("click", function handler() {
      el.removeEventListener("click", handler);
      resolve();
    });
  });
}

/**
 * 自由顺序：在画布上点未着色节点，或点「确认」。
 * 可多次点节点切换当前编辑对象；未确认则 beliefs 不会写入，节点保持空。
 */
function waitPickOrConfirm(graphCanvas, btn, layout, remainingSet) {
  return new Promise((resolve) => {
    function cleanup() {
      graphCanvas.removeEventListener("mousedown", onGraphDown);
      btn.removeEventListener("click", onConfirm);
    }
    function onGraphDown(e) {
      const rect = graphCanvas.getBoundingClientRect();
      const sx = graphCanvas.width / rect.width;
      const sy = graphCanvas.height / rect.height;
      const mx = (e.clientX - rect.left) * sx;
      const my = (e.clientY - rect.top) * sy;
      const hit = findNodeAt(layout, [...remainingSet], mx, my);
      if (hit) {
        cleanup();
        resolve({ type: "pick", node: hit });
      }
    }
    function onConfirm() {
      cleanup();
      resolve({ type: "confirm" });
    }
    graphCanvas.addEventListener("mousedown", onGraphDown);
    btn.addEventListener("click", onConfirm);
  });
}

async function runSingleTrial(stimulusDoc, trial, meta) {
  validateTrial(trial);
  const cw = stimulusDoc.canvasWidth || 960;
  const ch = stimulusDoc.canvasHeight || 620;
  const container = buildContainer();
  const graphCanvas = container.querySelector(".belief-graph-canvas");
  const pickerCanvas = container.querySelector(".belief-picker-canvas");
  const msgEl = container.querySelector(".belief-message");
  const btn = container.querySelector(".belief-confirm");
  graphCanvas.width = cw;
  graphCanvas.height = ch;

  const layout = layoutFromNodes(trial.nodes);
  const beliefs = { ...(trial.initialBeliefs || {}) };
  const nodeIds = trial.nodes.map((n) => n.id);
  const colored = new Set(Object.keys(trial.initialBeliefs || {}));
  const uncolored = nodeIds.filter((id) => !colored.has(id));
  let remaining = new Set(uncolored);
  const queue = trial.orderMode === "sequential" ? [...(trial.reportOrder || [])] : [];

  const picker = new window.TriangleColorPicker(
    pickerCanvas.width / 2,
    pickerCanvas.height / 2 + 8,
    Math.min(pickerCanvas.width, pickerCanvas.height) * 0.36
  );
  picker.setBelief(1 / 3, 1 / 3, 1 / 3);

  const rows = [];
  let focusedNode = null;
  /** 固定顺序：节点上仅显示报告顺序 1、2、3…（来自 reportOrder，与节点 id 无关） */
  const seqStepByNodeId = new Map();
  (trial.reportOrder || []).forEach((nid, i) => {
    seqStepByNodeId.set(nid, i + 1);
  });
  /** 自由顺序：已报告节点上显示 1、2、3…（当场填色顺序，非节点 id） */
  const freeFillOrder = {};
  let freeFillCounter = 0;

  function redraw(focused, liveBelief) {
    const ctx = graphCanvas.getContext("2d");
    ctx.fillStyle = rgb(THEME.background);
    ctx.fillRect(0, 0, graphCanvas.width, graphCanvas.height);
    drawEdges(ctx, layout, trial.edges);
    for (const n of trial.nodes) {
      const pos = layout[n.id];
      let b = beliefs[n.id] != null ? beliefs[n.id] : null;
      if (n.id === focused && remaining.has(n.id) && b == null && liveBelief) {
        b = liveBelief;
      }
      const isSel = remaining.has(n.id);
      const isFoc = n.id === focused;
      drawNode(ctx, pos, b, isSel, isFoc);
      const labelPx = Math.max(10, Math.min(18, Math.round(14 * (THEME.nodeRadius / BASE_R))));
      if (trial.orderMode === "sequential") {
        const step = seqStepByNodeId.get(n.id);
        if (step != null) {
          ctx.font = `bold ${labelPx}px sans-serif`;
          ctx.fillStyle = rgb(THEME.black);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(step), pos[0], pos[1]);
        }
      } else if (trial.orderMode === "free") {
        const ord = freeFillOrder[n.id];
        if (ord != null) {
          ctx.font = `bold ${labelPx}px sans-serif`;
          ctx.fillStyle = rgb(THEME.black);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(ord), pos[0], pos[1]);
        }
      }
    }
    const pctx = pickerCanvas.getContext("2d");
    pctx.fillStyle = rgb(THEME.background);
    pctx.fillRect(0, 0, pickerCanvas.width, pickerCanvas.height);
    const triFont = Math.max(10, Math.min(18, Math.round(14 * (THEME.nodeRadius / BASE_R))));
    drawTrianglePicker(pctx, picker, triFont);
  }

  function setMessage(text) {
    msgEl.textContent = text;
  }

  pickerCanvas.addEventListener("mousedown", (e) => {
    const rect = pickerCanvas.getBoundingClientRect();
    const sx = pickerCanvas.width / rect.width;
    const sy = pickerCanvas.height / rect.height;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * sy;
    picker.handleClick(mx, my);
    redraw(focusedNode, picker.getBelief());
  });
  pickerCanvas.addEventListener("mousemove", (e) => {
    if (e.buttons !== 1) return;
    const rect = pickerCanvas.getBoundingClientRect();
    const sx = pickerCanvas.width / rect.width;
    const sy = pickerCanvas.height / rect.height;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * sy;
    picker.handleClick(mx, my);
    redraw(focusedNode, picker.getBelief());
  });

  const mount = document.getElementById("jspsych-target");
  mount.innerHTML = "";
  mount.appendChild(container);

  try {
    while (remaining.size > 0) {
      if (trial.orderMode === "sequential") {
        focusedNode = queue[0];
        picker.setBelief(1 / 3, 1 / 3, 1 / 3);
        const stepNow = seqStepByNodeId.get(focusedNode) ?? queue.length;
        setMessage(
          `请按顺序报告标号为 ${stepNow} 的节点。调节三角盘并点击确认。（图上数字为报告顺序，非节点名称）`
        );
        redraw(focusedNode, picker.getBelief());

        const onsetMs = Math.round(performance.now());
        await waitClick(btn);
        const offsetMs = Math.round(performance.now());
        const [r, g, b] = picker.getBelief();

        if (focusedNode !== queue[0]) {
          const should = queue[0];
          const stepShould = seqStepByNodeId.get(should) ?? "?";
          setMessage(`顺序错误，当前应报告标号为 ${stepShould} 的节点。`);
          continue;
        }

        beliefs[focusedNode] = [r, g, b];
        rows.push({
          ...meta,
          step_index: rows.length + 1,
          chosen_node: focusedNode,
          belief_red: r,
          belief_green: g,
          belief_blue: b,
          onset_ms: onsetMs,
          offset_ms: offsetMs,
          RT_ms: offsetMs - onsetMs,
        });
        remaining.delete(focusedNode);
        queue.shift();
        focusedNode = null;
      } else {
        focusedNode = null;
        picker.setBelief(1 / 3, 1 / 3, 1 / 3);
        setMessage(
          "请点击未着色节点，调节三角盘后点确认。可直接点击另一未着色节点切换；未确认的节点保持为空。"
        );
        redraw(null, null);
        let selectionTime = Math.round(performance.now());

        for (;;) {
          const ev = await waitPickOrConfirm(graphCanvas, btn, layout, remaining);
          if (ev.type === "pick") {
            focusedNode = ev.node;
            picker.setBelief(1 / 3, 1 / 3, 1 / 3);
            selectionTime = Math.round(performance.now());
            setMessage(
              "已选节点。调节三角盘后点确认；或点击其他未着色节点切换（切换后前一节点仍为空）。"
            );
            redraw(focusedNode, picker.getBelief());
            continue;
          }

          const [r, g, b] = picker.getBelief();
          if (!focusedNode || !remaining.has(focusedNode)) {
            setMessage("请先点击一个未着色节点，再点确认。");
            continue;
          }

          const onsetMs = selectionTime;
          const offsetMs = Math.round(performance.now());

          beliefs[focusedNode] = [r, g, b];
          freeFillCounter += 1;
          freeFillOrder[focusedNode] = freeFillCounter;
          rows.push({
            ...meta,
            step_index: rows.length + 1,
            chosen_node: focusedNode,
            belief_red: r,
            belief_green: g,
            belief_blue: b,
            onset_ms: onsetMs,
            offset_ms: offsetMs,
            RT_ms: offsetMs - onsetMs,
          });
          remaining.delete(focusedNode);
          focusedNode = null;
          break;
        }
      }
    }
  } finally {
    mount.innerHTML = "";
  }

  return rows;
}

async function runAllTrials(stimulus, participantId) {
  const runScaleEl = document.getElementById("run-node-scale");
  let scale = runScaleEl && runScaleEl.value !== "" ? parseFloat(runScaleEl.value) : NaN;
  if (Number.isNaN(scale)) {
    scale =
      typeof stimulus.nodeVisualScale === "number" && stimulus.nodeVisualScale > 0
        ? stimulus.nodeVisualScale
        : 0.88;
  }
  window.GraphExperimentTheme.setNodeVisualScale(scale);

  const allRows = [];
  let trialGlobal = 0;
  for (let bi = 0; bi < stimulus.blocks.length; bi++) {
    const block = stimulus.blocks[bi];
    for (let ti = 0; ti < block.trials.length; ti++) {
      trialGlobal += 1;
      const trial = block.trials[ti];
      validateTrial(trial);
      const meta = {
        participant: participantId,
        stimulus_name: stimulus.name || "",
        block_index: bi + 1,
        block_id: block.blockId,
        trial_in_block: ti + 1,
        trial_global: trialGlobal,
        graph_id: trial.graphId,
        order_mode: trial.orderMode,
      };
      const rows = await runSingleTrial(stimulus, trial, meta);
      for (const r of rows) {
        allRows.push(r);
      }
    }
  }
  return allRows;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadCsv(filename, rows) {
  if (!rows.length) {
    downloadJson(filename.replace(/\.csv$/, ".json"), []);
    return;
  }
  const keys = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [keys.join(",")];
  for (const r of rows) {
    lines.push(keys.map((k) => esc(r[k])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function startExperimentFromUi() {
  const pid = (document.getElementById("run-participant").value || "").trim() || "anonymous";
  const fileInput = document.getElementById("run-stimulus-file");
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    alert("请先选择刺激集 JSON 文件");
    return;
  }
  const text = await file.text();
  let stimulus;
  try {
    stimulus = JSON.parse(text);
  } catch (e) {
    alert("JSON 解析失败: " + e);
    return;
  }
  if (!stimulus || stimulus.version !== 1) {
    alert("需要 version: 1 的刺激集");
    return;
  }

  if (typeof stimulus.nodeVisualScale === "number" && stimulus.nodeVisualScale > 0) {
    const s = String(stimulus.nodeVisualScale);
    const rs = document.getElementById("run-node-scale");
    const es = document.getElementById("editor-node-scale");
    if (rs) rs.value = s;
    if (es) es.value = s;
    localStorage.setItem("graphNodeVisualScale", s);
    window.GraphExperimentTheme.setNodeVisualScale(stimulus.nodeVisualScale);
    const pct = Math.round(stimulus.nodeVisualScale * 100);
    const v1 = document.getElementById("editor-node-scale-val");
    const v2 = document.getElementById("run-node-scale-val");
    if (v1) v1.textContent = `${pct}%`;
    if (v2) v2.textContent = `${pct}%`;
    if (window.EditorApp && window.EditorApp.refreshEditorView) {
      window.EditorApp.refreshEditorView();
    }
  }

  const jsPsych = initJsPsych({
    display_element: document.getElementById("jspsych-target"),
    on_finish: function () {
      try {
        jsPsych.data.get().localSave("json", `graph_coloring_${pid}_jspsych.json`);
      } catch (e) {
        console.warn(e);
      }
    },
  });

  const timeline = [
    {
      type: htmlKeyboardResponse,
      stimulus:
        "<p>图着色信念任务：请按空格继续。</p><p>自定顺序图：按图上数字 1、2、3… 的顺序逐点报告（数字表示报告顺序，与节点后台 id 无关）。自由顺序图：点节点后调三角盘再确认；已报告节点显示当场填色顺序 1、2、3…；文字提示不暴露节点 id。</p>",
      choices: [" "],
    },
    {
      type: callFunction,
      async: true,
      func: async function () {
        const rows = await runAllTrials(stimulus, pid);
        downloadCsv(`graph_coloring_${pid}.csv`, rows);
        downloadJson(`graph_coloring_${pid}.json`, { participant: pid, stimulus, rows });
      },
    },
    {
      type: htmlKeyboardResponse,
      stimulus: "<p>实验结束。数据应已下载。按任意键关闭。</p>",
      choices: "ALL_KEYS",
      response_ends_trial: true,
    },
  ];

  await jsPsych.run(timeline);
}

document.getElementById("btn-start-exp").addEventListener("click", () => {
  startExperimentFromUi().catch((e) => {
    console.error(e);
    alert(String(e));
  });
});

document.getElementById("run-stimulus-file").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  const st = document.getElementById("run-stimulus-status");
  if (f) st.textContent = `已选择: ${f.name}`;
  else st.textContent = "请先选择刺激集 JSON 文件";
});
