import { useEffect, useRef, useState } from "react";

export default function MapStage({ title = "Map", detail = "", className = "", children }) {
  const stageRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("map-fullscreen-active", isFullscreen);

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    }

    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    }

    const resizeTimers = isFullscreen
      ? [40, 180, 420].map((delay) => window.setTimeout(() => window.dispatchEvent(new Event("resize")), delay))
      : [];

    if (isFullscreen) {
      window.addEventListener("keydown", handleEscape);
      document.addEventListener("fullscreenchange", handleFullscreenChange);
    }

    return () => {
      document.body.classList.remove("map-fullscreen-active");
      window.removeEventListener("keydown", handleEscape);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      resizeTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isFullscreen]);

  async function toggleFullscreen() {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        await stageRef.current?.requestFullscreen?.();
      } catch {
        // CSS fullscreen still works when the browser blocks native fullscreen.
      }
      return;
    }

    setIsFullscreen(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.();
      } catch {
        // Ignore browser fullscreen exit errors; CSS state is already reset.
      }
    }
  }

  return (
    <div
      ref={stageRef}
      className={`route-map-stage map-stage-shell ${isFullscreen ? "route-map-stage-fullscreen map-stage-shell-fullscreen" : ""} ${className}`.trim()}
    >
      <div className="route-map-toolbar">
        <div className="route-map-toolbar-copy">
          <strong>{title}</strong>
          {detail ? <span>{detail}</span> : null}
        </div>
        <button className="secondary-button route-map-expand-button" type="button" onClick={toggleFullscreen}>
          {isFullscreen ? "Close full screen" : "Full screen"}
        </button>
      </div>
      {typeof children === "function" ? children({ isFullscreen }) : children}
    </div>
  );
}
