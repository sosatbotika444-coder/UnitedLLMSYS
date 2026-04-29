import AuthShiftPlanner from "./AuthShiftPlanner";

export default function CommercialLanding({ authPanel, mobile = false }) {
  return (
    <main className={`site-auth-shell home-focus-shell ${mobile ? "home-focus-shell-mobile" : ""}`.trim()}>
      <div className="home-focus-panel">
        {authPanel}
      </div>

      <aside className="home-focus-planner">
        <AuthShiftPlanner title="Planner" />
      </aside>
    </main>
  );
}
