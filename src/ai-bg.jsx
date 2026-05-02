// AI background removal via Transformers.js + onnx-community/BEN2-ONNX.
// Transformers.js itself is loaded lazily via window.__loadTransformers
// (a `<script type="module">` shim in index.html that defers the
// dynamic import until called).

let segmenterPromise = null;
let modelEverLoaded = false; // flips true the first time getSegmenter resolves

// Tries WebGPU first, falls back to WASM. Cached so concurrent and
// subsequent calls share the same load. On failure the cache is cleared
// so the next click can retry from scratch (incl. re-fetching the bundle).
const getSegmenter = () => {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    if (typeof window.__loadTransformers !== 'function') {
      throw new Error('Transformers.js loader missing — check index.html');
    }
    const { pipeline, RawImage } = await window.__loadTransformers();
    let seg;
    try {
      seg = await pipeline(
        'background-removal',
        'onnx-community/BEN2-ONNX',
        { device: 'webgpu' }
      );
    } catch (e) {
      console.warn('[ai-bg] WebGPU unavailable, falling back to WASM:', e);
      seg = await pipeline('background-removal', 'onnx-community/BEN2-ONNX');
    }
    modelEverLoaded = true;
    // Stash RawImage on the segmenter for removeBackground to reach.
    seg.__RawImage = RawImage;
    return seg;
  })().catch((err) => {
    segmenterPromise = null;
    throw err;
  });
  return segmenterPromise;
};

const isModelLoaded = () => modelEverLoaded;

const boxKey = ({ x, y, w, h }) => `${x}_${y}_${w}_${h}`;

// Run BEN2 on a single source canvas. Returns a new canvas (same size) with
// the background made transparent.
const removeBackground = async (sourceCanvas) => {
  const segmenter = await getSegmenter();
  // RawImage.fromCanvas avoids the round-trip through a base64 PNG.
  const input = segmenter.__RawImage.fromCanvas(sourceCanvas);
  const output = await segmenter(input);
  const raw = Array.isArray(output) ? output[0] : output;
  const out = raw.toCanvas();
  // BEN2 normally returns a canvas at the input size, but copy to a fresh
  // canvas of the source's size to be defensive against resampling.
  if (out.width === sourceCanvas.width && out.height === sourceCanvas.height) {
    return out;
  }
  const fixed = document.createElement('canvas');
  fixed.width = sourceCanvas.width;
  fixed.height = sourceCanvas.height;
  fixed.getContext('2d').drawImage(out, 0, 0, fixed.width, fixed.height);
  return fixed;
};

// Crop each sprite from `image` and run BEN2 over it. Returns Map<boxKey, canvas>.
// `onProgress(done, total)` fires after each sprite completes.
const processSpritesAI = async (image, sprites, onProgress) => {
  const cache = new Map();
  let done = 0;
  onProgress?.(0, sprites.length);
  for (const s of sprites) {
    const src = document.createElement('canvas');
    src.width = s.box.w;
    src.height = s.box.h;
    const ctx = src.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, s.box.x, s.box.y, s.box.w, s.box.h, 0, 0, s.box.w, s.box.h);
    const masked = await removeBackground(src);
    cache.set(boxKey(s.box), masked);
    done++;
    onProgress?.(done, sprites.length);
  }
  return cache;
};

window.AIBackgroundRemoval = {
  getSegmenter,
  isModelLoaded,
  removeBackground,
  processSpritesAI,
  boxKey,
};
