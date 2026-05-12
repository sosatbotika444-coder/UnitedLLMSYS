import { UnitedIcon } from "./UnitedLaneIcons";
import { UnitedLaneMark } from "./UnitedLaneSiteChrome";

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
    title: "Fuel cost control",
    detail: "Estimate gallons, price caps, savings, and authorizations before the truck reaches the pump.",
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
  { label: "Active Loads", value: "128", delta: "+18%" },
  { label: "Fuel Saved", value: "$42.8k", delta: "+11%" },
  { label: "At Risk Units", value: "7", delta: "-24%" },
  { label: "Avg Response", value: "4.2m", delta: "-31%" },
];

const dashboardRows = [
  { truck: "UL-148", lane: "Dalton, GA -> Dallas, TX", status: "On Route", score: "96%" },
  { truck: "UL-214", lane: "Chicago, IL -> Newark, NJ", status: "Fuel Review", score: "82%" },
  { truck: "UL-088", lane: "Atlanta, GA -> Tampa, FL", status: "Ready", score: "91%" },
];

const plans = [
  {
    name: "Launch",
    price: "Private",
    detail: "For a small dispatch team getting fuel, route, and truck visibility into one workspace.",
    items: ["Role-based login", "Load board", "Route history", "Team chat"],
  },
  {
    name: "Operations",
    price: "Growth",
    detail: "For fleets that need daily command-center work across dispatch, fuel, safety, and drivers.",
    items: ["Motive fleet sync", "Fuel approvals", "Analytics dashboard", "Safety workspace"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    detail: "For multi-role teams that want tighter workflows, reporting, and managed deployment support.",
    items: ["Admin controls", "Custom workflows", "Data exports", "Priority support"],
  },
];

const testimonials = [
  {
    quote: "United Lane puts routing, fuel decisions, and driver context in one place. The team moves faster because the screen matches the shift.",
    name: "Dispatch Lead",
    role: "Fuel Service",
  },
  {
    quote: "The safety workspace keeps reviews, notes, documents, and urgent support organized without sending people through five systems.",
    name: "Safety Manager",
    role: "Compliance",
  },
  {
    quote: "The driver portal is simple enough for the road, but it still connects back to the office view. That is the balance we needed.",
    name: "Fleet Operator",
    role: "Driver Support",
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
        <strong>Operations Command</strong>
      </div>

      <div className="startup-preview-grid">
        <section className="startup-preview-chart">
          <div className="startup-preview-heading">
            <span>Fuel Performance</span>
            <strong>$42.8k saved</strong>
          </div>
          <div className="startup-bars" aria-hidden="true">
            {[42, 70, 55, 88, 64, 94, 78].map((height, index) => (
              <i key={height + index} style={{ height: `${height}%` }} />
            ))}
          </div>
        </section>

        <section className="startup-preview-card startup-preview-map">
          <span>Live Fleet</span>
          <strong>47 moving</strong>
          <div className="startup-route-line" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </section>

        <section className="startup-preview-card startup-preview-risk">
          <span>Safety Queue</span>
          <strong>7 reviews</strong>
          <small>3 critical follow-ups today</small>
        </section>

        <section className="startup-preview-table">
          <div className="startup-table-head">
            <span>Truck</span>
            <span>Lane</span>
            <span>Status</span>
            <span>Score</span>
          </div>
          {dashboardRows.map((row) => (
            <div className="startup-table-row" key={row.truck}>
              <strong>{row.truck}</strong>
              <span>{row.lane}</span>
              <em>{row.status}</em>
              <b>{row.score}</b>
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
              View Dashboard
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
              <p>Reduce dispatch drag, fuel waste, and handoff confusion by giving every role a focused workspace backed by shared operational data.</p>
            </article>
            <article>
              <strong>Why it matters</strong>
              <p>When live fleet status, route economics, safety notes, and driver tools sit together, teams spend less time hunting and more time deciding.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="startup-section startup-analytics startup-reveal" id="analytics">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Dashboard Preview</span>
            <h2>Analytics that feel like a control room, not a spreadsheet.</h2>
          </div>

          <div className="startup-analytics-grid">
            <div className="startup-stat-grid">
              {analyticsCards.map((item) => (
                <article className="startup-stat-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.delta} this month</small>
                </article>
              ))}
            </div>

            <DashboardPreview />
          </div>
        </div>
      </section>

      <section className="startup-section startup-pricing startup-reveal" id="pricing">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Plans</span>
            <h2>Flexible plans for growing fleet operations.</h2>
            <p>Choose the operating model that fits the team now, then scale into deeper analytics and managed workflows.</p>
          </div>

          <div className="startup-pricing-grid">
            {plans.map((plan) => (
              <article className={`startup-plan-card ${plan.featured ? "startup-plan-featured" : ""}`.trim()} key={plan.name}>
                <span>{plan.name}</span>
                <h3>{plan.price}</h3>
                <p>{plan.detail}</p>
                <ul>
                  {plan.items.map((item) => (
                    <li key={item}>
                      <UnitedIcon name="success" size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
                <a className={plan.featured ? "startup-button startup-button-primary" : "startup-button startup-button-secondary"} href="#client-access">
                  Talk to Team
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="startup-section startup-testimonials startup-reveal" id="testimonials">
        <div className="startup-container">
          <div className="startup-section-heading">
            <span>Testimonials</span>
            <h2>Designed for the people running the day.</h2>
          </div>

          <div className="startup-testimonial-grid">
            {testimonials.map((item) => (
              <article className="startup-testimonial-card" key={item.name}>
                <p>{item.quote}</p>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.role}</span>
                </div>
              </article>
            ))}
          </div>
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
            <a href="#pricing">Plans</a>
            <a href="#faq">FAQ</a>
          </nav>
          <small>Copyright 2026 United Lane LLC. Built for private logistics operations.</small>
        </div>
      </footer>
    </main>
  );
}
