import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Pencil, X } from 'lucide-react';
import { api } from '../../api/client';
import { MeasureUnit, PriceRecord, VerificationStatus } from '../../types';
import {
  computeNormalizedUnitPrice,
  computeQuantityFromUnitPrice,
  formatQuantityInput,
  getNormalizedUnitSuffix,
} from './splitPriceUtils';

const VALID_UNITS: MeasureUnit[] = ['g', 'kg', 'ml', 'l', 'pcs'];

function toMeasureUnit(unit: string): MeasureUnit {
  return VALID_UNITS.includes(unit as MeasureUnit) ? (unit as MeasureUnit) : 'pcs';
}

function deriveUnitPriceInput(
  paidPrice: number,
  quantity: number | null,
  unit: MeasureUnit,
  pkgSize: number,
  normalizedUnitPrice?: number | null
): string {
  if (normalizedUnitPrice != null) return String(normalizedUnitPrice);
  if (quantity == null || quantity <= 0) return '';
  const computed = computeNormalizedUnitPrice(paidPrice, quantity, unit, pkgSize);
  return computed != null ? String(computed) : '';
}

interface SplitPriceEditorProps {
  priceRecordId: number;
  paidPrice: number;
  regularPrice: number;
  isDiscount: boolean;
  quantity: number | null;
  unit: string;
  packageSize?: number | null;
  normalizedUnitPrice?: number | null;
  verificationStatus?: VerificationStatus;
  defaultExpanded?: boolean;
  onSaved: (updated: PriceRecord) => void | Promise<void>;
}

