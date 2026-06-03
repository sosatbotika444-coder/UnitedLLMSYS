export function parseDataDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function firstDataDate(...values) {
  for (const value of values) {
    if (parseDataDate(value)) return value;
  }
  return "";
}

export function latestDataDate(values = []) {
  let latest = null;
  values.forEach((value) => {
    const parsed = parseDataDate(value);
    if (!parsed) return;
    if (!latest || parsed.getTime() > latest.getTime()) {
      latest = parsed;
    }
  });
  return latest ? latest.toISOString() : "";
}

export function formatDataDate(value) {
  const parsed = parseDataDate(value);
  if (!parsed) return value ? String(value) : "Not loaded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

export function DataFreshnessStrip({ items = [], className = "" }) {
  const visibleItems = items.filter(Boolean);
  if (!visibleItems.length) return null;

  return (
    <section className={`data-freshness-strip ${className}`.trim()} aria-label="Data dates">
      {visibleItems.map((item) => (
        <article key={item.id || item.label} className={`data-freshness-item ${item.tone ? `data-freshness-${item.tone}` : ""}`.trim()}>
          <span>{item.label}</span>
          <strong>{item.loading ? "Loading..." : formatDataDate(item.value)}</strong>
          {item.detail ? <small>{item.detail}</small> : null}
        </article>
      ))}
    </section>
  );
}
