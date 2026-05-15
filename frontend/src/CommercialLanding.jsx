import { UnitedIcon } from "./UnitedLaneIcons";
import { UnitedLaneMark } from "./UnitedLaneSiteChrome";
import FreeTimeHub from "./FreeTimeHub";

const heroStats = [
  { value: "58+", label: "fleet units monitored" },
  { value: "24/7", label: "dispatch visibility" },
  { value: "1", label: "command center" },
];

const features = [
  {
    icon: "route",
    title: "Smart route planning",
    detail: "Build practical routes, compare options, and approve fuel stops with live trip context.",
  },
  {
    icon: "fuel",
    title: "Fuel authorization workflow",
    detail: "Plan stops, prepare driver instructions, and keep approvals connected to the route context.",
  },
  {
    icon: "fleet",
    title: "Live fleet tracking",
    detail: "See movement, stale GPS, driver assignment, low fuel, and unit status from one screen.",
  },
  {
    icon: "safety",
    title: "Safety operations",
    detail: "Manage incidents, documents, shift briefs, emergency support, and compliance follow-up.",
  },
  {
    icon: "chart",
    title: "Truck analytics",
    detail: "Compare mileage, MPG, faults, utilization, idle time, HOS signals, and archive growth.",
  },
  {
    icon: "driver",
    title: "Driver access",
    detail: "Give drivers a focused mobile workspace tied to their Motive truck and route support.",
  },
];

const analyticsCards = [
  { label: "Role Workspaces", value: "5", detail: "Admin, Fuel, Statistics, Safety, and Driver" },
  { label: "Core Modules", value: "8+", detail: "Loads, routing, tracking, approvals, documents, chat" },
  { label: "Fleet Sources", value: "2", detail: "Motive telemetry plus TomTom route intelligence" },
  { label: "Driver Flow", value: "Truck Match", detail: "Drivers connect through their assigned vehicle" },
];

const dashboardRows = [
  { area: "Routing", fact: "Build A/B routes with truck context", owner: "Fuel Service", status: "Live" },
  { area: "Safety", fact: "Cases, documents, notes, and shift briefs", owner: "Safety", status: "Ready" },
  { area: "Driver Portal", fact: "Mobile workspace linked to Motive truck match", owner: "Driver", status: "Active" },
];

const projectFactGroups = [
  {
    name: "Access Model",
    label: "Private",
    detail: "The platform is built for internal operations, with office accounts created by Admin.",
    items: ["Role-based login", "Protected backend routes", "Driver truck matching", "Admin account controls"],
  },
  {
    name: "Operations",
    label: "Connected",
    detail: "Daily work is grouped around loads, routes, live fleet status, approvals, and shared messages.",
    items: ["Motive fleet sync", "Route builder", "Fleet analytics", "Team chat"],
    featured: true,
  },
  {
    name: "Safety Layer",
    label: "Organized",
    detail: "Safety users get a separate workspace for follow-up, evidence, documents, and handoffs.",
    items: ["Safety notes", "Document review", "Incident cases", "Shift briefs"],
  },
];

const projectNotes = [
  {
    title: "One login, different workspaces",
    detail: "Admin, Fuel Service, Statistics, Safety, and Driver accounts land in different areas after sign-in.",
  },
  {
    title: "Driver access stays focused",
    detail: "Drivers use a mobile-first workspace tied to truck matching instead of seeing the whole office system.",
  },
  {
    title: "Safety has its own record flow",
    detail: "Notes, uploaded documents, investigations, service tools, and shift briefs stay grouped together.",
  },
];

const faqs = [
  {
    question: "What is United Lane Operations Platform?",
    answer: "It is a private logistics command center for dispatch, route planning, fuel approvals, fleet visibility, safety workflows, driver access, and team communication.",
  },
  {
    question: "Who uses the system?",
    answer: "Admin, Fuel Service, Statistics, Safety, and Driver users each receive a role-specific workspace after secure sign-in.",
  },
  {
    question: "Does it connect to live fleet data?",
    answer: "Yes. The platform is built around Motive fleet data, route intelligence, truck analytics, and operational cache layers for reliable daily use.",
  },
  {
    question: "Can office users self-register?",
    answer: "Office accounts are controlled by Admin. Driver registration stays available only through the matched truck workflow.",
  },
];

