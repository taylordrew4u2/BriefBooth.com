// Fixed same-origin destinations. URL intent selects a view, never an identity or permission.
export const recoveryOwnerId = "adc53778-f007-4c58-bd47-ba7a675abb29";
export const clientWorkspacePath = "/client/?workspace=account";

function connection(search: string) {
  const value = new URLSearchParams(search).get("connect");
  return value === "google" || value === "zoom" ? value : null;
}
export function accountSignInPath(search = "") {
  const intent = connection(search);
  return "/account/sign-in/" + (intent ? "?connect=" + intent : "");
}
export function accountCallbackPath(search = "") {
  const intent = connection(search);
  return "/account/" + (intent ? "?connect=" + intent : "");
}
export function consultantWorkspacePath(search = "") {
  const intent = connection(search);
  return "/studio/?workspace=consultant" + (intent ? "&connect=" + intent : "");
}
export function needsConsultantWorkspace(search: string) {
  const params = new URLSearchParams(search);
  return params.get("workspace") === "consultant" || connection(search) !== null || params.has("google") || params.has("zoom");
}
export function needsAccountAccess(search: string) {
  const params = new URLSearchParams(search);
  return connection(search) !== null || ["signin", "signup", "password"].includes(params.get("mode") || "") || params.has("code");
}
export function accountDestination(role: unknown, clientIntent: boolean, search: string, recovery: boolean) {
  if (role === "consultant" && !clientIntent) return recovery ? consultantWorkspacePath(search) : (connection(search) ? "/studio/?connect=" + connection(search) : "/studio");
  return recovery ? clientWorkspacePath : "/client";
}
export function isRecoveryOwnerWorkspace(userId: string, recovery: boolean) {
  return recovery && userId === recoveryOwnerId;
}
export function usesRecoveryBooking(path: string, recovery: boolean) {
  return recovery && /^\/book\/4u-digital\/?$/.test(path);
}
