import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const quickPrompts = [
  "Review diesel prices along this route.",
  "Summarize today's dispatch priorities.",
  "Compare Love's and Pilot for parking and fuel planning.",
  "Draft a message to a driver about a route change."
];
const welcomeMessage = {
  role: "assistant",
  text:
    "UnitedLane AI Operations Assistant is ready. You can use this space for route questions, dispatch notes, station comparisons, business writing, and day-to-day support."
};

async function sendChatMessage(message, token, context = "") {
  const response = await fetch(`${API_URL}/navigation/assistant-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ message, context })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "UnitedLane could not answer right now.");
  }

  return data;
}

export default function UnitedLaneChat({ token, user }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([welcomeMessage]);
  const logRef = useRef(null);

  const context = useMemo(() => {
    if (!user) return "";
    return [
      `Signed in user: ${user.full_name} (${user.email})`,
      "Workspace: UnitedLane dispatch, official station routing, and assistant panel"
    ].join("\n");
  }, [user]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, sending]);

  async function submitMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || !token || sending) return;

    const nextMessages = [...messages, { role: "user", text: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const data = await sendChatMessage(trimmed, token, context);
      setMessages([...nextMessages, { role: "assistant", text: data.message }]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          text: error.message || "UnitedLane could not answer right now."
        }
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await submitMessage(input);
  }

  return (
    <section className="panel unitedlane-ai-workspace">
      <div className="panel-head unitedlane-ai-head">
        <div>
          <h2>AI Operations Assistant</h2>
          <span>Route planning, dispatch writing, station comparisons, and business support in one premium chat surface.</span>
        </div>
        <div className="unitedlane-ai-status">
          <span>{sending ? "Thinking" : "Online"}</span>
          <strong>{sending ? "Preparing response" : "Workspace assistant available"}</strong>
        </div>
      </div>

      <section className="unitedlane-ai-promptbar">
        {quickPrompts.map((prompt) => (
          <button key={prompt} type="button" className="unitedlane-ai-chip" onClick={() => submitMessage(prompt)} disabled={sending}>
            {prompt}
          </button>
        ))}
      </section>

      <div className="unitedlane-ai-layout">
        <aside className="unitedlane-ai-sidebar">
          <div className="unitedlane-ai-sidebar-card">
            <span className="brand-pill">UnitedLane</span>
            <h3>Operations Copilot</h3>
            <p>Use this space for route insight, fuel analysis, driver messaging, customer drafts, and daily operations support.</p>
          </div>
          <div className="unitedlane-ai-sidebar-card subdued">
            <strong>Fast-start prompts</strong>
            <p>Ask for route summaries, price comparisons, driver notes, customer-facing drafts, or quick general help.</p>
          </div>
        </aside>

        <div className="unitedlane-ai-chatcard">
          <div className="unitedlane-ai-log" ref={logRef}>
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`unitedlane-ai-bubble unitedlane-ai-bubble-${message.role}`}>
                <strong>{message.role === "assistant" ? "UnitedLane" : "You"}</strong>
                <p>{message.text}</p>
              </article>
            ))}
            {sending ? <div className="unitedlane-ai-thinking">Working on it...</div> : null}
          </div>

          <form className="unitedlane-ai-form" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about routing, station pricing, dispatch, writing, or general workspace support"
              rows={4}
            />
            <div className="unitedlane-ai-formbar">
              <span>Workspace context is attached automatically when available.</span>
              <button className="primary-button primary-button-brand" type="submit" disabled={sending || !input.trim()}>
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
