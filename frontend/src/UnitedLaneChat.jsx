import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DEFAULT_ASSISTANT_NAME = "Safety Team";
const DEFAULT_QUICK_PROMPTS = [
  "Write a short driver coaching message.",
  "Give me a post-accident checklist.",
  "Review this safety issue and tell me the next steps."
];

function createWelcomeMessage(assistantName = DEFAULT_ASSISTANT_NAME, text = "Safety Team is ready.") {
  return {
    role: "assistant",
    assistantName,
    text
  };
}

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
    throw new Error(data.detail || "Safety Team could not answer right now.");
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

export default function UnitedLaneChat({
  token,
  user,
  title = "Safety AI",
  assistantName = DEFAULT_ASSISTANT_NAME,
  workspace = "Safety",
  extraContext = "",
  promptOptions = DEFAULT_QUICK_PROMPTS,
  welcomeText = "Safety Team is ready.",
  placeholder = "Ask Safety AI",
  className = ""
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState(() => [createWelcomeMessage(assistantName, welcomeText)]);
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState("");
  const logRef = useRef(null);
  const fileInputRef = useRef(null);

  const context = useMemo(() => {
    const lines = [];
    if (user) {
      lines.push(`User: ${user.full_name} (${user.email})`);
    }
    lines.push(`Workspace: ${workspace}`);
    if (extraContext.trim()) {
      lines.push(extraContext.trim());
    }
    return lines.join("\n");
  }, [extraContext, user, workspace]);

  useEffect(() => {
    setMessages([createWelcomeMessage(assistantName, welcomeText)]);
  }, [assistantName, welcomeText]);

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
      setAttachmentError("Please upload PNG, JPEG, WEBP, or GIF.");
      return;
    }

    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      clearAttachment();
      setAttachmentError(`Image is too large. Keep it under ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.`);
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
    const outgoingText = trimmed || (nextAttachment ? "Please review the attached image." : "");
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
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          assistantName: data.assistant_name || assistantName,
          text: data.message
        }
      ]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          assistantName,
          text: error.message || "Safety Team could not answer right now."
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
    <section className={`panel unitedlane-ai-workspace ${className}`.trim()}>
      <div className="panel-head unitedlane-ai-head">
        <div>
          <h2>{title}</h2>
          <span>{sending ? "Working..." : "Ready"}</span>
        </div>
        <div className="unitedlane-ai-status">
          <span>{sending ? "Thinking" : "Online"}</span>
          <strong>{assistantName}</strong>
        </div>
      </div>

      <section className="unitedlane-ai-promptbar">
        {promptOptions.map((prompt) => (
          <button key={prompt} type="button" className="unitedlane-ai-chip" onClick={() => submitMessage(prompt)} disabled={sending}>
            {prompt}
          </button>
        ))}
      </section>

      <div className="unitedlane-ai-layout unitedlane-ai-layout-single">
        <div className="unitedlane-ai-chatcard">
          <div className="unitedlane-ai-log" ref={logRef}>
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`unitedlane-ai-bubble unitedlane-ai-bubble-${message.role}`}>
                <strong>{message.role === "assistant" ? (message.assistantName || assistantName) : "You"}</strong>
                {message.imageUrl ? <img className="unitedlane-ai-bubble-image" src={message.imageUrl} alt={message.imageName || "Uploaded attachment"} /> : null}
                {message.imageName ? <span className="unitedlane-ai-bubble-meta">{message.imageName}</span> : null}
                <p>{message.text}</p>
              </article>
            ))}
            {sending ? <div className="unitedlane-ai-thinking">Working...</div> : null}
          </div>

          <form className="unitedlane-ai-form" onSubmit={handleSubmit}>
            {attachment ? (
              <div className="unitedlane-ai-attachment-preview">
                <img src={attachment.dataUrl} alt={attachment.name} className="unitedlane-ai-attachment-thumb" />
                <div className="unitedlane-ai-attachment-copy">
                  <strong>{attachment.name}</strong>
                  <span>{formatBytes(attachment.size)}</span>
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
              placeholder={placeholder}
              rows={4}
            />
            <div className="unitedlane-ai-formbar">
              <span>{attachment ? "Image attached" : "Optional image supported"}</span>
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
                  {attachment ? "Change image" : "Attach image"}
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
