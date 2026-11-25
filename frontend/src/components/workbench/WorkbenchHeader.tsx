import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  FileText,
  LayoutGrid,
  ListOrdered,
  Paperclip,
  RotateCcw,
  Ticket,
  Upload,
  X,
} from 'lucide-react';
import { useReceiptWorkbench } from '../../context/ReceiptWorkbenchContext';
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
    assetAccounts,
    assetAccountsError,
    mealVoucherAccounts,
    selectedSourceAccount,
    selectedVoucherAccount,
    usableVouchers,
    maxByTotal,
    maxVouchers,
    voucherCovered,
    cardRemainder,
    voucherLimitExceeded,
  } = useReceiptWorkbench();

  const [fileError, setFileError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [discountText, setDiscountText] = useState(
    basketDiscount > 0 ? String(basketDiscount) : ''
  );
  const [voucherUnitText, setVoucherUnitText] = useState(String(voucherUnitValue));

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local text fields on clearDraft or external updates
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

  const hasMealVoucherAccounts = mealVoucherAccounts.length > 0;
  const showVoucherToggle =
    hasMealVoucherAccounts || paymentMode === 'split_vouchers';

  const isSelectedVoucherFlagged =
    selectedVoucherAccount?.asset_type === 'meal_voucher' &&
    Boolean(selectedVoucherAccount.voucher_unit_value && selectedVoucherAccount.voucher_unit_value > 0);
  const voucherOptions = hasMealVoucherAccounts ? mealVoucherAccounts : assetAccounts;
  const hasStaleVoucherSelection =
    voucherAccountId !== null &&
    !voucherOptions.some(acc => acc.id === voucherAccountId);

  // Auto-select single flagged meal-voucher account & lock unit value from metadata
  useEffect(() => {
    if (paymentMode !== 'split_vouchers') return;
    if (voucherAccountId === null && mealVoucherAccounts.length === 1) {
      setVoucherAccountId(mealVoucherAccounts[0].id);
    }
  }, [paymentMode, voucherAccountId, mealVoucherAccounts, setVoucherAccountId]);

  useEffect(() => {
    if (
      paymentMode === 'split_vouchers' &&
      isSelectedVoucherFlagged &&
      selectedVoucherAccount?.voucher_unit_value
    ) {
      const configured = selectedVoucherAccount.voucher_unit_value;
      if (Math.abs(configured - voucherUnitValue) > 0.001) {
        setVoucherUnitValue(configured);
      }
    }
  }, [
    paymentMode,
    isSelectedVoucherFlagged,
    selectedVoucherAccount?.voucher_unit_value,
    voucherUnitValue,
    setVoucherUnitValue,
  ]);

  const activeUnitValue =
    isSelectedVoucherFlagged && selectedVoucherAccount?.voucher_unit_value
      ? selectedVoucherAccount.voucher_unit_value
      : voucherUnitValue;

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
      {assetAccountsError && (
        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Firefly III asset accounts unavailable ({assetAccountsError}). You can still itemize and
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
            Receipt Total (€)
          </label>
          <div
            aria-label="Computed receipt total"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold bg-slate-50 text-slate-900 select-all"
          >
            €{calculatedSum.toFixed(2)}
          </div>
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
                {paymentMode === 'split_vouchers' && cardRemainder <= 0 && (
                  <span className="ml-1 text-[11px] font-normal text-emerald-700">
                    (Optional — €0.00 remainder)
                  </span>
                )}
              </label>
              <select
                value={sourceAccountId ?? ''}
                onChange={e =>
                  setSourceAccountId(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="">
                  {paymentMode === 'split_vouchers' && cardRemainder <= 0
                    ? 'Not needed (€0.00 remainder)'
                    : 'Select source account...'}
                </option>
                {assetAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} (€{acc.current_balance})
                  </option>
                ))}
              </select>
            </div>

            {showVoucherToggle && (
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
                  Pay / Split with Meal Vouchers
                </span>
              </label>
            )}
          </div>

          {paymentMode === 'split_vouchers' && (
            <div className="space-y-2.5 pt-2 border-t border-slate-200/80">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    {hasStaleVoucherSelection && voucherAccountId !== null && (
                      <option value={voucherAccountId}>
                        {selectedVoucherAccount?.name || `Account #${voucherAccountId}`} (Unflagged / Missing)
                      </option>
                    )}
                    {voucherOptions.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} (
                        {acc.asset_type === 'meal_voucher'
                          ? `${acc.usable_vouchers ?? 0} × €${(acc.voucher_unit_value ?? 0).toFixed(2)}`
                          : `€${acc.current_balance}`}
                        )
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Voucher Count (0–{maxVouchers})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={maxVouchers}
                    value={voucherCount}
                    onChange={e => {
                      const raw = parseInt(e.target.value, 10);
                      setVoucherCount(
                        isNaN(raw) ? 0 : Math.max(0, Math.min(maxVouchers, raw))
                      );
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  />
                  {selectedVoucherAccount && (
                    <span className="block mt-1 text-[10px] text-slate-500">
                      {usableVouchers !== null
                        ? `${usableVouchers} in Firefly · ${maxByTotal} fit receipt`
                        : `${maxByTotal} fit receipt`}
                    </span>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Voucher Unit Value (€)
                  </label>
                  {isSelectedVoucherFlagged ? (
                    <div className="w-full px-3 py-2 border border-amber-200 rounded-lg text-xs bg-amber-50/70 text-amber-900 font-semibold flex items-center justify-between">
                      <span>€{activeUnitValue.toFixed(2)}</span>
                      <span className="text-[10px] font-medium text-amber-700">Locked</span>
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>

              {hasStaleVoucherSelection && (
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    Saved draft references Account #{voucherAccountId}, which is no longer flagged as a meal-voucher account. Select a valid meal-voucher account or configure it in Accounts & Chains.
                  </span>
                </div>
              )}

              {isSelectedVoucherFlagged &&
                selectedVoucherAccount &&
                !selectedVoucherAccount.is_exact_multiple && (
                  <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      Firefly balance (€{Number(selectedVoucherAccount.current_balance || 0).toFixed(2)}) is off by €
                      {Math.abs(selectedVoucherAccount.balance_discrepancy).toFixed(2)} from an exact multiple of €
                      {activeUnitValue.toFixed(2)}.
                    </span>
                  </div>
                )}

              {voucherLimitExceeded && (
                <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>
                    Selected {voucherCount} vouchers exceeds the allowed maximum ({maxVouchers}). Lower voucher count before pushing.
                  </span>
                </div>
              )}
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

      {/* Live Computed Total & Payment Breakdown */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-3 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-slate-100">
            <span className="text-slate-500 mr-1.5">Receipt Total:</span>
            <strong className="text-slate-900">€{calculatedSum.toFixed(2)}</strong>
            <span className="text-slate-400 ml-1">
              (Items €{computedItemsSum.toFixed(2)}
              {basketDiscount > 0 ? ` - €${basketDiscount.toFixed(2)}` : ''})
            </span>
          </div>

          {calculatedSum < 0 && (
            <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
              Basket discount exceeds item sum
            </div>
          )}
        </div>

        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-lg">
          {paymentMode === 'single' ? (
            <span>
              Payment: <strong>100% on {selectedSourceAccount?.name || 'Select Source Account'}</strong>
            </span>
          ) : cardRemainder <= 0 ? (
            <span>
              Payment: <strong>100% Vouchers ({selectedVoucherAccount?.name || 'Unselected'})</strong>:{' '}
              <strong className="text-amber-700">€{voucherCovered.toFixed(2)}</strong>
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
