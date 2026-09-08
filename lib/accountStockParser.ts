export interface ParsedCredential {
  username: string;
  password: string;
  notes?: string;
}

const LINE_DELIMS = [/\t+/, /\s*\|\s*/, /\s*;\s*/, /\s*,\s*/, /:(?=\s*\S)/];

function splitLine(line: string): [string, string, string] | null {
  for (const delim of LINE_DELIMS) {
    const parts = line.split(delim).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const [username, password, ...rest] = parts;
      return [username, password, rest.join(" ")];
    }
  }
  return null;
}

function parseLines(text: string): ParsedCredential[] {
  const out: ParsedCredential[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^[-=_*]{3,}$/.test(line)) continue;
    const parts = splitLine(line);
    if (!parts) continue;
    const [username, password, notes] = parts;
    if (!username || !password) continue;
    out.push({ username, password, notes: notes || undefined });
  }
  return out;
}

function parseBlocks(text: string): ParsedCredential[] {
  // Same structured shape the admin's single-account form already writes
  // (Username/Email: ... / Password: ... / Notes: ...), so a block copied
  // straight out of one export/notes file works without reformatting.
  const blocks = text.split(/\n[ \t]*(?:-{3,}|={3,})[ \t]*\n|\n\s*\n+/g);
  const out: ParsedCredential[] = [];
  for (const block of blocks) {
    const userMatch = block.match(/^(?:username\/email|username|email)\s*:\s*(.+)$/im);
    const passMatch = block.match(/^password\s*:\s*(.+)$/im);
    const notesMatch = block.match(/^notes\s*:\s*([\s\S]*)$/im);
    const username = userMatch?.[1]?.trim();
    const password = passMatch?.[1]?.trim();
    if (username && password) {
      out.push({ username, password, notes: notesMatch?.[1]?.trim() || undefined });
    }
  }
  return out;
}

// Accepts whatever shape an admin is likely to have accounts saved in:
//  - one login per line, delimited by tab / "|" / ";" / "," / ":"
//    e.g. "alice@gmail.com:hunter2" or "bob@x.com, p@ss, recovery: y@z.com"
//  - the structured "Username/Email: ...\nPassword: ...\nNotes: ..." block
//    (same format the single-account fields already save), with multiple
//    blocks separated by a blank line or a line of dashes/equals — this is
//    also exactly what a dropped .txt export of several accounts looks like.
export function parseAccountStockText(raw: string): ParsedCredential[] {
  const text = (raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (/^\s*(username\/email|username|email)\s*:/im.test(text)) {
    return parseBlocks(text);
  }
  return parseLines(text);
}
