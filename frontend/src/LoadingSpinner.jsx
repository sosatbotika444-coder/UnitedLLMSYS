export function LoadingSpinner({
  label = "Loading...",
  size = "sm",
  inline = false,
  className = "",
}) {
  const classes = [
    inline ? "loading-spinner-inline" : "loading-spinner-block",
    `loading-spinner-${size}`,
    className,
  ].filter(Boolean).join(" ");

  return (
    <span className={classes} role="status" aria-live="polite">
      <span className="loading-spinner-circle" aria-hidden="true" />
      {label ? <span className="loading-spinner-label">{label}</span> : null}
    </span>
  );
}

export function LoadingState({ label = "Loading data...", className = "" }) {
  return (
    <div className={`loading-state ${className}`.trim()}>
      <LoadingSpinner label={label} size="md" />
    </div>
  );
}

export function LoadingButtonLabel({ loading, loadingLabel = "Loading...", children }) {
  return loading ? <LoadingSpinner label={loadingLabel} inline /> : children;
}
