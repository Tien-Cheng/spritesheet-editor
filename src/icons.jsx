// Inline SVG icons. All 18px stroke-based, currentColor.
const Icon = ({ d, size = 18, fill, stroke = 'currentColor', strokeWidth = 1.6, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
       fill={fill || 'none'} stroke={stroke} strokeWidth={strokeWidth}
       strokeLinecap="round" strokeLinejoin="round" {...rest}>
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  Cursor: (p) => <Icon {...p}><path d="M5 3l7 16 2-7 7-2z" /></Icon>,
  Hand: (p) => <Icon {...p}><path d="M9 11V5.5a1.5 1.5 0 013 0V10" /><path d="M12 10V4.5a1.5 1.5 0 013 0V11" /><path d="M15 11V6.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6.5 7S5 18 5 14v-2.5a1.5 1.5 0 013 0V13" /></Icon>,
  CropFree: (p) => <Icon {...p}><path d="M4 8V4h4" /><path d="M16 4h4v4" /><path d="M20 16v4h-4" /><path d="M8 20H4v-4" /><rect x="8" y="8" width="8" height="8" /></Icon>,
  Grid: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></Icon>,
  Click: (p) => <Icon {...p}><rect x="4" y="4" width="10" height="10" /><path d="M14 14l3 3M17 14l3 3M14 17l3-3M17 17l3-3" strokeWidth="1.4" /></Icon>,
  Auto: (p) => <Icon {...p}><path d="M3 7l4-4 4 4M7 3v8" /><path d="M21 17l-4 4-4-4M17 21v-8" /><circle cx="12" cy="12" r="2" /></Icon>,
  Eyedropper: (p) => <Icon {...p}><path d="M16 3l5 5-3 3-2-2-7 7-3 1 1-3 7-7-2-2 4-2z" /></Icon>,
  Wand: (p) => <Icon {...p}><path d="M3 21l12-12" /><path d="M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /><path d="M19 11l.7 1.4 1.4.6-1.4.6L19 15l-.7-1.4-1.4-.6 1.4-.6z" /></Icon>,
  Plus: (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>,
  Minus: (p) => <Icon {...p}><path d="M5 12h14" /></Icon>,
  Maximize: (p) => <Icon {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Icon>,
  Trash: (p) => <Icon {...p}><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M6 6l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" /></Icon>,
  Edit: (p) => <Icon {...p}><path d="M14 4l4 4M3 21l4-1L20 7l-3-3L4 17l-1 4z" /></Icon>,
  Download: (p) => <Icon {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></Icon>,
  Upload: (p) => <Icon {...p}><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></Icon>,
  Image: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.6" /><path d="M21 15l-5-5L5 21" /></Icon>,
  Refresh: (p) => <Icon {...p}><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></Icon>,
  X: (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>,
  Check: (p) => <Icon {...p}><path d="M5 12l5 5 9-11" /></Icon>,
  Lock: (p) => <Icon {...p}><rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V7a4 4 0 018 0v4" /></Icon>,
  Eye: (p) => <Icon {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>,
};

window.Icons = Icons;
