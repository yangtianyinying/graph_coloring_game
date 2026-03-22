/**
 * 视觉参数：画布像素尺寸由刺激 JSON 固定；节点圆环大小由 setNodeVisualScale 调节。
 */
(function (global) {
  const BASE = {
    nodeRadius: 22,
    ringWidth: 7,
    pickerRadius: 100,
  };

  const THEME = {
    background: [255, 255, 255],
    red: [220, 70, 70],
    green: [70, 170, 90],
    blue: [70, 110, 230],
    black: [25, 25, 25],
    gray: [120, 120, 120],
    unqueried: [190, 190, 190],
    selectable: [30, 30, 30],
    nodeRadius: BASE.nodeRadius,
    ringWidth: BASE.ringWidth,
    pickerRadius: BASE.pickerRadius,
  };

  let _visualScale = 1;

  function setNodeVisualScale(scale) {
    const s = Math.max(0.35, Math.min(1.65, Number(scale) || 1));
    _visualScale = s;
    THEME.nodeRadius = Math.max(8, Math.round(BASE.nodeRadius * s));
    THEME.ringWidth = Math.max(3, Math.round(BASE.ringWidth * s));
    THEME.pickerRadius = Math.max(36, Math.round(BASE.pickerRadius * s));
  }

  function getNodeVisualScale() {
    return _visualScale;
  }

  function rgb(arr) {
    return `rgb(${arr[0]},${arr[1]},${arr[2]})`;
  }

  setNodeVisualScale(1);

  global.GraphExperimentTheme = {
    THEME,
    rgb,
    BASE_NODE: BASE,
    setNodeVisualScale,
    getNodeVisualScale,
  };
})(typeof window !== "undefined" ? window : globalThis);
