const IMMEDIATE_EVENT_TYPES = new Set([
  'CASH_SHORTFALL',
  'SALES_DROP',
  'INGREDIENT_COST_SPIKE',
  'POLICY_DEADLINE',
  'DATA_LINK_FAILURE',
]);

const IMMEDIATE_SEVERITIES = {
  CASH_SHORTFALL: 'HIGH',
  SALES_DROP: 'HIGH',
  INGREDIENT_COST_SPIKE: 'HIGH',
  POLICY_DEADLINE: 'HIGH',
  DATA_LINK_FAILURE: 'HIGH',
};

function normalizedType(value) {
  return typeof value === 'string' && /^[A-Z0-9_]+$/.test(value)
    ? value
    : 'UNCLASSIFIED';
}

function evidenceFor(event, context) {
  const evidence = { id: `event.${normalizedType(event?.type)}` };
  const source = event?.source ?? context?.source;
  const asOf = event?.asOf ?? context?.asOf;

  if (source != null) evidence.source = source;
  if (asOf != null) evidence.asOf = asOf;
  return evidence;
}

function alertMessage(type, channel) {
  if (channel === 'IMMEDIATE') {
    return `${type} was reported and needs timely review; the available signal does not establish a final outcome.`;
  }
  return `${type} was recorded for the weekly review; the available signal does not establish a final outcome.`;
}

export function processBusinessEvent(event = {}, context = {}) {
  const type = normalizedType(event.type);
  const channel = IMMEDIATE_EVENT_TYPES.has(type) ? 'IMMEDIATE' : 'WEEKLY';
  const evidence = evidenceFor(event, context);

  return [{
    type,
    channel,
    severity: channel === 'IMMEDIATE' ? IMMEDIATE_SEVERITIES[type] : 'LOW',
    message: alertMessage(type, channel),
    evidenceIds: [evidence.id],
    evidence: [evidence],
  }];
}

export function buildWeeklyBriefing(context = {}) {
  const events = Array.isArray(context.events) ? context.events : [];
  const alerts = events
    .flatMap((event) => processBusinessEvent(event, context))
    .filter((alert) => alert.channel === 'WEEKLY');

  return {
    channel: 'WEEKLY',
    alerts,
  };
}
