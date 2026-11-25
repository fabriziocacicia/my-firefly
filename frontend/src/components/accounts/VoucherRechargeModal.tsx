import React, { useEffect, useState } from 'react';
import { AlertCircle, Ticket, X } from 'lucide-react';
import { api } from '../../api/client';
import { FireflyAssetAccount, FireflyRevenueAccount } from '../../types';

interface VoucherRechargeModalProps {
  account: FireflyAssetAccount;
  revenueAccounts: FireflyRevenueAccount[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

const getTodayDate = () => new Date().toISOString().slice(0, 10);
const getCurrentTimeHHMM = () => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

export const VoucherRechargeModal: React.FC<VoucherRechargeModalProps> = ({
  account,
  revenueAccounts,
  onClose,
  onSuccess,
}) => {
  const [countStr, setCountStr] = useState('20');
  const [rechargeDate, setRechargeDate] = useState(getTodayDate);
  const [rechargeTime, setRechargeTime] = useState(getCurrentTimeHHMM);
  const [revenueAccountId, setRevenueAccountId] = useState(
    account.default_revenue_account_id ? String(account.default_revenue_account_id) : ''
  );
  const [description, setDescription] = useState(
    account.default_recharge_description || ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const unitValue = account.voucher_unit_value ?? 0;
  const parsedCount = parseInt(countStr, 10);
  const validCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 0;
  const depositAmount = Math.round(validCount * Math.round(unitValue * 100)) / 100;
  const projectedBalance = Number(account.current_balance || 0) + depositAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (validCount <= 0) {
      setError('Enter a positive number of vouchers.');
      return;
    }
    if (!revenueAccountId) {
      setError('Select an employer revenue account.');
      return;
    }

    const normalizedTime =
      rechargeTime.length === 5 ? `${rechargeTime}:00` : rechargeTime || '12:00:00';

    setSubmitting(true);
    try {
      await api.assetAccounts.recharge(account.id, {
        count: validCount,
        recharge_date: rechargeDate,
        recharge_time: normalizedTime,
        revenue_account_id: Number(revenueAccountId),
        description: description.trim() || null,
      });
      await onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create recharge deposit in Firefly III');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voucher-recharge-title"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <h2 id="voucher-recharge-title" className="text-base font-bold text-slate-900">
                Recharge Meal Vouchers
              </h2>
              <span className="text-xs text-slate-500">
                {account.name} (€{unitValue.toFixed(2)} / voucher)
              </span>
            </div>
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="recharge-count" className="block text-xs font-semibold text-slate-700 mb-1">
                Vouchers <span className="text-red-500">*</span>
              </label>
              <input
                id="recharge-count"
                type="number"
                min={1}
                step={1}
                required
                value={countStr}
                onChange={(e) => setCountStr(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label htmlFor="recharge-date" className="block text-xs font-semibold text-slate-700 mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                id="recharge-date"
                type="date"
                required
                value={rechargeDate}
                onChange={(e) => setRechargeDate(e.target.value)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label htmlFor="recharge-time" className="block text-xs font-semibold text-slate-700 mb-1">
                Time <span className="text-red-500">*</span>
              </label>
              <input
                id="recharge-time"
                type="time"
                required
                value={rechargeTime}
                onChange={(e) => setRechargeTime(e.target.value)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="recharge-revenue" className="block text-xs font-semibold text-slate-700 mb-1">
              Employer (Revenue Account) <span className="text-red-500">*</span>
            </label>
            <select
              id="recharge-revenue"
              required
              value={revenueAccountId}
              onChange={(e) => setRevenueAccountId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Select revenue account...</option>
              {revenueAccounts.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  {rev.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="recharge-description" className="block text-xs font-semibold text-slate-700 mb-1">
              Description (Optional)
            </label>
            <input
              id="recharge-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`Meal vouchers recharge (${validCount} x €${unitValue.toFixed(2)})`}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs space-y-1">
            <div className="flex justify-between text-amber-900">
              <span>Firefly Deposit Amount:</span>
              <strong>€{depositAmount.toFixed(2)}</strong>
            </div>
            <div className="flex justify-between text-amber-800">
              <span>Projected New Balance:</span>
              <span>
                €{projectedBalance.toFixed(2)} ({(account.usable_vouchers ?? 0) + validCount} vouchers)
              </span>
            </div>
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
              disabled={submitting}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
            >
              {submitting ? 'Creating Deposit...' : `Add ${validCount} Vouchers`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
