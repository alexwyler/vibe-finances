export const DISPLAY_LABELS = {
  wealthfrontBrokerage: 'Wealthfront brokerage account',
  schwabTotalValue: 'Schwab brokerage account',
  brokerageIndividual: 'Northwestern brokerage account',
  adjustableComplifeTotal: 'Life insurance',
  wellsFargoChecking: 'Wells Fargo Checking',
  bofaAutoLoan: 'Bank of America Auto Loan',
  chaseCreditCardBalance: 'Chase credit card balance',
  chaseDiscretionarySpend: 'Chase discretionary spend',
  chaseDiscretionaryBreakdown: 'Chase discretionary breakdown',
  cashflowIncome: 'Monthly Income',
  cashflowFixed: 'Monthly Fixed',
  cashflowDiscretionary: 'Monthly Discretionary',
  cashflowBreakdown: 'Discretionary Spending Breakdown'
};

export function getDefaultExtractorLabel(extractor) {
  return DISPLAY_LABELS[extractor.id] || extractor.label;
}
