/**
 * jsPsych 7 runner: load stimulus JSON, sequential/free belief reporting, local download.
 */
import { initJsPsych } from "jspsych";
import htmlKeyboardResponse from "@jspsych/plugin-html-keyboard-response";
import callFunction from "@jspsych/plugin-call-function";

const { THEME, rgb } = window.GraphExperimentTheme;
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
      <canvas class="belief-graph-canvas"></canvas>
      <div class="belief-side">
        <p class="belief-message"></p>
        <canvas class="belief-picker-canvas" width="280" height="280"></canvas>
        <button type="button" class="belief-confirm">确认</button>
      </div>
    </div>
  `;
  const style = document.createElement("style");
  style.textContent = `
    .belief-trial-wrap { font-family: "Segoe UI","Microsoft YaHei",sans-serif; padding: 16px; }
    .belief-trial-inner { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
    .belief-graph-canvas { border: 1px solid #bbb; background: ${rgb(THEME.background)}; display: block; max-width: 100%; }
    .belief-side { min-width: 280px; }
    .belief-message { min-height: 2.5em; font-size: 15px; }
    .belief-picker-canvas { cursor: pointer; border: 1px solid #ccc; display: block; }
    .belief-confirm { margin-top: 12px; padding: 10px 24px; font-size: 16px; cursor: pointer; }
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
    pickerCanvas.height / 2 + 10,
    Math.min(pickerCanvas.width, pickerCanvas.height) * 0.38
  );
  picker.setBelief(1 / 3, 1 / 3, 1 / 3);

  const rows = [];
  let focusedNode = null;

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
      const label = n.label != null ? String(n.label) : n.id;
      ctx.font = "14px sans-serif";
      ctx.fillStyle = rgb(THEME.black);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, pos[0], pos[1]);
    }
    const pctx = pickerCanvas.getContext("2d");
    pctx.fillStyle = rgb(THEME.background);
    pctx.fillRect(0, 0, pickerCanvas.width, pickerCanvas.height);
    drawTrianglePicker(pctx, picker, 14);
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
        setMessage(`按顺序报告节点：${focusedNode}。调节三角盘并点击确认。`);
        redraw(focusedNode, picker.getBelief());

        const onsetMs = Math.round(performance.now());
        await waitClick(btn);
        const offsetMs = Math.round(performance.now());
        const [r, g, b] = picker.getBelief();

        if (focusedNode !== queue[0]) {
          setMessage(`顺序错误，当前应为：${queue[0]}`);
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
              `已选 ${focusedNode}。调节三角盘后点确认；或点击其他未着色节点切换（切换后前一节点仍为空）。`
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
        "<p>图着色信念任务：请按空格继续。</p><p>自定顺序图：按给定顺序逐点报告。自由顺序图：点击节点调节三角盘后点确认；可在确认前点击另一节点切换，未确认的节点保持为空。</p>",
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
