const safetyEmail = <a href="mailto:safety@unitedlanellc.com">safety@unitedlanellc.com</a>;
const smsFormLink = <a href="https://form.jotform.com/243344477274058" target="_blank" rel="noreferrer">https://form.jotform.com/243344477274058</a>;
const privacyPolicyLink = <a href="https://unitedlanellc.com/privacy-and-terms" target="_blank" rel="noreferrer">https://unitedlanellc.com/privacy-and-terms</a>;
const helpPhone = <a href="tel:+12342265821">(234) 226-5821</a>;

export const sitePanels = {
  about: {
    eyebrow: "About Us",
    title: "United Lane LLC",
    paragraphs: [
      "United Lane LLC brings dispatch, routing, live tracking, and driver support into one operations workspace.",
      "The goal is simple: give the team one clean place to manage loads, stay aligned with drivers, and make fast decisions during the day."
    ]
  },
  docs: {
    eyebrow: "Documentation",
    title: "United Lane Operations Platform",
    effectiveDate: "Product Documentation - 2026 Edition",
    paragraphs: [
      "United Lane Operations Platform is a private logistics workspace for dispatch, fuel service, safety operations, driver support, live fleet visibility, and administrative control.",
      "This documentation explains how the web application is organized, which roles can access each workspace, and how the core operational workflows are intended to be used."
    ],
    sections: [
      {
        title: "1. Platform Overview",
        paragraphs: [
          "The application combines several operational tools into a single authenticated site. Users sign in by role and see the workspace that matches their account permissions."
        ],
        bullets: [
          "Admin Panel: manage users, roles, bans, passwords, and operational statistics.",
          "Fuel Service: manage loads, route planning, fleet tracking, and fuel approvals.",
          "Safety: manage fleet safety workflows, emergency support, service tools, documents, notes, and AI assistance.",
          "Driver Workspace: give drivers a mobile-first view of their truck, route, service tools, emergency support, and team chat.",
          "Team Chat: shared communication across operational departments."
        ]
      },
      {
        title: "2. Accounts, Roles, and Access",
        paragraphs: [
          "Every account belongs to exactly one role. The role controls the workspace shown after login and the backend API permissions available to that user. Public registration is disabled for office users; accounts are created by an administrator."
        ],
        bullets: [
          "Admin accounts can access the Admin Panel and are allowed through department-protected backend routes.",
          "Fuel Service accounts access dispatch loads, routing, Motive tracking, fuel authorizations, TomTom tools, and team chat.",
          "Safety accounts access safety notes, documents, investigations, shift briefs, emergency tools, service maps, AI chat, and team chat.",
          "Driver accounts are created through the driver flow and must be matched to a Motive truck.",
          "Banned accounts cannot sign in, even if the password is correct."
        ],
        details: [
          {
            label: "Recommended account policy",
            content: "Create staff accounts from the Admin Panel, assign the smallest required role, and reset passwords when staff change responsibilities."
          },
          {
            label: "Admin bootstrap account",
            content: "The initial admin username is configured by backend environment variables. Change the bootstrap password after deployment."
          }
        ]
      },
      {
        title: "3. Login and Registration",
        paragraphs: [
          "The login form accepts credentials for the selected department. Admin users can sign in with username or email. Fuel Service and Safety users sign in with email and password. Driver users sign in or register through the truck-matching driver flow."
        ],
        bullets: [
          "Office registration is closed. Fuel Service, Safety, and Admin accounts must be created by Admin.",
          "Driver registration remains available because it validates a Motive truck match before creating a driver workspace.",
          "Passwords are stored as password hashes on the backend, not as plain text.",
          "JWT access tokens are stored in the browser for the active session."
        ]
      },
      {
        title: "4. Admin Panel",
        paragraphs: [
          "The Admin Panel is the system control center. It is intended for trusted operators who manage access and monitor the health of platform usage."
        ],
        bullets: [
          "View total accounts, active users, banned users, routes, fuel authorizations, team messages, and safety document counts.",
          "Create accounts for Admin, Fuel Service, Safety, and Driver roles.",
          "Edit user full name, email, username, role, and ban reason.",
          "Ban or unban accounts immediately.",
          "Reset account passwords.",
          "Delete accounts while protecting the current admin from deleting or banning themselves."
        ],
        details: [
          {
            label: "Ban behavior",
            content: "When a user is banned, the backend blocks login and token-based access. The ban reason is stored for admin review."
          },
          {
            label: "Self-protection",
            content: "The system prevents an admin from banning or deleting their own account and prevents removing the last active admin."
          }
        ]
      },
      {
        title: "5. Fuel Service Workspace",
        paragraphs: [
          "Fuel Service is the main operations area for dispatchers and fuel coordinators. It brings the load board, route planning, fuel approval controls, fleet tracking, and shared communication into one workspace."
        ],
        bullets: [
          "Dashboard: shows load counts, active loads, low fuel count, review items, and miles left.",
          "Tracking: displays Motive fleet data, vehicle status, locations, drivers, movement, stale status, low fuel, and faults.",
          "Routing: builds routes from point A to point B and combines live truck fuel with station and route data.",
          "Route History: searches every saved route build by account, driver, truck, origin, destination, or date.",
          "Approvals: manages pre-approved fuel stops, gallon limits, amount limits, expiration, reconciliation, and violations.",
          "Loads: editable dispatch sheet for driver, truck, status, MPG, fuel percent, pickup, stops, and delivery.",
          "Settings: browser theme selection for the workspace."
        ]
      },
      {
        title: "6. Routing and Smart Fuel Planning",
        paragraphs: [
          "Routing helps the team build practical truck routes and fuel plans. It uses current route inputs, vehicle fuel information, configured tank capacity, station data, and price signals to recommend stops."
        ],
        bullets: [
          "Search origin and destination locations.",
          "Use live Motive truck location as the route start when available.",
          "Compare route options with distance, travel time, traffic delay, and branded fuel stops.",
          "Filter stops by brand, city, maximum off-route distance, and auto diesel price target.",
          "Build smart fuel plans with max three planned stops.",
          "Open map links for routes and selected fuel stops.",
          "Approve a fuel stop directly from the routing result.",
          "Every completed route build is saved with the account that created it, route options, selected stop, and fuel planning summary."
        ]
      },
      {
        title: "7. Motive Fleet Tracking",
        paragraphs: [
          "The Motive tracking area centralizes live and cached fleet visibility. It is designed to help dispatchers identify movement, stale data, fuel issues, and driver assignment quickly."
        ],
        bullets: [
          "Fleet metrics for total vehicles, located vehicles, moving vehicles, stopped vehicles, online vehicles, stale vehicles, vehicles with drivers, and active drivers.",
          "Vehicle list with filtering for moving, stopped, stale, low fuel, and faults.",
          "Vehicle detail panel with driver, location, telemetry, and vehicle information.",
          "Map view for fleet location context.",
          "Snapshot export when the backend integration is configured.",
          "Background refresh and cache status indicators."
        ]
      },
      {
        title: "8. Fuel Authorizations",
        paragraphs: [
          "Fuel Authorizations are controlled approvals for planned fueling. They connect routing recommendations with operational limits and Motive purchase reconciliation."
        ],
        bullets: [
          "Create approval records from smart route stops.",
          "Track status: approved, sent, used, expired, violated, or cancelled.",
          "Store vehicle, driver, station, route, amount, gallons, price cap, and driver message.",
          "Copy driver instructions for communication.",
          "Mark approvals as sent.",
          "Cancel approvals when plans change.",
          "Reconcile individual approvals or bulk reconcile open approvals against Motive purchases."
        ]
      },
      {
        title: "9. Safety Workspace",
        paragraphs: [
          "Safety is a focused workspace for compliance, incidents, emergency support, safety documents, investigations, shift briefs, and AI-assisted review."
        ],
        bullets: [
          "Safety Notes: private notes saved by Safety users.",
          "Safety Documents: upload and review files with categorization, summary, issues, recommended action, and excerpt.",
          "Investigations: create and manage cases with facts, evidence, questions, action plans, outcomes, severity, owner, due date, and vehicle ID.",
          "Shift Briefs: maintain handoff notes, checklist items, action items, and shift status.",
          "Service Tools: locate service centers and emergency support options.",
          "Safety AI Chat: ask operational safety questions and include image attachments when supported."
        ]
      },
      {
        title: "10. Driver Workspace",
        paragraphs: [
          "The Driver Workspace is mobile-first and linked to a Motive vehicle. It keeps driver-facing tools simple while still connecting to the company operations platform."
        ],
        bullets: [
          "Register or sign in by truck number, password, and matched Motive vehicle.",
          "View linked truck profile, current route support, fuel tools, service tools, emergency tools, and team chat.",
          "Use the same route assistant experience with driver-appropriate constraints.",
          "Access support features without exposing the full Fuel Service or Admin workspace."
        ]
      },
      {
        title: "11. Team Chat",
        paragraphs: [
          "Team Chat is a shared communication layer for operational departments. It supports quick collaboration without leaving the platform."
        ],
        bullets: [
          "Send messages to shared rooms.",
          "Reply to messages with context previews.",
          "Edit your own messages.",
          "Delete your own messages; Safety and Admin can remove messages when needed.",
          "Filter and search conversation content."
        ]
      },
      {
        title: "12. Maps, Data, and Integrations",
        paragraphs: [
          "The application depends on backend integrations for live fleet, routing, map, station, price, and AI features. When an integration is not configured, the UI reports the unavailable state instead of silently failing."
        ],
        bullets: [
          "Motive API supplies fleet, driver, vehicle, location, and fuel-related data.",
          "TomTom supports map, routing, traffic, location search, and capability discovery.",
          "Official station catalog data supports Love's and Pilot Flying J fuel stop discovery.",
          "OpenRouter settings can power AI-assisted route guidance and safety chat workflows.",
          "Backend runtime cache workers refresh live price and Motive snapshot data where enabled."
        ]
      },
      {
        title: "13. Security Model",
        paragraphs: [
          "The security model is role based. The frontend hides workspaces that do not apply to the current user, and the backend enforces access on protected routes."
        ],
        bullets: [
          "Backend JWT authentication is required for protected API routes.",
          "Passwords are verified against backend password hashes.",
          "Office user registration is disabled by default and controlled by PUBLIC_REGISTRATION_ENABLED.",
          "Admin can ban accounts, and banned accounts are denied login and token access.",
          "Department checks protect Fuel Service, Safety, Driver, and Admin workflows.",
          "CORS origins are configured from backend environment settings."
        ]
      },
      {
        title: "14. Deployment Notes",
        paragraphs: [
          "The frontend is a Vite application and the backend is a FastAPI application. Production deployments should set explicit environment variables for API URLs, database, authentication secret, integrations, CORS, and admin bootstrap credentials."
        ],
        bullets: [
          "Frontend VITE_API_URL should point to the backend API root, including /api.",
          "Backend DATABASE_URL should point to the production PostgreSQL database.",
          "SECRET_KEY must be changed from the development default.",
          "PUBLIC_REGISTRATION_ENABLED should remain false for private operations mode.",
          "ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_EMAIL should be set before first production start, then the password should be rotated.",
          "MOTIVE_API_KEY, TOMTOM_API_KEY, and AI provider settings should be configured only in backend or deployment environment variables."
        ]
      },
      {
        title: "15. Troubleshooting",
        bullets: [
          "Cannot sign in: confirm the selected department matches the account role and the account is not banned.",
          "Any email no longer registers: this is expected. Office accounts must be created by Admin.",
          "Admin login fails: confirm the bootstrap admin exists and the deployed ADMIN_USERNAME and ADMIN_PASSWORD values are correct.",
          "Motive data unavailable: confirm Motive credentials and backend network access.",
          "Routing unavailable: confirm TomTom credentials and backend API availability.",
          "Frontend calls the wrong backend: verify VITE_API_URL in .env, .env.production, and the deployment platform."
        ]
      }
    ]
  },  privacy: {
    eyebrow: "Privacy & Terms",
    title: "Privacy Policy & SMS Terms",
    effectiveDate: "Effective Date: April 9, 2026",
    sections: [
      {
        title: "1. Information We Collect",
        paragraphs: [
          "We collect information to provide you with a better experience while using our services. This may include information you provide directly through forms or interactions with the site, as well as information collected through tracking tools used to improve site performance and user experience."
        ],
        bullets: [
          "Personal information such as your name, email address, and phone number.",
          "Cookies, web beacons, and similar tracking technologies used to understand user behavior, remember preferences, and improve our services.",
          "You can manage or disable cookies through your browser settings."
        ]
      },
      {
        title: "2. How We Use Your Information",
        bullets: [
          "Provide services, including trucking support, order processing, quote handling, and customer support.",
          "Analyze usage patterns, improve the site, and enhance the user experience.",
          "Send updates, promotions, and important service-related communications.",
          "Comply with applicable laws, regulations, and legal requests."
        ]
      },
      {
        title: "3. SMS Terms & Conditions",
        paragraphs: [
          "Information obtained as part of the SMS consent process will not be shared with third parties for marketing purposes."
        ]
      },
      {
        title: "4. Your Rights and Choices",
        paragraphs: [
          "As a user, you may have the following rights regarding your personal data:"
        ],
        bullets: [
          "Access: You can request to view the personal information we have collected about you.",
          "Correction: You can update or correct inaccurate or incomplete information.",
          "Deletion: You can request deletion of your personal data, subject to legal or contractual obligations.",
          "Opt-Out: You can unsubscribe from marketing communications by using the unsubscribe link in our emails or by contacting us directly.",
          "Cookies Management: You can manage or disable cookies through your browser settings."
        ],
        notes: [
          <>If you would like to exercise any of these rights or ask questions about how we handle your data, please contact us at {safetyEmail}.</>
        ]
      },
      {
        title: "5. Children's Privacy",
        paragraphs: [
          "Our services are not intended for children under the age of 13, and we do not knowingly collect or solicit personal information from children. If we learn that we have collected personal information from a child under 13, we will take steps to delete that information as quickly as possible."
        ]
      },
      {
        title: "6. Third-Party Links",
        paragraphs: [
          "Our site may contain links to external websites that are not operated by us. We are not responsible for the content, privacy practices, or policies of those third-party sites, and we encourage you to review their privacy policies before using them."
        ]
      },
      {
        title: "7. Changes to This Privacy Policy",
        paragraphs: [
          "We may update this Privacy Policy from time to time. Any changes will be posted on this page together with an updated effective date. We encourage you to review this policy periodically to stay informed about how we protect your information."
        ]
      },
      {
        title: "8. Contact Us",
        paragraphs: [
          <>If you have any questions about this Privacy Policy, the data we collect, or how we use your information, please contact us at {safetyEmail}.</>
        ]
      },
      {
        title: "9. SMS Terms & Conditions",
        details: [
          {
            label: "SMS Consent Communication",
            content: "Phone numbers collected during the SMS consent process will not be shared with third parties for marketing purposes."
          },
          {
            label: "Types of SMS Communications",
            content: "If you consent to receive conversational text messages from UNITED LANE LLC, you may receive follow-up messages, transportation-service updates, and broker-related communications."
          },
          {
            label: "Message Frequency",
            content: "Message frequency may vary depending on the type of communication and your engagement. You may receive approximately 5 to 10 messages per day related to your request."
          },
          {
            label: "Potential Fees for SMS Messaging",
            content: "Standard message and data rates may apply based on your carrier's pricing plan. Charges may differ for domestic and international messages."
          },
          {
            label: "Opt-In Method",
            content: <>You may opt in to receive conversational SMS messages from UNITED LANE LLC by submitting the website form at {smsFormLink}.</>
          },
          {
            label: "Opt-Out Method",
            content: "You can opt out of receiving SMS messages at any time by replying STOP to any SMS you receive. You may also contact us directly to request removal from our messaging list."
          },
          {
            label: "Help",
            content: <>If you experience any issues, reply HELP to any SMS message or contact us directly at {helpPhone}.</>
          },
          {
            label: "Additional Options",
            content: "If you do not wish to receive SMS messages, simply leave the SMS consent box unchecked on our forms."
          },
          {
            label: "Standard Messaging Disclosures",
            content: <>Message and data rates may apply. You can opt out at any time by texting STOP. For assistance, reply HELP. Messaging frequency may vary. Visit our privacy policy and terms at {privacyPolicyLink}.</>
          }
        ]
      }
    ]
  }
};

