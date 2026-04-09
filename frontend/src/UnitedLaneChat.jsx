import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const quickPrompts = [
  "Review diesel prices along this route.",
  "Summarize today's dispatch priorities.",
  "Compare Love's and Pilot for parking and fuel planning.",
  "Draft a message to a driver about a route change."
];
const welcomeMessage = {
  role: "assistant",
  text: "Assistant is ready. Ask about routes, loads, stations, messages, writing help, or attach a photo for analysis."
};

async function sendChatMessage(message, token, context = "", attachment = null) {
  const response = await fetch(`${API_URL}/navigation/assistant-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      message,
      context,
      image_name: attachment?.name || "",
      image_data_url: attachment?.dataUrl || ""
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "UnitedLane could not answer right now.");
  }

  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image upload could not be read."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UnitedLaneChat({ token, user }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([welcomeMessage]);
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState("");
  const logRef = useRef(null);
  const fileInputRef = useRef(null);

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

  function clearAttachment() {
    setAttachment(null);
    setAttachmentError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleAttachmentChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setAttachmentError("");

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      clearAttachment();
      setAttachmentError("Please upload a PNG, JPEG, WEBP, or GIF image.");
      return;
    }

    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      clearAttachment();
      setAttachmentError(`Image is too large. Please keep it under ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAttachment({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl
      });
    } catch (error) {
      clearAttachment();
      setAttachmentError(error.message || "Image upload could not be read.");
    }
  }

  async function submitMessage(text, nextAttachment = attachment) {
    const trimmed = text.trim();
    const outgoingText = trimmed || (nextAttachment ? "Please analyze the attached image." : "");
    if (!outgoingText || !token || sending) return;

    const userMessage = {
      role: "user",
      text: outgoingText,
      imageUrl: nextAttachment?.dataUrl || "",
      imageName: nextAttachment?.name || ""
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    clearAttachment();

    try {
      const data = await sendChatMessage(outgoingText, token, context, nextAttachment);
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
          <h2>Assistant</h2>
          <span>Ask about routes, dispatch notes, station comparisons, writing help, or upload a local image for analysis.</span>
        </div>
        <div className="unitedlane-ai-status">
          <span>{sending ? "Thinking" : "Online"}</span>
          <strong>{sending ? "Preparing assistant response" : "OpenRouter multimodal assistant available"}</strong>
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
            <h3>How to use it</h3>
            <p>Type a question, attach a photo from disk, or combine both in one request.</p>
          </div>
          <div className="unitedlane-ai-sidebar-card subdued">
            <strong>Image support</strong>
            <p>Upload route screenshots, station photos, dispatch dashboards, bills, or documents. PNG, JPEG, WEBP, and GIF are supported up to {formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.</p>
          </div>
        </aside>

        <div className="unitedlane-ai-chatcard">
          <div className="unitedlane-ai-log" ref={logRef}>
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`unitedlane-ai-bubble unitedlane-ai-bubble-${message.role}`}>
                <strong>{message.role === "assistant" ? "UnitedLane" : "You"}</strong>
                {message.imageUrl ? <img className="unitedlane-ai-bubble-image" src={message.imageUrl} alt={message.imageName || "Uploaded attachment"} /> : null}
                {message.imageName ? <span className="unitedlane-ai-bubble-meta">Attached image: {message.imageName}</span> : null}
                <p>{message.text}</p>
              </article>
            ))}
            {sending ? <div className="unitedlane-ai-thinking">Working on it...</div> : null}
          </div>

          <form className="unitedlane-ai-form" onSubmit={handleSubmit}>
            {attachment ? (
              <div className="unitedlane-ai-attachment-preview">
                <img src={attachment.dataUrl} alt={attachment.name} className="unitedlane-ai-attachment-thumb" />
                <div className="unitedlane-ai-attachment-copy">
                  <strong>{attachment.name}</strong>
                  <span>{formatBytes(attachment.size)} | Ready for analysis</span>
                </div>
                <button type="button" className="secondary-button unitedlane-ai-remove-attachment" onClick={clearAttachment} disabled={sending}>
                  Remove
                </button>
              </div>
            ) : null}

            {attachmentError ? <div className="notice error inline-notice unitedlane-ai-inline-error">{attachmentError}</div> : null}

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about routing, station pricing, dispatch, writing, or upload a photo for UnitedLane to inspect"
              rows={4}
            />
            <div className="unitedlane-ai-formbar">
              <span>Workspace context and optional image are sent with the current request.</span>
              <div className="unitedlane-ai-form-actions">
                <input
                  ref={fileInputRef}
                  className="unitedlane-ai-upload-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAttachmentChange}
                  disabled={sending}
                />
                <button className="secondary-button unitedlane-ai-upload-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={sending}>
                  {attachment ? "Change photo" : "Attach photo"}
                </button>
                <button className="primary-button primary-button-brand" type="submit" disabled={sending || (!input.trim() && !attachment)}>
                  Send
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
