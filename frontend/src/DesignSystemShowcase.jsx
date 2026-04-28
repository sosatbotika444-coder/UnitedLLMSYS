import { useMemo, useState } from "react";
import { useConfirmDialog } from "./feedback";
import { UnitedIcon, unitedIconNames } from "./UnitedLaneIcons";

const productScreens = [
  {
    icon: "dashboard",
    title: "Fuel Service Command",
    detail: "Hero workflow, KPI rail, live queues, and fast dispatch shortcuts.",
    states: ["Empty queue onboarding", "Live dispatch metrics", "Inline success feedback"],
  },
  {
    icon: "safety",
    title: "Safety Operations",
    detail: "Risk-first incident layout with cases, fleet alerts, exports, and AI support.",
    states: ["Critical escalation", "Needs-review document flow", "Shared brief handoff"],
  },
  {
    icon: "driver",
    title: "Driver Workspace",
    detail: "Mobile-first fuel, service, emergency, and HOS visibility with one-thumb access.",
    states: ["No HOS state", "Low-fuel warning", "Service-ready routing"],
  },
  {
    icon: "admin",
    title: "Admin Control Center",
    detail: "Account governance, live activity telemetry, and protected destructive actions.",
    states: ["Busy account mutation", "Delete confirmation", "Live stats refresh"],
  },
  {
    icon: "chat",
    title: "Shared Team Chat",
    detail: "High-contrast thread bubbles, reply context, moderation, and lightweight composer.",
    states: ["Empty room", "Loading backlog", "Edited/deleted messages"],
  },
];

const motionTokens = [
  { label: "Hover", value: "140ms", detail: "ease-out for buttons, cards, tabs" },
  { label: "Enter", value: "220ms", detail: "cubic-bezier(0.22, 1, 0.36, 1)" },
  { label: "Dialog", value: "260ms", detail: "opacity + translate + blur release" },
  { label: "Skeleton", value: "1.45s", detail: "subtle shimmer, no layout shift" },
];

const sampleLoads = [
  { number: "UL-4821", lane: "Chicago to Dallas", status: "In transit", margin: "$1,420", eta: "On time" },
  { number: "UL-4828", lane: "Joliet to Atlanta", status: "Needs review", margin: "$980", eta: "Fuel check" },
  { number: "UL-4833", lane: "Memphis to Houston", status: "Delayed", margin: "$640", eta: "1h late" },
];

function FieldError({ visible, children }) {
  if (!visible) return null;
  return (
    <span className="design-form-error">
      <UnitedIcon name="error" size={14} />
      {children}
    </span>
  );
}

