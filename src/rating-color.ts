const colors: Record<string, string> = {
  ideal: "var(--score-ideal)",
  good: "var(--score-good)",
  marginal: "var(--score-marginal)",
  avoid: "var(--score-avoid)",
};

export const ratingColor = (rating: string) => colors[rating] ?? "var(--text-muted)";
