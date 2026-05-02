// Toolbox (left rail) — tool buttons.

const Toolbar = ({ tool, setTool, hasImage }) => {
  const Btn = ({ id, icon: I, label, kbd, divider }) => (
    <>
      {divider && <div className="tool-divider" />}
      <button
        className={'tool-btn' + (tool === id ? ' active' : '')}
        onClick={() => setTool(id)}
        disabled={!hasImage}
        aria-label={label}
      >
        <I size={18} />
        {kbd && <span className="kbd">{kbd}</span>}
        <span className="tip">{label}<span className="kbd-tip">{kbd}</span></span>
      </button>
    </>
  );
  return (
    <aside className="toolbox">
      <Btn id={TOOLS.SELECT} icon={Icons.Cursor} label="Select" kbd="V" />
      <Btn id={TOOLS.PAN} icon={Icons.Hand} label="Pan" kbd="H" />
      <Btn id={TOOLS.FREE} icon={Icons.CropFree} label="Free draw (locks size)" kbd="M" divider />
      <Btn id={TOOLS.GRID} icon={Icons.Grid} label="Grid slice" kbd="G" />
      <Btn id={TOOLS.CLICK} icon={Icons.Click} label="Click to place" kbd="C" />
      <Btn id={TOOLS.AUTO} icon={Icons.Auto} label="Auto-detect" kbd="A" />
      <Btn id={TOOLS.EYEDROPPER} icon={Icons.Eyedropper} label="Pick BG color" kbd="I" divider />
      <Btn id={TOOLS.WAND} icon={Icons.Wand} label="Magic wand" kbd="W" />
    </aside>
  );
};

window.Toolbar = Toolbar;