export default function DesignSystemShowcase({ compact = false }) {
  const confirmAction = useConfirmDialog();
  const [form, setForm] = useState({
    driver: "",
    email: "dispatch@unitedlane.com",
    note: "Pickup verified. Waiting for fuel release.",
  });
  const [demoMessage, setDemoMessage] = useState("");

  const driverInvalid = form.driver.trim().length > 0 && form.driver.trim().length < 3;
  const emailInvalid = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email);

  const visibleIcons = useMemo(() => unitedIconNames.slice(0, 18), []);

  async function openPreviewDialog(kind) {
    if (kind === "danger") {
      const accepted = await confirmAction({
        tone: "danger",
        icon: "warning",
        meta: "Destructive action",
        title: "Archive this full-road trip?",
        description: "The trip will leave the active board and operators will need history view to reopen context.",
        confirmLabel: "Archive trip",
      });
      setDemoMessage(accepted ? "Archive confirmation pattern approved." : "Archive action cancelled safely.");
      return;
    }

    if (kind === "success") {
      const accepted = await confirmAction({
        tone: "success",
        icon: "success",
        meta: "Success state",
        title: "Fuel plan shared",
        description: "This is the success modal pattern used after major multi-step workflows complete.",
        confirmLabel: "Looks good",
        cancelLabel: "Close",
        hideCancel: true,
      });
      if (accepted) {
        setDemoMessage("Success-state modal preview completed.");
      }
      return;
    }

    const accepted = await confirmAction({
      tone: "info",
      icon: "info",
      meta: "Operator guidance",
      title: "Send driver instructions now?",
      description: "Use confirmation when the next action leaves the system and affects the driver or another department.",
      confirmLabel: "Send now",
    });
    setDemoMessage(accepted ? "Info confirmation preview completed." : "Instruction send stayed in draft.");
  }

  return (
    <section className={`panel design-system-shell ${compact ? "compact" : ""}`.trim()}>
      <div className="panel-head design-system-head">
        <div>
          <h2>Design System</h2>
          <span>Production UI kit, motion rules, states, iconography, and application blueprints.</span>
        </div>
        <div className="design-system-head-badge">
          <UnitedIcon name="spark" size={16} />
          <strong>Top-tier ops UI</strong>
        </div>
      </div>

      <section className="design-system-hero">
        <article className="design-system-principles">
          <span>Foundation</span>
          <strong>Minimal, premium, and operationally fast</strong>
          <p>Surfaces are denser than consumer SaaS, but hierarchy stays calm: clear spacing, low-noise gradients, role-specific accents, and instant action feedback.</p>
        </article>
        <div className="design-system-principle-grid">
          <article>
            <UnitedIcon name="theme" size={18} />
            <strong>Dual-theme ready</strong>
            <small>Shared tokens for light, dark, and blue command modes.</small>
          </article>
          <article>
            <UnitedIcon name="spark" size={18} />
            <strong>Micro-interactions</strong>
            <small>Hover lift, pressed response, and content reveal tuned for speed.</small>
          </article>
          <article>
            <UnitedIcon name="approvals" size={18} />
            <strong>Action confidence</strong>
            <small>Confirm destructive steps and surface success immediately after.</small>
          </article>
        </div>
      </section>

      <div className="design-system-grid">
        <article className="design-surface-card">
          <div className="design-section-head">
            <strong>Buttons</strong>
            <span>Primary, secondary, ghost, danger</span>
          </div>
          <div className="design-button-row">
            <button type="button" className="primary-button"><UnitedIcon name="plus" size={16} />Create load</button>
            <button type="button" className="secondary-button"><UnitedIcon name="route" size={16} />Build route</button>
            <button type="button" className="ghost-button"><UnitedIcon name="chat" size={16} />Open thread</button>
            <button type="button" className="delete-button"><UnitedIcon name="warning" size={16} />Archive</button>
            <button type="button" className="secondary-button" disabled>Disabled state</button>
          </div>
        </article>

        <article className="design-surface-card">
          <div className="design-section-head">
            <strong>Forms</strong>
            <span>Validation, helper copy, edge states</span>
          </div>
          <div className="design-form-grid">
            <label>
              Driver name
              <input
                type="text"
                value={form.driver}
                onChange={(event) => setForm((current) => ({ ...current, driver: event.target.value }))}
                placeholder="Type at least 3 characters"
                aria-invalid={driverInvalid}
              />
              <FieldError visible={driverInvalid}>Name is too short for assignment.</FieldError>
            </label>
            <label>
              Contact email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                aria-invalid={emailInvalid}
              />
              <FieldError visible={emailInvalid}>Enter a valid email format.</FieldError>
            </label>
            <label className="wide-field">
              Dispatch note
              <textarea
                rows={4}
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              />
              <small>Notes keep the same spacing, corner radius, and inline feedback pattern across workspaces.</small>
            </label>
          </div>
        </article>

        <article className="design-surface-card">
          <div className="design-section-head">
            <strong>Feedback</strong>
            <span>Success, info, warning, error, loading</span>
          </div>
          <div className="design-feedback-stack">
            <div className="notice success inline-notice"><UnitedIcon name="success" size={16} />Route saved and sent to approvals.</div>
            <div className="notice info inline-notice"><UnitedIcon name="info" size={16} />Fresh Motive data is syncing in the background.</div>
            <div className="notice error inline-notice"><UnitedIcon name="error" size={16} />Driver message could not be delivered.</div>
            <div className="module-loader design-loader-preview">Loading intelligent route comparison...</div>
            <div className="design-skeleton-card">
              <span className="design-skeleton-line w-40" />
              <span className="design-skeleton-line w-85" />
              <span className="design-skeleton-line w-60" />
            </div>
          </div>
        </article>

        <article className="design-surface-card">
          <div className="design-section-head">
            <strong>Modals</strong>
            <span>Confirm, alert, success</span>
          </div>
          <div className="design-button-row">
            <button type="button" className="delete-button" onClick={() => openPreviewDialog("danger")}>Preview archive</button>
            <button type="button" className="secondary-button" onClick={() => openPreviewDialog("info")}>Preview alert</button>
            <button type="button" className="primary-button" onClick={() => openPreviewDialog("success")}>Preview success</button>
          </div>
          <small className="design-preview-note">{demoMessage || "Preview buttons open the same dialog system used for destructive and high-impact actions."}</small>
        </article>
      </div>

      <div className="design-system-grid design-system-grid-secondary">
        <article className="design-surface-card">
          <div className="design-section-head">
            <strong>Cards, lists, tables</strong>
            <span>Data-dense but visually calm</span>
          </div>
          <div className="design-card-list">
            {sampleLoads.map((item) => (
              <article key={item.number} className="design-mini-record">
                <div>
                  <span>{item.number}</span>
                  <strong>{item.lane}</strong>
                </div>
                <div>
                  <em>{item.status}</em>
                  <small>{item.eta}</small>
                </div>
              </article>
            ))}
          </div>
          <div className="design-table-wrap">
            <table className="design-token-table">
              <thead>
                <tr>
                  <th>Load</th>
                  <th>Status</th>
                  <th>Margin</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sampleLoads.map((item) => (
                  <tr key={`${item.number}-table`}>
                    <td>{item.number}</td>
                    <td>{item.status}</td>
                    <td>{item.margin}</td>
                    <td><button type="button" className="ghost-button">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="design-surface-card">
          <div className="design-section-head">
            <strong>Motion tokens</strong>
            <span>Fast, subtle, GPU-friendly</span>
          </div>
          <div className="design-motion-grid">
            {motionTokens.map((token) => (
              <article key={token.label}>
                <span>{token.label}</span>
                <strong>{token.value}</strong>
                <small>{token.detail}</small>
              </article>
            ))}
          </div>
        </article>

        <article className="design-surface-card">
          <div className="design-section-head">
            <strong>Custom icons</strong>
            <span>One stroke system for all sections and actions</span>
          </div>
          <div className="design-icon-grid">
            {visibleIcons.map((icon) => (
              <article key={icon}>
                <UnitedIcon name={icon} size={18} />
                <span>{icon}</span>
              </article>
            ))}
          </div>
        </article>
      </div>

      <section className="design-screen-board">
        <div className="design-section-head">
          <strong>Application blueprints</strong>
          <span>Examples for every major product surface</span>
        </div>
        <div className="design-screen-grid">
          {productScreens.map((screen) => (
            <article key={screen.title} className="design-screen-card">
              <div className="design-screen-card-top">
                <span><UnitedIcon name={screen.icon} size={18} />{screen.title}</span>
                <strong>Ready</strong>
              </div>
              <p>{screen.detail}</p>
              <div className="design-screen-tags">
                {screen.states.map((state) => (
                  <span key={state}>{state}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
