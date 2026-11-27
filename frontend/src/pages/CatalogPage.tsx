import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Flame,
  History,
  Layers,
  ListChecks,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { ProductPriceChart } from '../components/charts/ProductPriceChart';
import { StoreCombobox } from '../components/common/StoreCombobox';
import { CatalogAnalyticsTab } from '../components/catalog/CatalogAnalyticsTab';
import { FireflyBacklogTab } from '../components/catalog/FireflyBacklogTab';
import { ItemEditorModal } from '../components/catalog/ItemEditorModal';
import { SplitPriceEditor } from '../components/catalog/SplitPriceEditor';
import { SyncHistoryDrawer } from '../components/catalog/SyncHistoryDrawer';
import { SyncJobBadge } from '../components/catalog/SyncJobBadge';
import { TagHierarchyTab } from '../components/catalog/TagHierarchyTab';
import { formatProductBadge } from '../components/workbench/productUtils';
import { hasDismissibleFinishedJobs } from '../hooks/syncJobVisibility';
import { isSyncJobActive, useFireflySyncJobs } from '../hooks/useFireflySyncJobs';
import {
  DealAnalysis,
  PriceRecord,
  Product,
  Tag,
  TagImplication,
} from '../types';

type CatalogTab = 'items' | 'backlog' | 'tags' | 'analytics';

