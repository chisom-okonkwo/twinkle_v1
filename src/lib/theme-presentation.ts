import type { ThemeSnapshot, ThemePeriod } from "./themes-repository";

// Read-only presentation: an empty result, an unfinished scan and a failure
// must never look like the same outcome.
export function themeEmptyState(snapshot: ThemeSnapshot, period: ThemePeriod) {
  const unfinished = ["pending", "paused", "failed"].includes(snapshot.status);
  if (unfinished)
    return {
      title: "Discovery is not finished",
      message:
        snapshot.status === "failed"
          ? "Retry discovery when you’re ready. Your notes remain available."
          : snapshot.scheduled
            ? "Some notes still need processing. Twinkle can continue in the background."
            : "Choose Continue to look for shared ideas within this period.",
      showAllTime: false,
    };
  if (period === "recent") {
    const dates = snapshot.date_coverage;
    const count = dates?.in_period ?? snapshot.total;
    let message =
      count === 0
        ? "No available notes have a known original date in this period."
        : `${count} ${count === 1 ? "note falls" : "notes fall"} in this period. A group needs at least two supporting notes dated within the period.`;
    if (dates?.outside_period)
      message += ` ${dates.outside_period} ${dates.outside_period === 1 ? "note is" : "notes are"} outside this window.`;
    if (dates?.unknown_date)
      message += ` ${dates.unknown_date} ${dates.unknown_date === 1 ? "note has" : "notes have"} no reliable original date and can only appear in All time.`;
    message += " Imported notes use their original date, not the import date.";
    return {
      title: "No shared group found in the past 90 days",
      message,
      showAllTime: (snapshot.all_time_group_count ?? 0) > 0,
    };
  }
  return {
    title: "No supported group in this view yet",
    message:
      snapshot.total < 2
        ? "More than one meaningful note is needed to reveal a shared subject."
        : "Only supported connections appear here. Unrelated thoughts can stand on their own.",
    showAllTime: false,
  };
}

// Keep observing server-owned work while this screen is visible. This never
// starts AI, and slows down rather than polling indefinitely at full speed.
export function themePollDelay(
  snapshot: Pick<ThemeSnapshot, "status" | "scheduled">,
  elapsedMs: number,
) {
  if (elapsedMs >= 10 * 60 * 1000) return null;
  if (
    snapshot.status === "processing" ||
    (snapshot.status === "pending" && snapshot.scheduled)
  )
    return elapsedMs < 30000 ? 2500 : elapsedMs < 120000 ? 5000 : 15000;
  if (
    snapshot.scheduled &&
    (snapshot.status === "failed" || snapshot.status === "paused")
  )
    return 30000;
  return null;
}
