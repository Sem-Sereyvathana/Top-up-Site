// Shared by the header and footer so both show the same admin-configured
// brand (Settings.siteName / logoUrl / supportTelegram).

export const DEFAULT_SITE_NAME = "SHARUSTORE";
export const DEFAULT_SUPPORT_TELEGRAM = "@sharustore";

// Two-tone name: a trailing "store" / "topup" gets the accent colour
// (SHARU + STORE). Any other name is shown as a single colour.
export function splitBrandName(name: string): [string, string] {
  const m = name.match(/^(.*?)(store|topup)$/i);
  return m && m[1] ? [m[1], m[2]] : [name, ""];
}
