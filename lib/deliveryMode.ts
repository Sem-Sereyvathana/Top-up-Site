// Shared by both new marketplaces (Game Items, Accounts). A cart order is
// only "DIRECT" (admin can fulfil straight away, no chat needed first) when
// EVERY line in it is DIRECT. A single MANUAL line — or a line with no
// mode assigned at all, which we treat as the safer default — downgrades
// the whole order to MANUAL so the buyer always gets pointed to Telegram
// when any part of their order needs a human conversation first. Game Items
// resolves this from each GameItem's own deliveryMode; Accounts resolves it
// from each account's own deliveryMode the same way (not the linked Game's).
export type DeliveryMode = "DIRECT" | "MANUAL";

export function resolveDeliveryMode(
  lineModes: (string | null | undefined)[]
): DeliveryMode {
  if (lineModes.length === 0) return "MANUAL";
  return lineModes.every((m) => m === "DIRECT") ? "DIRECT" : "MANUAL";
}
