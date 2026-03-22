/**
 * Triangle RGB belief picker — logic ported from belief_query_pygame/ui/triangle_picker.py
 */
(function (global) {
  function area2(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  }

  class TriangleColorPicker {
    constructor(centerX, centerY, radius) {
      this.cx = centerX;
      this.cy = centerY;
      this.radius = radius;
      this._r = 1 / 3;
      this._g = 1 / 3;
      this._b = 1 / 3;
      this._updateVertices();
    }

    _updateVertices() {
      const r = this.radius;
      this.vRed = [this.cx, this.cy + r];
      this.vGreen = [this.cx - (r * Math.sqrt(3)) / 2, this.cy - r / 2];
      this.vBlue = [this.cx + (r * Math.sqrt(3)) / 2, this.cy - r / 2];
    }

    getVertices() {
      return [this.vRed, this.vGreen, this.vBlue];
    }

    setBelief(r, g, b) {
      const total = Math.max(r + g + b, 1e-9);
      this._r = r / total;
      this._g = g / total;
      this._b = b / total;
    }

    getBelief() {
      return [this._r, this._g, this._b];
    }

    _pointToBarycentric(px, py) {
      const vRed = this.vRed;
      const vGreen = this.vGreen;
      const vBlue = this.vBlue;
      const ar = area2(vGreen[0], vGreen[1], vBlue[0], vBlue[1], px, py);
      const ag = area2(vBlue[0], vBlue[1], vRed[0], vRed[1], px, py);
      const ab = area2(vRed[0], vRed[1], vGreen[0], vGreen[1], px, py);
      const total = area2(vRed[0], vRed[1], vGreen[0], vGreen[1], vBlue[0], vBlue[1]);
      if (Math.abs(total) < 1e-8) {
        return [this._r, this._g, this._b];
      }
      let r = Math.max(0, Math.min(1, ar / total));
      let g = Math.max(0, Math.min(1, ag / total));
      let b = Math.max(0, Math.min(1, ab / total));
      const s = Math.max(r + g + b, 1e-9);
      return [r / s, g / s, b / s];
    }

    handleClick(px, py) {
      [this._r, this._g, this._b] = this._pointToBarycentric(px, py);
    }
  }

  global.TriangleColorPicker = TriangleColorPicker;
})(typeof window !== "undefined" ? window : globalThis);
