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
