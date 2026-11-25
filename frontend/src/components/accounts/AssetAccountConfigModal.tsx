import React, { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { api } from '../../api/client';
import {
  AssetAccountType,
  FireflyAssetAccount,
  FireflyRevenueAccount,
} from '../../types';
import { ASSET_TYPE_META, ASSET_TYPE_ORDER, formatAssetMoney } from './assetTypeUtils';

interface AssetAccountConfigModalProps {
  account: FireflyAssetAccount;
  revenueAccounts: FireflyRevenueAccount[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const AssetAccountConfigModal: React.FC<AssetAccountConfigModalProps> = ({
  account,
  revenueAccounts,
  onClose,
  onSaved,
}) => {
  const [assetType, setAssetType] = useState<AssetAccountType>(account.asset_type);
  const [unitValueStr, setUnitValueStr] = useState(
    account.voucher_unit_value ? account.voucher_unit_value.toFixed(2) : '5.16'
  );
  const [revenueAccountId, setRevenueAccountId] = useState<string>(
    account.default_revenue_account_id ? String(account.default_revenue_account_id) : ''
  );
  const [defaultDescription, setDefaultDescription] = useState(
    account.default_recharge_description || ''
  );
  const [notes, setNotes] = useState(account.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let unitValue: number | null = null;
    if (assetType === 'meal_voucher') {
      const parsed = parseFloat(unitValueStr.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Voucher unit value must be greater than €0.00.');
        return;
      }
      unitValue = Math.round(parsed * 100) / 100;
      if (unitValue <= 0) {
        setError('Voucher unit value must be at least €0.01.');
        return;
      }
    }

    setSaving(true);
    try {
      await api.assetAccounts.updateMetadata(account.id, {
        asset_type: assetType,
        voucher_unit_value: unitValue,
        default_revenue_account_id:
          assetType === 'meal_voucher' && revenueAccountId
            ? Number(revenueAccountId)
            : null,
        default_recharge_description:
          assetType === 'meal_voucher' ? defaultDescription.trim() || null : null,
        notes: notes.trim() || null,
      });
      await onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save asset account configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-config-title"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="asset-config-title" className="text-base font-bold text-slate-900">
              Configure: {account.name}
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              Asset Account #{account.id} · Balance {formatAssetMoney(account.current_balance, account.currency_code)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-2">Account Type</span>
            <div className="grid grid-cols-2 gap-2">
              {ASSET_TYPE_ORDER.map((typeKey) => {
                const meta = ASSET_TYPE_META[typeKey];
                const Icon = meta.icon;
                const isSelected = assetType === typeKey;
                return (
                  <button
                    key={typeKey}
                    type="button"
                    onClick={() => setAssetType(typeKey)}
                    className={`p-2.5 rounded-xl border text-left flex items-start gap-2 transition cursor-pointer ${
                      typeKey === 'standard' || typeKey === 'meal_voucher' ? 'col-span-2' : ''
                    } ${
                      isSelected
                        ? meta.modalActiveClass
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isSelected ? meta.modalIconClass : 'text-slate-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <span className="font-semibold text-xs block">{meta.label}</span>
                      <span className="text-[11px] text-slate-400 block truncate">
                        {meta.subtitle}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {assetType === 'meal_voucher' && (
            <>
              <div>
                <label htmlFor="voucher-unit-value" className="block text-xs font-semibold text-slate-700 mb-1">
                  Single Voucher Value (€) <span className="text-red-500">*</span>
                </label>
                <input
                  id="voucher-unit-value"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={unitValueStr}
                  onChange={(e) => setUnitValueStr(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label htmlFor="default-revenue-account" className="block text-xs font-semibold text-slate-700 mb-1">
                  Default Employer (Revenue Account)
                </label>
                <select
                  id="default-revenue-account"
                  value={revenueAccountId}
                  onChange={(e) => setRevenueAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">None (choose on each recharge)</option>
                  {revenueAccounts.map((rev) => (
                    <option key={rev.id} value={rev.id}>
                      {rev.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Set and forget for monthly recharges; can be changed anytime.
                </p>
              </div>

              <div>
                <label htmlFor="default-recharge-desc" className="block text-xs font-semibold text-slate-700 mb-1">
                  Voucher Name (Optional)
                </label>
                <input
                  id="default-recharge-desc"
                  type="text"
                  value={defaultDescription}
                  onChange={(e) => setDefaultDescription(e.target.value)}
                  placeholder="e.g. Ticket Restaurant, Edenred"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Used for recharge descriptions:{' '}
                  <span className="font-medium text-slate-600">
                    {defaultDescription.trim()
                      ? `22 x ${defaultDescription.trim()} Meal Vouchers`
                      : '22 x Meal Vouchers'}
                  </span>
                </p>
              </div>
            </>
          )}

          <div>
            <label htmlFor="asset-notes" className="block text-xs font-semibold text-slate-700 mb-1">
              Notes (Optional)
            </label>
            <textarea
              id="asset-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
