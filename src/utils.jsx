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
// bgRemoval: { mode: 'color' | 'wand' | 'ai' | null, color: [r,g,b], tolerance: 0..255, seedX, seedY, aiCache }
// Async because the 'ai' branch (and only that branch) reads from a Map
// that's populated by AI inference; today the function returns synchronously
// for color/wand/null modes but the signature is async so callers don't need
// to special-case modes.
//
// In 'ai' mode this fails closed: if the cache has no entry for the exact
// box, returns null instead of silently rendering the un-masked source.
// Callers (thumbnails, export) treat null as "skip" so the UI never claims
// "BG removed (AI)" while shipping pixels with the original background.
const cropSprite = async (img, box, bgRemoval) => {
  const { x, y, w, h } = box;
  if (w <= 0 || h <= 0) return null;

  if (bgRemoval && bgRemoval.mode === 'ai') {
    const key = window.AIBackgroundRemoval?.boxKey(box);
    const cached = key ? bgRemoval.aiCache?.get(key) : null;
    if (!cached) return null; // fail closed — no masked entry, no output
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cached, 0, 0);
    return c;
  }

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

  if (bgRemoval && (bgRemoval.mode === 'color' || bgRemoval.mode === 'wand')) {
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

// Sample background color from the 1px image border using a quantized histogram.
// Returns null if >50% of border pixels are transparent (treat as transparent bg).
const sampleBackgroundColor = (px, W, H) => {
  const bins = new Map();
  let transparentCount = 0;
  let total = 0;
  const sample = (x, y) => {
    const i = (y * W + x) * 4;
    total++;
    if (px[i+3] < 8) { transparentCount++; return; }
    // Quantize to 5 bits per channel (32 levels) → 15-bit key
    const key = ((px[i] >> 3) << 10) | ((px[i+1] >> 3) << 5) | (px[i+2] >> 3);
    const cur = bins.get(key);
    if (cur) { cur.r += px[i]; cur.g += px[i+1]; cur.b += px[i+2]; cur.n++; }
    else bins.set(key, { r: px[i], g: px[i+1], b: px[i+2], n: 1 });
  };
  for (let x = 0; x < W; x++) { sample(x, 0); sample(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { sample(0, y); sample(W - 1, y); }
  if (transparentCount * 2 > total) return null;
  let best = null;
  for (const v of bins.values()) if (!best || v.n > best.n) best = v;
  if (!best) return null;
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
};

// Morphological close (dilate then erode) on a Uint8Array foreground mask.
// Uses a square kernel of given radius. Separable per axis for speed.
const morphCloseMask = (mask, W, H, radius) => {
  if (radius <= 0) return mask;
  const dilateAxis = (src, isHoriz) => {
    const out = new Uint8Array(src.length);
    if (isHoriz) {
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < W && src[row + nx]) { v = 1; break; }
          }
          out[row + x] = v;
        }
      }
    } else {
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          let v = 0;
          for (let dy = -radius; dy <= radius; dy++) {
            const ny = y + dy;
            if (ny >= 0 && ny < H && src[ny * W + x]) { v = 1; break; }
          }
          out[y * W + x] = v;
        }
      }
    }
    return out;
  };
  const erodeAxis = (src, isHoriz) => {
    // OOB neighbors are treated as foreground so the close pass doesn't
    // hollow out a `radius`-wide band along the canvas edges.
    const out = new Uint8Array(src.length);
    if (isHoriz) {
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
          let v = 1;
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < W && !src[row + nx]) { v = 0; break; }
          }
          out[row + x] = v;
        }
      }
    } else {
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          let v = 1;
          for (let dy = -radius; dy <= radius; dy++) {
            const ny = y + dy;
            if (ny >= 0 && ny < H && !src[ny * W + x]) { v = 0; break; }
          }
          out[y * W + x] = v;
        }
      }
    }
    return out;
  };
  return erodeAxis(erodeAxis(dilateAxis(dilateAxis(mask, true), false), true), false);
};

