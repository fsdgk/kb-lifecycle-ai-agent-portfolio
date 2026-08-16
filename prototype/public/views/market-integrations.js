const MARKET_DATA_CATEGORIES = Object.freeze([
  'NEARBY_COMPETITORS',
  'NEW_OPENINGS',
  'CLOSURES',
  'VACANCIES',
  'RENT_LISTINGS',
  'FOOTFALL',
  'SALES_TREND',
]);

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function renderMarketIntegrationCategories(categories = MARKET_DATA_CATEGORIES) {
  const visibleCategories = Array.isArray(categories)
    ? categories.filter((category) => MARKET_DATA_CATEGORIES.includes(category))
    : MARKET_DATA_CATEGORIES;
  return `<ul data-market-integration-categories>${visibleCategories
    .map((category) => `<li data-market-category="${escapeHtml(category)}">${escapeHtml(category)}</li>`)
    .join('')}</ul>`;
}
