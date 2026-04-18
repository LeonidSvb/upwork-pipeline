export const CONFIG = {
  // Stage 1 — relevance filter (cheap/fast model)
  filterModel:  'google/gemini-2.5-flash-lite',
  filterPrompt: 'filter',

  // Stage 2 — detailed scoring (smarter model, only relevant jobs)
  scoreModel:   'google/gemini-2.5-flash-lite',
  scorePrompt:  'score',

  // Countries to exclude (client location)
  excludeCountries: [
    'India', 'Pakistan', 'Nigeria', 'Bangladesh', 'Kenya', 'Philippines',
  ],

  // Pre-filter before saving to DB (Apify level)
  preFilter: {
    fixedMin:     50,
    hourlyMin:    10,
    proposalsMax: 30,
  },

  // Notification filters (Telegram)
  notify: {
    minScore:     6,
    maxProposals: 15,
    hourlyMin:    15,
    hourlyMax:    80,
  },
};
