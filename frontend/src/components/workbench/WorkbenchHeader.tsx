import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  LayoutGrid,
  ListOrdered,
  Paperclip,
  RotateCcw,
  Ticket,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useReceiptWorkbench } from '../../context/ReceiptWorkbenchContext';
import { FireflyAssetAccount } from '../../types';
import { StoreCombobox } from '../common/StoreCombobox';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPT_ATTR =
  'image/heic,image/heif,image/jpeg,image/png,image/webp,application/pdf,.heic,.heif';

export const WorkbenchHeader: React.FC = () => {
  const {
    fireflyAccountId,
    setFireflyAccountId,
    storeName,
    setStoreName,
    purchaseDate,
    setPurchaseDate,
    purchaseTime,
    setPurchaseTime,
    targetTotal,
    setTargetTotal,
    basketDiscount,
    setBasketDiscount,
    notes,
    setNotes,
    sourceAccountId,
    setSourceAccountId,
    paymentMode,
    setPaymentMode,
    voucherAccountId,
    setVoucherAccountId,
    voucherCount,
    setVoucherCount,
    voucherUnitValue,
    setVoucherUnitValue,
    activeMode,
    setActiveMode,
    attachedFile,
    setAttachedFile,
    savedReceiptId,
    clearDraft,
    computedItemsSum,
    calculatedSum,
    discrepancyDelta,
    isBalanced,
  } = useReceiptWorkbench();

  const [assetAccounts, setAssetAccounts] = useState<FireflyAssetAccount[]>([]);
  const [fireflyOffline, setFireflyOffline] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [targetTotalText, setTargetTotalText] = useState(
    targetTotal > 0 ? String(targetTotal) : ''
  );
  const [discountText, setDiscountText] = useState(
    basketDiscount > 0 ? String(basketDiscount) : ''
  );
  const [voucherUnitText, setVoucherUnitText] = useState(String(voucherUnitValue));

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.firefly
      .getAssetAccounts()
      .then(accounts => {
        setAssetAccounts(accounts);
        setFireflyOffline(null);
      })
      .catch(err => {
        setFireflyOffline(
          err instanceof Error
            ? err.message
            : 'Unable to fetch Firefly III asset accounts'
        );
      });
  }, []);

  // Sync local text fields on clearDraft or external updates
  useEffect(() => {
    const parsed = parseFloat(targetTotalText) || 0;
    if (Math.abs(parsed - targetTotal) > 0.001) {
      setTargetTotalText(targetTotal > 0 ? String(targetTotal) : '');
    }
  }, [targetTotal]);

  useEffect(() => {
    const parsed = parseFloat(discountText) || 0;
    if (Math.abs(parsed - basketDiscount) > 0.001) {
      setDiscountText(basketDiscount > 0 ? String(basketDiscount) : '');
    }
  }, [basketDiscount]);

  useEffect(() => {
    const parsed = parseFloat(voucherUnitText) || 0;
    if (Math.abs(parsed - voucherUnitValue) > 0.001) {
      setVoucherUnitText(String(voucherUnitValue));
    }
  }, [voucherUnitValue]);

  useEffect(() => {
    if (!attachedFile) {
      setPreviewUrl(null);
      return;
    }
    const lowerName = attachedFile.name.toLowerCase();
    const isBrowserRenderableImage =
      attachedFile.type.startsWith('image/') &&
      !attachedFile.type.includes('heic') &&
      !attachedFile.type.includes('heif') &&
      !lowerName.endsWith('.heic') &&
      !lowerName.endsWith('.heif');

    if (!isBrowserRenderableImage) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(attachedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachedFile]);

  const handleSelectedFile = (file: File | undefined | null) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(
        `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 15 MB limit.`
      );
      return;
    }
    setFileError(null);
    setAttachedFile(file);
  };

  const selectedSourceAccount = assetAccounts.find(a => a.id === sourceAccountId);
  const selectedVoucherAccount = assetAccounts.find(a => a.id === voucherAccountId);

  const effectiveTotal = targetTotal > 0 ? targetTotal : Math.max(calculatedSum, 0);
  const voucherCovered =
    paymentMode === 'split_vouchers'
      ? Math.round(
          Math.min(Math.max(effectiveTotal, 0), voucherCount * voucherUnitValue) * 100
        ) / 100
      : 0;
  const cardRemainder =
    paymentMode === 'split_vouchers'
      ? Math.round(Math.max(0, effectiveTotal - voucherCovered) * 100) / 100
      : Math.round(Math.max(effectiveTotal, 0) * 100) / 100;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Top Row: Title, Mode Switcher & Reset */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Receipt Workbench
            </h1>
            {savedReceiptId !== null && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Saved Draft #{savedReceiptId}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Synchronized draft autosaved locally in browser storage
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveMode('grid')}
              className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  activeMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5 mr-1.5" />
              Tabular Data Grid
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('stream')}
              className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  activeMode === 'stream'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5 mr-1.5" />
              Card Stream
            </button>
          </div>

          <button
            type="button"
            onClick={clearDraft}
            title="Clear current draft"
            className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 transition"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Clear
          </button>
        </div>
      </div>

      {/* Firefly Non-Blocking Warning */}
      {fireflyOffline && (
        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Firefly III asset accounts unavailable ({fireflyOffline}). You can still itemize and
            click <strong>Save Receipt Locally</strong>.
          </span>
        </div>
      )}

      {/* Primary Receipt Metadata Controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Store (Expense Account) *
          </label>
          <StoreCombobox
            value={fireflyAccountId}
            accountNameHint={storeName}
            onChange={(id, name) => {
              setFireflyAccountId(id);
              setStoreName(name);
            }}
            placeholder="Search store / expense account..."
          />
        </div>

        <div className="md:col-span-3 grid grid-cols-5 gap-2">
          <div className="col-span-3">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Purchase Date *
            </label>
            <input
              type="date"
              required
              value={purchaseDate}
              onChange={e => setPurchaseDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Time *
            </label>
            <input
              type="time"
              required
              value={purchaseTime}
              onChange={e => setPurchaseTime(e.target.value)}
              className="w-full px-2 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Target Total (€) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={targetTotalText}
            onChange={e => {
              const raw = e.target.value;
              setTargetTotalText(raw);
              const n = parseFloat(raw);
              setTargetTotal(!isNaN(n) && n >= 0 ? n : 0);
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Basket Discount (€)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={discountText}
            onChange={e => {
              const raw = e.target.value;
              setDiscountText(raw);
              const n = parseFloat(raw);
              setBasketDiscount(!isNaN(n) && n >= 0 ? n : 0);
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
          <input
            type="text"
            placeholder="Optional slip note..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Payment Source & Attachment Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Source Account & Vouchers */}
        <div className="lg:col-span-7 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Primary Source Account (Card / Cash)
              </label>
              <select
                value={sourceAccountId ?? ''}
                onChange={e =>
                  setSourceAccountId(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="">Select source account...</option>
                {assetAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} (€{acc.current_balance})
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center space-x-2.5 py-2 px-3 rounded-lg bg-white border border-slate-200 cursor-pointer hover:border-blue-300">
              <input
                type="checkbox"
                checked={paymentMode === 'split_vouchers'}
                onChange={e =>
                  setPaymentMode(e.target.checked ? 'split_vouchers' : 'single')
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <Ticket className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-semibold text-slate-800">
                Split with Vouchers (Buoni Pasto)
              </span>
            </label>
          </div>

          {paymentMode === 'split_vouchers' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200/80">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Voucher Asset Account
                </label>
                <select
                  value={voucherAccountId ?? ''}
                  onChange={e =>
                    setVoucherAccountId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">Select voucher account...</option>
                  {assetAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} (€{acc.current_balance})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Voucher Count (0–8)
                </label>
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={voucherCount}
                  onChange={e => {
                    const raw = parseInt(e.target.value, 10);
                    setVoucherCount(
                      isNaN(raw) ? 0 : Math.max(0, Math.min(8, raw))
                    );
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Voucher Unit Value (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={voucherUnitText}
                  onChange={e => {
                    const raw = e.target.value;
                    setVoucherUnitText(raw);
                    const n = parseFloat(raw);
                    if (!isNaN(n) && n > 0) setVoucherUnitValue(n);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                />
              </div>
            </div>
          )}
        </div>

        {/* Receipt File Attachment Dropzone */}
        <div className="lg:col-span-5">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={e => handleSelectedFile(e.target.files?.[0])}
            className="hidden"
          />

          {!attachedFile ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDragging(false);
                handleSelectedFile(e.dataTransfer.files?.[0]);
              }}
              className={`border-2 border-dashed rounded-xl p-3.5 text-center cursor-pointer transition ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
              }`}
            >
              <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
              <div className="text-xs font-semibold text-slate-700">
                Attach Receipt Photo or PDF
              </div>
              <div className="text-[11px] text-slate-400">
                HEIC/HEIF (iPhone), JPEG, PNG, WebP, or PDF (max 15 MB)
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/60 border border-blue-200">
              <div className="flex items-center space-x-3 min-w-0">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Receipt preview"
                    className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-white border border-blue-200 flex items-center justify-center shrink-0">
                    {attachedFile.type === 'application/pdf' ? (
                      <FileText className="w-5 h-5 text-rose-600" />
                    ) : (
                      <Paperclip className="w-5 h-5 text-blue-600" />
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800 truncate">
                    {attachedFile.name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {(attachedFile.size / 1024).toFixed(0)} KB
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAttachedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-white transition"
                title="Remove attachment"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {fileError && (
            <p className="mt-1.5 text-xs text-rose-600 font-medium">{fileError}</p>
          )}
        </div>
      </div>

      {/* Live Reconciliation Meter & Payment Breakdown */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-3 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-slate-100">
            <span className="text-slate-500 mr-1.5">Target Total:</span>
            <strong className="text-slate-900">€{targetTotal.toFixed(2)}</strong>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-100">
            <span className="text-slate-500 mr-1.5">Calculated Sum:</span>
            <strong className="text-slate-900">€{calculatedSum.toFixed(2)}</strong>
            <span className="text-slate-400 ml-1">
              (Items €{computedItemsSum.toFixed(2)}
              {basketDiscount > 0 ? ` - €${basketDiscount.toFixed(2)}` : ''})
            </span>
          </div>

          {isBalanced ? (
            <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Balanced (Δ €{Math.abs(discrepancyDelta).toFixed(2)})
            </div>
          ) : (
            <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-semibold">
              Discrepancy (Δ): {discrepancyDelta >= 0 ? '+' : ''}€
              {discrepancyDelta.toFixed(2)}
            </div>
          )}
        </div>

        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-lg">
          {paymentMode === 'single' ? (
            <span>
              Payment: <strong>100% on {selectedSourceAccount?.name || 'Select Source Account'}</strong>
            </span>
          ) : (
            <span>
              Vouchers (<strong>{selectedVoucherAccount?.name || 'Unselected'}</strong>):{' '}
              <strong className="text-amber-700">€{voucherCovered.toFixed(2)}</strong> + Card
              Remainder (<strong>{selectedSourceAccount?.name || 'Unselected'}</strong>):{' '}
              <strong className="text-blue-700">€{cardRemainder.toFixed(2)}</strong>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
