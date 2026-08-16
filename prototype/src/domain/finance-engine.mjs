export function roundKrw(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('value must be a finite number');
  }
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function calculateStartupFunding(profile) {
  const plannedCost = profile.business.plannedStartupCostKrw;
  const ownCapital = profile.business.ownCapitalKrw;

  return {
    plannedCost,
    ownCapital,
    fundingGap: Math.max(0, plannedCost - ownCapital),
    recommendedBuffer: roundKrw(plannedCost * 0.15),
  };
}

export function forecastCashflow(openingBalance, dailyFlows, days = 28) {
  if (!Number.isInteger(days) || days <= 0) {
    throw new RangeError('days must be a positive integer');
  }
  if (!Number.isInteger(openingBalance)) {
    throw new TypeError('openingBalance must be an integer KRW amount');
  }
  if (!dailyFlows.every((flow) => flow == null || Number.isInteger(flow))) {
    throw new TypeError('dailyFlows must contain integer KRW amounts');
  }

  let balance = openingBalance;
  const daily = [];
  let shortfallDate = null;

  for (let index = 0; index < days; index += 1) {
    balance += dailyFlows[index] ?? 0;
    daily.push({ day: index + 1, balance });
    if (balance < 0 && !shortfallDate) shortfallDate = `DAY_${index + 1}`;
  }

  const minimumBalance = Math.min(...daily.map((item) => item.balance));
  const shortage = Math.max(0, -minimumBalance);

  return {
    daily,
    minimumBalance,
    shortfallDate,
    shortfallRange: {
      low: roundKrw(shortage * 0.9),
      high: roundKrw(shortage * 1.1),
    },
  };
}

export function detectFinancialRisks(forecast) {
  return forecast.shortfallDate
    ? [{ type: 'CASH_SHORTFALL', severity: 'HIGH', evidence: ['cashflow.minimumBalance'] }]
    : [];
}
