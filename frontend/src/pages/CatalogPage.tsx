import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
} from 'lucide-react';
import { api } from '../api/client';
import { ProductPriceChart } from '../components/charts/ProductPriceChart';
import { StoreCombobox } from '../components/common/StoreCombobox';
import { CatalogAnalyticsTab } from '../components/catalog/CatalogAnalyticsTab';
import { FireflyBacklogTab } from '../components/catalog/FireflyBacklogTab';
import { ItemEditorModal } from '../components/catalog/ItemEditorModal';
import { TagHierarchyTab } from '../components/catalog/TagHierarchyTab';
import { formatProductBadge } from '../components/workbench/productUtils';
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
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Item Create / Edit Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [propagatingId, setPropagatingId] = useState<number | null>(null);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);

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

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, tgs, imps, syncStatus] = await Promise.all([
        api.products.list({
          search: search.trim() || undefined,
          tag_id: selectedTagId || undefined,
          firefly_category_name: selectedCategory || undefined,
        }),
        api.tags.list(),
        api.tags.listImplications(),
        api.fireflySync.getStatus(),
      ]);
      setProducts(prods);
      setTags(tgs);
      setImplications(imps);
      setUnassociatedCount(syncStatus.unassociated_count);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, selectedTagId, selectedCategory]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const distinctItemCategories = useMemo(() => {
    const names = new Set<string>();
    for (const p of products) {
      if (p.firefly_category_name) names.add(p.firefly_category_name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [products]);

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
    try {
      const res = await api.products.propagateFirefly(prod.id);
      setCatalogNotice(
        `Updated ${res.updated_transactions} Firefly transaction(s) for "${prod.name}".`
      );
      await loadAll();
    } catch (err) {
      console.error(err);
    } finally {
      setPropagatingId(null);
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
    setShowPriceModal(true);
  };

  const handleRecordPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !priceFireflyAccountId || !paidPrice) return;

    const reg = parseFloat(regularPrice) || parseFloat(paidPrice);
    const paid = parseFloat(paidPrice);

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
    openHistoryModal(selectedProduct);
  };

  const openHistoryModal = async (product: Product) => {
    setHistoryData(null);
    setSelectedProduct(product);
    setShowHistoryModal(true);
    const hist = await api.prices.getHistory(product.id);
    setHistoryData({ analysis: hist.analysis, records: hist.records });
  };

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
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-3 overflow-x-auto">
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

      {catalogNotice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          {catalogNotice}
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
            {distinctItemCategories.length > 0 && (
              <select
                value={selectedCategory || ''}
                onChange={e => setSelectedCategory(e.target.value || null)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
              >
                <option value="">All Categories</option>
                {distinctItemCategories.map(cat => (
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
                          <span className="text-xs text-slate-500">
                            {formatProductBadge(p)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className="p-2 rounded-lg bg-slate-50 hover:bg-blue-50 text-slate-500 hover:text-blue-600 shrink-0"
                          title="Edit item"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
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
                            disabled={propagatingId === p.id}
                            onClick={() => handlePropagateItem(p)}
                            className="inline-flex items-center text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                            title="Push current item name, category & tags to linked Firefly transactions"
                          >
                            <RefreshCw
                              className={`w-3 h-3 mr-1 ${
                                propagatingId === p.id ? 'animate-spin' : ''
                              }`}
                            />
                            Sync {p.affected_firefly_count} FF
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
          onDataChanged={loadAll}
          onUnassociatedCountChange={setUnassociatedCount}
        />
      )}

      {activeTab === 'tags' && (
        <TagHierarchyTab
          tags={tags}
          implications={implications}
          onRefresh={loadAll}
        />
      )}

      {activeTab === 'analytics' && (
        <CatalogAnalyticsTab
          tags={tags}
          availableCategories={distinctItemCategories}
        />
      )}

      {/* Create / Edit Item Modal */}
      <ItemEditorModal
        isOpen={editorOpen}
        editingProduct={editingProduct}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          loadAll();
        }}
      />

      {/* Log Price Modal */}
      {showPriceModal && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
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
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                >
                  Save Price
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Price History & Deal Analysis Modal */}
      {showHistoryModal && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
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
              >
                &times;
              </button>
            </div>

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
                    className="p-3 bg-slate-50 rounded-lg flex items-center justify-between text-xs"
                  >
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
                            SALE
                          </span>
                        )}
                      </div>
                      {r.normalized_unit_price && (
                        <span className="text-[10px] text-slate-500 font-medium block">
                          €{r.normalized_unit_price.toFixed(2)} /{' '}
                          {selectedProduct.default_unit === 'g'
                            ? 'kg'
                            : selectedProduct.default_unit === 'ml'
                            ? 'L'
                            : selectedProduct.default_unit}
                        </span>
                      )}
                    </div>
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
