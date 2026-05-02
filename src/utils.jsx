// Utility functions for image processing, cropping, and export.

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Decode color helpers
const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};
const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// Sample a pixel from an HTMLImageElement via offscreen canvas.
// Caches the canvas on the image element.
const sampleImagePixel = (img, x, y) => {
  if (!img._sampleCanvas) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    img._sampleCanvas = c;
    img._sampleCtx = ctx;
  }
  const ix = Math.max(0, Math.min(img.naturalWidth - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(img.naturalHeight - 1, Math.floor(y)));
  const d = img._sampleCtx.getImageData(ix, iy, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
};

// Build an ImageData of the full image (cached).
const getImageData = (img) => {
  if (!img._fullData) {
    if (!img._sampleCanvas) sampleImagePixel(img, 0, 0); // initialize
    img._fullData = img._sampleCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
  }
  return img._fullData;
};

// Color distance squared (Euclidean RGB)
const colorDistSq = (r1, g1, b1, r2, g2, b2) =>
  (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;

// Crop a region from img. Optionally apply background removal.
// bgRemoval: { mode: 'color' | 'wand' | null, color: [r,g,b], tolerance: 0..255, seedX, seedY }
const cropSprite = (img, box, bgRemoval) => {
  const { x, y, w, h } = box;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

  if (bgRemoval && bgRemoval.mode) {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    if (bgRemoval.mode === 'color') {
      const [tr, tg, tb] = bgRemoval.color;
      const tol2 = (bgRemoval.tolerance || 0) ** 2;
      for (let i = 0; i < px.length; i += 4) {
        if (colorDistSq(px[i], px[i+1], px[i+2], tr, tg, tb) <= tol2) {
          px[i+3] = 0;
        }
      }
    } else if (bgRemoval.mode === 'wand') {
      // flood-fill from (seedX-x, seedY-y) within the cropped region
      const sx = Math.floor(bgRemoval.seedX - x);
      const sy = Math.floor(bgRemoval.seedY - y);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        floodFillTransparent(px, w, h, sx, sy, bgRemoval.tolerance || 0);
      }
    }
    ctx.putImageData(data, 0, 0);
  }
  return c;
};

const floodFillTransparent = (px, w, h, sx, sy, tolerance) => {
  const idx0 = (sy * w + sx) * 4;
  const tr = px[idx0], tg = px[idx0+1], tb = px[idx0+2];
  const tol2 = tolerance * tolerance;
  const visited = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  while (stack.length) {
    const p = stack.pop();
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (px[i+3] === 0) continue; // already transparent
    if (colorDistSq(px[i], px[i+1], px[i+2], tr, tg, tb) > tol2) continue;
    px[i+3] = 0;
    const px_x = p % w, px_y = (p / w) | 0;
    if (px_x > 0) stack.push(p - 1);
    if (px_x < w - 1) stack.push(p + 1);
    if (px_y > 0) stack.push(p - w);
    if (px_y < h - 1) stack.push(p + w);
  }
};

// Auto-detect: find connected non-background regions in the image.
// Returns array of {x,y,w,h} bounding boxes. bgColor is RGB or null (=use corner sample).
const autoDetectSprites = (img, opts = {}) => {
  const data = getImageData(img);
  const { width: W, height: H, data: px } = data;
  const tolerance = opts.tolerance ?? 18;
  const minSize = opts.minSize ?? 6;
  const padding = opts.padding ?? 0;

  // Determine bg color: use opts.color if provided; else sample 4 corners and pick most common.
  let bg = opts.color;
  if (!bg) {
    const corners = [
      [0,0], [W-1,0], [0,H-1], [W-1,H-1]
    ].map(([x,y]) => {
      const i = (y*W + x) * 4;
      return [px[i], px[i+1], px[i+2], px[i+3]];
    });
    // If corner is fully transparent, treat as bg.
    const transparentCorner = corners.find(c => c[3] === 0);
    if (transparentCorner) bg = null; // means: bg = transparent
    else bg = corners[0]; // top-left
  }

  const tol2 = tolerance * tolerance;
  const isBg = (i) => {
    const a = px[i+3];
    if (bg === null) return a < 8; // transparent bg
    if (a < 8) return true; // also treat fully transparent as bg
    return colorDistSq(px[i], px[i+1], px[i+2], bg[0], bg[1], bg[2]) <= tol2;
  };

  // BFS over non-bg pixels with 8-connectivity, collect bounding boxes.
  const visited = new Uint8Array(W * H);
  const boxes = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (visited[p]) continue;
      const i = p * 4;
      if (isBg(i)) { visited[p] = 1; continue; }
      // BFS
      let minX = x, maxX = x, minY = y, maxY = y, count = 0;
      const stack = [p];
      while (stack.length) {
        const q = stack.pop();
        if (visited[q]) continue;
        visited[q] = 1;
        const qi = q * 4;
        if (isBg(qi)) continue;
        const qx = q % W, qy = (q / W) | 0;
        if (qx < minX) minX = qx;
        if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy;
        if (qy > maxY) maxY = qy;
        count++;
        // 8-connectivity
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = qx + dx, ny = qy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const np = ny * W + nx;
            if (!visited[np]) stack.push(np);
          }
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw >= minSize && bh >= minSize && count > minSize * minSize / 2) {
        boxes.push({
          x: Math.max(0, minX - padding),
          y: Math.max(0, minY - padding),
          w: Math.min(W, bw + padding * 2),
          h: Math.min(H, bh + padding * 2),
        });
      }
    }
  }
  // Sort top-to-bottom, left-to-right (by row bands)
  boxes.sort((a, b) => {
    const rowA = Math.floor(a.y / 20), rowB = Math.floor(b.y / 20);
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });
  return boxes;
};

// Generate uniform grid boxes
const gridBoxes = (imgW, imgH, cols, rows, padX = 0, padY = 0) => {
  cols = Math.max(1, cols|0);
  rows = Math.max(1, rows|0);
  const cellW = (imgW - padX * (cols + 1)) / cols;
  const cellH = (imgH - padY * (rows + 1)) / rows;
  if (cellW <= 0 || cellH <= 0) return [];
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: Math.round(padX + c * (cellW + padX)),
        y: Math.round(padY + r * (cellH + padY)),
        w: Math.round(cellW),
        h: Math.round(cellH),
      });
    }
  }
  return out;
};

// Async file load → HTMLImageElement
const loadImageFile = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = url;
});

// Convert canvas to PNG blob
const canvasToBlob = (canvas) => new Promise((resolve) => {
  canvas.toBlob((b) => resolve(b), 'image/png');
});

// Sanitize filename
const safeName = (s) => (s || 'sprite').replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60);

window.SpriteUtils = {
  clamp, hexToRgb, rgbToHex,
  sampleImagePixel, getImageData,
  cropSprite, autoDetectSprites, gridBoxes,
  loadImageFile, canvasToBlob, safeName,
};
