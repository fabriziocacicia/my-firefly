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

    expect(byType.gift_card.activeCount).toBe(0);
    expect(byType.gift_card.totals).toEqual([{ currency: 'EUR', cents: 0 }]);

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
      makeAccount({ id: 1, name: 'EUR Gift A', asset_type: 'gift_card', current_balance: '0.10', currency_code: 'EUR' }),
      makeAccount({ id: 2, name: 'EUR Gift B', asset_type: 'gift_card', current_balance: '0.20', currency_code: 'EUR' }),
      makeAccount({ id: 3, name: 'USD Card', asset_type: 'gift_card', current_balance: '25.50', currency_code: 'USD' }),
      makeAccount({ id: 4, name: 'Vouchers', asset_type: 'meal_voucher', current_balance: '51.60', currency_code: null }),
    ];

    const summary = computeAssetBalanceSummary(accounts);

    expect(summary.grandTotals).toEqual([
      { currency: 'EUR', cents: 5190 },
      { currency: 'USD', cents: 2550 },
    ]);

    const giftCard = summary.categorized.find((c) => c.type === 'gift_card');
    expect(giftCard?.activeCount).toBe(3);
    expect(giftCard?.totals).toEqual([
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
    expect(emptySummary.categorized).toHaveLength(4);
    expect(emptySummary.categorized.every((c) => c.activeCount === 0 && c.totals[0].cents === 0)).toBe(true);

    const edgeAccounts: FireflyAssetAccount[] = [
      makeAccount({ id: 1, name: 'Active Undefined', active: undefined, asset_type: 'cash', current_balance: '1.005', currency_code: ' eur ' }),
      makeAccount({ id: 2, name: 'Negative Bank', asset_type: 'bank_account', current_balance: '-5.16' }),
      makeAccount({ id: 3, name: 'Invalid Balance', asset_type: 'gift_card', current_balance: 'not-a-number' }),
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
    expect(normalizeAssetType('gift_card')).toBe('gift_card');
  });
});
