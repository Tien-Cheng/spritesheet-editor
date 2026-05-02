// SpriteCanvas: the central canvas that displays the loaded image, handles
// pan/zoom, draws sprite bounding boxes, and lets the user create new boxes
// via four crop modes.

const { useEffect, useRef, useState, useCallback, useMemo } = React;

// Tool kinds
const TOOLS = {
  SELECT: 'select',
  PAN: 'pan',
  FREE: 'free',
  GRID: 'grid',
  CLICK: 'click',
  AUTO: 'auto',
  EYEDROPPER: 'eyedropper',
  WAND: 'wand',
};

const SpriteCanvas = ({
  image,
  sprites,
  setSprites,
  selectedId,
  setSelectedId,
  tool,
  setTool,
  modeOpts,
  setModeOpts,
  bgRemoval,
  onEyedropperResult,
  onWandClick,
  onUploadFile,
}) => {
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drawing, setDrawing] = useState(null); // {x0,y0,x1,y1} in image space
  const [panStart, setPanStart] = useState(null);
  const [hoverPx, setHoverPx] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [boxDrag, setBoxDrag] = useState(null); // moving/resizing existing sprite
  const [resizeMode, setResizeMode] = useState(false); // arrow keys resize instead of move

  // Track wrapper size
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Fit-to-view when image loads or wrap size changes
  const fitToView = useCallback(() => {
    if (!image || !size.w || !size.h) return;
    const margin = 40;
    const sx = (size.w - margin * 2) / image.naturalWidth;
    const sy = (size.h - margin * 2) / image.naturalHeight;
    const scale = Math.min(sx, sy, 8);
    const tx = (size.w - image.naturalWidth * scale) / 2;
    const ty = (size.h - image.naturalHeight * scale) / 2;
    setView({ tx, ty, scale });
  }, [image, size]);
  useEffect(() => { fitToView(); }, [fitToView]);

  // Convert client coords -> image coords
  const clientToImg = useCallback((clientX, clientY) => {
    const r = stageRef.current.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    return {
      x: (sx - view.tx) / view.scale,
      y: (sy - view.ty) / view.scale,
    };
  }, [view]);

  // Wheel: zoom toward cursor, or pan with shift
  const onWheel = useCallback((e) => {
    if (!image) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      // Zoom
      const r = stageRef.current.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const factor = Math.pow(1.0015, -e.deltaY);
      const newScale = SpriteUtils.clamp(view.scale * factor, 0.05, 32);
      const k = newScale / view.scale;
      setView({
        scale: newScale,
        tx: sx - (sx - view.tx) * k,
        ty: sy - (sy - view.ty) * k,
      });
    } else {
      setView(v => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
    }
  }, [view, image]);
  // Attach non-passive wheel listener
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handler = (e) => onWheel(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [onWheel]);

  // Pointer down — depending on tool
  const onPointerDown = (e) => {
    if (!image) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle / alt = pan
      setPanStart({ x: e.clientX, y: e.clientY, vx: view.tx, vy: view.ty });
      e.target.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === TOOLS.PAN) {
      setPanStart({ x: e.clientX, y: e.clientY, vx: view.tx, vy: view.ty });
      e.target.setPointerCapture(e.pointerId);
      return;
    }
    const p = clientToImg(e.clientX, e.clientY);
    if (p.x < 0 || p.y < 0 || p.x > image.naturalWidth || p.y > image.naturalHeight) return;

    if (tool === TOOLS.EYEDROPPER) {
      const rgba = SpriteUtils.sampleImagePixel(image, p.x, p.y);
      onEyedropperResult && onEyedropperResult(rgba, p);
      return;
    }
    if (tool === TOOLS.WAND) {
      onWandClick && onWandClick(p);
      return;
    }
    if (tool === TOOLS.CLICK) {
      // Place a fixed-size box centered on cursor
      const w = modeOpts.fixedW, h = modeOpts.fixedH;
      const box = {
        x: Math.round(SpriteUtils.clamp(p.x - w/2, 0, image.naturalWidth - w)),
        y: Math.round(SpriteUtils.clamp(p.y - h/2, 0, image.naturalHeight - h)),
        w, h,
      };
      addSprite(box);
      return;
    }
    if (tool === TOOLS.FREE) {
      // If clicking on an already-selected box edge/corner, start a resize.
      // (handled by handle's own pointerdown — see below)
      // First box: free-draw. Subsequent: click-to-place at locked size if locked.
      if (modeOpts.locked && modeOpts.fixedW && modeOpts.fixedH) {
        const w = modeOpts.fixedW, h = modeOpts.fixedH;
        // Start a drag that re-positions a fixed-size box anchored to cursor
        setDrawing({
          x0: p.x - w/2, y0: p.y - h/2,
          x1: p.x + w/2, y1: p.y + h/2,
          locked: true,
        });
      } else {
        setDrawing({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, locked: false });
      }
      e.target.setPointerCapture(e.pointerId);
      return;
    }
    // SELECT tool: clicking empty deselects
    setSelectedId(null);
  };

  const onPointerMove = (e) => {
    if (!image) return;
    const p = clientToImg(e.clientX, e.clientY);
    setHoverPx({ ...p, clientX: e.clientX, clientY: e.clientY });
    if (panStart) {
      setView(v => ({
        ...v,
        tx: panStart.vx + (e.clientX - panStart.x),
        ty: panStart.vy + (e.clientY - panStart.y),
      }));
      return;
    }
    if (boxDrag) {
      const dx = (e.clientX - boxDrag.startClientX) / view.scale;
      const dy = (e.clientY - boxDrag.startClientY) / view.scale;
      const orig = boxDrag.orig;
      let nb = { ...orig };
      if (boxDrag.kind === 'move') {
        nb.x = Math.round(SpriteUtils.clamp(orig.x + dx, 0, image.naturalWidth - orig.w));
        nb.y = Math.round(SpriteUtils.clamp(orig.y + dy, 0, image.naturalHeight - orig.h));
      } else {
        // resize handle: edges are 'n','s','e','w','ne','nw','se','sw'
        let x = orig.x, y = orig.y, w = orig.w, h = orig.h;
        if (boxDrag.kind.includes('e')) w = orig.w + dx;
        if (boxDrag.kind.includes('w')) { x = orig.x + dx; w = orig.w - dx; }
        if (boxDrag.kind.includes('s')) h = orig.h + dy;
        if (boxDrag.kind.includes('n')) { y = orig.y + dy; h = orig.h - dy; }
        // enforce min 1px
        if (w < 1) { if (boxDrag.kind.includes('w')) x = orig.x + orig.w - 1; w = 1; }
        if (h < 1) { if (boxDrag.kind.includes('n')) y = orig.y + orig.h - 1; h = 1; }
        // clamp to image bounds
        if (x < 0) { w += x; x = 0; }
        if (y < 0) { h += y; y = 0; }
        if (x + w > image.naturalWidth) w = image.naturalWidth - x;
        if (y + h > image.naturalHeight) h = image.naturalHeight - y;
        nb = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      }
      setSprites(prev => prev.map(s => s.id === boxDrag.id ? { ...s, box: nb } : s));
      return;
    }
    if (drawing) {
      if (drawing.locked) {
        const w = modeOpts.fixedW, h = modeOpts.fixedH;
        setDrawing({ ...drawing, x0: p.x - w/2, y0: p.y - h/2, x1: p.x + w/2, y1: p.y + h/2 });
      } else {
        setDrawing({ ...drawing, x1: p.x, y1: p.y });
      }
    }
  };

  const onPointerUp = (e) => {
    if (panStart) {
      setPanStart(null);
      try { e.target.releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    if (boxDrag) {
      setBoxDrag(null);
      try { e.target.releasePointerCapture(e.pointerId); } catch {}
      return;
    }
    if (drawing) {
      const x = Math.round(Math.max(0, Math.min(drawing.x0, drawing.x1)));
      const y = Math.round(Math.max(0, Math.min(drawing.y0, drawing.y1)));
      const x2 = Math.round(Math.min(image.naturalWidth, Math.max(drawing.x0, drawing.x1)));
      const y2 = Math.round(Math.min(image.naturalHeight, Math.max(drawing.y0, drawing.y1)));
      const w = x2 - x, h = y2 - y;
      if (w >= 2 && h >= 2) {
        if (drawing.locked) {
          addSprite({ x, y, w: modeOpts.fixedW, h: modeOpts.fixedH });
        } else {
          // First free-draw — lock the size for subsequent boxes if no size set yet.
          if (!modeOpts.fixedW || !modeOpts.fixedH) {
            setModeOpts({ ...modeOpts, fixedW: w, fixedH: h, locked: true });
          }
          addSprite({ x, y, w, h });
        }
      }
      setDrawing(null);
      try { e.target.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  const addSprite = (box) => {
    setSprites((prev) => {
      const id = (prev.length ? Math.max(...prev.map(s => s.id)) : 0) + 1;
      const next = [...prev, { id, name: '', box, customName: false }];
      return next;
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'v' || e.key === 'V') setTool(TOOLS.SELECT);
      else if (e.key === 'h' || e.key === 'H' || e.key === ' ') { e.preventDefault(); setTool(TOOLS.PAN); }
      else if (e.key === 'm' || e.key === 'M') setTool(TOOLS.FREE);
      else if (e.key === 'g' || e.key === 'G') setTool(TOOLS.GRID);
      else if (e.key === 'c' || e.key === 'C') setTool(TOOLS.CLICK);
      else if (e.key === 'a' || e.key === 'A') setTool(TOOLS.AUTO);
      else if (e.key === 'i' || e.key === 'I') setTool(TOOLS.EYEDROPPER);
      else if (e.key === 'w' || e.key === 'W') setTool(TOOLS.WAND);
      else if (e.key === 'f' || e.key === 'F') fitToView();
      else if (e.key === '0') fitToView();
      else if (e.key === '+' || e.key === '=') {
        const cx = size.w / 2, cy = size.h / 2;
        zoomBy(1.2, cx, cy);
      } else if (e.key === '-' || e.key === '_') {
        const cx = size.w / 2, cy = size.h / 2;
        zoomBy(1/1.2, cx, cy);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId != null) {
        e.preventDefault();
        setSprites(prev => prev.filter(s => s.id !== selectedId));
        setSelectedId(null);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
        setResizeMode(false);
      } else if ((e.key === 'r' || e.key === 'R') && selectedId != null) {
        // Toggle resize mode for arrow keys
        e.preventDefault();
        setResizeMode(m => !m);
      } else if (selectedId != null && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        setSprites(prev => prev.map(s => {
          if (s.id !== selectedId) return s;
          let { x, y, w, h } = s.box;
          if (resizeMode) {
            if (e.key === 'ArrowLeft') w = Math.max(1, w - step);
            if (e.key === 'ArrowRight') w = w + step;
            if (e.key === 'ArrowUp') h = Math.max(1, h - step);
            if (e.key === 'ArrowDown') h = h + step;
            // clamp to image bounds
            if (x + w > image.naturalWidth) w = image.naturalWidth - x;
            if (y + h > image.naturalHeight) h = image.naturalHeight - y;
          } else {
            if (e.key === 'ArrowLeft') x -= step;
            if (e.key === 'ArrowRight') x += step;
            if (e.key === 'ArrowUp') y -= step;
            if (e.key === 'ArrowDown') y += step;
            x = SpriteUtils.clamp(x, 0, image.naturalWidth - w);
            y = SpriteUtils.clamp(y, 0, image.naturalHeight - h);
          }
          return { ...s, box: { x, y, w, h } };
        }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, size, fitToView, setTool, setSelectedId, setSprites, resizeMode, image]);

  const zoomBy = (factor, cx, cy) => {
    const newScale = SpriteUtils.clamp(view.scale * factor, 0.05, 32);
    const k = newScale / view.scale;
    setView({
      scale: newScale,
      tx: cx - (cx - view.tx) * k,
      ty: cy - (cy - view.ty) * k,
    });
  };

  // Drag-and-drop file upload
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && onUploadFile) onUploadFile(f);
  };

  // Compute SVG transforms
  const T = `translate(${view.tx} ${view.ty}) scale(${view.scale})`;

  // Visible image-space rectangle (for pixel grid culling)
  const visibleImg = useMemo(() => {
    if (!image || !size.w || !size.h) return null;
    const x0 = Math.max(0, -view.tx / view.scale);
    const y0 = Math.max(0, -view.ty / view.scale);
    const x1 = Math.min(image.naturalWidth, (size.w - view.tx) / view.scale);
    const y1 = Math.min(image.naturalHeight, (size.h - view.ty) / view.scale);
    return { x0, y0, x1, y1 };
  }, [image, view, size]);

  // Pixel grid lines (only at high zoom)
  const pixelGridLines = useMemo(() => {
    if (!visibleImg || view.scale < 6) return null;
    const xs = [];
    const ys = [];
    const x0 = Math.floor(visibleImg.x0);
    const x1 = Math.ceil(visibleImg.x1);
    const y0 = Math.floor(visibleImg.y0);
    const y1 = Math.ceil(visibleImg.y1);
    // cap at ~400 lines per axis to be safe
    const stride = (x1 - x0) > 400 ? Math.ceil((x1 - x0) / 400) : 1;
    const strideY = (y1 - y0) > 400 ? Math.ceil((y1 - y0) / 400) : 1;
    for (let x = x0; x <= x1; x += stride) xs.push(x);
    for (let y = y0; y <= y1; y += strideY) ys.push(y);
    return { xs, ys, x0, x1, y0, y1 };
  }, [visibleImg, view.scale]);

  // Compute grid preview rectangles
  const gridPreview = useMemo(() => {
    if (!image || tool !== TOOLS.GRID) return null;
    return SpriteUtils.gridBoxes(
      image.naturalWidth, image.naturalHeight,
      modeOpts.gridCols, modeOpts.gridRows,
      modeOpts.gridPadX || 0, modeOpts.gridPadY || 0
    );
  }, [image, tool, modeOpts]);

  const stageClass =
    'canvas-stage' +
    (tool === TOOLS.PAN ? ' tool-pan' : '') +
    (panStart ? ' panning' : '') +
    (tool === TOOLS.EYEDROPPER ? ' tool-eyedropper' : '');

  return (
    <div ref={wrapRef} className="canvas-wrap"
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div ref={stageRef} className={stageClass}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {image && (
          <svg className="crop-svg" width="100%" height="100%">
            <g transform={T}>
              {/* checker bg behind image */}
              <defs>
                <pattern id="checker" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                  <rect width="16" height="16" fill="#ffffff" />
                  <rect width="8" height="8" fill="#e7e5e4" />
                  <rect x="8" y="8" width="8" height="8" fill="#e7e5e4" />
                </pattern>
              </defs>
              <rect x="0" y="0"
                width={image.naturalWidth} height={image.naturalHeight}
                fill="url(#checker)" />
              {/* image */}
              <image href={image.src}
                x="0" y="0"
                width={image.naturalWidth} height={image.naturalHeight}
                style={{ imageRendering: view.scale > 2 ? 'pixelated' : 'auto' }} />
              {/* image border */}
              <rect x="0" y="0"
                width={image.naturalWidth} height={image.naturalHeight}
                fill="none" stroke="#d6d3d1" strokeWidth="1" vectorEffect="non-scaling-stroke" />

              {/* Grid preview */}
              {gridPreview && gridPreview.map((b, i) => (
                <rect key={'g'+i}
                  x={b.x} y={b.y} width={b.w} height={b.h}
                  className="grid-cell" />
              ))}

              {/* Pixel grid (zoom > 6x) */}
              {pixelGridLines && (
                <g pointerEvents="none" opacity="0.55">
                  {pixelGridLines.xs.map(x => (
                    <line key={'gx'+x} x1={x} y1={pixelGridLines.y0} x2={x} y2={pixelGridLines.y1}
                      stroke="#000" strokeOpacity="0.10"
                      strokeWidth={0.5/view.scale} />
                  ))}
                  {pixelGridLines.ys.map(y => (
                    <line key={'gy'+y} x1={pixelGridLines.x0} y1={y} x2={pixelGridLines.x1} y2={y}
                      stroke="#000" strokeOpacity="0.10"
                      strokeWidth={0.5/view.scale} />
                  ))}
                </g>
              )}

              {/* Existing sprite boxes */}
              {sprites.map((s, i) => {
                const sel = s.id === selectedId;
                const moveCursor = (tool === TOOLS.SELECT || tool === TOOLS.PAN) ? 'move' : 'pointer';
                return (
                  <g key={s.id}>
                    <rect x={s.box.x} y={s.box.y} width={s.box.w} height={s.box.h}
                      className={'sprite-box' + (sel ? ' selected' : '')}
                      style={{ cursor: sel ? 'move' : moveCursor }}
                      onPointerDown={(e) => {
                        if (tool === TOOLS.SELECT || tool === TOOLS.PAN) {
                          e.stopPropagation();
                          setSelectedId(s.id);
                          if (e.button === 0 && !e.altKey) {
                            setBoxDrag({
                              id: s.id, kind: 'move',
                              startClientX: e.clientX, startClientY: e.clientY,
                              orig: { ...s.box },
                            });
                            e.target.setPointerCapture(e.pointerId);
                          }
                        }
                      }}
                    />
                    {/* Index label */}
                    <g transform={`translate(${s.box.x} ${s.box.y})`} pointerEvents="none">
                      <rect x="0" y={-14/view.scale} width={28/view.scale} height={14/view.scale}
                        className="sprite-label-bg"
                        rx={2/view.scale} />
                      <text x={4/view.scale} y={-3/view.scale}
                        className="sprite-label"
                        style={{ fontSize: 10/view.scale + 'px' }}>
                        {String(i + 1).padStart(2, '0')}
                      </text>
                    </g>

                    {/* Selected: dimension label + resize handles */}
                    {sel && (() => {
                      const hs = 8 / view.scale; // handle size in image-space px
                      const handles = [
                        { kind: 'nw', cx: s.box.x, cy: s.box.y, cur: 'nwse-resize' },
                        { kind: 'n', cx: s.box.x + s.box.w/2, cy: s.box.y, cur: 'ns-resize' },
                        { kind: 'ne', cx: s.box.x + s.box.w, cy: s.box.y, cur: 'nesw-resize' },
                        { kind: 'e', cx: s.box.x + s.box.w, cy: s.box.y + s.box.h/2, cur: 'ew-resize' },
                        { kind: 'se', cx: s.box.x + s.box.w, cy: s.box.y + s.box.h, cur: 'nwse-resize' },
                        { kind: 's', cx: s.box.x + s.box.w/2, cy: s.box.y + s.box.h, cur: 'ns-resize' },
                        { kind: 'sw', cx: s.box.x, cy: s.box.y + s.box.h, cur: 'nesw-resize' },
                        { kind: 'w', cx: s.box.x, cy: s.box.y + s.box.h/2, cur: 'ew-resize' },
                      ];
                      const dimText = `${s.box.w} \u00d7 ${s.box.h}`;
                      const dimW = dimText.length * 6.2 / view.scale + 8/view.scale;
                      const dimH = 16/view.scale;
                      // Place dimension label at bottom-right of box, slightly outside
                      const dx = s.box.x + s.box.w - dimW;
                      const dy = s.box.y + s.box.h + 4/view.scale;
                      // Position label
                      const posText = `${s.box.x}, ${s.box.y}`;
                      const posW = posText.length * 6.2 / view.scale + 8/view.scale;
                      const px = s.box.x;
                      const py = s.box.y - 18/view.scale;
                      return (
                        <g>
                          {/* dimension chip (bottom-right, outside) */}
                          <rect x={dx} y={dy} width={dimW} height={dimH}
                            fill="#2563eb" rx={3/view.scale} />
                          <text x={dx + 4/view.scale} y={dy + 11/view.scale}
                            fill="#fff"
                            style={{ fontFamily:'Geist Mono, monospace', fontSize: 11/view.scale + 'px', fontWeight: 500 }}
                            pointerEvents="none">
                            {dimText}
                          </text>
                          {/* position chip (top-left, outside) */}
                          <rect x={px + 30/view.scale} y={py} width={posW} height={dimH}
                            fill="#1c1917" rx={3/view.scale} />
                          <text x={px + 34/view.scale} y={py + 11/view.scale}
                            fill="#fff"
                            style={{ fontFamily:'Geist Mono, monospace', fontSize: 11/view.scale + 'px' }}
                            pointerEvents="none">
                            {posText}
                          </text>
                          {/* resize handles */}
                          {handles.map(h => (
                            <rect key={h.kind}
                              x={h.cx - hs/2} y={h.cy - hs/2}
                              width={hs} height={hs}
                              fill="#fff" stroke="#2563eb"
                              strokeWidth={1.5/view.scale}
                              style={{ cursor: h.cur }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setBoxDrag({
                                  id: s.id, kind: h.kind,
                                  startClientX: e.clientX, startClientY: e.clientY,
                                  orig: { ...s.box },
                                });
                                e.target.setPointerCapture(e.pointerId);
                              }}
                            />
                          ))}
                        </g>
                      );
                    })()}
                  </g>
                );
              })}

              {/* In-progress draw */}
              {drawing && (() => {
                const x = Math.round(Math.min(drawing.x0, drawing.x1));
                const y = Math.round(Math.min(drawing.y0, drawing.y1));
                const w = Math.round(Math.abs(drawing.x1 - drawing.x0));
                const h = Math.round(Math.abs(drawing.y1 - drawing.y0));
                const dimText = `${w} \u00d7 ${h}`;
                const dimW = dimText.length * 6.2 / view.scale + 8/view.scale;
                const dimH = 16/view.scale;
                return (
                  <g pointerEvents="none">
                    <rect x={x} y={y} width={w} height={h} className="preview-box" />
                    {w > 0 && h > 0 && (
                      <g>
                        <rect x={x + w - dimW} y={y + h + 4/view.scale}
                          width={dimW} height={dimH}
                          fill="#2563eb" rx={3/view.scale} />
                        <text x={x + w - dimW + 4/view.scale} y={y + h + 4/view.scale + 11/view.scale}
                          fill="#fff"
                          style={{ fontFamily:'Geist Mono, monospace', fontSize: 11/view.scale + 'px', fontWeight: 500 }}>
                          {dimText}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })()}

              {/* Click-to-place ghost */}
              {tool === TOOLS.CLICK && hoverPx && (
                <g pointerEvents="none">
                  <rect
                    x={hoverPx.x - modeOpts.fixedW/2}
                    y={hoverPx.y - modeOpts.fixedH/2}
                    width={modeOpts.fixedW}
                    height={modeOpts.fixedH}
                    className="preview-box"
                  />
                  {(() => {
                    const w = modeOpts.fixedW, h = modeOpts.fixedH;
                    const x = hoverPx.x - w/2, y = hoverPx.y - h/2;
                    const dimText = `${w} \u00d7 ${h}`;
                    const dimW = dimText.length * 6.2 / view.scale + 8/view.scale;
                    const dimH = 16/view.scale;
                    return (
                      <g>
                        <rect x={x + w - dimW} y={y + h + 4/view.scale}
                          width={dimW} height={dimH}
                          fill="#2563eb" rx={3/view.scale} />
                        <text x={x + w - dimW + 4/view.scale} y={y + h + 4/view.scale + 11/view.scale}
                          fill="#fff"
                          style={{ fontFamily:'Geist Mono, monospace', fontSize: 11/view.scale + 'px', fontWeight: 500 }}>
                          {dimText}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              )}
            </g>
          </svg>
        )}

        {/* Empty state */}
        {!image && (
          <div className={'canvas-empty' + (dragOver ? ' dragging' : '')}>
            <div className="drop">
              <Icons.Image size={28} stroke="#a8a29e" strokeWidth={1.4} />
              <h2>Drop a sprite sheet here</h2>
              <p>PNG, JPG, GIF, or WebP. Anything with sprites on a flat or transparent background works best.</p>
              <label className="upload-btn">
                <Icons.Upload size={14} />
                Choose file
                <input type="file" accept="image/*" style={{ display:'none' }}
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f && onUploadFile) onUploadFile(f);
                  }} />
              </label>
              <div className="hint">or drag &amp; drop</div>
            </div>
          </div>
        )}

        {/* Eyedropper readout */}
        {tool === TOOLS.EYEDROPPER && image && hoverPx && hoverPx.x >= 0 && hoverPx.y >= 0 &&
         hoverPx.x < image.naturalWidth && hoverPx.y < image.naturalHeight && (() => {
          const [r,g,b,a] = SpriteUtils.sampleImagePixel(image, hoverPx.x, hoverPx.y);
          return (
            <div className="eyedropper-readout"
              style={{ left: hoverPx.clientX + 14, top: hoverPx.clientY + 14 }}>
              <div style={{
                width: 14, height: 14, borderRadius: 3,
                background: `rgba(${r},${g},${b},${a/255})`,
                border: '1px solid var(--border-strong)' }} />
              <span>{SpriteUtils.rgbToHex(r,g,b).toUpperCase()}</span>
              <span style={{ color: 'var(--ink-4)' }}>
                {Math.floor(hoverPx.x)},{Math.floor(hoverPx.y)}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Mode panel (top center) */}
      {image && (
        <ModePanel
          tool={tool}
          modeOpts={modeOpts}
          setModeOpts={setModeOpts}
          image={image}
          sprites={sprites}
          setSprites={setSprites}
        />
      )}

      {/* Resize mode badge */}
      {image && selectedId != null && resizeMode && (
        <div style={{
          position: 'absolute', top: 60, right: 12,
          background: '#2563eb', color: '#fff',
          padding: '6px 10px', borderRadius: 6,
          fontSize: 11.5, fontFamily: 'Geist Mono, monospace',
          boxShadow: '0 2px 8px rgba(37,99,235,0.35)',
          display: 'flex', alignItems: 'center', gap: 6,
          zIndex: 6,
        }}>
          <Icons.Maximize size={12} />
          RESIZE MODE · ←↑↓→ resize · R to exit
        </div>
      )}

      {/* Zoom pill */}
      {image && (
        <div className="zoom-pill">
          <button title="Zoom out" onClick={() => zoomBy(1/1.25, size.w/2, size.h/2)}>
            <Icons.Minus size={14} />
          </button>
          <div className="level">{Math.round(view.scale * 100)}%</div>
          <button title="Zoom in" onClick={() => zoomBy(1.25, size.w/2, size.h/2)}>
            <Icons.Plus size={14} />
          </button>
          <button title="Fit to view (F)" onClick={fitToView}>
            <Icons.Maximize size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

// --- Mode-specific control panel that floats above the canvas
const ModePanel = ({ tool, modeOpts, setModeOpts, image, sprites, setSprites }) => {
  if (tool === TOOLS.SELECT) {
    return (
      <div className="mode-panel">
        <div className="label">Select</div>
        <div className="controls">
          <span className="hint">Drag to move • Handles to resize • ←↑↓→ nudge 1px (Shift = 10) • R toggle resize • Del remove</span>
        </div>
      </div>
    );
  }
  if (tool === TOOLS.PAN) {
    return (
      <div className="mode-panel">
        <div className="label">Pan</div>
        <div className="controls">
          <span className="hint">Drag to pan • Scroll to zoom</span>
        </div>
      </div>
    );
  }
  if (tool === TOOLS.FREE) {
    return (
      <div className="mode-panel">
        <div className="label">Free draw</div>
        <div className="controls">
          <div className="field">
            <label>W</label>
            <input type="number" value={modeOpts.fixedW || ''} placeholder="auto"
              onChange={(e) => setModeOpts({ ...modeOpts, fixedW: +e.target.value || 0 })}/>
          </div>
          <div className="field">
            <label>H</label>
            <input type="number" value={modeOpts.fixedH || ''} placeholder="auto"
              onChange={(e) => setModeOpts({ ...modeOpts, fixedH: +e.target.value || 0 })}/>
          </div>
          <button
            className={'btn ' + (modeOpts.locked ? 'primary' : '')}
            onClick={() => setModeOpts({ ...modeOpts, locked: !modeOpts.locked })}
            title={modeOpts.locked ? 'Size locked — click to unlock' : 'Lock size'}
          >
            <span style={{ display:'flex', alignItems:'center', gap:4 }}>
              <Icons.Lock size={12} />
              {modeOpts.locked ? 'Locked' : 'Lock size'}
            </span>
          </button>
          <span className="hint">
            {modeOpts.locked && modeOpts.fixedW
              ? 'Click to place ' + modeOpts.fixedW + '×' + modeOpts.fixedH
              : 'Drag the first box — size locks for the rest'}
          </span>
        </div>
      </div>
    );
  }
  if (tool === TOOLS.CLICK) {
    return (
      <div className="mode-panel">
        <div className="label">Click place</div>
        <div className="controls">
          <div className="field">
            <label>W</label>
            <input type="number" value={modeOpts.fixedW}
              onChange={(e) => setModeOpts({ ...modeOpts, fixedW: Math.max(1, +e.target.value || 1) })}/>
          </div>
          <div className="field">
            <label>H</label>
            <input type="number" value={modeOpts.fixedH}
              onChange={(e) => setModeOpts({ ...modeOpts, fixedH: Math.max(1, +e.target.value || 1) })}/>
          </div>
          <span className="hint">Click on the image to drop a box</span>
        </div>
      </div>
    );
  }
  if (tool === TOOLS.GRID) {
    const apply = () => {
      const boxes = SpriteUtils.gridBoxes(
        image.naturalWidth, image.naturalHeight,
        modeOpts.gridCols, modeOpts.gridRows,
        modeOpts.gridPadX || 0, modeOpts.gridPadY || 0
      );
      const startId = (sprites.length ? Math.max(...sprites.map(s => s.id)) : 0) + 1;
      setSprites([
        ...sprites,
        ...boxes.map((b, i) => ({ id: startId + i, name: '', box: b, customName: false })),
      ]);
    };
    return (
      <div className="mode-panel">
        <div className="label">Grid slice</div>
        <div className="controls">
          <div className="field">
            <label>Cols</label>
            <input type="number" min="1" value={modeOpts.gridCols}
              onChange={(e) => setModeOpts({ ...modeOpts, gridCols: Math.max(1, +e.target.value || 1) })}/>
          </div>
          <div className="field">
            <label>Rows</label>
            <input type="number" min="1" value={modeOpts.gridRows}
              onChange={(e) => setModeOpts({ ...modeOpts, gridRows: Math.max(1, +e.target.value || 1) })}/>
          </div>
          <div className="sep" />
          <div className="field">
            <label title="Padding around each cell">Pad</label>
            <input type="number" min="0" value={modeOpts.gridPadX || 0}
              onChange={(e) => setModeOpts({
                ...modeOpts,
                gridPadX: Math.max(0, +e.target.value || 0),
                gridPadY: Math.max(0, +e.target.value || 0),
              })}/>
          </div>
          <div className="sep" />
          <button className="btn primary" onClick={apply}>
            <Icons.Check size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Slice {modeOpts.gridCols * modeOpts.gridRows}
          </button>
        </div>
      </div>
    );
  }
  if (tool === TOOLS.AUTO) {
    const detect = () => {
      const boxes = SpriteUtils.autoDetectSprites(image, {
        tolerance: modeOpts.autoTolerance || 18,
        minSize: modeOpts.autoMinSize || 8,
        padding: modeOpts.autoPadding || 1,
      });
      // If uniform option is on, expand all boxes to the largest size
      let final = boxes;
      if (modeOpts.autoUniform && boxes.length) {
        const maxW = Math.max(...boxes.map(b => b.w));
        const maxH = Math.max(...boxes.map(b => b.h));
        final = boxes.map(b => {
          const cx = b.x + b.w/2, cy = b.y + b.h/2;
          let nx = Math.round(cx - maxW/2);
          let ny = Math.round(cy - maxH/2);
          nx = Math.max(0, Math.min(image.naturalWidth - maxW, nx));
          ny = Math.max(0, Math.min(image.naturalHeight - maxH, ny));
          return { x: nx, y: ny, w: maxW, h: maxH };
        });
      }
      const startId = (sprites.length ? Math.max(...sprites.map(s => s.id)) : 0) + 1;
      setSprites([
        ...sprites,
        ...final.map((b, i) => ({ id: startId + i, name: '', box: b, customName: false })),
      ]);
    };
    return (
      <div className="mode-panel">
        <div className="label">Auto detect</div>
        <div className="controls">
          <div className="field">
            <label title="Color similarity tolerance">Tol</label>
            <input type="number" min="0" max="200" value={modeOpts.autoTolerance ?? 18}
              onChange={(e) => setModeOpts({ ...modeOpts, autoTolerance: Math.max(0, +e.target.value || 0) })}/>
          </div>
          <div className="field">
            <label title="Min sprite size in px">Min</label>
            <input type="number" min="1" value={modeOpts.autoMinSize ?? 8}
              onChange={(e) => setModeOpts({ ...modeOpts, autoMinSize: Math.max(1, +e.target.value || 1) })}/>
          </div>
          <div className="field">
            <label title="Padding around detected box">Pad</label>
            <input type="number" min="0" value={modeOpts.autoPadding ?? 1}
              onChange={(e) => setModeOpts({ ...modeOpts, autoPadding: Math.max(0, +e.target.value || 0) })}/>
          </div>
          <div className="sep" />
          <label style={{ display:'flex', alignItems:'center', gap: 5, fontSize: 12, color:'var(--ink-2)', cursor:'pointer' }}>
            <input type="checkbox" checked={!!modeOpts.autoUniform}
              onChange={(e) => setModeOpts({ ...modeOpts, autoUniform: e.target.checked })}/>
            Uniform size
          </label>
          <div className="sep" />
          <button className="btn primary" onClick={detect}>
            <Icons.Auto size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Detect
          </button>
        </div>
      </div>
    );
  }
  if (tool === TOOLS.EYEDROPPER) {
    return (
      <div className="mode-panel">
        <div className="label">Eyedropper</div>
        <div className="controls">
          <span className="hint">Click on the image to set background color for removal</span>
        </div>
      </div>
    );
  }
  if (tool === TOOLS.WAND) {
    return (
      <div className="mode-panel">
        <div className="label">Magic wand</div>
        <div className="controls">
          <span className="hint">Click on a region to mark it as background (uses tolerance from sidebar)</span>
        </div>
      </div>
    );
  }
  return null;
};

window.SpriteCanvas = SpriteCanvas;
window.TOOLS = TOOLS;
