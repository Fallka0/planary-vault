// 24-grid outline icons, currentColor. As few as possible; the lock is the only security signal.

type P = { className?: string };

function Svg({ children, className, width = 1.8 }: { children: React.ReactNode; className?: string; width?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {children}
    </svg>
  );
}

export const Plus = (p: P) => <Svg {...p} width={2}><path d="M12 5v14M5 12h14" /></Svg>;
export const Search = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const Lock = (p: P) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const Folder = (p: P) => <Svg {...p} width={1.6}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Svg>;
export const ListIcon = (p: P) => <Svg {...p}><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></Svg>;
export const GridIcon = (p: P) => <Svg {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></Svg>;
export const ChevronDown = (p: P) => <Svg {...p} width={2}><path d="m6 9 6 6 6-6" /></Svg>;
export const ChevronLeft = (p: P) => <Svg {...p} width={2}><path d="m15 18-6-6 6-6" /></Svg>;
export const ChevronRight = (p: P) => <Svg {...p} width={2}><path d="m9 18 6-6-6-6" /></Svg>;
export const More = (p: P) => <Svg {...p} width={2.4}><path d="M5 12h.01M12 12h.01M19 12h.01" /></Svg>;
export const Close = (p: P) => <Svg {...p} width={2}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const Check = (p: P) => <Svg {...p} width={2}><path d="m5 12 5 5L20 7" /></Svg>;
export const Download = (p: P) => <Svg {...p} width={2}><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" /></Svg>;
export const Alert = (p: P) => <Svg {...p} width={2}><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" /></Svg>;
export const ArrowRight = (p: P) => <Svg {...p} width={2}><path d="M5 12h14m0 0-6-6m6 6-6 6" /></Svg>;
export const ArrowUpRight = (p: P) => <Svg {...p} width={2.2}><path d="M7 17 17 7M9 7h8v8" /></Svg>;
export const Menu = (p: P) => <Svg {...p} width={2}><path d="M5 9h14M5 15h14" /></Svg>;
