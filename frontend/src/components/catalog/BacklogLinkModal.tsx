import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { isSyncJobActive } from '../../hooks/useFireflySyncJobs';
import { AliasScope, FireflySyncJob, Product } from '../../types';
import { formatProductBadge } from '../workbench/productUtils';
import { filterLinkModalProducts } from './backlogProductSearch';

export interface LinkTarget {
  label: string;
  occurrenceCount: number;
  journalIds: number[];
  suggestedProductId: number | null;
  aliasScope: AliasScope;
}

interface BacklogLinkModalProps {
  target: LinkTarget | null;
  products: Product[];
  jobsByProductId: Record<number, FireflySyncJob>;
  onClose: () => void;
  onJobStarted: (job: FireflySyncJob) => void;
  onLinked: () => Promise<void>;
}

export const BacklogLinkModal: React.FC<BacklogLinkModalProps> = ({
  target,
  products,
  jobsByProductId,
  onClose,
  onJobStarted,
  onLinked,
}) => {
  const [linkSearch, setLinkSearch] = useState('');
  const [modalProducts, setModalProducts] = useState<Product[] | null>(null);
  const [loadingModalProducts, setLoadingModalProducts] = useState(false);
  const [selectedLinkProductId, setSelectedLinkProductId] = useState<number | null>(null);
  const [submittingLink, setSubmittingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const productsRef = useRef(products);
  productsRef.current = products;

  useEffect(() => {
    if (!target) {
      setLoadingModalProducts(false);
      return;
    }
    setLinkSearch('');
    setModalProducts(null);
    setSelectedLinkProductId(target.suggestedProductId ?? null);
    setLinkError(null);

    const controller = new AbortController();
    setLoadingModalProducts(true);
    api.products
      .list(undefined, { signal: controller.signal })
      .then(allProducts => {
        if (!controller.signal.aborted) {
          setModalProducts(allProducts);
        }
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setModalProducts(productsRef.current);
        setLinkError(
          err instanceof Error
            ? `Failed to refresh full catalog: ${err.message}`
            : 'Failed to refresh full catalog'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingModalProducts(false);
        }
      });
    return () => controller.abort();
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, onClose]);

  if (!target) return null;

  const filteredModalProducts = filterLinkModalProducts(modalProducts ?? products, linkSearch);

  const handleConfirmLink = async () => {
    if (!selectedLinkProductId) return;
    setSubmittingLink(true);
    setLinkError(null);
    try {
      const job = await api.fireflySync.linkBacklog(
        selectedLinkProductId,
        target.journalIds,
        target.aliasScope
      );
      onJobStarted(job);
      onClose();
      await onLinked();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to link transactions');
    } finally {
      setSubmittingLink(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            Link Firefly Entry to Canonical Item
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Linking <strong>&quot;{target.label}&quot;</strong> ({target.occurrenceCount} split
            {target.occurrenceCount === 1 ? '' : 's'}) will rewrite those Firefly splits with the
            chosen item&apos;s name, category, and expanded tags.
          </p>
        </div>

        <input
          type="text"
          autoFocus
          value={linkSearch}
          onChange={e => setLinkSearch(e.target.value)}
          placeholder="Search items by name or brand..."
          aria-label="Search items by name or brand"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />

        <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
          {loadingModalProducts && modalProducts === null ? (
            <div className="p-4 text-center text-xs text-slate-400">
              Loading catalog items...
            </div>
          ) : filteredModalProducts.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              No matching items in catalog.
            </div>
          ) : (
            filteredModalProducts.map(prod => {
              const selected = selectedLinkProductId === prod.id;
              const activeJobForProd =
                jobsByProductId[prod.id] && isSyncJobActive(jobsByProductId[prod.id]);
              return (
                <button
                  key={prod.id}
                  type="button"
                  disabled={activeJobForProd}
                  onClick={() => setSelectedLinkProductId(prod.id)}
                  className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between transition disabled:opacity-50 ${
                    selected ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold truncate">{prod.name}</div>
                    <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1">
                      <span className="text-slate-600 font-medium">
                        {prod.brand?.name || 'Generic'}
                      </span>
                      <span>·</span>
                      <span>{formatProductBadge(prod)}</span>
                      <span>·</span>
                      <span>{prod.firefly_category_name || 'No category'}</span>
                    </div>
                  </div>
                  {activeJobForProd ? (
                    <span className="text-[11px] font-semibold text-blue-600">Syncing...</span>
                  ) : (
                    selected && (
                      <span className="text-[11px] font-bold text-blue-600">Selected</span>
                    )
                  )}
                </button>
              );
            })
          )}
        </div>

        {linkError && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {linkError}
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedLinkProductId || submittingLink}
            onClick={handleConfirmLink}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold"
          >
            {submittingLink ? 'Linking & Updating Firefly...' : 'Link & Rewrite Firefly'}
          </button>
        </div>
      </div>
    </div>
  );
};
