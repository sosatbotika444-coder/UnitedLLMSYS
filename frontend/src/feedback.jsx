import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { UnitedIcon } from "./UnitedLaneIcons";

const ConfirmDialogContext = createContext(async () => false);

const toneIcons = {
  default: "spark",
  danger: "warning",
  success: "success",
  info: "info",
};

function ConfirmDialog({ dialog, onResolve }) {
  useEffect(() => {
    if (!dialog) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onResolve(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, onResolve]);

  if (!dialog) {
    return null;
  }

  const {
    tone = "default",
    title = "Confirm action",
    description = "Please confirm to continue.",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    icon = toneIcons[tone] || "spark",
    hideCancel = false,
    meta = "",
  } = dialog;

  return (
    <div className="confirm-dialog-backdrop" onClick={() => onResolve(false)}>
      <section
        className={`confirm-dialog-shell confirm-dialog-${tone}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-icon">
          <UnitedIcon name={icon} size={22} />
        </div>
        <div className="confirm-dialog-copy">
          {meta ? <span className="confirm-dialog-meta">{meta}</span> : null}
          <h2 id="confirm-dialog-title">{title}</h2>
          <p>{description}</p>
        </div>
        <div className="confirm-dialog-actions">
          {!hideCancel ? (
            <button type="button" className="ghost-button" onClick={() => onResolve(false)}>
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={tone === "danger" ? "delete-button" : "primary-button"}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ConfirmDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      setDialog({
        tone: "default",
        title: "Confirm action",
        description: "Please confirm to continue.",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        hideCancel: false,
        ...options,
        resolve,
      });
    });
  }, []);

  const resolveDialog = useCallback((accepted) => {
    setDialog((current) => {
      if (current?.resolve) {
        current.resolve(Boolean(accepted));
      }
      return null;
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <ConfirmDialog dialog={dialog} onResolve={resolveDialog} />
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  return useContext(ConfirmDialogContext);
}