function DashboardPreview() {
  return (
    <div className="startup-dashboard-preview" aria-label="United Lane dashboard preview">
      <div className="startup-preview-topbar">
        <span />
        <span />
        <span />
        <strong>Project Facts</strong>
      </div>

      <div className="startup-preview-grid">
        <section className="startup-preview-chart">
          <div className="startup-preview-heading">
            <span>Core Workspaces</span>
            <strong>5 roles</strong>
          </div>
          <div className="startup-bars" aria-hidden="true">
            {[42, 70, 55, 88, 64, 94, 78].map((height, index) => (
              <i key={height + index} style={{ height: `${height}%` }} />
            ))}
          </div>
        </section>

        <section className="startup-preview-card startup-preview-map">
          <span>Fleet Layer</span>
          <strong>Motive sync</strong>
          <div className="startup-route-line" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </section>

        <section className="startup-preview-card startup-preview-risk">
          <span>Route Layer</span>
          <strong>TomTom tools</strong>
          <small>Maps, search, routing, and traffic</small>
        </section>

        <section className="startup-preview-table">
          <div className="startup-table-head">
            <span>Area</span>
            <span>Project fact</span>
            <span>Workspace</span>
            <span>Status</span>
          </div>
          {dashboardRows.map((row) => (
            <div className="startup-table-row" key={row.area}>
              <strong>{row.area}</strong>
              <span>{row.fact}</span>
              <span>{row.owner}</span>
              <em>{row.status}</em>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

export default function CommercialLanding({ authPanel, mobile = false }) {
  return (
    <main className={`startup-site ${mobile ? "startup-site-mobile" : ""}`.trim()}>
      <section className="startup-hero" id="site-home">
        <div className="startup-container startup-hero-inner startup-reveal">
          <span className="startup-eyebrow">Private SaaS for commercial trucking operations</span>
          <h1>United Lane turns dispatch, fuel, safety, and fleet data into one command center.</h1>
          <p>
            A premium operations platform for teams that need live truck visibility, smarter route planning,
            controlled fuel approvals, safety workflows, and driver support without switching tools all day.
          </p>

          <div className="startup-hero-actions">
            <a className="startup-button startup-button-primary" href="#client-access">
              Request Access
            </a>
            <a className="startup-button startup-button-secondary" href="#analytics">
              View Facts
            </a>
          </div>

          <div className="startup-hero-stats">
            {heroStats.map((item) => (
              <article key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>

          <DashboardPreview />
        </div>
      </section>

      <section className="startup-section startup-features startup-reveal" id="features">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Platform Features</span>
            <h2>Everything the shift needs, organized by role.</h2>
            <p>United Lane keeps the core workflows close together so dispatch, fuel service, safety, analytics, and drivers stay aligned.</p>
          </div>

          <div className="startup-feature-grid">
            {features.map((feature) => (
              <article className="startup-feature-card" key={feature.title}>
                <span className="startup-icon-wrap">
                  <UnitedIcon name={feature.icon} size={20} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="startup-section startup-about startup-reveal" id="about">
        <div className="startup-container startup-about-grid">
          <div>
            <span className="startup-section-label">About United Lane</span>
            <h2>Built for real logistics pressure, not demo-day simplicity.</h2>
            <p>
              United Lane Operations Platform brings daily trucking decisions into one modern interface: the route being planned,
              the truck being tracked, the fuel authorization being approved, and the safety issue that needs follow-up.
            </p>
          </div>

          <div className="startup-about-panel">
            <article>
              <strong>Mission</strong>
              <p>Reduce dispatch drag and handoff confusion by giving every role a focused workspace backed by shared operational data.</p>
            </article>
            <article>
              <strong>Why it matters</strong>
              <p>When live fleet status, route context, safety notes, and driver tools sit together, teams spend less time hunting and more time deciding.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="startup-section startup-analytics startup-reveal" id="analytics">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Project Facts</span>
            <h2>A quick look at what the platform actually includes.</h2>
          </div>

          <div className="startup-analytics-grid">
            <div className="startup-stat-grid">
              {analyticsCards.map((item) => (
                <article className="startup-stat-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>

            <DashboardPreview />
          </div>
        </div>
      </section>

      <section className="startup-section startup-pricing startup-reveal" id="project-facts">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Inside The Project</span>
            <h2>Three simple facts about how the product is organized.</h2>
            <p>Access, operations, and safety are separated so each team sees the workspace meant for its role.</p>
          </div>

          <div className="startup-pricing-grid">
            {projectFactGroups.map((group) => (
              <article className={`startup-plan-card ${group.featured ? "startup-plan-featured" : ""}`.trim()} key={group.name}>
                <span>{group.name}</span>
                <h3>{group.label}</h3>
                <p>{group.detail}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>
                      <UnitedIcon name="success" size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
                <a className={group.featured ? "startup-button startup-button-primary" : "startup-button startup-button-secondary"} href="#client-access">
                  Open Access
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="startup-section startup-testimonials startup-reveal" id="testimonials">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Project Notes</span>
            <h2>Small details that explain the system better.</h2>
          </div>

          <div className="startup-testimonial-grid">
            {projectNotes.map((item) => (
              <article className="startup-testimonial-card" key={item.title}>
                <p>{item.detail}</p>
                <div>
                  <strong>{item.title}</strong>
                  <span>Project fact</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="startup-section startup-free-time startup-reveal" id="free-time">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Free Time</span>
            <h2>A clean little place to relax before the next login.</h2>
            <p>Mini games for quick pauses, plus a calm ball screen for when the desk needs to breathe.</p>
          </div>

          <FreeTimeHub />
        </div>
      </section>

      <section className="startup-section startup-access startup-reveal" id="client-access">
        <div className="startup-container startup-access-grid">
          <div className="startup-access-copy">
            <span className="startup-section-label">Secure Access</span>
            <h2>Sign in by department and land in the right workspace.</h2>
            <p>
              Admin, Fuel Service, Statistics, Safety, and Driver roles are separated from the first click,
              with protected backend routes behind each workspace.
            </p>
            <div className="startup-access-badges">
              <span>Role-based</span>
              <span>Private fleet data</span>
              <span>Driver-safe access</span>
            </div>
          </div>

          <div className="startup-auth-shell">
            {authPanel}
          </div>
        </div>
      </section>

      <section className="startup-section startup-faq startup-reveal" id="faq">
        <div className="startup-container startup-faq-grid">
          <div>
            <span className="startup-section-label">FAQ</span>
            <h2>Questions operators usually ask first.</h2>
          </div>

          <div className="startup-faq-list">
            {faqs.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="startup-footer">
        <div className="startup-container startup-footer-inner">
          <div className="startup-footer-brand">
            <UnitedLaneMark />
            <div>
              <strong>United Lane LLC</strong>
              <span>Operations Platform</span>
            </div>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#features">Features</a>
            <a href="#about">About</a>
            <a href="#analytics">Analytics</a>
            <a href="#project-facts">Facts</a>
            <a href="#free-time">Free Time</a>
            <a href="#faq">FAQ</a>
          </nav>
          <small>Copyright 2026 United Lane LLC. Built for private logistics operations.</small>
        </div>
      </footer>
    </main>
  );
}
