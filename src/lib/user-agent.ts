/**
 * Summarize a raw User-Agent into a compact browser/OS label such as
 * "Chrome 126 · macOS". The raw header is never persisted.
 */
export function summarizeUserAgent(ua: string): string | null {
  if (!ua || ua.length < 4) return null;

  const browsers: { re: RegExp; name: string }[] = [
    { re: /Edg\/(\d+)/, name: "Edge" },
    { re: /OPR\/(\d+)|Opera\/(\d+)/, name: "Opera" },
    { re: /Firefox\/(\d+)/, name: "Firefox" },
    { re: /Chrome\/(\d+)/, name: "Chrome" },
    { re: /Safari\/(\d+)/, name: "Safari" },
  ];
  let browser = "Unknown";
  for (const { re, name } of browsers) {
    const match = ua.match(re);
    if (match) {
      const majorVersion = match[1] ?? match[2];
      browser = majorVersion ? `${name} ${majorVersion}` : name;
      break;
    }
  }

  const operatingSystems: [RegExp, string][] = [
    [/Windows NT 10/i, "Windows 10/11"],
    [/Windows NT 6\.3/i, "Windows 8.1"],
    [/Mac OS X/i, "macOS"],
    [/Android/i, "Android"],
    [/iPhone|iPad|iPod/i, "iOS"],
    [/Linux/i, "Linux"],
  ];
  const os = operatingSystems.find(([pattern]) => pattern.test(ua))?.[1] ?? "?";
  return `${browser} · ${os}`;
}