function getNavButtonClass(activeItem, item) {
  return `site-nav-button${activeItem === item ? " site-nav-button-active" : ""}`;
}

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

export function SiteHeader({ onHome, onAbout, onDocs, onPrivacy, activeItem = "" }) {
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
            <button className={getNavButtonClass(activeItem, "home")} type="button" onClick={onHome}>
              HOME
            </button>
            <button className={getNavButtonClass(activeItem, "about")} type="button" onClick={onAbout}>
              ABOUT US
            </button>
            <button className={getNavButtonClass(activeItem, "docs")} type="button" onClick={onDocs}>
              DOCS
            </button>
            <button className={getNavButtonClass(activeItem, "privacy")} type="button" onClick={onPrivacy}>
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
        {panel.effectiveDate ? <p className="site-dialog-meta">{panel.effectiveDate}</p> : null}

        <div className="site-dialog-body">
          {panel.paragraphs?.map((paragraph, index) => (
            <p key={`panel-paragraph-${index}`}>{paragraph}</p>
          ))}

          {panel.sections?.map((section) => (
            <section className="site-dialog-section" key={section.title}>
              <h3>{section.title}</h3>
              {section.paragraphs?.map((paragraph, index) => (
                <p key={`${section.title}-paragraph-${index}`}>{paragraph}</p>
              ))}
              {section.bullets?.length ? (
                <ul className="site-dialog-list">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              {section.notes?.map((note, index) => (
                <p key={`${section.title}-note-${index}`}>{note}</p>
              ))}
              {section.details?.length ? (
                <div className="site-dialog-details">
                  {section.details.map((detail) => (
                    <article className="site-dialog-detail" key={detail.label}>
                      <strong>{detail.label}</strong>
                      <p>{detail.content}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
