// Bearer check for write tools (world code, live windows). Constant time, no
// imports: a token that is unset means the write tools are simply off.

export function bearerOf(header: string | null | undefined): string {
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(String(header || ""));
  return m ? m[1] : "";
}

export function isAuthed(header: string | null | undefined, token: string | undefined): boolean {
  if (!token || token.length < 16) return false;
  const given = bearerOf(header);
  if (!given) return false;
  let diff = given.length ^ token.length;
  const n = Math.max(given.length, token.length);
  for (let i = 0; i < n; i++) diff |= (given.charCodeAt(i) || 0) ^ (token.charCodeAt(i) || 0);
  return diff === 0;
}
