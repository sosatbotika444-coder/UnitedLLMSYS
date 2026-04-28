const iconNames = [
  "home",
  "dashboard",
  "fleet",
  "chart",
  "profit",
  "road",
  "route",
  "history",
  "approvals",
  "table",
  "chat",
  "settings",
  "more",
  "admin",
  "safety",
  "driver",
  "fuel",
  "service",
  "emergency",
  "privacy",
  "docs",
  "about",
  "search",
  "plus",
  "logout",
  "menu",
  "chevron-left",
  "chevron-right",
  "spark",
  "success",
  "warning",
  "error",
  "info",
  "theme",
  "sun",
  "moon",
  "download",
  "mobile",
  "user",
];

function IconFrame({ children, size = 20, className = "", title = "" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

function Stroke({ children }) {
  return (
    <g
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    >
      {children}
    </g>
  );
}

export function UnitedIcon({ name = "spark", size = 20, className = "", title = "" }) {
  switch (name) {
    case "home":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M3.5 10.5 12 3.75l8.5 6.75" />
            <path d="M6.25 9.75V19.5h11.5V9.75" />
            <path d="M9.75 19.5v-4.5h4.5v4.5" />
          </Stroke>
        </IconFrame>
      );
    case "dashboard":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <rect x="3.5" y="4" width="7.25" height="7.25" rx="2.2" />
            <rect x="13.25" y="4" width="7.25" height="4.75" rx="2" />
            <rect x="13.25" y="11.25" width="7.25" height="8.75" rx="2.2" />
            <rect x="3.5" y="13.75" width="7.25" height="6.25" rx="2.2" />
          </Stroke>
        </IconFrame>
      );
    case "fleet":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M3.5 8.75h11.25l2 2.5h3.75v5.25H19" />
            <path d="M3.5 8.75v7.75h1.75" />
            <path d="M7.25 16.5h6.5" />
            <circle cx="6.25" cy="16.75" r="1.75" />
            <circle cx="17.75" cy="16.75" r="1.75" />
            <path d="M11 8.75V5.5h3.75" />
          </Stroke>
        </IconFrame>
      );
    case "chart":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M4 19.5h16" />
            <path d="M7 16.5V11" />
            <path d="M12 16.5V7.5" />
            <path d="M17 16.5V9.25" />
            <path d="m6.5 8.5 4-3 4 1.75 3.5-2.5" />
            <circle cx="6.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
            <circle cx="10.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
            <circle cx="14.5" cy="7.25" r="1" fill="currentColor" stroke="none" />
            <circle cx="18" cy="4.75" r="1" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "profit":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M4 18.5h16" />
            <path d="M6.25 15.5 10 11.75l3 2.5 5.25-6" />
            <path d="M15.25 8.25H18.5v3.25" />
            <path d="M12 4v15.5" />
          </Stroke>
        </IconFrame>
      );
    case "road":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M9 4.5 6.25 19.5" />
            <path d="M15 4.5l2.75 15" />
            <path d="M10.75 7.25h2.5" />
            <path d="M10 11.5h4" />
            <path d="M9.25 15.75h5.5" />
          </Stroke>
        </IconFrame>
      );
    case "route":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="6.5" cy="6.5" r="2.5" />
            <circle cx="17.5" cy="17.5" r="2.5" />
            <path d="M8.5 6.5h3.25c2.9 0 5.25 2.35 5.25 5.25v3.25" />
            <path d="m14.5 12.75 2.5 2.5 2.5-2.5" />
          </Stroke>
        </IconFrame>
      );
    case "history":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
            <path d="M4 5.5v4h4" />
            <path d="M12 8.25v4l2.75 1.75" />
          </Stroke>
        </IconFrame>
      );
    case "approvals":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 3.5 18.5 6v5c0 4.35-2.65 7.85-6.5 9.5C8.15 18.85 5.5 15.35 5.5 11V6L12 3.5Z" />
            <path d="m9.25 11.75 2 2 3.5-4" />
          </Stroke>
        </IconFrame>
      );
    case "table":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
            <path d="M3.5 9.5h17" />
            <path d="M9.25 5v14" />
            <path d="M14.75 5v14" />
          </Stroke>
        </IconFrame>
      );
    case "chat":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M5.25 6.25h13.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10.5L6 20v-2.75H5.25a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
            <path d="M7.75 10.5h8.5" />
            <path d="M7.75 13.5h5.75" />
          </Stroke>
        </IconFrame>
      );
    case "settings":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="12" r="3.25" />
            <path d="M12 3.5v2.25" />
            <path d="M12 18.25v2.25" />
            <path d="m5.98 5.98 1.6 1.6" />
            <path d="m16.42 16.42 1.6 1.6" />
            <path d="M3.5 12h2.25" />
            <path d="M18.25 12h2.25" />
            <path d="m5.98 18.02 1.6-1.6" />
            <path d="m16.42 7.58 1.6-1.6" />
          </Stroke>
        </IconFrame>
      );
    case "more":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="6" cy="12" r="1.35" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
            <circle cx="18" cy="12" r="1.35" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "admin":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 4.25 18.5 7v4.5c0 3.9-2.45 7.15-6.5 8.75-4.05-1.6-6.5-4.85-6.5-8.75V7L12 4.25Z" />
            <path d="M9 11.75h6" />
            <path d="M12 8.75v6" />
          </Stroke>
        </IconFrame>
      );
    case "safety":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 3.5 18.5 6v5c0 4.35-2.65 7.85-6.5 9.5C8.15 18.85 5.5 15.35 5.5 11V6L12 3.5Z" />
            <path d="M12 8v4.25" />
            <circle cx="12" cy="15.5" r=".95" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "driver":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="8" r="3.25" />
            <path d="M6 19c1.3-3.1 3.4-4.75 6-4.75S16.7 15.9 18 19" />
            <path d="M4 19h16" />
          </Stroke>
        </IconFrame>
      );
    case "fuel":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M7.25 4.5h6a2 2 0 0 1 2 2v13H7.25a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
            <path d="M15.25 8.5h1.9l1.6 1.65v4.1c0 .75-.6 1.35-1.35 1.35H15.25" />
            <path d="M9 8h4.5" />
            <path d="M9 11h4.5" />
          </Stroke>
        </IconFrame>
      );
    case "service":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="m14 5 5 5" />
            <path d="m10 19-5-5" />
            <path d="m8.75 11.5 6.75-6.75 2.25 2.25L11 13.75" />
            <path d="m4.75 15.5 3.75-3.75 3.75 3.75-3.75 3.75Z" />
          </Stroke>
        </IconFrame>
      );
    case "emergency":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 4.25 4.75 7.5v5.15c0 4 2.55 6.95 7.25 8.1 4.7-1.15 7.25-4.1 7.25-8.1V7.5L12 4.25Z" />
            <path d="M12 8v7.75" />
            <path d="M8.25 11.875h7.5" />
          </Stroke>
        </IconFrame>
      );
    case "privacy":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <rect x="5.5" y="10" width="13" height="9.5" rx="2.25" />
            <path d="M8 10V7.75A4 4 0 0 1 12 3.75a4 4 0 0 1 4 4V10" />
            <circle cx="12" cy="14.75" r="1" fill="currentColor" stroke="none" />
            <path d="M12 15.75v2.25" />
          </Stroke>
        </IconFrame>
      );
    case "docs":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M7 4.5h7l4 4v11a1.9 1.9 0 0 1-1.9 1.9H7A1.9 1.9 0 0 1 5.1 19.5V6.4A1.9 1.9 0 0 1 7 4.5Z" />
            <path d="M14 4.5v4h4" />
            <path d="M8.5 12h7" />
            <path d="M8.5 15.25h5.25" />
          </Stroke>
        </IconFrame>
      );
    case "about":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 10.25v5.25" />
            <circle cx="12" cy="7.5" r=".95" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "search":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="10.5" cy="10.5" r="5.5" />
            <path d="m15 15 4.25 4.25" />
          </Stroke>
        </IconFrame>
      );
    case "plus":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </Stroke>
        </IconFrame>
      );
    case "logout":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M10 4.5H6.5A2.5 2.5 0 0 0 4 7v10a2.5 2.5 0 0 0 2.5 2.5H10" />
            <path d="M14 8.25 19 12l-5 3.75" />
            <path d="M19 12H9.75" />
          </Stroke>
        </IconFrame>
      );
    case "menu":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M4.5 7h15" />
            <path d="M4.5 12h15" />
            <path d="M4.5 17h15" />
          </Stroke>
        </IconFrame>
      );
    case "chevron-left":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="m14.75 5.5-6.5 6.5 6.5 6.5" />
          </Stroke>
        </IconFrame>
      );
    case "chevron-right":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="m9.25 5.5 6.5 6.5-6.5 6.5" />
          </Stroke>
        </IconFrame>
      );
    case "spark":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="m12 3.75 1.6 4.15L17.75 9.5l-4.15 1.6L12 15.25l-1.6-4.15L6.25 9.5l4.15-1.6L12 3.75Z" />
            <path d="m18.5 14.75.75 1.85 1.85.75-1.85.75-.75 1.9-.75-1.9-1.85-.75 1.85-.75.75-1.85Z" />
            <path d="m5.5 14.25.65 1.45 1.45.65-1.45.65-.65 1.45-.65-1.45-1.45-.65 1.45-.65.65-1.45Z" />
          </Stroke>
        </IconFrame>
      );
    case "success":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="12" r="8.5" />
            <path d="m8.25 12 2.5 2.5 5-5" />
          </Stroke>
        </IconFrame>
      );
    case "warning":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 4.5 20 18.5H4L12 4.5Z" />
            <path d="M12 9v4.5" />
            <circle cx="12" cy="16.25" r=".95" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "error":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="12" r="8.5" />
            <path d="m9 9 6 6" />
            <path d="m15 9-6 6" />
          </Stroke>
        </IconFrame>
      );
    case "info":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 10.75v5" />
            <circle cx="12" cy="7.75" r=".95" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "theme":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 3.75a8.25 8.25 0 1 0 0 16.5c1.1 0 2-.9 2-2 0-.55-.2-1.05-.55-1.45a2.15 2.15 0 0 1 1.75-3.55h1.3A4.5 4.5 0 0 0 21 8.75c0-2.75-3.7-5-9-5Z" />
            <circle cx="7.75" cy="10" r=".95" fill="currentColor" stroke="none" />
            <circle cx="10.25" cy="7" r=".95" fill="currentColor" stroke="none" />
            <circle cx="14.25" cy="7.25" r=".95" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "sun":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="12" r="3.75" />
            <path d="M12 3.75v2.5" />
            <path d="M12 17.75v2.5" />
            <path d="m5.75 5.75 1.75 1.75" />
            <path d="m16.5 16.5 1.75 1.75" />
            <path d="M3.75 12h2.5" />
            <path d="M17.75 12h2.5" />
            <path d="m5.75 18.25 1.75-1.75" />
            <path d="m16.5 7.5 1.75-1.75" />
          </Stroke>
        </IconFrame>
      );
    case "moon":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M16.75 4.75a7.75 7.75 0 1 0 2.5 14.95A8.25 8.25 0 0 1 16.75 4.75Z" />
          </Stroke>
        </IconFrame>
      );
    case "download":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <path d="M12 4.75v10.5" />
            <path d="m8.75 12.5 3.25 3.25 3.25-3.25" />
            <path d="M5 19.25h14" />
          </Stroke>
        </IconFrame>
      );
    case "mobile":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <rect x="7.25" y="3.75" width="9.5" height="16.5" rx="2.35" />
            <path d="M11 6.5h2" />
            <circle cx="12" cy="17.25" r=".95" fill="currentColor" stroke="none" />
          </Stroke>
        </IconFrame>
      );
    case "user":
      return (
        <IconFrame size={size} className={className} title={title}>
          <Stroke>
            <circle cx="12" cy="8.25" r="3.25" />
            <path d="M5.5 19c1.25-3.25 3.4-5 6.5-5s5.25 1.75 6.5 5" />
          </Stroke>
        </IconFrame>
      );
    default:
      return <UnitedIcon name="spark" size={size} className={className} title={title} />;
  }
}

export { iconNames as unitedIconNames };
