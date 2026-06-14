import { actions, useStore } from "../store";

/** Inline approval bar shown when the server requests a permission. */
export function PermissionPrompt() {
  const permission = useStore((s) => s.permission);
  if (!permission) {
    return null;
  }
  const reply = (r: "once" | "always" | "reject") => {
    actions.respondPermission(permission.permissionId, r);
    useStore.setState({ permission: undefined });
  };
  return (
    <div className="permission">
      <div className="permission-title">{permission.title}</div>
      <div className="permission-actions">
        <button className="control primary" onClick={() => reply("once")}>
          Allow once
        </button>
        <button className="control" onClick={() => reply("always")}>
          Always
        </button>
        <button className="control danger" onClick={() => reply("reject")}>
          Reject
        </button>
      </div>
    </div>
  );
}
