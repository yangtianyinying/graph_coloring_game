/**
 * Canvas drawing for graph nodes and triangle picker — ported from belief_query_pygame/ui/renderer.py
 */
(function (global) {
  const { THEME, rgb } = global.GraphExperimentTheme;
  const REF_R = (global.GraphExperimentTheme.BASE_NODE && global.GraphExperimentTheme.BASE_NODE.nodeRadius) || 22;

  function nodeSizeRatio() {
    return THEME.nodeRadius / REF_R;
  }

  function mixRgb(belief) {
    let [r, g, b] = belief;
    const s = Math.max(r + g + b, 1e-9);
    r /= s;
    g /= s;
    b /= s;
    return [Math.round(255 * r), Math.round(255 * g), Math.round(255 * b)];
  }

  function drawNode(ctx, center, belief, isSelectable, isFocus) {
    const [x, y] = center;
    const outerR = THEME.nodeRadius + THEME.ringWidth;
    if (!belief) {
      ctx.beginPath();
      ctx.arc(x, y, outerR, 0, Math.PI * 2);
      ctx.fillStyle = rgb(THEME.unqueried);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, THEME.nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = rgb(THEME.background);
      ctx.fill();
    } else {
      let startRad = (-90 * Math.PI) / 180;
      const colors = [THEME.red, THEME.green, THEME.blue];
      for (let i = 0; i < 3; i++) {
        const p = belief[i];
        const endRad = startRad + p * 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(x, y, outerR, startRad, endRad);
        ctx.strokeStyle = rgb(colors[i]);
        ctx.lineWidth = THEME.ringWidth;
        ctx.stroke();
        startRad = endRad;
      }
      const [mr, mg, mb] = mixRgb(belief);
      ctx.beginPath();
      ctx.arc(x, y, THEME.nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, THEME.nodeRadius, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(THEME.black);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(THEME.black);
    ctx.lineWidth = 2;
    ctx.stroke();
    const sr = nodeSizeRatio();
    if (isSelectable) {
      ctx.beginPath();
      ctx.arc(x, y, outerR + Math.max(3, Math.round(6 * sr)), 0, Math.PI * 2);
      ctx.strokeStyle = rgb(THEME.selectable);
      ctx.lineWidth = Math.max(2, Math.round(3 * sr));
      ctx.stroke();
    }
    if (isFocus) {
      ctx.beginPath();
      ctx.arc(x, y, outerR + Math.max(4, Math.round(12 * sr)), 0, Math.PI * 2);
      ctx.strokeStyle = "rgb(255, 150, 0)";
      ctx.lineWidth = Math.max(2, Math.round(4 * sr));
      ctx.stroke();
    }
  }

  function drawEdges(ctx, layout, edges) {
    ctx.strokeStyle = rgb(THEME.gray);
    ctx.lineWidth = Math.max(2, Math.round(4 * nodeSizeRatio()));
    ctx.lineCap = "round";
    for (const [u, v] of edges) {
      const a = layout[u];
      const b = layout[v];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  function barycentricAt(px, py, vRed, vGreen, vBlue) {
    function area2(ax, ay, bx, by, cx, cy) {
      return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    }
    const ar = area2(vGreen[0], vGreen[1], vBlue[0], vBlue[1], px, py);
    const ag = area2(vBlue[0], vBlue[1], vRed[0], vRed[1], px, py);
    const ab = area2(vRed[0], vRed[1], vGreen[0], vGreen[1], px, py);
    const total = area2(vRed[0], vRed[1], vGreen[0], vGreen[1], vBlue[0], vBlue[1]);
    if (Math.abs(total) < 1e-9) return null;
    let r = ar / total;
    let g = ag / total;
    let b = ab / total;
    if (Math.min(r, g, b) < -1e-6) return null;
    return [r, g, b];
  }

  function drawTrianglePicker(ctx, picker, fontPx) {
    const [vRed, vGreen, vBlue] = picker.getVertices();
    const pts = [
      [Math.round(vRed[0]), Math.round(vRed[1])],
      [Math.round(vGreen[0]), Math.round(vGreen[1])],
      [Math.round(vBlue[0]), Math.round(vBlue[1])],
    ];
    const xMin = Math.max(0, Math.min(...pts.map((p) => p[0])) - 2);
    const xMax = Math.min(ctx.canvas.width - 1, Math.max(...pts.map((p) => p[0])) + 2);
    const yMin = Math.max(0, Math.min(...pts.map((p) => p[1])) - 2);
    const yMax = Math.min(ctx.canvas.height - 1, Math.max(...pts.map((p) => p[1])) + 2);

    const img = ctx.getImageData(xMin, yMin, xMax - xMin + 1, yMax - yMin + 1);
    const data = img.data;
    let idx = 0;
    for (let py = yMin; py <= yMax; py++) {
      for (let px = xMin; px <= xMax; px++) {
        const w = barycentricAt(px, py, vRed, vGreen, vBlue);
        if (w) {
          data[idx] = Math.max(0, Math.min(1, w[0])) * 255;
          data[idx + 1] = Math.max(0, Math.min(1, w[1])) * 255;
          data[idx + 2] = Math.max(0, Math.min(1, w[2])) * 255;
          data[idx + 3] = 255;
        } else {
          data[idx + 3] = 0;
        }
        idx += 4;
      }
    }
    ctx.putImageData(img, xMin, yMin);

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.closePath();
    ctx.strokeStyle = rgb(THEME.black);
    ctx.lineWidth = Math.max(2, Math.round(3 * (fontPx / 14)));

    ctx.stroke();

    ctx.font = `${fontPx}px sans-serif`;
    ctx.fillStyle = rgb(THEME.black);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const labels = [
      ["R", pts[0]],
      ["G", pts[1]],
      ["B", pts[2]],
    ];
    for (const [lab, pt] of labels) {
      ctx.fillText(lab, pt[0], pt[1] - 16);
    }

    const [r, g, b] = picker.getBelief();
    const px = r * vRed[0] + g * vGreen[0] + b * vBlue[0];
    const py = r * vRed[1] + g * vGreen[1] + b * vBlue[1];
    const dotR = Math.max(4, Math.round(7 * (fontPx / 14)));
    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(THEME.black);
    ctx.lineWidth = Math.max(1, Math.round(2 * (fontPx / 14)));
    ctx.stroke();
  }

  /** Build layout map id -> [x,y] from trial nodes array */
  function layoutFromNodes(nodes) {
    const layout = {};
    for (const n of nodes) {
      layout[n.id] = [n.x, n.y];
    }
    return layout;
  }

  function nodeHitRadius() {
    const extra = Math.max(8, Math.round(14 * nodeSizeRatio()));
    return THEME.nodeRadius + THEME.ringWidth + extra;
  }

  function findNodeAt(layout, nodeIds, mx, my) {
    const hr = nodeHitRadius();
    let best = null;
    let bestD = Infinity;
    for (const id of nodeIds) {
      const p = layout[id];
      if (!p) continue;
      const dx = p[0] - mx;
      const dy = p[1] - my;
      const d = dx * dx + dy * dy;
      if (d <= hr * hr && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  global.GraphCanvasDraw = {
    drawNode,
    drawEdges,
    drawTrianglePicker,
    mixRgb,
    layoutFromNodes,
    findNodeAt,
    nodeHitRadius,
    barycentricAt,
  };
})(typeof window !== "undefined" ? window : globalThis);
