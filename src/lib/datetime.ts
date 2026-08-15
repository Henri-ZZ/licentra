/**
 * Shared UTC+8 (Asia/Shanghai) datetime formatter for the dashboard.
 *
 * All admin-facing timestamps display as "YYYY-MM-DD HH:mm:ss" in UTC+8
 * (the operator's timezone) instead of raw ISO strings like
 * "2026-08-14T23:56:06.550Z".
 *
 * Accepts Date, ISO string, unix milliseconds, or null → "—".
 */
export function formatDateTimeCn(
  value: Date | string | number | null | undefined
): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
