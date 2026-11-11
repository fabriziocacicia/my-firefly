import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Paperclip,
  RefreshCw,
  Save,
  Send,
} from 'lucide-react';
import { api } from '../api/client';
import { CardStreamView } from '../components/workbench/CardStreamView';
import { TabularGridView } from '../components/workbench/TabularGridView';
import { WorkbenchHeader } from '../components/workbench/WorkbenchHeader';
import { useReceiptWorkbench } from '../context/ReceiptWorkbenchContext';
import { ReceiptCreatePayload, ReceiptRecord } from '../types';

export const ReceiptWorkbenchPage: React.FC = () => {
  const {
    storeId,
    purchaseDate,
    targetTotal,
    basketDiscount,
    notes,
    sourceAccountId,
    paymentMode,
    voucherAccountId,
    voucherCount,
    voucherUnitValue,
    draftItems,
    savedReceiptId,
    setSavedReceiptId,
    activeMode,
    attachedFile,
    setAttachedFile,
    selectedStore,
    isBalanced,
    canSaveLocally,
    canPushToFirefly,
    clearDraft,
  } = useReceiptWorkbench();

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [recentOpen, setRecentOpen] = useState(true);
  const [recentReceipts, setRecentReceipts] = useState<ReceiptRecord[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [syncingReceiptId, setSyncingReceiptId] = useState<number | null>(null);

  const loadRecentReceipts = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const list = await api.receipts.list(20, 0);
      setRecentReceipts(list);
    } catch (err) {
      console.error('Failed to load recent receipts:', err);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    loadRecentReceipts();
  }, [loadRecentReceipts]);

  const getPushDisabledReasons = (): string[] => {
    const reasons: string[] = [];
    if (!storeId) {
      reasons.push('Select a store');
    } else if (!selectedStore?.firefly_account_id) {
      reasons.push('Map selected store to a Firefly expense account');
    }
    if (draftItems.length === 0) reasons.push('Add at least one item');
    if (targetTotal <= 0) reasons.push('Set Target Total > 0');
    else if (!isBalanced) reasons.push('Reconcile item sum with Target Total (|Δ| ≤ €0.01)');
    if (!sourceAccountId) reasons.push('Select Primary Source Account');
    if (paymentMode === 'split_vouchers') {
      if (!voucherAccountId) reasons.push('Select Voucher Asset Account');
      if (voucherCount <= 0) reasons.push('Set Voucher Count ≥ 1');
    }
    return reasons;
  };

  const handleSaveOrPush = async (shouldPush: boolean) => {
    if (!storeId) return;
    setSubmitting(true);
    setStatusMessage(null);

    const payload: ReceiptCreatePayload = {
      store_id: storeId,
      purchase_date: purchaseDate,
      total_amount: targetTotal,
      basket_discount: basketDiscount,
      source_account_id: sourceAccountId,
      payment_mode: paymentMode,
      voucher_account_id: paymentMode === 'split_vouchers' ? voucherAccountId : null,
      voucher_count: paymentMode === 'split_vouchers' ? voucherCount : 0,
      voucher_unit_value: voucherUnitValue,
      notes: notes.trim() || undefined,
      items: draftItems.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit: item.unit,
        package_size: item.package_size,
        paid_price: item.paid_price,
        regular_price: item.regular_price,
        is_discount: item.is_discount,
      })),
    };

    try {
      let receiptId = savedReceiptId;
      if (receiptId === null) {
        const created = await api.receipts.create(payload);
        receiptId = created.id;
        setSavedReceiptId(created.id);
      }

      if (attachedFile) {
        await api.receipts.uploadAttachment(receiptId, attachedFile);
        setAttachedFile(null);
      }

      if (shouldPush) {
        const pushed = await api.receipts.pushToFirefly(receiptId, false);
        clearDraft();
        await loadRecentReceipts();
        setStatusMessage({
          type: 'success',
          text: `Receipt #${pushed.id} saved and synced to Firefly III!`,
        });
      } else {
        clearDraft();
        await loadRecentReceipts();
        setStatusMessage({
          type: 'success',
          text: `Receipt #${receiptId} saved locally to companion database.`,
        });
      }
    } catch (err) {
      await loadRecentReceipts();
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Operation failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecentPush = async (receipt: ReceiptRecord, force: boolean) => {
    setSyncingReceiptId(receipt.id);
    setStatusMessage(null);
    try {
      const updated = await api.receipts.pushToFirefly(receipt.id, force);
      setRecentReceipts(prev => prev.map(r => (r.id === updated.id ? updated : r)));
      setStatusMessage({
        type: 'success',
        text: `Receipt #${updated.id} synced to Firefly III.`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to sync receipt to Firefly III',
      });
    } finally {
      setSyncingReceiptId(null);
    }
  };

  const pushDisabledReasons = getPushDisabledReasons();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <WorkbenchHeader />

      {/* Active Entry View */}
      {activeMode === 'grid' ? <TabularGridView /> : <CardStreamView />}

      {/* Status Notification */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center space-x-2 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span className="font-medium">{statusMessage.text}</span>
        </div>
      )}

      {/* Commit & Push Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {canPushToFirefly ? (
            <span className="text-emerald-700 font-medium">
              All guards satisfied — ready to save locally and push balanced splits to Firefly III.
            </span>
          ) : pushDisabledReasons.length > 0 ? (
            <span>
              Firefly push locked: <strong>{pushDisabledReasons.join(' • ')}</strong>
            </span>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!canSaveLocally || submitting}
            onClick={() => handleSaveOrPush(false)}
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 text-xs font-semibold transition"
          >
            <Save className="w-4 h-4 mr-1.5 text-slate-600" />
            {submitting ? 'Working...' : 'Save Receipt Locally'}
          </button>

          <button
            type="button"
            disabled={!canPushToFirefly || submitting}
            title={pushDisabledReasons.join(' • ') || 'Push balanced splits to Firefly III'}
            onClick={() => handleSaveOrPush(true)}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-sm transition"
          >
            <Send className="w-4 h-4 mr-1.5" />
            {submitting ? 'Pushing...' : 'Save & Push Splits to Firefly'}
          </button>
        </div>
      </div>

      {/* Collapsible Recent Receipts History */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 flex items-center justify-between bg-slate-50 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setRecentOpen(v => !v)}
            className="flex items-center space-x-2 text-sm font-bold text-slate-900"
          >
            <span>Recent Receipts ({recentReceipts.length})</span>
            {recentOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </button>

          <button
            type="button"
            onClick={loadRecentReceipts}
            className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingRecent ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {recentOpen && (
          <div className="divide-y divide-slate-100">
            {recentReceipts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No receipts persisted yet.
              </div>
            ) : (
              recentReceipts.map(receipt => {
                const voucherCovered =
                  receipt.payment_mode === 'split_vouchers'
                    ? Math.min(
                        receipt.total_amount,
                        receipt.voucher_count * receipt.voucher_unit_value
                      )
                    : 0;
                const needsCardRemainder =
                  receipt.payment_mode === 'split_vouchers' &&
                  receipt.total_amount - voucherCovered > 0.005;

                const isPartialVoucherOnly =
                  receipt.firefly_voucher_transaction_id != null &&
                  receipt.firefly_transaction_id == null &&
                  needsCardRemainder;

                const isFullySynced =
                  receipt.payment_mode === 'single'
                    ? receipt.firefly_transaction_id != null
                    : receipt.firefly_voucher_transaction_id != null &&
                      (!needsCardRemainder || receipt.firefly_transaction_id != null);

                return (
                  <div
                    key={receipt.id}
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/70"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">
                          {receipt.store?.company?.name || 'Store'} — {receipt.store?.name}
                        </span>
                        <span className="text-xs text-slate-500">
                          {receipt.purchase_date}
                        </span>
                        <span className="text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                          €{receipt.total_amount.toFixed(2)}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {receipt.items.length} items
                          {receipt.basket_discount > 0
                            ? ` • Disc -€${receipt.basket_discount.toFixed(2)}`
                            : ''}
                        </span>
                      </div>

                      {receipt.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {receipt.attachments.map(att => (
                            <a
                              key={att.id}
                              href={api.receipts.getAttachmentUrl(receipt.id, att.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-md border border-blue-200/80"
                            >
                              <Paperclip className="w-3 h-3 mr-1" />
                              {att.filename}
                              <ExternalLink className="w-2.5 h-2.5 ml-1" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {isFullySynced ? (
                        <span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Synced
                          {receipt.firefly_voucher_transaction_id
                            ? ` (V#${receipt.firefly_voucher_transaction_id})`
                            : ''}
                          {receipt.firefly_transaction_id
                            ? ` (C#${receipt.firefly_transaction_id})`
                            : ''}
                        </span>
                      ) : isPartialVoucherOnly ? (
                        <>
                          <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                            Partial (Voucher #{receipt.firefly_voucher_transaction_id})
                          </span>
                          <button
                            type="button"
                            disabled={syncingReceiptId === receipt.id}
                            onClick={() => handleRecentPush(receipt, true)}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                          >
                            {syncingReceiptId === receipt.id
                              ? 'Resuming...'
                              : 'Resume Card Sync'}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                            Local Only
                          </span>
                          <button
                            type="button"
                            disabled={syncingReceiptId === receipt.id}
                            onClick={() => handleRecentPush(receipt, false)}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-semibold"
                          >
                            {syncingReceiptId === receipt.id
                              ? 'Pushing...'
                              : 'Push to Firefly'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
