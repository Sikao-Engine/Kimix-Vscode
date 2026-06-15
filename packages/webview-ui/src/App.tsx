import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { PlanReview } from "./components/PlanReview";
import { PendingQueue } from "./components/PendingQueue";
import { useStore } from "./store";
import { onHostMessage, postToHost } from "./vscodeApi";

export function App() {
  const apply = useStore((s) => s.applyHostMessage);
  const ui = useStore((s) => s.ui);
  const error = useStore((s) => s.errorBanner);

  useEffect(() => {
    const off = onHostMessage(apply);
    postToHost({ type: "ready" });
    return off;
  }, [apply]);

  return (
    <div className="app">
      <Toolbar />
      {ui.status === "starting" && (
        <div className="banner">Starting server…</div>
      )}
      {ui.status === "error" && (
        <div className="banner banner-error">
          Server error: {ui.serverError ?? "unknown"}
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      <div className="body">
        <div className="chat">
          <MessageList />
          <PlanReview />
          <PendingQueue />
          <PermissionPrompt />
          <Composer />
        </div>
      </div>
    </div>
  );
}
