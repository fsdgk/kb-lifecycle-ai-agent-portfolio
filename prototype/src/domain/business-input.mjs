import benchmarks from '../../data/industry-benchmarks.json' with { type: 'json' };

const PATHS = new Set(['STARTUP', 'OPERATING']);
const benchmarksById = new Map(benchmarks.map((benchmark) => [benchmark.templateId, benchmark]));
const SEOUL_DISTRICTS = new Set([
  'JONGNO', 'JUNG', 'YONGSAN', 'SEONGDONG', 'GWANGJIN', 'DONGDAEMUN', 'JUNGNANG', 'SEONGBUK',
  'GANGBUK', 'DOBONG', 'NOWON', 'EUNPYEONG', 'SEODAEMUN', 'MAPO', 'YANGCHEON', 'GANGSEO',
  'GURO', 'GEUMCHEON', 'YEONGDEUNGPO', 'DONGJAK', 'GWANAK', 'SEOCHO', 'GANGNAM', 'SONGPA',
  'GANGDONG',
]);

function requirePlainObject(value, name) {
  if (value == null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function validateKrwAmounts(value, name = 'input') {
  if (value == null || typeof value !== 'object') return;

  for (const [key, item] of Object.entries(value)) {
    const propertyName = `${name}.${key}`;
    if (key.endsWith('Krw')) {
      const allowsNegative = key === 'declaredNetProfitKrw';
      if (!Number.isInteger(item) || (!allowsNegative && item < 0)) {
        throw new TypeError(`${propertyName} must be a ${allowsNegative ? '' : 'non-negative '}integer KRW amount`);
      }
    } else if (item != null && typeof item === 'object') {
      validateKrwAmounts(item, propertyName);
    }
  }
}

function normalizeCustomCosts(customCosts) {
  if (customCosts == null) return undefined;
  if (!Array.isArray(customCosts)) throw new TypeError('customCosts must be an array');
  if (customCosts.length > 20) throw new RangeError('customCosts cannot contain more than twenty items');

  const labels = new Set();
  return customCosts.map((cost, index) => {
    requirePlainObject(cost, `customCosts[${index}]`);
    if (typeof cost.label !== 'string' || !cost.label.trim()) {
      throw new TypeError('custom cost label must not be blank');
    }
    const label = cost.label.trim();
    const duplicateKey = label.toLocaleLowerCase('en-US');
    if (labels.has(duplicateKey)) throw new RangeError(`duplicate custom cost label: ${label}`);
    labels.add(duplicateKey);
    if (!Number.isInteger(cost.amountKrw) || cost.amountKrw < 0) {
      throw new TypeError('custom cost amountKrw must be a non-negative integer KRW amount');
    }
    return { ...cost, label };
  });
}

function normalizeSection(section, name) {
  requirePlainObject(section, name);
  validateKrwAmounts(section, name);
  const normalized = { ...section };
  if ('customCosts' in normalized) normalized.customCosts = normalizeCustomCosts(normalized.customCosts);
  return normalized;
}

export function loadIndustryBenchmark(templateId) {
  if (typeof templateId !== 'string' || !benchmarksById.has(templateId)) {
    throw new RangeError(`unknown industry template: ${templateId}`);
  }
  return structuredClone(benchmarksById.get(templateId));
}

export function normalizeBusinessInput(raw) {
  requirePlainObject(raw, 'raw');
  if (!PATHS.has(raw.path)) throw new RangeError('path must be STARTUP or OPERATING');
  if (!PATHS.has(raw.stage)) throw new RangeError('stage must be STARTUP or OPERATING');
  if (raw.path !== raw.stage) throw new RangeError('path and stage must match');
  if (typeof raw.regionCode !== 'string' || !raw.regionCode.trim()) {
    throw new TypeError('regionCode must be a non-blank string');
  }
  if (raw.districtCode != null && raw.districtCode !== '' && !SEOUL_DISTRICTS.has(String(raw.districtCode).trim())) {
    throw new RangeError('districtCode must be a supported Seoul district when supplied');
  }
  if (raw.neighborhoodName != null && raw.neighborhoodName !== '' && typeof raw.neighborhoodName !== 'string') {
    throw new TypeError('neighborhoodName must be a Seoul dong or trade-area name when supplied');
  }

  const benchmark = loadIndustryBenchmark(raw.industryTemplate);
  requirePlainObject(raw.businessProfile, 'businessProfile');
  const result = {
    path: raw.path,
    stage: raw.stage,
    regionCode: raw.regionCode.trim(),
    industryTemplate: benchmark.templateId,
    businessProfile: structuredClone(raw.businessProfile),
  };
  if (raw.districtCode != null && raw.districtCode !== '') result.districtCode = String(raw.districtCode).trim();
  if (raw.neighborhoodName != null && raw.neighborhoodName !== '') result.neighborhoodName = raw.neighborhoodName.trim();

  if (raw.path === 'STARTUP') {
    result.startup = normalizeSection(raw.startup, 'startup');
  } else {
    result.operating = normalizeSection(raw.operating, 'operating');
    const margin = result.operating.declaredMarginRate;
    if (margin != null && (typeof margin !== 'number' || !Number.isFinite(margin) || margin < -1 || margin > 1)) {
      throw new RangeError('declaredMarginRate must be between -1 and 1');
    }
  }

  return result;
}