export const SplitPriceEditor: React.FC<SplitPriceEditorProps> = ({
  priceRecordId,
  paidPrice,
  regularPrice,
  isDiscount,
  quantity,
  unit,
  packageSize = 1,
  normalizedUnitPrice,
  verificationStatus = 'verified',
  defaultExpanded = false,
  onSaved,
}) => {
  const pkgSize = packageSize && packageSize > 0 ? packageSize : 1;
  const initialUnit = toMeasureUnit(unit);

  const [editing, setEditing] = useState(defaultExpanded || verificationStatus === 'missing');
  const [qtyInput, setQtyInput] = useState<string>(() =>
    formatQuantityInput(quantity, initialUnit)
  );
  const [unitInput, setUnitInput] = useState<MeasureUnit>(initialUnit);
  const effectivePkgSize = unitInput !== initialUnit && pkgSize > 1 ? 1 : pkgSize;

  const [unitPriceInput, setUnitPriceInput] = useState<string>(() =>
    deriveUnitPriceInput(paidPrice, quantity, initialUnit, pkgSize, normalizedUnitPrice)
  );
  const [discountChecked, setDiscountChecked] = useState<boolean>(isDiscount);
  const [regularInput, setRegularInput] = useState<string>(
    isDiscount && regularPrice > 0 ? String(regularPrice) : String(paidPrice)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextUnit = toMeasureUnit(unit);
    setUnitInput(nextUnit);
    setQtyInput(formatQuantityInput(quantity, nextUnit));
    setUnitPriceInput(
      deriveUnitPriceInput(paidPrice, quantity, nextUnit, pkgSize, normalizedUnitPrice)
    );
    setDiscountChecked(isDiscount);
    setRegularInput(isDiscount && regularPrice > 0 ? String(regularPrice) : String(paidPrice));
    setError(null);
  }, [priceRecordId, paidPrice, regularPrice, isDiscount, quantity, unit, pkgSize, normalizedUnitPrice]);

  const handleQtyChange = (val: string) => {
    setQtyInput(val);
    setError(null);
    const num = parseFloat(val);
    if (Number.isFinite(num) && num > 0) {
      const up = computeNormalizedUnitPrice(paidPrice, num, unitInput, effectivePkgSize);
      setUnitPriceInput(up != null ? String(up) : '');
    } else {
      setUnitPriceInput('');
    }
  };

  const handleUnitChange = (nextUnit: MeasureUnit) => {
    setUnitInput(nextUnit);
    setError(null);
    const nextPkg = nextUnit !== initialUnit && pkgSize > 1 ? 1 : pkgSize;
    const num = parseFloat(qtyInput);
    if (Number.isFinite(num) && num > 0) {
      const up = computeNormalizedUnitPrice(paidPrice, num, nextUnit, nextPkg);
      setUnitPriceInput(up != null ? String(up) : '');
    }
  };

  const handleUnitPriceChange = (val: string) => {
    setUnitPriceInput(val);
    setError(null);
    const up = parseFloat(val);
    if (Number.isFinite(up) && up > 0) {
      const computedQty = computeQuantityFromUnitPrice(paidPrice, up, unitInput, effectivePkgSize);
      setQtyInput(computedQty != null ? formatQuantityInput(computedQty, unitInput) : '');
    }
  };

  const handleQuickConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.prices.update(priceRecordId, { confirm_verified: true });
      await onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm record');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedQty = parseFloat(qtyInput);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setError('Enter a valid quantity (> 0) or unit price.');
      return;
    }

    const parsedRegular = discountChecked ? parseFloat(regularInput) : paidPrice;
    if (discountChecked && (!Number.isFinite(parsedRegular) || parsedRegular <= 0)) {
      setError('Enter a valid regular shelf price.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await api.prices.update(priceRecordId, {
        quantity: parsedQty,
        unit: unitInput,
        is_discount: discountChecked,
        regular_price: parsedRegular,
        confirm_verified: true,
      });
      setEditing(false);
      await onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save split pricing');
    } finally {
      setSaving(false);
    }
  };

  const unitSuffix = getNormalizedUnitSuffix(unitInput);
  const summaryQtyLabel =
    quantity == null
      ? '—'
      : pkgSize > 1
      ? `${formatQuantityInput(quantity, initialUnit)} × ${pkgSize}${initialUnit}`
      : `${formatQuantityInput(quantity, initialUnit)} ${initialUnit}`;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
        {verificationStatus === 'missing' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
            <AlertTriangle className="w-3 h-3" />
            Missing qty
          </span>
        )}
        {verificationStatus === 'needs_review' && (
          <>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[11px] font-semibold">
              <AlertTriangle className="w-3 h-3" />
              Needs review
            </span>
            {quantity != null && quantity > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={handleQuickConfirm}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50"
                title="Confirm existing quantity as verified"
              >
                <Check className="w-3 h-3" />
                Confirm
              </button>
            )}
          </>
        )}
        {verificationStatus === 'verified' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
            <CheckCircle2 className="w-3 h-3" />
            Verified
          </span>
        )}

        <span className="text-[11px] text-slate-600 font-medium tabular-nums">
          {summaryQtyLabel}
          {normalizedUnitPrice != null ? ` · €${normalizedUnitPrice.toFixed(2)} ${unitSuffix}` : ''}
        </span>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setEditing(prev => !prev);
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold"
          title={editing ? 'Close editor' : 'Edit quantity & discount'}
        >
          {editing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
          {editing ? 'Close' : 'Edit'}
        </button>
      </div>

      {editing && (
        <form
          onSubmit={handleSave}
          className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <label className="text-[11px] font-semibold text-slate-600">
                {effectivePkgSize > 1 ? `Packs (×${effectivePkgSize}${unitInput})` : 'Qty'}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={qtyInput}
                onChange={e => handleQtyChange(e.target.value)}
                placeholder={unitInput === 'g' ? '850' : unitInput === 'l' ? '28.5' : '1'}
                className="w-20 px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                aria-label="Quantity"
              />
              <select
                value={unitInput}
                onChange={e => handleUnitChange(e.target.value as MeasureUnit)}
                className="px-1.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium"
                aria-label="Unit"
              >
                {VALID_UNITS.map(u => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <span className="text-slate-400 text-[11px]" title="Bidirectional calculator">
              ↔
            </span>

            <div className="flex items-center gap-1">
              <input
                type="number"
                step="any"
                min="0"
                value={unitPriceInput}
                onChange={e => handleUnitPriceChange(e.target.value)}
                placeholder={unitInput === 'l' ? '1.749' : '2.99'}
                className="w-20 px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                aria-label="Unit price"
              />
              <span className="text-[11px] font-medium text-slate-600">
                € {unitSuffix}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={discountChecked}
                  onChange={e => setDiscountChecked(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Discount</span>
              </label>

              {discountChecked && (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-500">Regular €</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={regularInput}
                    onChange={e => setRegularInput(e.target.value)}
                    className="w-20 px-2 py-0.5 rounded border border-slate-300 font-mono text-xs"
                    aria-label="Regular price"
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-semibold"
            >
              {saving ? 'Saving...' : 'Save & Verify'}
            </button>
          </div>

          {error && (
            <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
              {error}
            </div>
          )}
        </form>
      )}
    </div>
  );
};
