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
  privacy: {
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

export function SiteHeader({ onHome, onAbout, onPrivacy, activeItem = "" }) {
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
