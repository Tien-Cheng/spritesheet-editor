// Sidebar: BG removal controls + sprite list + export

const SpriteSidebar = ({
  image,
  sprites, setSprites,
  selectedId, setSelectedId,
  bgRemoval, setBgRemoval,
  onResetImage,
}) => {
  const [renamingId, setRenamingId] = React.useState(null);
  const [exporting, setExporting] = React.useState(false);
  const [thumbs, setThumbs] = React.useState({});
  const [toast, setToast] = React.useState(null);
  const [aiState, setAiState] = React.useState({ running: false, done: 0, total: 0 });

  // Show toast
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  // Generate thumbnails when sprites or bg removal changes
  React.useEffect(() => {
    if (!image) { setThumbs({}); return; }
    const next = {};
    let active = true;
    (async () => {
      for (const s of sprites) {
        const c = await SpriteUtils.cropSprite(image, s.box, bgRemoval);
        if (!c || !active) continue;
        next[s.id] = c.toDataURL('image/png');
      }
      if (active) setThumbs(next);
    })();
    return () => { active = false; };
  }, [image, sprites, bgRemoval]);

  // Compute uniform size info
  const sizeStats = React.useMemo(() => {
    if (!sprites.length) return null;
    const sizes = sprites.map(s => `${s.box.w}×${s.box.h}`);
    const uniq = [...new Set(sizes)];
    return {
      uniform: uniq.length === 1,
      sizes: uniq,
      maxW: Math.max(...sprites.map(s => s.box.w)),
      maxH: Math.max(...sprites.map(s => s.box.h)),
    };
  }, [sprites]);

  const normalizeAllToMax = () => {
    if (!image || !sizeStats) return;
    const w = sizeStats.maxW, h = sizeStats.maxH;
    setSprites(prev => prev.map(s => {
      const cx = s.box.x + s.box.w/2;
      const cy = s.box.y + s.box.h/2;
      let nx = Math.round(cx - w/2);
      let ny = Math.round(cy - h/2);
      nx = Math.max(0, Math.min(image.naturalWidth - w, nx));
      ny = Math.max(0, Math.min(image.naturalHeight - h, ny));
      return { ...s, box: { x: nx, y: ny, w, h } };
    }));
    showToast(`Normalized all sprites to ${w}×${h}`);
  };

  const clearBg = () => setBgRemoval({ mode: null, color: [255,255,255], tolerance: 16 });

  // True when AI mode is active but some sprite boxes have changed since
  // inference (their boxKey is missing from the cache).
  const aiStale = React.useMemo(() => {
    if (bgRemoval.mode !== 'ai' || !bgRemoval.aiCache) return false;
    return sprites.some(s => !bgRemoval.aiCache.has(window.AIBackgroundRemoval.boxKey(s.box)));
  }, [sprites, bgRemoval]);

  const onAiRemove = async () => {
    if (!image || !sprites.length) return;
    setAiState({ running: true, done: 0, total: sprites.length });
    const firstRun = !window.__benSegmenterAttempted;
    window.__benSegmenterAttempted = true;
    if (firstRun) showToast('Loading model… (~80MB on first use)');
    try {
      const cache = await window.AIBackgroundRemoval.processSpritesAI(
        image, sprites,
        (d, t) => setAiState({ running: true, done: d, total: t }),
      );
      setBgRemoval({ ...bgRemoval, mode: 'ai', aiCache: cache });
      showToast(`AI removed background on ${sprites.length} sprite${sprites.length === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[ai-bg] failed:', err);
      showToast(`AI failed: ${err?.message || err}`);
    } finally {
      setAiState({ running: false, done: 0, total: 0 });
    }
  };

  // Export all sprites as zip
  const onExport = async () => {
    if (!image || !sprites.length) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      const used = {};
      for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        const c = await SpriteUtils.cropSprite(image, s.box, bgRemoval);
        if (!c) continue;
        const blob = await SpriteUtils.canvasToBlob(c);
        let base = s.customName && s.name
          ? SpriteUtils.safeName(s.name)
          : `sprite_${String(i+1).padStart(2,'0')}`;
        let name = base;
        let n = 2;
        while (used[name]) { name = `${base}_${n++}`; }
        used[name] = true;
        zip.file(name + '.png', blob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sprites.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Exported ${sprites.length} sprite${sprites.length === 1 ? '' : 's'}`);
    } finally {
      setExporting(false);
    }
  };

  const onRename = (id, name) => {
    setSprites(prev => prev.map(s => s.id === id ? { ...s, name, customName: !!name } : s));
  };
  const onDelete = (id) => {
    setSprites(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const clearAll = () => {
    if (!sprites.length) return;
    if (confirm(`Remove all ${sprites.length} sprites?`)) {
      setSprites([]);
      setSelectedId(null);
    }
  };

  const [r, g, b] = bgRemoval.color || [255,255,255];
  const colorHex = SpriteUtils.rgbToHex(r, g, b);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Icons.Image size={14} />
        Spritesheet
      </div>

      {/* Image meta + reset */}
      <div className="sidebar-section">
        {image ? (
          <div className="bbox-info">
            <div className="row"><span className="k">file</span>
              <span style={{
                maxWidth: 130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
              }}>{image._fileName || 'image'}</span></div>
            <div className="row"><span className="k">size</span>
              <span>{image.naturalWidth}×{image.naturalHeight}</span></div>
            <div className="row" style={{ gridColumn: '1 / -1', marginTop: 4 }}>
              <button onClick={onResetImage}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  padding: '4px 8px', borderRadius: 4, fontSize: 11.5,
                  color: 'var(--ink-3)', cursor: 'pointer', width: '100%',
                }}>
                <Icons.Refresh size={11} style={{ verticalAlign:'-1px', marginRight: 4 }} />
                Replace image
              </button>
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--ink-4)', fontSize: 12 }}>No image loaded</div>
        )}
      </div>

      {/* Background removal */}
      <div className="sidebar-section">
        <h3>Background removal</h3>
        <div className="bg-row">
          <label>Color</label>
          <input
            type="color"
            value={colorHex}
            onChange={(e) => setBgRemoval({
              ...bgRemoval,
              color: SpriteUtils.hexToRgb(e.target.value),
            })}
            style={{
              width: 32, height: 24, border: '1px solid var(--border-strong)',
              borderRadius: 4, padding: 0, background: 'transparent', cursor: 'pointer',
            }}
          />
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {colorHex.toUpperCase()}
          </span>
        </div>
        <div className="bg-row">
          <label>Tolerance</label>
          <input type="range" min="0" max="120"
            value={bgRemoval.tolerance}
            onChange={(e) => setBgRemoval({ ...bgRemoval, tolerance: +e.target.value })}/>
          <span className="tolerance-readout">{bgRemoval.tolerance}</span>
        </div>
        <div className="bg-actions">
          <button
            className={bgRemoval.mode === 'color' ? 'primary' : ''}
            onClick={() => setBgRemoval({ ...bgRemoval, mode: bgRemoval.mode === 'color' ? null : 'color', wandSeeds: [] })}
            title="Make pixels matching the color transparent on every export">
            {bgRemoval.mode === 'color' ? <Icons.Check size={12}/> : null}
            {bgRemoval.mode === 'color' ? ' Color BG on' : 'Color BG'}
          </button>
          <button
            className={bgRemoval.mode === 'ai' && !aiStale ? 'primary' : ''}
            disabled={!image || !sprites.length || aiState.running}
            onClick={onAiRemove}
            title="Run BEN2 (AI) to remove background per sprite — works on noisy or photographic art">
            {aiState.running
              ? `AI… ${aiState.done}/${aiState.total}`
              : (bgRemoval.mode === 'ai'
                  ? (aiStale ? 'AI Remove · stale' : <><Icons.Check size={12}/> AI on</>)
                  : 'AI Remove')}
          </button>
          <button onClick={clearBg} disabled={!bgRemoval.mode}>
            <Icons.X size={11} style={{ verticalAlign:'-1px' }}/> Clear
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          Use the <strong>eyedropper</strong> (I) to pick a color from the image, the
          <strong> magic wand</strong> (W) to flood-fill from a click, or
          <strong> AI Remove</strong> for noisy / photographic sprites
          (downloads ~80MB on first use, runs locally). Removal is applied
          on export &amp; in thumbnails — your source image is preserved.
        </div>
      </div>

      {/* Sprite list */}
      <div className="sidebar-header" style={{ borderTop: '1px solid var(--border)' }}>
        Sprites
        <span className="count">{sprites.length}</span>
        <div className="spacer" />
        {sprites.length > 1 && sizeStats && !sizeStats.uniform && (
          <button className="icon-btn" title={`Normalize all to ${sizeStats.maxW}×${sizeStats.maxH}`}
            onClick={normalizeAllToMax}>
            <Icons.Maximize size={13} />
          </button>
        )}
        {sprites.length > 0 && (
          <button className="icon-btn" title="Clear all" onClick={clearAll}>
            <Icons.Trash size={13} />
          </button>
        )}
      </div>

      {sizeStats && !sizeStats.uniform && (
        <div style={{
          padding: '8px 14px',
          background: '#fef3c7',
          borderBottom: '1px solid #fde68a',
          fontSize: 11.5,
          color: '#854d0e',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ flex: 1 }}>
            Mixed sizes: {sizeStats.sizes.slice(0, 3).join(', ')}
            {sizeStats.sizes.length > 3 ? '…' : ''}
          </span>
          <button onClick={normalizeAllToMax}
            style={{
              background: '#854d0e', color: '#fef3c7', border: 0,
              padding: '3px 7px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
            }}>
            Normalize
          </button>
        </div>
      )}

      <div className="sprite-list">
        {sprites.map((s, i) => (
          <div key={s.id}
            className={'sprite-card' + (selectedId === s.id ? ' selected' : '')}
            onClick={() => setSelectedId(s.id)}>
            <div className="sprite-thumb">
              {thumbs[s.id] && <img src={thumbs[s.id]} alt="" />}
            </div>
            <div className="sprite-meta">
              <div className="sprite-name">
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    defaultValue={s.name || `sprite_${String(i+1).padStart(2,'0')}`}
                    onBlur={(e) => { onRename(s.id, e.target.value); setRenamingId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { onRename(s.id, e.target.value); setRenamingId(null); }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  s.customName && s.name ? s.name : `sprite_${String(i+1).padStart(2,'0')}`
                )}
              </div>
              <div className="sprite-dims">
                {s.box.w}×{s.box.h}
                <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>
                  @ {s.box.x},{s.box.y}
                </span>
              </div>
            </div>
            <div className="actions">
              <button title="Rename" onClick={(e) => { e.stopPropagation(); setRenamingId(s.id); }}>
                <Icons.Edit size={12} />
              </button>
              <button title="Delete" className="danger"
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}>
                <Icons.Trash size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="export-btn"
          disabled={!sprites.length || exporting}
          onClick={onExport}>
          <Icons.Download size={14} />
          {exporting ? 'Exporting…' : `Export ${sprites.length || ''} as ZIP`.trim()}
        </button>
        <div className="export-meta">
          {sprites.length
            ? `${sprites.length} PNG${sprites.length===1?'':'s'}${bgRemoval.mode ? (bgRemoval.mode === 'ai' ? ' · BG removed (AI)' : ' · BG removed') : ''}`
            : 'Crop sprites to enable export'}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </aside>
  );
};

window.SpriteSidebar = SpriteSidebar;
