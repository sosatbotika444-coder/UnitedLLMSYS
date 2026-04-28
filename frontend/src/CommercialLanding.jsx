import { useEffect, useMemo, useState } from "react";
import { trackActivity } from "./activityTracker";
import { UnitedIcon } from "./UnitedLaneIcons";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const LANDING_VARIANT_KEY = "unitedlane_landing_variant_v1";
const CONTACT_EMAIL = "safety@unitedlanellc.com";
const CONTACT_PHONE = "+12342265821";
const CONTACT_PHONE_LABEL = "(234) 226-5821";

const heroVariants = {
  a: {
    eyebrow: "Private Fleet Revenue System",
    title: "Cut fuel waste, dispatch lag, and driver handoff chaos from one operations system.",
    subtitle: "United Lane turns routing, live tracking, safety workflows, driver support, and team coordination into one commercial command center built for trucking teams that need faster decisions and better margin control.",
    primaryCta: "Book Private Demo",
    secondaryCta: "See Pricing",
    trust: "Best for carriers and dispatch-heavy fleets that need visibility before problems become margin loss.",
  },
  b: {
    eyebrow: "Ops Command For Carriers",
    title: "Run dispatch, safety, fuel, and driver operations from one private command center.",
    subtitle: "Replace scattered chats, spreadsheets, route tabs, and manual follow-up with a role-based platform that keeps every critical workflow moving in the same system.",
    primaryCta: "Get Profit Audit",
    secondaryCta: "How It Works",
    trust: "Best for growing fleets that want tighter control without adding headcount before every new load wave.",
  },
};

const trustMetrics = [
  { label: "4 role-based workspaces", value: "Dispatch, Safety, Driver, Admin" },
  { label: "10+ live modules", value: "Routing, approvals, incidents, chat, analytics" },
  { label: "1 private operating layer", value: "Shared visibility across day-to-day decisions" },
];

const integrationPills = ["Motive Fleet Data", "TomTom Routing", "Fuel Approvals", "Safety AI", "Driver Workspace", "Team Chat"];

const advantageCards = [
  {
    icon: "fuel",
    title: "Protect fuel margin",
    detail: "Build routes with truck context, live stop logic, approvals, and purchase reconciliation instead of relying on disconnected tabs.",
  },
  {
    icon: "fleet",
    title: "See the fleet in one glance",
    detail: "Tracking, fuel, HOS, stale telemetry, fault context, and live trip state stay together so dispatchers react earlier.",
  },
  {
    icon: "safety",
    title: "Stop safety handoff loss",
    detail: "Shift briefs, investigations, service maps, emergency tools, and notes are stored in the same flow as the live fleet.",
  },
  {
    icon: "chat",
    title: "Shorten response time",
    detail: "Team Chat, quick actions, and driver-facing workspaces reduce the back-and-forth that usually slows operations down.",
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "Connect your operating reality",
    detail: "Bring dispatch, fleet, driver, and safety workflows into one private setup instead of forcing the team to jump between tools.",
  },
  {
    step: "02",
    title: "Prioritize margin-first actions",
    detail: "Route planning, live fleet visibility, authorizations, incidents, and chat surface in the order teams actually act on them.",
  },
  {
    step: "03",
    title: "Scale without losing control",
    detail: "Expand from one department to shared role-based access, richer analytics, and tighter admin oversight as the fleet grows.",
  },
];

const scenarioCards = [
  {
    title: "Internal dispatch pilot",
    subtitle: "United Lane fuel service workflow",
    result: "One command path: Loads -> Routing -> Tracking -> Approvals",
    detail: "Instead of rebuilding the same trip in multiple tools, operators move through a guided flow with saved history and shared visibility.",
  },
  {
    title: "Safety escalation control",
    subtitle: "Incident queue + shift brief",
    result: "Shared action board for investigations, risky people, and handoff notes",
    detail: "Safety users keep live cases, exported reports, and first-action checklists aligned without separate trackers.",
  },
  {
    title: "Driver support simplification",
    subtitle: "Mobile-first driver workspace",
    result: "Fuel route, service map, emergency tools, and chat in one place",
    detail: "Drivers get only the tools they need, while back office keeps centralized control over approvals and status.",
  },
];

