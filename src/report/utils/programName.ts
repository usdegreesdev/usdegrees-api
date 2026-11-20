/** programs.title is stored with a trailing period ("Accounting and Related Services."); it is never printed. */
export function cleanProgramName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const t = name.trim().replace(/\.+$/, "").trim();
  return t === "" ? null : t;
}
