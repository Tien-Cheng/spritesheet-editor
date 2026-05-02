// Top-level App: state + composition.

const App = () => {
  const [image, setImage] = React.useState(null);
  const [sprites, setSprites] = React.useState([]); // {id, name, box:{x,y,w,h}, customName}
  const [selectedId, setSelectedId] = React.useState(null);
  const [tool, setTool] = React.useState(TOOLS.SELECT);
  const [modeOpts, setModeOpts] = React.useState({
    fixedW: 64, fixedH: 64, locked: false,
    gridCols: 4, gridRows: 4, gridPadX: 0, gridPadY: 0,
    autoTolerance: 18, autoMinSize: 12, autoPadding: 0, autoUniform: true,
    autoClose: 1, autoMerge: 6,
  });
  const [bgRemoval, setBgRemoval] = React.useState({
    mode: null, // null | 'color' | 'wand' | 'ai'
    color: [255, 255, 255],
    tolerance: 16,
  });

  // Load image (file -> Image)
  const loadFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const img = await SpriteUtils.loadImageFile(file);
    img._fileName = file.name;
    setImage(img);
    setSprites([]);
    setSelectedId(null);
    // Default click-place size to 1/4 of width
    setModeOpts(o => ({
      ...o,
      fixedW: Math.max(16, Math.round(img.naturalWidth / 4)),
      fixedH: Math.max(16, Math.round(img.naturalHeight / 4)),
    }));
    // Switch to free-draw tool to invite cropping
    setTool(TOOLS.FREE);
  };

  const onResetImage = () => {
    if (sprites.length && !confirm('Replace image and discard sprites?')) return;
    setImage(null);
    setSprites([]);
    setSelectedId(null);
    setTool(TOOLS.SELECT);
  };

  // Eyedropper result -> set bg removal color + auto-enable color BG
  const onEyedropperResult = (rgba, p) => {
    setBgRemoval(prev => ({
      ...prev,
      color: [rgba[0], rgba[1], rgba[2]],
      mode: 'color',
    }));
    // Bounce back to select tool for convenience
    setTool(TOOLS.SELECT);
  };

  // Magic wand: click to add a per-export flood-fill seed.
  // We'll implement this as a single seed (most common case): on click, set
  // bgRemoval mode='wand' with seedX/seedY in image coords.
  const onWandClick = (p) => {
    setBgRemoval(prev => ({
      ...prev,
      mode: 'wand',
      seedX: p.x,
      seedY: p.y,
    }));
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">SS</div>
          Spritesheet Editor
        </div>
        <div className="meta">
          {image
            ? `${image.naturalWidth}×${image.naturalHeight} · ${sprites.length} sprite${sprites.length===1?'':'s'}`
            : 'no image loaded'}
        </div>
        <div className="spacer" />
        <div className="meta" style={{ fontSize: 11 }}>
          ⏎ Rename · Del Delete · Space Pan · Scroll Zoom
        </div>
      </header>

      <Toolbar tool={tool} setTool={setTool} hasImage={!!image} />

      <SpriteCanvas
        image={image}
        sprites={sprites} setSprites={setSprites}
        selectedId={selectedId} setSelectedId={setSelectedId}
        tool={tool} setTool={setTool}
        modeOpts={modeOpts} setModeOpts={setModeOpts}
        bgRemoval={bgRemoval}
        onEyedropperResult={onEyedropperResult}
        onWandClick={onWandClick}
        onUploadFile={loadFile}
      />

      <SpriteSidebar
        image={image}
        sprites={sprites} setSprites={setSprites}
        selectedId={selectedId} setSelectedId={setSelectedId}
        bgRemoval={bgRemoval} setBgRemoval={setBgRemoval}
        onResetImage={onResetImage}
      />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
