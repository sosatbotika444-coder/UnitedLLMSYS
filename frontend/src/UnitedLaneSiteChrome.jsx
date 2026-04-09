export const sitePanels = {
  about: {
    eyebrow: "About Us",
    title: "United Lane LLC",
    paragraphs: [
      "United Lane LLC brings dispatch, routing, live tracking, and driver support into one operations workspace.",
      "The goal is simple: give the team one clean place to manage loads, stay aligned with drivers, and make fast decisions during the day."
    ]
  },
  privacy: {
    eyebrow: "Privacy & Terms",
    title: "Internal Operations Notice",
    paragraphs: [
      "This workspace is intended for authorized company use and may contain load, route, driver, and fleet information.",
      "Operational data should be handled only for dispatch, safety, compliance, and customer support workflows according to your company policy."
    ]
  }
};

export function UnitedLaneMark({ className = "" }) {
  const classes = ["united-lane-mark", className].filter(Boolean).join(" ");

  return (
    <svg className={classes} viewBox="0 0 184 92" aria-hidden="true">
      <polygon points="8,74 54,18 96,18 50,74" fill="#145694" />
      <circle cx="29" cy="32" r="3.5" fill="#ffffff" />
      <circle cx="46" cy="28" r="3.5" fill="#ffffff" />
      <circle cx="63" cy="25" r="3.5" fill="#ffffff" />
      <circle cx="39" cy="45" r="3.5" fill="#ffffff" />
      <circle cx="56" cy="42" r="3.5" fill="#ffffff" />
      <circle cx="73" cy="38" r="3.5" fill="#ffffff" />
      <circle cx="50" cy="58" r="3.5" fill="#ffffff" />
      <circle cx="67" cy="55" r="3.5" fill="#ffffff" />
      <path d="M78 18h13l29 56H107Z" fill="#c62e36" />
      <path d="M91 18h7l29 56H120Z" fill="#ffffff" />
      <path d="M101 18h13l29 56H130Z" fill="#c62e36" />
      <path d="M115 18h7l26 56H141Z" fill="#ffffff" />
      <path d="M125 18h13l23 56H148Z" fill="#c62e36" />
    </svg>
  );
}

export function SiteHeader({ onHome, onAbout, onPrivacy }) {
  return (
    <header className="site-header">
      <div className="site-header-frame">
        <div className="site-header-inner">
          <button className="site-brand" type="button" onClick={onHome}>
            <UnitedLaneMark className="site-brand-mark-svg" />
            <span className="site-brand-copy" aria-label="United Lane LLC">
              <strong>UNITED</strong>
              <strong>LANE LLC</strong>
            </span>
          </button>

          <nav className="site-nav" aria-label="Site navigation">
            <button className="site-nav-button site-nav-button-primary" type="button" onClick={onHome}>
              HOME
            </button>
            <button className="site-nav-button" type="button" onClick={onAbout}>
              ABOUT US
            </button>
            <button className="site-nav-button" type="button" onClick={onPrivacy}>
              PRIVACY & TERMS
            </button>
          </nav>
        </div>

        <div className="site-header-divider" />
      </div>
    </header>
  );
}

export function SiteDialog({ panel, onClose }) {
  if (!panel) {
    return null;
  }

  return (
    <div className="site-dialog-backdrop" onClick={onClose}>
      <section
        className="site-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="site-dialog-close" type="button" onClick={onClose}>
          CLOSE
        </button>
        <span className="site-dialog-eyebrow">{panel.eyebrow}</span>
        <h2 id="site-dialog-title">{panel.title}</h2>
        {panel.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
    </div>
  );
}
