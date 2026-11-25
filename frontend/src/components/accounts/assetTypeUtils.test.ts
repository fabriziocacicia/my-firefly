import { describe, expect, it } from 'bun:test';
import { FireflyAssetAccount } from '../../types';
import {
  CATEGORIZED_ASSET_TYPES,
  computeAssetBalanceSummary,
  formatAssetMoney,
  formatCents,
  normalizeAssetType,
} from './assetTypeUtils';

function makeAccount(
  overrides: Partial<FireflyAssetAccount> & { id: number; name: string }
): FireflyAssetAccount {
  return {
    current_balance: '0.00',
    active: true,
    currency_code: 'EUR',
    asset_type: 'standard',
    is_exact_multiple: true,
    balance_discrepancy: 0,
    ...overrides,
  };
}

describe('computeAssetBalanceSummary', () => {
  it('sums all active accounts including standard in grandTotals while omitting standard from categorized breakdown', () => {
    const accounts: FireflyAssetAccount[] = [
      makeAccount({ id: 1, name: 'Main Bank', asset_type: 'bank_account', current_balance: '2416.15' }),
      makeAccount({ id: 2, name: 'Savings', asset_type: 'bank_account', current_balance: '100.00' }),
      makeAccount({ id: 3, name: 'Cash Wallet', asset_type: 'cash', current_balance: '119.86' }),
      makeAccount({ id: 4, name: 'Unclassified Cash-like', asset_type: 'standard', current_balance: '50.00' }),
    ];

    const summary = computeAssetBalanceSummary(accounts);

    expect(summary.totalActiveCount).toBe(4);
    expect(summary.grandTotals).toEqual([{ currency: 'EUR', cents: 268601 }]);

    // Breakdown has strictly the 4 categorized types, in order, including 0-count ones
    expect(summary.categorized.map((c) => c.type)).toEqual(CATEGORIZED_ASSET_TYPES);
    const byType = Object.fromEntries(summary.categorized.map((c) => [c.type, c]));

    expect(byType.bank_account.activeCount).toBe(2);
    expect(byType.bank_account.totals).toEqual([{ currency: 'EUR', cents: 251615 }]);

    expect(byType.cash.activeCount).toBe(1);
    expect(byType.cash.totals).toEqual([{ currency: 'EUR', cents: 11986 }]);

    expect(byType.digital_credit.activeCount).toBe(0);
    expect(byType.digital_credit.totals).toEqual([{ currency: 'EUR', cents: 0 }]);

    expect(byType.investment_account.activeCount).toBe(0);
    expect(byType.investment_account.totals).toEqual([{ currency: 'EUR', cents: 0 }]);

    expect(byType.meal_voucher.activeCount).toBe(0);
    expect(byType.meal_voucher.totals).toEqual([{ currency: 'EUR', cents: 0 }]);
  });

  it('excludes inactive accounts from totals and counts', () => {
    const accounts: FireflyAssetAccount[] = [
      makeAccount({ id: 1, name: 'Active Bank', asset_type: 'bank_account', current_balance: '200.00', active: true }),
      makeAccount({ id: 2, name: 'Closed Bank', asset_type: 'bank_account', current_balance: '999.99', active: false }),
      makeAccount({ id: 3, name: 'Closed Standard', asset_type: 'standard', current_balance: '500.00', active: false }),
    ];

    const summary = computeAssetBalanceSummary(accounts);

    expect(summary.totalActiveCount).toBe(1);
    expect(summary.grandTotals).toEqual([{ currency: 'EUR', cents: 20000 }]);

    const bank = summary.categorized.find((c) => c.type === 'bank_account');
    expect(bank?.activeCount).toBe(1);
    expect(bank?.totals).toEqual([{ currency: 'EUR', cents: 20000 }]);
  });

  it('avoids floating-point drift and groups multi-currency accounts separately', () => {
    const accounts: FireflyAssetAccount[] = [
      makeAccount({ id: 1, name: 'EUR Credit A', asset_type: 'digital_credit', current_balance: '0.10', currency_code: 'EUR' }),
      makeAccount({ id: 2, name: 'EUR Credit B', asset_type: 'digital_credit', current_balance: '0.20', currency_code: 'EUR' }),
      makeAccount({ id: 3, name: 'USD Credit', asset_type: 'digital_credit', current_balance: '25.50', currency_code: 'USD' }),
      makeAccount({ id: 4, name: 'Vouchers', asset_type: 'meal_voucher', current_balance: '51.60', currency_code: null }),
    ];

    const summary = computeAssetBalanceSummary(accounts);

    expect(summary.grandTotals).toEqual([
      { currency: 'EUR', cents: 5190 },
      { currency: 'USD', cents: 2550 },
    ]);

    const digitalCredit = summary.categorized.find((c) => c.type === 'digital_credit');
    expect(digitalCredit?.activeCount).toBe(3);
    expect(digitalCredit?.totals).toEqual([
      { currency: 'EUR', cents: 30 },
      { currency: 'USD', cents: 2550 },
    ]);
  });

  it('formats cents cleanly with EUR symbol or currency prefix', () => {
    expect(formatCents(0, 'EUR')).toBe('€0.00');
    expect(formatCents(241615, 'EUR')).toBe('€2416.15');
    expect(formatCents(-516, 'EUR')).toBe('-€5.16');
    expect(formatCents(2550, 'USD')).toBe('USD 25.50');
    expect(formatCents(1000, ' eur ')).toBe('€10.00');
  });

  it('handles empty lists, all-inactive accounts, negative balances, undefined active, and decimal-safe rounding', () => {
    const emptySummary = computeAssetBalanceSummary([]);
    expect(emptySummary.totalActiveCount).toBe(0);
    expect(emptySummary.grandTotals).toEqual([{ currency: 'EUR', cents: 0 }]);
    expect(emptySummary.categorized).toHaveLength(5);
    expect(emptySummary.categorized.every((c) => c.activeCount === 0 && c.totals[0].cents === 0)).toBe(true);

    const edgeAccounts: FireflyAssetAccount[] = [
      makeAccount({ id: 1, name: 'Active Undefined', active: undefined, asset_type: 'cash', current_balance: '1.005', currency_code: ' eur ' }),
      makeAccount({ id: 2, name: 'Negative Bank', asset_type: 'bank_account', current_balance: '-5.16' }),
      makeAccount({ id: 3, name: 'Invalid Balance', asset_type: 'digital_credit', current_balance: 'not-a-number' }),
      makeAccount({ id: 4, name: 'Inactive Standard', active: false, asset_type: 'standard', current_balance: '100.00' }),
    ];

    const summary = computeAssetBalanceSummary(edgeAccounts);
    expect(summary.totalActiveCount).toBe(3);
    expect(summary.grandTotals).toEqual([{ currency: 'EUR', cents: 101 - 516 }]);

    const cash = summary.categorized.find((c) => c.type === 'cash');
    expect(cash?.totals).toEqual([{ currency: 'EUR', cents: 101 }]);
    expect(formatAssetMoney('-5.16', 'EUR')).toBe('-€5.16');
    expect(formatAssetMoney('bad', 'USD')).toBe('USD 0.00');
    expect(normalizeAssetType('future_type')).toBe('standard');
    expect(normalizeAssetType('digital_credit')).toBe('digital_credit');
    expect(normalizeAssetType('investment_account')).toBe('investment_account');
  });

  it('excludes include_net_worth=false from grandTotals while keeping them in per-type categorized cards', () => {
    const accounts: FireflyAssetAccount[] = [
      makeAccount({ id: 1, name: 'Included Bank', asset_type: 'bank_account', current_balance: '1000.00', include_net_worth: true }),
      makeAccount({ id: 2, name: 'Excluded Bank', asset_type: 'bank_account', current_balance: '500.00', include_net_worth: false }),
      makeAccount({ id: 3, name: 'Excluded Digital Credit', asset_type: 'digital_credit', current_balance: '40.00', include_net_worth: false }),
      makeAccount({ id: 4, name: 'Included Standard', asset_type: 'standard', current_balance: '25.00', include_net_worth: true }),
      makeAccount({ id: 5, name: 'Excluded Standard', asset_type: 'standard', current_balance: '75.00', include_net_worth: false }),
      makeAccount({ id: 6, name: 'Inactive Net Worth Bank', active: false, asset_type: 'bank_account', current_balance: '999.00', include_net_worth: true }),
      makeAccount({ id: 7, name: 'Brokerage ETF', asset_type: 'investment_account', current_balance: '2416.15', include_net_worth: true }),
    ];

    const summary = computeAssetBalanceSummary(accounts);

    // Grand total includes only active accounts with include_net_worth !== false (1000 + 25 + 2416.15 = 3441.15 EUR)
    expect(summary.totalActiveCount).toBe(3);
    expect(summary.grandTotals).toEqual([{ currency: 'EUR', cents: 344115 }]);

    // Per-type breakdown cards still sum ALL active accounts of each categorized type
    const bank = summary.categorized.find((c) => c.type === 'bank_account');
    expect(bank?.activeCount).toBe(2);
    expect(bank?.totals).toEqual([{ currency: 'EUR', cents: 150000 }]);

    const digitalCredit = summary.categorized.find((c) => c.type === 'digital_credit');
    expect(digitalCredit?.activeCount).toBe(1);
    expect(digitalCredit?.totals).toEqual([{ currency: 'EUR', cents: 4000 }]);

    const investment = summary.categorized.find((c) => c.type === 'investment_account');
    expect(investment?.activeCount).toBe(1);
    expect(investment?.totals).toEqual([{ currency: 'EUR', cents: 241615 }]);
  });
});