const testimonials = [
  {
    quote: "We built this around the exact moments dispatch loses time: load changes, fuel decisions, and figuring out where the truck really is.",
    author: "Fuel Service Team",
    role: "Internal pilot feedback",
  },
  {
    quote: "The safety side matters because incidents, service tools, and handoffs should not live outside the same operating picture.",
    author: "Safety Operations",
    role: "Internal pilot feedback",
  },
  {
    quote: "Giving drivers a simpler workspace while keeping approvals and tracking centralized is a big part of making this commercially useful.",
    author: "Driver Support Workflow",
    role: "Internal pilot feedback",
  },
];

const pricingPlans = [
  {
    id: "launch",
    tone: "launch",
    title: "Launch",
    price: "$1,250/mo",
    note: "Suggested entry tier for up to 25 trucks",
    badge: "Good",
    features: ["Dispatch workspace", "Routing + fuel planning", "Live fleet tracking", "Basic onboarding"],
    cta: "Start With Launch",
  },
  {
    id: "growth",
    tone: "growth",
    title: "Growth Control",
    price: "$2,900/mo",
    note: "Suggested tier for 26-100 trucks",
    badge: "Better",
    features: ["Everything in Launch", "Safety workspace", "Driver workspace", "Route history + approvals", "Shared team chat"],
    cta: "Choose Growth",
  },
  {
    id: "command",
    tone: "command",
    title: "Command",
    price: "Custom",
    note: "Suggested tier for 100+ trucks or multi-team rollout",
    badge: "Best",
    features: ["Everything in Growth", "Admin controls", "Custom rollout plan", "Priority support", "Commercial KPI tailoring"],
    cta: "Talk Enterprise",
  },
];

const faqItems = [
  {
    question: "Who is this product best for?",
    answer: "It is best suited to carrier operations, dispatch-heavy fleets, and growing teams that need dispatch, fuel, safety, and driver workflows in one private system.",
  },
  {
    question: "Is this self-serve or sales-led?",
    answer: "The strongest commercial motion here is sales-led onboarding. Existing customers can use private access immediately, while new buyers convert through a demo and rollout plan.",
  },
  {
    question: "How fast can a team go live?",
    answer: "A focused rollout can start with dispatch and routing first, then expand into safety, driver, and admin controls once the first workflow is stable.",
  },
  {
    question: "Why not use separate tools?",
    answer: "Separate tools often break the handoff between route planning, fuel approvals, live visibility, and safety follow-up. This product wins by keeping those decisions connected.",
  },
  {
    question: "What should be measured after launch?",
    answer: "Track CTA click-through, lead submission rate, demo-to-onboarding conversion, routing usage, approval compliance, user retention, gross margin impact, and LTV by fleet segment.",
  },
];

function assignVariant() {
  if (typeof window === "undefined") {
    return "a";
  }

  const params = new URLSearchParams(window.location.search);
  const forced = String(params.get("variant") || "").toLowerCase();
  if (forced === "a" || forced === "b") {
    window.sessionStorage.setItem(LANDING_VARIANT_KEY, forced);
    return forced;
  }

  const stored = window.sessionStorage.getItem(LANDING_VARIANT_KEY);
  if (stored === "a" || stored === "b") {
    return stored;
  }

  const nextVariant = Math.random() >= 0.5 ? "b" : "a";
  window.sessionStorage.setItem(LANDING_VARIANT_KEY, nextVariant);
  return nextVariant;
}

function scrollToSection(sectionId) {
  if (typeof document === "undefined") return;
  const node = document.getElementById(sectionId);
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}