export const CatalogPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<CatalogTab>('items');
  const [products, setProducts] = useState<Product[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [implications, setImplications] = useState<TagImplication[]>([]);
  const [unassociatedCount, setUnassociatedCount] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [allItemCategories, setAllItemCategories] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Item Create / Edit Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [propagatingId, setPropagatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Price & History Modals
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [historyData, setHistoryData] = useState<{
    analysis: DealAnalysis | null;
    records: PriceRecord[];
  } | null>(null);

  const [priceFireflyAccountId, setPriceFireflyAccountId] = useState<number | null>(null);
  const [priceStoreName, setPriceStoreName] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [paidPrice, setPaidPrice] = useState('');
  const [isDiscount, setIsDiscount] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historySeqRef = useRef(0);

  const loadSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadAll = useCallback(async (silent: boolean = false) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const reqId = ++loadSeqRef.current;

    if (!silent) setLoading(true);
    try {
      const hasFilters = Boolean(
        debouncedSearch.trim() || selectedTagId || selectedCategory
      );
      const [prods, tgs, imps, syncStatus, ffCategories] = await Promise.all([
        api.products.list(
          {
            search: debouncedSearch.trim() || undefined,
            tag_id: selectedTagId || undefined,
            firefly_category_name: selectedCategory || undefined,
          },
          { signal: controller.signal }
        ),
        api.tags.list(),
        api.tags.listImplications(),
        api.fireflySync.getStatus(),
        api.categories.list().catch(() => [] as string[]),
      ]);
      if (controller.signal.aborted || reqId !== loadSeqRef.current) return;

      setProducts(prods);
      setTags(tgs);
      setImplications(imps);
      setUnassociatedCount(syncStatus.unassociated_count);

      setAllItemCategories(prev => {
        const names = new Set<string>(hasFilters ? prev : []);
        for (const cat of ffCategories) {
          if (cat) names.add(cat);
        }
        for (const p of prods) {
          if (p.firefly_category_name) names.add(p.firefly_category_name);
        }
        return Array.from(names).sort((a, b) => a.localeCompare(b));
      });
    } catch (err) {
      if (controller.signal.aborted || reqId !== loadSeqRef.current) return;
      console.error(err);
    } finally {
      if (reqId === loadSeqRef.current && !silent) setLoading(false);
    }
  }, [debouncedSearch, selectedTagId, selectedCategory]);

  const {
    jobs,
    activeJobs,
    jobsByProductId,
    unacknowledgedErrorCount,
    isDismissingAll,
    registerJob,
    dismissJob,
    dismissAllJobs,
  } = useFireflySyncJobs({
    onJobsChanged: async () => {
      await loadAll(true);
    },
  });

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    loadAll();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadAll]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setEditorOpen(true);
  };

  const openEditModal = (prod: Product) => {
    setEditingProduct(prod);
    setEditorOpen(true);
  };

  const handlePropagateItem = async (prod: Product) => {
    if (!prod.affected_firefly_count) return;
    if (
      !window.confirm(
        `Update ${prod.affected_firefly_count} linked transaction(s) in Firefly III for "${prod.name}"?`
      )
    ) {
      return;
    }
    setPropagatingId(prod.id);
    setCatalogNotice(null);
    setCatalogError(null);
    try {
      const job = await api.products.propagateFirefly(prod.id);
      registerJob(job);
      await loadAll(true);
    } catch (err) {
      setCatalogError(
        err instanceof Error ? err.message : 'Failed to start Firefly sync job'
      );
    } finally {
      setPropagatingId(null);
    }
  };

  const handleDeleteItem = async (prod: Product) => {
    if (
      !window.confirm(
        `Delete "${prod.name}" from the companion app? This does not touch Firefly III; any linked Firefly splits will simply return to the unassociated backlog.`
      )
    ) {
      return;
    }
    setDeletingId(prod.id);
    setCatalogNotice(null);
    setCatalogError(null);
    try {
      await api.products.delete(prod.id);
      setCatalogNotice(`Deleted "${prod.name}" from catalog.`);
      await loadAll();
    } catch (err) {
      setCatalogError(
        err instanceof Error ? err.message : 'Failed to delete item from catalog'
      );
    } finally {
      setDeletingId(null);
    }
  };

  const openPriceModal = (product: Product) => {
    setSelectedProduct(product);
    setPaidPrice('');
    setRegularPrice('');
    setIsDiscount(false);
    setQuantity('1');
    setPriceFireflyAccountId(null);
    setPriceStoreName('');
    setPriceError(null);
    setShowPriceModal(true);
  };

  const openHistoryModal = async (product: Product) => {
    const seq = ++historySeqRef.current;
    setHistoryData(null);
    setHistoryError(null);
    setSelectedProduct(product);
    setShowHistoryModal(true);
    try {
      const hist = await api.prices.getHistory(product.id);
      if (seq !== historySeqRef.current) return;
      setHistoryData({ analysis: hist.analysis, records: hist.records });
    } catch (err) {
      if (seq !== historySeqRef.current) return;
      setHistoryError(
        err instanceof Error ? err.message : 'Failed to load price history'
      );
    }
  };

  const handleRecordPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !priceFireflyAccountId || !paidPrice) return;

    const reg = parseFloat(regularPrice) || parseFloat(paidPrice);
    const paid = parseFloat(paidPrice);
    setSavingPrice(true);
    setPriceError(null);

    try {
      await api.prices.record({
        product_id: selectedProduct.id,
        firefly_account_id: priceFireflyAccountId,
        recorded_date: new Date().toISOString().split('T')[0],
        regular_price: reg,
        paid_price: paid,
        is_discount: isDiscount || paid < reg,
        quantity: parseFloat(quantity) || 1.0,
        unit: selectedProduct.default_unit,
      });

      setShowPriceModal(false);
      await openHistoryModal(selectedProduct);
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : 'Failed to record price');
    } finally {
      setSavingPrice(false);
    }
  };

  useEffect(() => {
    if (!showPriceModal && !showHistoryModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPriceModal(false);
        setShowHistoryModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPriceModal, showHistoryModal]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Canonical Items &amp; Firefly Sync
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage canonical items with fixed packaging, Firefly categories, and hierarchical
            tags, and reconcile historical Firefly transactions.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          New Item
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div className="flex items-center space-x-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('items')}
            className={`inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              activeTab === 'items'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5 mr-1.5" />
            Catalog Items ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('backlog')}
            className={`inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              activeTab === 'backlog'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5 mr-1.5" />
            Firefly Backlog
            <span
              className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'backlog'
                  ? 'bg-blue-500 text-white'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {unassociatedCount}
            </span>
            {activeJobs.length > 0 && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                <RefreshCw className="w-2.5 h-2.5 mr-1 animate-spin" />
                {activeJobs.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tags')}
            className={`inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              activeTab === 'tags'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 mr-1.5" />
            Tag Hierarchy ({tags.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              activeTab === 'analytics'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
            Tag Analytics
          </button>
        </div>

        <button
          ref={historyTriggerRef}
          type="button"
          onClick={() => setHistoryOpen(true)}
          className={`inline-flex items-center px-3 py-2 rounded-lg text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
            activeJobs.length > 0
              ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
              : unacknowledgedErrorCount > 0
              ? 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {activeJobs.length > 0 ? (
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-blue-600 animate-spin shrink-0" />
          ) : unacknowledgedErrorCount > 0 ? (
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-600 shrink-0" />
          ) : (
            <History className="w-3.5 h-3.5 mr-1.5 text-slate-500 shrink-0" />
          )}
          <span>Sync History</span>
          {activeJobs.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
              {activeJobs.length} active
            </span>
          )}
          {activeJobs.length === 0 && unacknowledgedErrorCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-600 text-white">
              {unacknowledgedErrorCount} {unacknowledgedErrorCount === 1 ? 'error' : 'errors'}
            </span>
          )}
        </button>
      </div>

      {catalogNotice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-2">
          <span>{catalogNotice}</span>
          <button
            type="button"
            onClick={() => setCatalogNotice(null)}
            className="p-0.5 rounded hover:bg-emerald-100 text-emerald-700 shrink-0"
            aria-label="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {catalogError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-2">
          <span>{catalogError}</span>
          <button
            type="button"
            onClick={() => setCatalogError(null)}
            className="p-0.5 rounded hover:bg-rose-100 text-rose-700 shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {activeTab === 'items' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search items by name..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {allItemCategories.length > 0 && (
              <select
                value={selectedCategory || ''}
                onChange={e => setSelectedCategory(e.target.value || null)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
              >
                <option value="">All Categories</option>
                {allItemCategories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Hierarchical Tag Filter Pills */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedTagId(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                selectedTagId === null
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Tags
            </button>
            {tags.map(tag => (
              <button
                key={tag.id}
                type="button"
                onClick={() =>
                  setSelectedTagId(selectedTagId === tag.id ? null : tag.id)
                }
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                  selectedTagId === tag.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                #{tag.name}
              </button>
            ))}
          </div>

          {/* Product Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {loading ? (
              <div className="col-span-full py-12 text-center text-slate-400">
                Loading catalog...
              </div>
            ) : products.length === 0 ? (
              <div className="col-span-full py-12 text-center text-slate-400 text-sm">
                No items match yet. Click &quot;New Item&quot; or link historical entries from{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('backlog')}
                  className="text-blue-600 font-semibold hover:underline"
                >
                  Firefly Backlog
                </button>
                .
              </div>
            ) : (
              products.map(p => {
                const directIds = new Set(p.tags.map(t => t.id));
                const effective = p.effective_tags && p.effective_tags.length > 0 ? p.effective_tags : p.tags;
                const itemJob = jobsByProductId[p.id];
                const itemJobActive = itemJob ? isSyncJobActive(itemJob) : false;
                return (
                  <div
                    key={p.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                              {p.brand?.name || 'Generic'}
                            </span>
                            {p.firefly_category_name && (
                              <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                                {p.firefly_category_name}
                              </span>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-slate-900 mt-1 truncate">
                            {p.name}
                          </h3>
                          <span className="text-xs text-slate-500 block">
                            {formatProductBadge(p)}
                          </span>
                          {p.firefly_description && (
                            <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                              FF: {p.firefly_description}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="p-2 rounded-lg bg-slate-50 hover:bg-blue-50 text-slate-500 hover:text-blue-600"
                            title="Edit item"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === p.id || itemJobActive}
                            onClick={() => handleDeleteItem(p)}
                            className="p-2 rounded-lg bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-40"
                            title={
                              itemJobActive
                                ? 'Cannot delete while Firefly sync job is running'
                                : 'Delete item'
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1">
                        {effective.map(t => (
                          <span
                            key={t.id}
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                              directIds.has(t.id)
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                            title={directIds.has(t.id) ? 'Direct tag' : 'Implied by hierarchy'}
                          >
                            {directIds.has(t.id) ? `#${t.name}` : `+${t.name}`}
                          </span>
                        ))}
                      </div>

                      {itemJob && (
                        <div className="mt-3">
                          <SyncJobBadge job={itemJob} onDismiss={dismissJob} compact />
                        </div>
                      )}
                    </div>

                    <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-3">
                        <button
                          type="button"
                          onClick={() => openHistoryModal(p)}
                          className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900"
                        >
                          <History className="w-3.5 h-3.5 mr-1" />
                          History
                        </button>
                        {(p.affected_firefly_count ?? 0) > 0 && (
                          <button
                            type="button"
                            disabled={propagatingId === p.id || itemJobActive}
                            onClick={() => handlePropagateItem(p)}
                            className="inline-flex items-center text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                            title="Push current item name, category & tags to linked Firefly transactions"
                          >
                            <RefreshCw
                              className={`w-3 h-3 mr-1 ${
                                propagatingId === p.id || itemJobActive ? 'animate-spin' : ''
                              }`}
                            />
                            {itemJobActive ? 'Syncing...' : `Sync ${p.affected_firefly_count} FF`}
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => openPriceModal(p)}
                        className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      >
                        <DollarSign className="w-3.5 h-3.5 mr-0.5" />
                        Log Price
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'backlog' && (
        <FireflyBacklogTab
          products={products}
          jobs={jobs}
          jobsByProductId={jobsByProductId}
          onJobStarted={registerJob}
          onDismissJob={dismissJob}
          onDismissAllJobs={dismissAllJobs}
          isDismissingAll={isDismissingAll}
          onDataChanged={() => loadAll(true)}
          onUnassociatedCountChange={setUnassociatedCount}
        />
      )}

      {activeTab === 'tags' && (
        <TagHierarchyTab
          tags={tags}
          implications={implications}
          onRefresh={() => loadAll(true)}
          onJobsStarted={startedJobs => startedJobs.forEach(registerJob)}
        />
      )}

      {activeTab === 'analytics' && (
        <CatalogAnalyticsTab
          tags={tags}
          availableCategories={allItemCategories}
        />
      )}

      {/* Create / Edit Item Modal */}
      <ItemEditorModal
        isOpen={editorOpen}
        editingProduct={editingProduct}
        onClose={() => setEditorOpen(false)}
        onSaved={() => loadAll(true)}
        onPropagationJobStarted={registerJob}
      />

      {/* Sync History Drawer */}
      <SyncHistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        liveJobs={jobs}
        hasDismissibleBanners={hasDismissibleFinishedJobs(jobs)}
        isDismissingAll={isDismissingAll}
        onDismissAll={dismissAllJobs}
        triggerRef={historyTriggerRef}
      />

      {/* Log Price Modal */}
      {showPriceModal && selectedProduct && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={e => {
            if (e.target === e.currentTarget) setShowPriceModal(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">
              Log Price for {selectedProduct.name}
            </h2>
            <form onSubmit={handleRecordPrice} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Store / Location
                </label>
                <StoreCombobox
                  required
                  value={priceFireflyAccountId}
                  accountNameHint={priceStoreName}
                  onChange={(id, name) => {
                    setPriceFireflyAccountId(id);
                    setPriceStoreName(name);
                  }}
                  placeholder="Search store / expense account..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Price Paid (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={paidPrice}
                    onChange={e => setPaidPrice(e.target.value)}
                    placeholder="0.99"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Regular Shelf Price (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={regularPrice}
                    onChange={e => setRegularPrice(e.target.value)}
                    placeholder="1.49"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="is_discount"
                  checked={
                    isDiscount ||
                    (Boolean(regularPrice) && parseFloat(paidPrice) < parseFloat(regularPrice))
                  }
                  onChange={e => setIsDiscount(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="is_discount" className="text-xs font-medium text-slate-700">
                  Bought on Discount / Special Offer
                </label>
              </div>

              {priceError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {priceError}
                </div>
              )}

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowPriceModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPrice}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
                >
                  {savingPrice ? 'Saving...' : 'Save Price'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Price History & Deal Analysis Modal */}
      {showHistoryModal && selectedProduct && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={e => {
            if (e.target === e.currentTarget) setShowHistoryModal(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-xl border border-slate-200 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{selectedProduct.name}</h2>
                <p className="text-xs text-slate-500">Price History &amp; Deal Scoring</p>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {historyError && (
              <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {historyError}
              </div>
            )}

            {historyData?.analysis && (
              <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">
                    Deal Quality Score
                  </span>
                  {historyData.analysis.deal_rating === 'ALL_TIME_LOW' ? (
                    <span className="inline-flex items-center text-xs font-bold text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full">
                      <Flame className="w-3.5 h-3.5 mr-1" /> Historic Low Price!
                    </span>
                  ) : historyData.analysis.deal_rating === 'GREAT_DEAL' ? (
                    <span className="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Great Deal (-
                      {historyData.analysis.discount_pct}%)
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                      Standard Baseline
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">Latest Paid</span>
                    <strong className="text-slate-900 text-sm">
                      €{historyData.analysis.current_price.toFixed(2)}
                    </strong>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">Normal Baseline</span>
                    <strong className="text-slate-900 text-sm">
                      €{historyData.analysis.baseline_regular_price.toFixed(2)}
                    </strong>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">All-Time Low</span>
                    <strong className="text-emerald-700 text-sm">
                      €{historyData.analysis.all_time_low.toFixed(2)}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {!historyData ? (
              <div className="mt-4 p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-400">
                Loading price history...
              </div>
            ) : (
              <ProductPriceChart
                records={historyData.records}
                analysis={historyData.analysis}
                defaultUnit={selectedProduct.default_unit}
              />
            )}

            <div className="mt-5 space-y-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Recorded Prices
              </h3>
              {!historyData?.records || historyData.records.length === 0 ? (
                <p className="text-xs text-slate-400">No prices recorded yet.</p>
              ) : (
                [...historyData.records].reverse().map(r => (
                  <div
                    key={r.id}
                    className="p-3 bg-slate-50 rounded-lg space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-800">
                          {r.store_name || `Store #${r.firefly_account_id}`}
                        </span>
                        <span className="block text-slate-400 text-[10px]">
                          {r.recorded_date}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center space-x-1.5 justify-end">
                          <strong className="text-sm text-slate-900">
                            €{r.paid_price.toFixed(2)}
                          </strong>
                          {r.is_discount && (
                            <span className="text-[10px] text-amber-700 bg-amber-100 font-semibold px-1.5 py-0.2 rounded">
                              SALE{r.regular_price > r.paid_price ? ` (reg €${r.regular_price.toFixed(2)})` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <SplitPriceEditor
                      priceRecordId={r.id}
                      paidPrice={r.paid_price}
                      regularPrice={r.regular_price}
                      isDiscount={r.is_discount}
                      quantity={r.quantity}
                      unit={r.unit}
                      packageSize={r.package_size ?? selectedProduct.package_size}
                      normalizedUnitPrice={r.normalized_unit_price}
                      verificationStatus={r.verification_status ?? 'verified'}
                      onSaved={() => openHistoryModal(selectedProduct)}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
