import { useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const welcomeMessage = {
  role: "assistant",
  text: "I am UnitedLane, your AI route and fuel assistant. I can help with fuel stops, routes, dispatch, trucking, loads, and station planning."
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
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([welcomeMessage]);

  const context = useMemo(() => {
    if (!user) return "";
    return `Signed in user: ${user.full_name} (${user.email})`;
  }, [user]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = input.trim();
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

  return (
    <>
      <button className="unitedlane-chat-fab" type="button" onClick={() => setOpen((value) => !value)}>
        <span>AI</span>
      </button>

      {open ? (
        <section className="unitedlane-chat-shell">
          <div className="unitedlane-chat-card">
            <div className="unitedlane-chat-head">
              <div>
                <strong>UnitedLane</strong>
                <span>Fuel, route, dispatch, and trucking chat</span>
              </div>
              <button type="button" className="unitedlane-chat-close" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div className="unitedlane-chat-log">
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`unitedlane-chat-bubble unitedlane-chat-bubble-${message.role}`}>
                  <strong>{message.role === "assistant" ? "UnitedLane" : "You"}</strong>
                  <p>{message.text}</p>
                </article>
              ))}
              {sending ? <div className="unitedlane-chat-status">UnitedLane is thinking...</div> : null}
            </div>

            <form className="unitedlane-chat-form" onSubmit={handleSubmit}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about fuel stops, routing, dispatch, loads, or station planning"
                rows={3}
              />
              <button className="primary-button primary-button-brand" type="submit" disabled={sending || !input.trim()}>
                Send
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </>
  );
}
