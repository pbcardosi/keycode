export type DangerLevel = "safe" | "warn" | "danger";

export interface DangerAssessment {
  level: DangerLevel;
  reason: string;
  pattern?: string | undefined;
}

interface DangerRule {
  pattern: RegExp;
  level: DangerLevel;
  reason: string;
}

const RULES: DangerRule[] = [
  {
    pattern: /\brm\s+(-[A-Za-z]*[rf][A-Za-z]*\s+)+(\/|~|\$HOME|\.)(\s|$)/i,
    level: "danger",
    reason: "Recursive delete of a root or home path",
  },
  { pattern: /\brm\s+-[A-Za-z]*r[A-Za-z]*\s+\*/i, level: "danger", reason: "Recursive delete with a wildcard" },
  {
    pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba)?sh\b/i,
    level: "danger",
    reason: "Piping a download into a shell",
  },
  { pattern: /\bchmod\s+(-R\s+)?777\b/i, level: "warn", reason: "World-writable permissions" },
  {
    pattern: /\bgit\s+push\b[^\n]*\s(--force|-f)(\s|$)/i,
    level: "warn",
    reason: "Force push rewrites remote history",
  },
  { pattern: /\bdd\s+if=/i, level: "danger", reason: "Raw disk write" },
  { pattern: /\bmkfs(\.\w+)?\b/i, level: "danger", reason: "Filesystem format" },
  { pattern: /\bformat\s+[A-Za-z]:/i, level: "danger", reason: "Disk format" },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, level: "danger", reason: "Fork bomb" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, level: "warn", reason: "Host power control" },
  {
    pattern: /\bRemove-Item\b[^\n]*(-Recurse)[^\n]*(-Force)[^\n]*(C:\\|~|\$HOME)/i,
    level: "danger",
    reason: "Recursive delete of a protected path",
  },
  { pattern: /\bdel\s+\/[sf]\b[^\n]*[A-Za-z]:\\/i, level: "danger", reason: "Recursive delete on a drive" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, level: "warn", reason: "Discards uncommitted work" },
  { pattern: /\bnpm\s+publish\b/i, level: "warn", reason: "Publishes a package" },
  { pattern: /\bsudo\b/i, level: "warn", reason: "Runs with elevated privileges" },
];

export function assessCommand(command: string): DangerAssessment {
  for (const rule of RULES) {
    if (rule.pattern.test(command)) {
      return { level: rule.level, reason: rule.reason, pattern: rule.pattern.source };
    }
  }
  return { level: "safe", reason: "No destructive pattern detected" };
}
