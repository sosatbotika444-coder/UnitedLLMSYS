import AuthShiftPlanner from "./AuthShiftPlanner";
import { UnitedIcon } from "./UnitedLaneIcons";
import { UnitedLaneMark } from "./UnitedLaneSiteChrome";

const trustStats = [
  { value: "24/7", label: "dispatch rhythm", detail: "Fast decisions across routes, fuel, and live loads." },
  { value: "4", label: "role lanes", detail: "Admin, Fuel Service, Safety, and Driver access." },
  { value: "1", label: "shared command surface", detail: "One calmer entry point instead of scattered tools." },
];

const valueCards = [
  {
    icon: "fuel",
    title: "Fuel service control",
    detail: "Load planning, smart routing, approvals, and fleet visibility stay aligned from the first click."
  },
  {
    icon: "safety",
    title: "Safety-first operations",
    detail: "Documents, investigations, emergency support, and AI review keep compliance work organized."
  },
  {
    icon: "driver",
    title: "Driver-ready access",
    detail: "Truck matching and mobile-friendly flows keep the driver side simple without exposing office tools."
  },
];

const workflowSteps = [
  { title: "Choose the right lane", detail: "Each role is clearly separated before login so users enter the correct workspace." },
  { title: "Authenticate with confidence", detail: "Cleaner hierarchy, better form spacing, and protected access make the first screen easier to trust." },
  { title: "Keep the shift moving", detail: "The planner rail stays close for callbacks, breaks, and follow-ups during long office hours." },
];

const supportItems = [
  { icon: "docs", title: "Docs stay nearby", detail: "About, documentation, and privacy pages are now available directly from the public header." },
  { icon: "privacy", title: "Secure by role", detail: "Office access stays admin-managed while driver onboarding remains tied to a matched truck." },
  { icon: "chat", title: "Built for handoffs", detail: "The whole entry flow now points teams toward faster sign-in and cleaner next steps." },
];

export default function CommercialLanding({ authPanel, mobile = false }) {
  return (
    <main className={`site-auth-shell home-focus-shell ${mobile ? "home-focus-shell-mobile" : ""}`.trim()}>
      <section className="home-focus-hero" id="site-home">
        <article className="home-focus-hero-shell">
          <div className="home-focus-brandbar">
            <div className="home-focus-brandlockup">
              <UnitedLaneMark className="home-focus-brandmark" />
              <div>
                <span className="home-focus-kicker">Private operations platform</span>
                <strong>United Lane LLC</strong>
              </div>
            </div>

            <span className="home-focus-hero-chip">
              <UnitedIcon name="approvals" size={16} />
              Role-based secure access
            </span>
          </div>

          <div className="home-focus-copy">
            <span className="home-focus-eyebrow">Professional logistics control surface</span>
            <h1>Dispatch, routing, safety, and driver support now land in one cleaner front door.</h1>
            <p>We kept the operational depth, but made the entry experience calmer, clearer, and more premium so every role knows exactly where to go.</p>
          </div>

          <div className="home-focus-stat-grid">
            {trustStats.map((item) => (
              <article key={item.label} className="home-focus-stat-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        </article>

        <div className="home-focus-value-grid">
          {valueCards.map((item) => (
            <article key={item.title} className="home-focus-value-card">
              <span className="home-focus-value-icon">
                <UnitedIcon name={item.icon} size={18} />
              </span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>

        <article className="home-focus-workflow-card">
          <div className="home-focus-workflow-head">
            <div>
              <span>Entry flow</span>
              <strong>From sign-in to action without confusion</strong>
            </div>
            <small>Designed so office staff, safety, and drivers each land in the right lane immediately.</small>
          </div>

          <ol className="home-focus-workflow-list">
            {workflowSteps.map((step, index) => (
              <li key={step.title} className="home-focus-workflow-step">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </section>

      <section className="home-focus-side-rail" id="client-access">
        <div className="home-focus-panel">
          {authPanel}
        </div>

        <aside className="home-focus-planner">
          <AuthShiftPlanner title="Shift Planner" />
        </aside>

        <article className="home-focus-support-card">
          <div className="home-focus-support-head">
            <span>Operator support</span>
            <strong>Built for real shift work</strong>
            <p>Access is clearer, the planner stays visible, and company docs/privacy are one click away from the header.</p>
          </div>

          <div className="home-focus-support-list">
            {supportItems.map((item) => (
              <div key={item.title} className="home-focus-support-item">
                <span className="home-focus-support-icon">
                  <UnitedIcon name={item.icon} size={16} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