// Merge boxes that overlap (IoU), are contained in another, or are within mergeDist on both axes.
// Iterates until no further merges occur.
const mergeBoxes = (boxes, { iouThresh = 0.3, mergeDist = 6 } = {}) => {
  if (boxes.length < 2) return boxes.slice();
  let cur = boxes.slice();
  for (let pass = 0; pass < 8; pass++) {
    const n = cur.length;
    const parent = new Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const link = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    let merged = false;
    for (let i = 0; i < n; i++) {
      const a = cur[i];
      for (let j = i + 1; j < n; j++) {
        if (find(i) === find(j)) continue;
        const b = cur[j];
        // Overlap in each axis (positive = overlap, negative = gap)
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const gapX = -ox, gapY = -oy;
        let connect = false;
        if (ox > 0 && oy > 0) {
          const inter = ox * oy;
          const unionArea = a.w * a.h + b.w * b.h - inter;
          const iou = inter / unionArea;
          if (iou >= iouThresh) connect = true;
          // Containment: one box's area equals intersection
          else if (inter === a.w * a.h || inter === b.w * b.h) connect = true;
        } else if (gapX <= mergeDist && gapY <= mergeDist) {
          connect = true;
        }
        if (connect) { link(i, j); merged = true; }
      }
    }
    if (!merged) break;
    // Collapse groups
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const g = groups.get(r);
      const a = cur[i];
      if (!g) groups.set(r, { x: a.x, y: a.y, x2: a.x + a.w, y2: a.y + a.h });
      else {
        if (a.x < g.x) g.x = a.x;
        if (a.y < g.y) g.y = a.y;
        if (a.x + a.w > g.x2) g.x2 = a.x + a.w;
        if (a.y + a.h > g.y2) g.y2 = a.y + a.h;
      }
    }
    cur = [...groups.values()].map(g => ({ x: g.x, y: g.y, w: g.x2 - g.x, h: g.y2 - g.y }));
  }
  return cur;
};

// Auto-detect: find connected non-background regions in the image.
// Returns array of {x,y,w,h} bounding boxes.
const autoDetectSprites = (img, opts = {}) => {
  const data = getImageData(img);
  const { width: W, height: H, data: px } = data;
  const tolerance = opts.tolerance ?? 18;
  const minSize = opts.minSize ?? 12;
  const padding = opts.padding ?? 0;
  const closePx = opts.closePx ?? 1;
  const mergeDist = opts.mergeDist ?? 6;
  const maxAspect = opts.maxAspect ?? 6;

  // Determine bg color: explicit override > border histogram > transparent.
  let bg = opts.color;
  if (bg === undefined) bg = sampleBackgroundColor(px, W, H);

  const tol2 = tolerance * tolerance;
  const isBgPixel = (i) => {
    const a = px[i+3];
    if (bg === null) return a < 8;
    if (a < 8) return true;
    return colorDistSq(px[i], px[i+1], px[i+2], bg[0], bg[1], bg[2]) <= tol2;
  };

  // Build foreground mask, then morphologically close it to bridge anti-alias gaps.
  let mask = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) mask[p] = isBgPixel(i) ? 0 : 1;
  mask = morphCloseMask(mask, W, H, closePx);

  // BFS over the closed mask with 8-connectivity, collect bounding boxes.
  const visited = new Uint8Array(W * H);
  let boxes = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (visited[p]) continue;
      if (!mask[p]) { visited[p] = 1; continue; }
      let minX = x, maxX = x, minY = y, maxY = y, count = 0;
      const stack = [p];
      while (stack.length) {
        const q = stack.pop();
        if (visited[q]) continue;
        visited[q] = 1;
        if (!mask[q]) continue;
        const qx = q % W, qy = (q / W) | 0;
        if (qx < minX) minX = qx;
        if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy;
        if (qy > maxY) maxY = qy;
        count++;
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
      const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      if (bw >= minSize && bh >= minSize && count > minSize * minSize / 2 && aspect <= maxAspect) {
        boxes.push({ x: minX, y: minY, w: bw, h: bh });
      }
    }
  }

  // Post-process merge (overlap + containment + proximity), then apply padding.
  // Setting mergeDist to 0 fully disables the merge step.
  if (mergeDist > 0) boxes = mergeBoxes(boxes, { mergeDist });
  if (padding > 0) {
    boxes = boxes.map(b => ({
      x: Math.max(0, b.x - padding),
      y: Math.max(0, b.y - padding),
      w: Math.min(W - Math.max(0, b.x - padding), b.w + padding * 2),
      h: Math.min(H - Math.max(0, b.y - padding), b.h + padding * 2),
    }));
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
  sampleBackgroundColor, morphCloseMask, mergeBoxes,
  loadImageFile, canvasToBlob, safeName,
};
