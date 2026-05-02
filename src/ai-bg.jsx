// AI background removal via Transformers.js + onnx-community/BEN2-ONNX.
// Loaded lazily — Transformers.js is fetched from CDN only after the user
// clicks "AI Remove".

const TRANSFORMERS_CDN =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm';

// `import()` hidden behind `new Function` so Babel-standalone doesn't try to
// transform it (it would otherwise be rewritten into a require-style call).
const esmImport = new Function('u', 'return import(u)');

let segmenterPromise = null;

const getSegmenter = () => {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    const { pipeline } = await esmImport(TRANSFORMERS_CDN);
    try {
      return await pipeline(
        'background-removal',
        'onnx-community/BEN2-ONNX',
        { device: 'webgpu' }
      );
    } catch (e) {
      console.warn('[ai-bg] WebGPU unavailable, falling back to WASM:', e);
      return pipeline('background-removal', 'onnx-community/BEN2-ONNX');
    }
  })().catch((err) => {
    segmenterPromise = null; // allow retry after a load failure
    throw err;
  });
  return segmenterPromise;
};

const boxKey = ({ x, y, w, h }) => `${x}_${y}_${w}_${h}`;

// Run BEN2 on a single source canvas. Returns a new canvas (same size) with
// the background made transparent.
const removeBackground = async (sourceCanvas) => {
  const segmenter = await getSegmenter();
  const dataUrl = sourceCanvas.toDataURL('image/png');
  const output = await segmenter(dataUrl);
  const raw = Array.isArray(output) ? output[0] : output;
  const out = raw.toCanvas();
  // BEN2 returns a canvas at the original input size, but normalize to source
  // dimensions just in case.
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
  removeBackground,
  processSpritesAI,
  boxKey,
};
