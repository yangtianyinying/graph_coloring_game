/**
 * Visual constants aligned with old Pygame config (belief_query_pygame/config.py).
 */
(function (global) {
  const THEME = {
    background: [255, 255, 255],
    red: [220, 70, 70],
    green: [70, 170, 90],
    blue: [70, 110, 230],
    black: [25, 25, 25],
    gray: [120, 120, 120],
    unqueried: [190, 190, 190],
    selectable: [30, 30, 30],
    nodeRadius: 34,
    ringWidth: 10,
    pickerRadius: 135,
  };

  function rgb(arr) {
    return `rgb(${arr[0]},${arr[1]},${arr[2]})`;
  }

  global.GraphExperimentTheme = { THEME, rgb };
})(typeof window !== "undefined" ? window : globalThis);