function estimatePlanForFleet(trucks) {
  if (trucks >= 101) return "command";
  if (trucks >= 26) return "growth";
  return "launch";
}

async function submitCommercialLead(payload) {
  const response = await fetch(`${API_URL}/marketing/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (response.ok) {
    return response.json();
  }

  let detail = "The request could not be submitted right now.";
  try {
    const data = await response.json();
    if (data?.detail) {
      detail = String(data.detail);
    }
  } catch {
    // Ignore parse failure and fall back to the default message.
  }
  throw new Error(detail);
}

export default function CommercialLanding({ authPanel, mobile = false }) {
  const [variant] = useState(assignVariant);
  const [selectedPlan, setSelectedPlan] = useState("growth");
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadError, setLeadError] = useState("");
  const [leadForm, setLeadForm] = useState({
    name: "",
    email: "",
    fleetSize: "40",
    priority: "Reduce fuel leakage",
    role: "Operations / Dispatch",
  });
  const [roiInput, setRoiInput] = useState({
    trucks: 40,
    monthlyFuelSpend: 85000,
    monthlyDetention: 12000,
  });

  const hero = heroVariants[variant] || heroVariants.a;
  const recommendedPlan = estimatePlanForFleet(Number(leadForm.fleetSize) || Number(roiInput.trucks) || 0);

  useEffect(() => {
    setSelectedPlan(recommendedPlan);
  }, [recommendedPlan]);

  useEffect(() => {
    document.title = "United Lane Operations Platform | Dispatch, Safety, Fuel & Driver Control";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        "content",
        "Commercial trucking operations platform for dispatch, fuel planning, safety workflows, driver support, live fleet visibility, and private team coordination."
      );
    }

    trackActivity({
      eventType: "experiment_view",
      eventName: "Viewed landing variant",
      page: "commercial-landing",
      workspace: variant,
      label: `Hero variant ${variant.toUpperCase()}`,
      details: { variant, surface: "public-landing" },
      throttleKey: `landing-variant:${variant}`,
      throttleMs: 5000,
    });
  }, [variant]);

  const roiModel = useMemo(() => {
    const trucks = Number(roiInput.trucks) || 0;
    const fuel = Number(roiInput.monthlyFuelSpend) || 0;
    const detention = Number(roiInput.monthlyDetention) || 0;
    const fuelSavings = fuel * 0.035;
    const detentionSavings = detention * 0.18;
    const laborSavings = trucks * 62;
    const monthlyGain = fuelSavings + detentionSavings + laborSavings;
    const annualGain = monthlyGain * 12;

    return {
      monthlyGain,
      annualGain,
      fuelSavings,
      detentionSavings,
      laborSavings,
    };
  }, [roiInput]);

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  }

  function updateLead(field, value) {
    if (leadError) {
      setLeadError("");
    }
    setLeadForm((current) => ({ ...current, [field]: value }));
  }

  function selectPlan(planId) {
    setSelectedPlan(planId);
    trackActivity({
      eventType: "pricing_select",
      eventName: "Selected pricing tier",
      page: "commercial-landing",
      workspace: planId,
      label: planId,
      details: { variant },
      throttleKey: `pricing:${planId}`,
      throttleMs: 600,
    });
    scrollToSection("lead-capture");
  }

  async function submitLead(event) {
    event.preventDefault();
    if (leadBusy) return;

    const email = leadForm.email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setLeadError("Enter a valid work email so we can send the audit and rollout recommendation.");
      return;
    }

    setLeadError("");
    setLeadBusy(true);
    try {
      await Promise.all([
        submitCommercialLead({
          name: leadForm.name.trim(),
          email,
          fleetSize: Number(leadForm.fleetSize) || 0,
          role: leadForm.role,
          priority: leadForm.priority,
          selectedPlan,
          landingVariant: variant,
          estimatedAnnualGain: Math.round(roiModel.annualGain),
          sourcePage: "commercial-landing",
          notes: "",
        }),
        trackActivity({
          eventType: "lead_submit",
          eventName: "Requested commercial demo",
          page: "commercial-landing",
          workspace: selectedPlan,
          label: email,
          details: {
            name: leadForm.name || "No name",
            email,
            fleet_size: leadForm.fleetSize,
            role: leadForm.role,
            priority: leadForm.priority,
            plan: selectedPlan,
            variant,
            est_annual_gain: String(Math.round(roiModel.annualGain)),
          },
        }),
      ]);
      setLeadSubmitted(true);
    } catch (submitError) {
      setLeadError(submitError instanceof Error ? submitError.message : "The request could not be submitted right now. Use the direct email or phone options below.");
    } finally {
      setLeadBusy(false);
    }
  }

  return (
    <main className={`commercial-site-shell ${mobile ? "mobile" : ""}`.trim()}>
      <section className="commercial-hero-shell" id="top">
        <div className="commercial-hero-grid">
          <section className="commercial-hero-panel">
            <div className="commercial-hero-copy">
              <span className="commercial-eyebrow">{hero.eyebrow}</span>
              <h1>{hero.title}</h1>
              <p>{hero.subtitle}</p>
            </div>

            <div className="commercial-hero-actions">
              <button
                type="button"
                className="primary-button"
                data-activity-label="Primary CTA: book demo"
                onClick={() => scrollToSection("lead-capture")}
              >
                <UnitedIcon name="spark" size={16} />
                {hero.primaryCta}
              </button>
              <button
                type="button"
                className="secondary-button"
                data-activity-label="Secondary CTA: landing section"
                onClick={() => scrollToSection(variant === "a" ? "pricing" : "workflow")}
              >
                <UnitedIcon name={variant === "a" ? "approvals" : "road"} size={16} />
                {hero.secondaryCta}
              </button>
              <button
                type="button"
                className="ghost-button"
                data-activity-label="Existing customer sign in"
                onClick={() => scrollToSection("client-access")}
              >
                <UnitedIcon name="user" size={16} />
                Existing customer sign in
              </button>
            </div>

            <div className="commercial-proof-strip">
              {trustMetrics.map((item) => (
                <article key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </article>
              ))}
            </div>

            <div className="commercial-integrations">
              <span>Connects with</span>
              <div>
                {integrationPills.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <small>{hero.trust}</small>
            </div>
          </section>

          <aside className="commercial-hero-aside">
            <section className="commercial-quick-proof">
              <div className="commercial-section-head">
                <strong>Why this converts better</strong>
                <span>Lead-first B2B funnel</span>
              </div>
              <div className="commercial-funnel-list">
                <article><span>1</span><div><strong>Strong offer</strong><small>Profit, fuel control, and response speed are clear in the first screen.</small></div></article>
                <article><span>2</span><div><strong>Measured intent</strong><small>ROI estimate, plan selection, and demo form all create trackable buying signals.</small></div></article>
                <article><span>3</span><div><strong>Private access</strong><small>Existing users can sign in immediately without distracting the main sales path.</small></div></article>
              </div>
            </section>

            <section className="commercial-auth-rail" id="client-access">
              <div className="commercial-section-head">
                <strong>Private client access</strong>
                <span>For current customers and internal users</span>
              </div>
              {authPanel}
            </section>
          </aside>
        </div>
      </section>

      <section className="commercial-section-block" id="advantage">
        <div className="commercial-section-heading">
          <span className="commercial-eyebrow">Why teams buy</span>
          <h2>Built around the exact points where trucking operations lose money.</h2>
          <p>The site now sells around concrete revenue problems instead of generic software language: fuel margin leakage, delayed response, weak handoff, and fragmented visibility.</p>
        </div>
        <div className="commercial-advantage-grid">
          {advantageCards.map((card) => (
            <article key={card.title} className="commercial-advantage-card">
              <div className="commercial-card-icon"><UnitedIcon name={card.icon} size={18} /></div>
              <strong>{card.title}</strong>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="commercial-section-block commercial-roi-block" id="roi">
        <div className="commercial-section-heading">
          <span className="commercial-eyebrow">Lead Magnet</span>
          <h2>Show buyers the financial upside before they ever book the call.</h2>
          <p>This lightweight estimator is designed to increase conversion from cold traffic and paid ads by giving operators a reason to raise their hand.</p>
        </div>
        <div className="commercial-roi-grid">
          <article className="commercial-roi-card">
            <label>
              Trucks in operation
              <input
                type="range"
                min="10"
                max="150"
                step="5"
                value={roiInput.trucks}
                onChange={(event) => setRoiInput((current) => ({ ...current, trucks: Number(event.target.value) }))}
              />
              <strong>{roiInput.trucks} trucks</strong>
            </label>
            <label>
              Monthly fuel spend
              <input
                type="range"
                min="20000"
                max="250000"
                step="5000"
                value={roiInput.monthlyFuelSpend}
                onChange={(event) => setRoiInput((current) => ({ ...current, monthlyFuelSpend: Number(event.target.value) }))}
              />
              <strong>{formatMoney(roiInput.monthlyFuelSpend)}</strong>
            </label>
            <label>
              Monthly detention + avoidable delay cost
              <input
                type="range"
                min="2000"
                max="40000"
                step="1000"
                value={roiInput.monthlyDetention}
                onChange={(event) => setRoiInput((current) => ({ ...current, monthlyDetention: Number(event.target.value) }))}
              />
              <strong>{formatMoney(roiInput.monthlyDetention)}</strong>
            </label>
          </article>

          <article className="commercial-roi-result">
            <span>Projected annual upside</span>
            <strong>{formatMoney(roiModel.annualGain)}</strong>
            <div className="commercial-roi-metrics">
              <div><small>Fuel control</small><strong>{formatMoney(roiModel.fuelSavings)}</strong></div>
              <div><small>Delay reduction</small><strong>{formatMoney(roiModel.detentionSavings)}</strong></div>
              <div><small>Ops efficiency</small><strong>{formatMoney(roiModel.laborSavings)}</strong></div>
            </div>
            <button
              type="button"
              className="primary-button"
              data-activity-label="ROI CTA: get audit"
              onClick={() => {
                setLeadForm((current) => ({
                  ...current,
                  fleetSize: String(roiInput.trucks),
                  priority: "Validate ROI and rollout plan",
                }));
                scrollToSection("lead-capture");
              }}
            >
              <UnitedIcon name="profit" size={16} />
              Use This In My Audit
            </button>
          </article>
        </div>
      </section>

      <section className="commercial-section-block" id="workflow">
        <div className="commercial-section-heading">
          <span className="commercial-eyebrow">How it works</span>
          <h2>A sales funnel aligned to how fleets actually buy software.</h2>
          <p>Cold traffic gets an offer and ROI angle. Warm buyers see operational proof and pricing. Existing customers jump directly to private access.</p>
        </div>
        <div className="commercial-workflow-grid">
          {workflowSteps.map((item) => (
            <article key={item.step} className="commercial-workflow-card">
              <span>{item.step}</span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="commercial-section-block" id="proof">
        <div className="commercial-section-heading">
          <span className="commercial-eyebrow">Trust & proof</span>
          <h2>Position the product as a serious commercial system, not a pretty dashboard.</h2>
          <p>Instead of empty claims, the new page leans on real product structure, internal pilot usage, operational scenarios, and integration reality.</p>
        </div>
        <div className="commercial-scenario-grid">
          {scenarioCards.map((item) => (
            <article key={item.title} className="commercial-scenario-card">
              <span>{item.subtitle}</span>
              <strong>{item.title}</strong>
              <em>{item.result}</em>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
        <div className="commercial-testimonial-grid">
          {testimonials.map((item) => (
            <article key={item.quote} className="commercial-testimonial-card">
              <p>"{item.quote}"</p>
              <strong>{item.author}</strong>
              <small>{item.role}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="commercial-section-block" id="pricing">
        <div className="commercial-section-heading">
          <span className="commercial-eyebrow">Suggested monetization</span>
          <h2>Sales-led SaaS pricing with an obvious good / better / best path.</h2>
          <p>The recommended model here is subscription + onboarding. Upsells come from safety, driver rollout, analytics, and enterprise support. Downsell is a limited Launch package or a paid audit.</p>
        </div>
        <div className="commercial-pricing-grid">
          {pricingPlans.map((plan) => (
            <article key={plan.id} className={`commercial-pricing-card commercial-pricing-${plan.tone}${selectedPlan === plan.id ? " selected" : ""}`.trim()}>
              <div className="commercial-pricing-top">
                <span>{plan.badge}</span>
                <strong>{plan.title}</strong>
                <small>{plan.note}</small>
              </div>
              <div className="commercial-pricing-price">{plan.price}</div>
              <div className="commercial-pricing-features">
                {plan.features.map((feature) => (
                  <div key={feature}><UnitedIcon name="success" size={14} />{feature}</div>
                ))}
              </div>
              <button type="button" className={plan.id === "growth" ? "primary-button" : "secondary-button"} onClick={() => selectPlan(plan.id)}>
                {plan.cta}
              </button>
            </article>
          ))}
        </div>
        <div className="commercial-pricing-aside">
          <article>
            <strong>Upsell</strong>
            <span>Enterprise onboarding, custom KPI layers, admin governance rollout, and priority support.</span>
          </article>
          <article>
            <strong>Downsell</strong>
            <span>Offer a paid fleet profit audit or a single-department Launch package for buyers not ready for full rollout.</span>
          </article>
          <article>
            <strong>Commercial guarantee</strong>
            <span>Promise extended onboarding support until the first production workflow is live instead of offering a vague refund story.</span>
          </article>
        </div>
      </section>

      <section className="commercial-section-block commercial-lead-capture" id="lead-capture">
        <div className="commercial-section-heading">
          <span className="commercial-eyebrow">Primary conversion</span>
          <h2>Get the 7-point fleet profit audit and a private rollout recommendation.</h2>
          <p>Minimal fields, strong value exchange, and a clear next step. This is the main lead-gen action for new commercial traffic.</p>
        </div>
        <div className="commercial-lead-grid">
          <article className="commercial-lead-value">
            <div className="commercial-section-head">
              <strong>What the prospect gets</strong>
              <span>Before the call</span>
            </div>
            <div className="commercial-lead-list">
              <article><UnitedIcon name="profit" size={16} /><div><strong>ROI estimate</strong><small>Projected annual upside based on fleet size and current operating cost.</small></div></article>
              <article><UnitedIcon name="route" size={16} /><div><strong>Workflow map</strong><small>The best first rollout path: Dispatch-only, Growth, or full Command deployment.</small></div></article>
              <article><UnitedIcon name="approvals" size={16} /><div><strong>Commercial fit review</strong><small>Recommended plan, onboarding scope, and likely upsell path.</small></div></article>
            </div>
          </article>

          <form className="commercial-lead-form" onSubmit={submitLead}>
            <div className="commercial-section-head">
              <strong>Request your audit</strong>
              <span>{selectedPlan === "command" ? "Enterprise fit" : selectedPlan === "growth" ? "Growth fit" : "Launch fit"}</span>
            </div>

            {leadSubmitted ? (
              <div className="commercial-success-card" role="status" aria-live="polite">
                <div><UnitedIcon name="success" size={18} /><strong>Request captured</strong></div>
                <p>Your demo request and commercial context were logged. Next step: contact the team directly or keep this page open for client sign-in if you already have access.</p>
                <div className="commercial-success-actions">
                  <a className="primary-button" href={`mailto:${CONTACT_EMAIL}?subject=United%20Lane%20Commercial%20Demo&body=I%20want%20a%20commercial%20demo%20for%20the%20${selectedPlan}%20plan.`}>
                    <UnitedIcon name="docs" size={16} />
                    Email Team
                  </a>
                  <a className="secondary-button" href={`tel:${CONTACT_PHONE}`}>
                    <UnitedIcon name="mobile" size={16} />
                    Call {CONTACT_PHONE_LABEL}
                  </a>
                </div>
              </div>
            ) : (
              <>
                <label>
                  Name
                  <input type="text" value={leadForm.name} onChange={(event) => updateLead("name", event.target.value)} placeholder="Optional" />
                </label>
                <label>
                  Work email
                  <input
                    type="email"
                    inputMode="email"
                    value={leadForm.email}
                    onChange={(event) => updateLead("email", event.target.value)}
                    placeholder="name@fleet.com"
                    required
                    aria-invalid={leadError ? "true" : "false"}
                  />
                </label>
                <label>
                  Fleet size
                  <select value={leadForm.fleetSize} onChange={(event) => updateLead("fleetSize", event.target.value)}>
                    <option value="15">Up to 25 trucks</option>
                    <option value="40">26-50 trucks</option>
                    <option value="80">51-100 trucks</option>
                    <option value="140">100+ trucks</option>
                  </select>
                </label>
                <label>
                  Role
                  <select value={leadForm.role} onChange={(event) => updateLead("role", event.target.value)}>
                    <option>Operations / Dispatch</option>
                    <option>Fleet Manager</option>
                    <option>Safety Lead</option>
                    <option>Owner / Executive</option>
                  </select>
                </label>
                <label className="wide-field">
                  Biggest priority
                  <select value={leadForm.priority} onChange={(event) => updateLead("priority", event.target.value)}>
                    <option>Reduce fuel leakage</option>
                    <option>Improve dispatch visibility</option>
                    <option>Tighten safety handoff</option>
                    <option>Support drivers better</option>
                    <option>Validate ROI and rollout plan</option>
                  </select>
                </label>
                <button type="submit" className="primary-button" disabled={leadBusy}>
                  <UnitedIcon name="spark" size={16} />
                  {leadBusy ? "Submitting..." : "Get My Audit"}
                </button>
                {leadError ? <small className="form-error-text" role="alert">{leadError}</small> : null}
                <small>Lead events, CTA clicks, and plan selections are already instrumented through the existing activity telemetry layer.</small>
              </>
            )}
          </form>
        </div>
      </section>

      <section className="commercial-section-block" id="faq">
        <div className="commercial-section-heading">
          <span className="commercial-eyebrow">Objection handling</span>
          <h2>FAQ built to remove hesitation before the buyer leaves the page.</h2>
          <p>This section is positioned late in the funnel to answer commercial questions after value, proof, and pricing have already been established.</p>
        </div>
        <div className="commercial-faq-list">
          {faqItems.map((item) => (
            <details key={item.question} className="commercial-faq-item">
              <summary data-activity-label={`FAQ: ${item.question}`}>
                <span>{item.question}</span>
                <UnitedIcon name="chevron-right" size={14} />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="commercial-section-block commercial-security-block">
        <div className="commercial-security-grid">
          <article>
            <span className="commercial-eyebrow">Trust</span>
            <strong>Private access, role-based visibility, and activity logs already exist in the product.</strong>
            <p>The commercial site now makes those trust signals visible: admin controls, protected office registration, role-based workspaces, and activity telemetry are not promises, they are already part of the platform architecture.</p>
          </article>
          <article>
            <span className="commercial-eyebrow">Next marketing layer</span>
            <strong>Ready for Google Ads, paid social, and email capture.</strong>
            <p>The structure now supports ad traffic landing on a single offer, A/B hero variants, ROI CTA testing, email capture, and conversion event measurement from first visit to demo request.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
