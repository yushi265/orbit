export const commonTimezoneOptions = [
  "UTC",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "America/Los_Angeles",
  "America/New_York",
] as const;

export function timezoneOptionsFor(current: string): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }
  ).supportedValuesOf;
  const supported = supportedValuesOf?.("timeZone") ?? commonTimezoneOptions;
  return [...new Set([current, ...commonTimezoneOptions, ...supported])].filter(Boolean);
}
