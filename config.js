// Central config — edit here to change scraping and filtering behavior
export const CONFIG = {
  // Prompt file to use for LLM enrichment (filename without .txt in prompts/ folder)
  enrichPrompt: 'low-rating',


  // Countries to exclude (client location) — case-insensitive match
  excludeCountries: [
    'India',
    'Pakistan',
    'Nigeria',
    'Bangladesh',
    'Kenya',
    'Philippines',
  ],

  // Pre-filter before saving to DB
  preFilter: {
    fixedMin: 50,       // fixed price jobs below this are skipped
    hourlyMin: 10,      // hourly jobs below this are skipped
    proposalsMax: 30,   // jobs with more than this many proposals are skipped
  },

  // Notification filters (Telegram)
  notify: {
    minScore: 6,
    maxProposals: 15,
    hourlyMin: 15,
    hourlyMax: 45,
    fixedMax: 500,
  },
};
