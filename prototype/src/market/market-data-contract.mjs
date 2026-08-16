export const MARKET_DATA_CATEGORIES = Object.freeze([
  'NEARBY_COMPETITORS',
  'NEW_OPENINGS',
  'CLOSURES',
  'VACANCIES',
  'RENT_LISTINGS',
  'FOOTFALL',
  'SALES_TREND',
]);

const PLANNED_DISCLOSURE = 'No live external market provider is connected in this prototype.';
const CURRENT_DISCLOSURE = 'Only current, provider-supplied market categories are shown.';
const APPROVED_QUERY_FIELDS = new Set(['region', 'industry', 'now']);
const APPROVED_CATEGORY_FIELDS = new Set(['category', 'source', 'asOf', 'confidence', 'maxAgeHours']);
const CONFIDENCE_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const SENSITIVE_VALUE = /@|(?:account|identity|financial|finance|transaction|email|phone|address)/i;
const MAX_AGE_HOURS_BY_CATEGORY = Object.freeze({
  NEARBY_COMPETITORS: 7 * 24,
  NEW_OPENINGS: 24,
  CLOSURES: 24,
  VACANCIES: 24,
  RENT_LISTINGS: 24,
  FOOTFALL: 1,
  SALES_TREND: 7 * 24,
});

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function assertApprovedFields(value, approvedFields, fieldName) {
  if (!isRecord(value) || Object.keys(value).some((key) => !approvedFields.has(key))) {
    throw new TypeError(`${fieldName} must contain only approved fields`);
  }
}

function assertPlainString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function assertSafeSource(source) {
  assertPlainString(source, 'source');
  if (SENSITIVE_VALUE.test(source)) throw new TypeError('source must not contain finance or identity data');
}

function asOfTime(category) {
  const value = new Date(category.asOf).getTime();
  if (!Number.isFinite(value)) throw new TypeError('asOf must be a valid timestamp');
  return value;
}

function validateCategory(category) {
  assertApprovedFields(category, APPROVED_CATEGORY_FIELDS, 'Provider category');
  if (!MARKET_DATA_CATEGORIES.includes(category.category)) {
    throw new TypeError('category must be a supported market category');
  }
  assertSafeSource(category.source);
  asOfTime(category);
  if (!CONFIDENCE_LEVELS.has(category.confidence)) {
    throw new TypeError('confidence must be LOW, MEDIUM, or HIGH');
  }
  if (category.maxAgeHours != null && (!Number.isFinite(category.maxAgeHours) || category.maxAgeHours < 0)) {
    throw new TypeError('maxAgeHours must be a non-negative finite number');
  }
  return { ...category };
}

function hasCurrentMarketAge(validatedCategory, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  const serviceMaxAgeHours = MAX_AGE_HOURS_BY_CATEGORY[validatedCategory.category];
  const maxAgeHours = Math.min(validatedCategory.maxAgeHours ?? serviceMaxAgeHours, serviceMaxAgeHours);
  const ageHours = (now.getTime() - asOfTime(validatedCategory)) / (60 * 60 * 1000);
  return ageHours >= 0 && ageHours <= maxAgeHours;
}

export function isCurrentMarketCategory(category, now = new Date()) {
  return hasCurrentMarketAge(validateCategory(category), now);
}

export function currentMarketCategory(category, now = new Date()) {
  const validatedCategory = validateCategory(category);
  return hasCurrentMarketAge(validatedCategory, now) ? validatedCategory : undefined;
}

export function plannedMarketIntegrationState() {
  return {
    status: 'PLANNED_INTEGRATION',
    categories: [...MARKET_DATA_CATEGORIES],
    disclosure: PLANNED_DISCLOSURE,
  };
}

function validateQuery(query) {
  assertApprovedFields(query, APPROVED_QUERY_FIELDS, 'Market provider query');
  assertPlainString(query.region, 'region');
  assertPlainString(query.industry, 'industry');
  if (query.now != null && (!(query.now instanceof Date) || Number.isNaN(query.now.getTime()))) {
    throw new TypeError('now must be a valid Date');
  }
}

export function createMarketDataGateway({ providerName, fetchAreaSnapshot } = {}) {
  const hasProvider = typeof providerName === 'string' && providerName.trim() !== ''
    && typeof fetchAreaSnapshot === 'function';

  async function getAreaSnapshot(query) {
    validateQuery(query);
    if (!hasProvider) return plannedMarketIntegrationState(query.region, query.industry);

    const categories = await fetchAreaSnapshot({ region: query.region, industry: query.industry });
    if (!Array.isArray(categories)) throw new TypeError('Provider snapshot must be an array of market categories');
    const currentCategories = categories
      .map((category) => currentMarketCategory(category, query.now ?? new Date()))
      .filter(Boolean);

    if (currentCategories.length === 0) return plannedMarketIntegrationState(query.region, query.industry);
    return {
      status: 'CURRENT',
      providerName: providerName.trim(),
      categories: currentCategories,
      disclosure: CURRENT_DISCLOSURE,
    };
  }

  return Object.freeze({ getAreaSnapshot, fetchAreaSnapshot: getAreaSnapshot });
}
