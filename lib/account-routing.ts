// Fixed same-origin destinations. URL intent selects a view, never an identity or permission.
export const recoveryOwnerId = "adc53778-f007-4c58-bd47-ba7a675abb29";
export const clientWorkspacePath = "/client/?workspace=account";

function connection(search: string) {
  const params = new URLSearchParams(search);
  const value = params.get("connect");
  if (value === "google" || value === "zoom") return value;
  // A staged Google grant still needs a verified owner session. Keep its
  // completion intent through sign-in; the URL itself never grants access.
  return !params.has("connect") && params.get("google") === "pending" ? "google" : null;
}
function connectionQuery(search: string) {
  const intent = connection(search);
  if (!intent) return "";
  const pending = intent === "google" && new URLSearchParams(search).get("google") === "pending";
  return "connect=" + intent + (pending ? "&google=pending" : "");
}
export function accountSignInPath(search = "") {
  const query = connectionQuery(search);
  return "/account/sign-in/" + (query ? "?" + query : "");
}
export function accountCallbackPath(search = "") {
  const query = connectionQuery(search);
  return "/account/" + (query ? "?" + query : "");
}
export function accountPasswordCallbackPath(search = "") {
  const query = connectionQuery(search);
  return "/account?mode=password" + (query ? "&" + query : "");
}
export function consultantWorkspacePath(search = "") {
  const query = connectionQuery(search);
  return "/studio/?workspace=consultant" + (query ? "&" + query : "");
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
