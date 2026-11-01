import type { ReactNode } from 'react';

/** Small stroke icons (24x24). Decorative: the buttons that use them carry the accessible name. */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconFiles = () => (
  <Svg>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4l2 2.5h7A1.5 1.5 0 0 1 20 8v10.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
  </Svg>
);
export const IconBuild = () => (
  <Svg>
    <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z" />
  </Svg>
);
export const IconDevice = () => (
  <Svg>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M11 18h2" />
  </Svg>
);
export const IconSparkle = () => (
  <Svg>
    <path d="M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8z" />
    <path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Svg>
);
export const IconTerminal = () => (
  <Svg>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M7.5 10l3 2.5-3 2.5M13 15h4" />
  </Svg>
);
export const IconStore = () => (
  <Svg>
    <path d="M12 3.5l7 3v5.2c0 4-2.8 7.2-7 8.8-4.2-1.6-7-4.8-7-8.8V6.5z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Svg>
);
export const IconLock = () => (
  <Svg>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);
export const IconSettings = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
  </Svg>
);

/** Tree icons (16px, filled shapes). Colour comes from CSS classes. */
function Tree({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={`tico ${className ?? ''}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
export const TreeFolder = ({ open }: { open?: boolean }) => (
  <Tree className="tico-folder">
    {open ? <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5V6H4.2a1.5 1.5 0 0 0-1.4 1L1.5 11z M3.2 7.5h11.6a.7.7 0 0 1 .67.9l-1.2 4.1a1.3 1.3 0 0 1-1.25.95H2.6z" /> : <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5v7A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5z" />}
  </Tree>
);
export const TreeSwift = () => (
  <Tree className="tico-swift">
    <path d="M13.6 11.7c.9-2.6-.1-5.6-2.6-7.8.9 1.1 1.3 2.4 1 3.6-1.4-1.2-3.6-3-5.2-4.6.8 1.7 2.1 3.6 3.6 5.2-2-1.1-4.5-2.9-6.4-4.6 1.5 2.4 3.9 5 6.4 6.6-2.2 1-5 .7-6.7-.6.9 1.4 2.8 2.7 5 3 2.4.3 4.4-.4 4.9-1.4z" />
  </Tree>
);
export const TreeConfig = () => (
  <Tree className="tico-config">
    <path d="M3 1.5h6.2L13 5.3V14a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14zM8.7 2.2v3.1h3.1zM5 8h6v1H5zm0 2.2h6v1H5z" />
  </Tree>
);
export const TreeFile = () => (
  <Tree className="tico-file">
    <path d="M3 1.5h6.2L13 5.3V14a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14zM8.7 2.2v3.1h3.1z" />
  </Tree>
);
export const TreePackage = () => (
  <Tree className="tico-package">
    <path d="M8 1.3l5.7 2.9v6.6L8 13.7 2.3 10.8V4.2zm0 1.2L4 4.6l4 2 4-2zM3.5 5.6v4.5L7.4 12V7.6zm9 0L8.6 7.6V12l3.9-1.9z" />
  </Tree>
);
export const IconRefresh = () => (
  <Svg>
    <path d="M19 8a7.5 7.5 0 0 0-13.5-1.5L4 8M5 16a7.5 7.5 0 0 0 13.5 1.5L20 16M4 4v4h4M20 20v-4h-4" />
  </Svg>
);
export const IconCollapse = () => (
  <Svg>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 12h8" />
  </Svg>
);
