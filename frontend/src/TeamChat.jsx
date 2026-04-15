import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const MESSAGE_LIMIT = 120;
const departmentLabels = {
  fuel: "Fuel Service",
  safety: "Safety",
  driver: "Driver"
};
const departmentFilters = [
  { id: "all", label: "All" },
  { id: "fuel", label: "Fuel" },
  { id: "safety", label: "Safety" },
  { id: "driver", label: "Driver" }
];

async function apiRequest(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

function mergeMessages(current, incoming) {
  const byId = new Map((current || []).map((message) => [message.id, message]));
  (incoming || []).forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values())
    .sort((left, right) => Number(left.id) - Number(right.id))
    .slice(-180);
}

function formatChatTime(value) {
  if (!value) return "Now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function authorInitials(author) {
  const name = author?.fullName || author?.email || "Team";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "UL";
}

function departmentLabel(department) {
  return departmentLabels[department] || "Team";
}

function shortMessage(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function messageSearchText(message) {
  return [message.body, message.author?.fullName, message.author?.email, departmentLabel(message.author?.department), message.replyTo?.body, message.replyTo?.authorName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function newestMessageId(messages) {
  return (messages || []).reduce((maxId, message) => Math.max(maxId, Number(message.id) || 0), 0);
}

function TeamChatMessage({ message, replyCount, highlighted, canModerate, onReply, onEdit, onDelete, onJumpToReply }) {
  const author = message.author || {};
  const canEdit = message.isOwn && !message.isDeleted;
  const canDelete = !message.isDeleted && (message.isOwn || canModerate);

  return (
    <article
      className={`team-chat-message${message.isOwn ? " own" : ""}${message.isDeleted ? " deleted" : ""}${highlighted ? " highlighted" : ""}`}
      data-message-id={message.id}
    >
      <div className={`team-chat-avatar team-chat-avatar-${author.department || "team"}`}>{authorInitials(author)}</div>
      <div className="team-chat-bubble">
        <header className="team-chat-message-head">
          <div>
            <strong>{author.fullName || "Unknown user"}</strong>
            <span>{departmentLabel(author.department)}</span>
          </div>
          <time dateTime={message.createdAt || ""}>{formatChatTime(message.createdAt)}</time>
        </header>

        {message.replyTo ? (
          <button className="team-chat-reply-preview" type="button" onClick={() => onJumpToReply(message.replyTo.id)}>
            <span>Reply to {message.replyTo.authorName || "message"}</span>
            <strong>{shortMessage(message.replyTo.body || "Message deleted", 150)}</strong>
          </button>
        ) : null}

        <p className="team-chat-message-body">{message.body}</p>

        <footer className="team-chat-message-actions">
          <button type="button" onClick={() => onReply(message)} disabled={message.isDeleted}>
            Reply
          </button>
          {canEdit ? <button type="button" onClick={() => onEdit(message)}>Edit</button> : null}
          {canDelete ? <button type="button" onClick={() => onDelete(message)}>Delete</button> : null}
          {message.editedAt ? <span>Edited</span> : null}
          {replyCount ? <span>{replyCount} {replyCount === 1 ? "reply" : "replies"}</span> : null}
        </footer>
      </div>
    </article>
  );
}

export default function TeamChat({ token, user, active = true, room = "general" }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [highlightedId, setHighlightedId] = useState(null);
  const messageListRef = useRef(null);
  const lastMessageIdRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);

  const loadMessages = useCallback(
    async ({ afterId = 0, mode = "initial" } = {}) => {
      if (!token || requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      if (mode === "initial") setLoading(true);
      if (mode === "manual") setRefreshing(true);

      try {
        const params = new URLSearchParams({ room, limit: String(afterId ? 80 : MESSAGE_LIMIT) });
        if (afterId) params.set("after_id", String(afterId));
        const data = await apiRequest(`/chat/messages?${params.toString()}`, {}, token);
        setMessages((current) => {
          const next = afterId ? mergeMessages(current, data || []) : data || [];
          lastMessageIdRef.current = newestMessageId(next);
          return next;
        });
        setError("");
      } catch (fetchError) {
        setError(fetchError.message || "Team chat could not load.");
      } finally {
        requestInFlightRef.current = false;
        if (mode === "initial") setLoading(false);
        if (mode === "manual") setRefreshing(false);
      }
    },
    [room, token]
  );

  useEffect(() => {
    if (!token || !active) return undefined;
    lastMessageIdRef.current = 0;
    setMessages([]);
    loadMessages({ mode: "initial" });
    return undefined;
  }, [active, loadMessages, token]);

  useEffect(() => {
    if (!token || !active) return undefined;
    const timer = window.setInterval(() => {
      loadMessages({ afterId: lastMessageIdRef.current, mode: "poll" });
    }, 6000);
    return () => window.clearInterval(timer);
  }, [active, loadMessages, token]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || !shouldStickToBottomRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!highlightedId) return undefined;
    const timer = window.setTimeout(() => setHighlightedId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [highlightedId]);

  const filteredMessages = useMemo(() => {
    const term = search.trim().toLowerCase();
    return messages.filter((message) => {
      const matchesDepartment = departmentFilter === "all" || message.author?.department === departmentFilter;
      const matchesSearch = !term || messageSearchText(message).includes(term);
      return matchesDepartment && matchesSearch;
    });
  }, [departmentFilter, messages, search]);

  const participants = useMemo(() => {
    const byId = new Map();
    messages.forEach((message) => {
      if (message.author?.id) byId.set(message.author.id, message.author);
    });
    return Array.from(byId.values()).sort((left, right) => String(left.fullName).localeCompare(String(right.fullName)));
  }, [messages]);

  const replyCounts = useMemo(() => {
    const counts = new Map();
    messages.forEach((message) => {
      if (message.replyTo?.id) {
        counts.set(message.replyTo.id, (counts.get(message.replyTo.id) || 0) + 1);
      }
    });
    return counts;
  }, [messages]);

  const latestMessage = messages[messages.length - 1] || null;
  const visibleMessageCount = filteredMessages.length;
  const canSend = Boolean(draft.trim()) && !sending && !editingId;

  function handleListScroll(event) {
    const element = event.currentTarget;
    shouldStickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140;
  }

  function jumpToReply(messageId) {
    const node = messageListRef.current?.querySelector(`[data-message-id="${messageId}"]`);
    if (!node) {
      setError("That reply target is outside the loaded history. Refresh to load the latest thread.");
      return;
    }
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(messageId);
  }

  async function sendMessage(event) {
    event?.preventDefault?.();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError("");
    try {
      const created = await apiRequest(
        "/chat/messages",
        {
          method: "POST",
          body: JSON.stringify({ room, body, replyToId: replyTo?.id || null })
        },
        token
      );
      setMessages((current) => {
        const next = mergeMessages(current, [created]);
        lastMessageIdRef.current = newestMessageId(next);
        return next;
      });
      setDraft("");
      setReplyTo(null);
      shouldStickToBottomRef.current = true;
    } catch (sendError) {
      setError(sendError.message || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  function handleDraftKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(event);
    }
  }

  function startEdit(message) {
    setEditingId(message.id);
    setEditDraft(message.body || "");
    setReplyTo(null);
  }

  async function saveEdit(event) {
    event?.preventDefault?.();
    const body = editDraft.trim();
    if (!editingId || !body) return;

    setSending(true);
    setError("");
    try {
      const updated = await apiRequest(
        `/chat/messages/${editingId}`,
        {
          method: "PUT",
          body: JSON.stringify({ body })
        },
        token
      );
      setMessages((current) => mergeMessages(current, [updated]));
      setEditingId(null);
      setEditDraft("");
    } catch (editError) {
      setError(editError.message || "Message could not be edited.");
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(message) {
    if (!window.confirm("Delete this message from Team Chat?")) return;
    setError("");
    try {
      const updated = await apiRequest(`/chat/messages/${message.id}`, { method: "DELETE" }, token);
      setMessages((current) => mergeMessages(current, [updated]));
    } catch (deleteError) {
      setError(deleteError.message || "Message could not be deleted.");
    }
  }

  if (!token) {
    return <div className="notice error inline-notice">Sign in to use Team Chat.</div>;
  }

  return (
    <section className="team-chat-panel">
      <div className="team-chat-hero">
        <div className="team-chat-hero-copy">
          <span>All Workspaces</span>
          <h2>Team Chat</h2>
          <p>Fuel Service, Safety, and Driver accounts share one live operations thread.</p>
        </div>
        <div className="team-chat-live-card">
          <span>Signed in</span>
          <strong>{user?.full_name || "Team member"}</strong>
          <small>{departmentLabel(user?.department)}</small>
        </div>
      </div>

      <div className="team-chat-metrics">
        <div><span>Messages</span><strong>{messages.length}</strong></div>
        <div><span>Participants</span><strong>{participants.length}</strong></div>
        <div><span>Latest</span><strong>{latestMessage ? departmentLabel(latestMessage.author?.department) : "Waiting"}</strong></div>
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}

      <div className="team-chat-shell">
        <aside className="team-chat-sidebar">
          <div className="team-chat-sidebar-section">
            <span className="team-chat-sidebar-label">Departments</span>
            <div className="team-chat-filter-row">
              {departmentFilters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={departmentFilter === filter.id ? "active" : ""}
                  onClick={() => setDepartmentFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="team-chat-sidebar-section">
            <span className="team-chat-sidebar-label">People in history</span>
            <div className="team-chat-people-list">
              {participants.length ? participants.slice(0, 12).map((person) => (
                <div key={person.id} className="team-chat-person">
                  <span className={`team-chat-mini-avatar team-chat-avatar-${person.department || "team"}`}>{authorInitials(person)}</span>
                  <div>
                    <strong>{person.fullName || "Unknown user"}</strong>
                    <small>{departmentLabel(person.department)}</small>
                  </div>
                </div>
              )) : <p>No participants yet.</p>}
            </div>
          </div>
        </aside>

        <section className="team-chat-main">
          <header className="team-chat-toolbar">
            <div>
              <h3>General Channel</h3>
              <span>{loading ? "Loading history..." : `${visibleMessageCount} visible messages`}</span>
            </div>
            <div className="team-chat-toolbar-actions">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search messages, people, departments"
              />
              <button type="button" className="secondary-button" onClick={() => loadMessages({ mode: "manual" })} disabled={refreshing || loading}>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </header>

          <div className="team-chat-log" ref={messageListRef} onScroll={handleListScroll}>
            {loading ? <div className="team-chat-empty">Loading Team Chat...</div> : null}
            {!loading && !filteredMessages.length ? (
              <div className="team-chat-empty">
                <strong>No messages found.</strong>
                <span>Start the shared channel or clear filters.</span>
              </div>
            ) : null}
            {filteredMessages.map((message) => (
              <TeamChatMessage
                key={message.id}
                message={message}
                replyCount={replyCounts.get(message.id) || 0}
                highlighted={highlightedId === message.id}
                canModerate={user?.department === "safety"}
                onReply={setReplyTo}
                onEdit={startEdit}
                onDelete={deleteMessage}
                onJumpToReply={jumpToReply}
              />
            ))}
          </div>

          {editingId ? (
            <form className="team-chat-composer editing" onSubmit={saveEdit}>
              <div className="team-chat-composer-context">
                <strong>Editing message</strong>
                <button type="button" onClick={() => { setEditingId(null); setEditDraft(""); }}>Cancel</button>
              </div>
              <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} maxLength={4000} />
              <div className="team-chat-composer-actions">
                <span>{editDraft.trim().length}/4000</span>
                <button className="primary-button" type="submit" disabled={sending || !editDraft.trim()}>{sending ? "Saving..." : "Save Edit"}</button>
              </div>
            </form>
          ) : (
            <form className="team-chat-composer" onSubmit={sendMessage}>
              {replyTo ? (
                <div className="team-chat-composer-context">
                  <div>
                    <strong>Replying to {replyTo.author?.fullName || "message"}</strong>
                    <span>{shortMessage(replyTo.body, 150)}</span>
                  </div>
                  <button type="button" onClick={() => setReplyTo(null)}>Cancel</button>
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                rows={3}
                maxLength={4000}
                placeholder="Message everyone in United Lane..."
              />
              <div className="team-chat-composer-actions">
                <span>Enter sends, Shift+Enter adds a line</span>
                <button className="primary-button" type="submit" disabled={!canSend}>{sending ? "Sending..." : "Send Message"}</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </section>
  );
}