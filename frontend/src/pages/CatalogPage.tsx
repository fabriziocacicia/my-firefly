import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Product, Tag, PriceRecord, DealAnalysis } from '../types';
import { Package, Plus, Flame, ThumbsUp, DollarSign, History } from 'lucide-react';
import { ProductPriceChart } from '../components/charts/ProductPriceChart';
import { StoreCombobox } from '../components/common/StoreCombobox';

export const CatalogPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);

  // Modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [historyData, setHistoryData] = useState<{ analysis: DealAnalysis | null; records: PriceRecord[] } | null>(null);

  // New product form
  const [newProductName, setNewProductName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [newDefaultUnit, setNewDefaultUnit] = useState('g');
  const [newPackageSize, setNewPackageSize] = useState('500');
  const [newSelectedTagIds, setNewSelectedTagIds] = useState<number[]>([]);

  // New tag form
  const [newTagName, setNewTagName] = useState('');
  const newTagGroup = 'Category';

  // New price log form
  const [priceFireflyAccountId, setPriceFireflyAccountId] = useState<number | null>(null);
  const [priceStoreName, setPriceStoreName] = useState<string>('');
  const [regularPrice, setRegularPrice] = useState('');
  const [paidPrice, setPaidPrice] = useState('');
  const [isDiscount, setIsDiscount] = useState(false);
  const [quantity, setQuantity] = useState('1');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [prods, tgs] = await Promise.all([
        api.products.list({ search: search || undefined, tag_id: selectedTagId || undefined }),
        api.tags.list(),
      ]);
      setProducts(prods);
      setTags(tgs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [search, selectedTagId]);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;

    let brandId: number | undefined = undefined;
    if (newBrandName.trim()) {
      const brand = await api.products.createBrand({ name: newBrandName.trim() });
      brandId = brand.id;
    }

    await api.products.create({
      name: newProductName.trim(),
      brand_id: brandId,
      default_unit: newDefaultUnit,
      package_size: parseFloat(newPackageSize) || 1.0,
      tag_ids: newSelectedTagIds
    });

    setShowProductModal(false);
    setNewProductName('');
    setNewBrandName('');
    loadAll();
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    const tag = await api.tags.create({ name: newTagName.trim(), group: newTagGroup });
    setTags([...tags, tag]);
    setNewSelectedTagIds([...newSelectedTagIds, tag.id]);
    setNewTagName('');
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
      unit: selectedProduct.default_unit
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Products & Price Intelligence</h1>
          <p className="text-sm text-slate-500 mt-1">
            Track products, brands, multi-dimensional tags (e.g. Organic, Whole, Fruit), and evaluate deals against baseline prices.
          </p>
        </div>
        <button
          onClick={() => setShowProductModal(true)}
          className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add Product
        </button>
      </div>

      {/* Tag Filter Pills */}
      <div className="mt-6 flex items-center space-x-2 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedTagId(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
            selectedTagId === null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          All Items
        </button>
        {tags.map(tag => (
          <button
            key={tag.id}
            onClick={() => setSelectedTagId(selectedTagId === tag.id ? null : tag.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
              selectedTagId === tag.id ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            }`}
          >
            #{tag.name}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full py-12 text-center text-slate-400">Loading catalog...</div>
        ) : products.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-400">
            No products in your catalog yet. Click "Add Product" to get started!
          </div>
        ) : (
          products.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                    {p.brand?.name || 'Generic / Brandless'}
                  </span>
                  <h3 className="text-base font-semibold text-slate-900 mt-0.5">{p.name}</h3>
                  <span className="text-xs text-slate-400">
                    Package: {p.package_size} {p.default_unit}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 text-slate-500">
                  <Package className="w-5 h-5" />
                </div>
              </div>

              {/* Tags */}
              <div className="mt-3 flex flex-wrap gap-1">
                {p.tags.map(t => (
                  <span key={t.id} className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                    {t.name}
                  </span>
                ))}
              </div>

              {/* Actions */}
              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => openHistoryModal(p)}
                  className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  <History className="w-3.5 h-3.5 mr-1" />
                  Price History
                </button>
                <button
                  onClick={() => openPriceModal(p)}
                  className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                >
                  <DollarSign className="w-3.5 h-3.5 mr-0.5" />
                  Log Price
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900">Add New Product</h2>
            <form onSubmit={handleCreateProduct} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={newProductName}
                  onChange={e => setNewProductName(e.target.value)}
                  placeholder="e.g. Spaghetti N.5, Organic Bananas, Bagnoschiuma"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Brand</label>
                <input
                  type="text"
                  value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)}
                  placeholder="e.g. De Cecco, Barilla, Conad Smart, Chanteclair"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Package Size</label>
                  <input
                    type="number"
                    step="any"
                    value={newPackageSize}
                    onChange={e => setNewPackageSize(e.target.value)}
                    placeholder="500"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Unit of Measure</label>
                  <select
                    value={newDefaultUnit}
                    onChange={e => setNewDefaultUnit(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="g">Grams (g → €/kg)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="ml">Milliliters (ml → €/L)</option>
                    <option value="l">Liters (L)</option>
                    <option value="pcs">Pieces (pcs)</option>
                  </select>
                </div>
              </div>

              {/* Tag Picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tags & Classifications</label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 rounded-lg border border-slate-200 max-h-28 overflow-y-auto">
                  {tags.map(t => {
                    const isSelected = newSelectedTagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setNewSelectedTagIds(newSelectedTagIds.filter(id => id !== t.id));
                          } else {
                            setNewSelectedTagIds([...newSelectedTagIds, t.id]);
                          }
                        }}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border border-slate-300'
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>

                {/* Quick Add Tag */}
                <div className="mt-2 flex space-x-2">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    placeholder="New tag (e.g. Organic, Whole Grain)..."
                    className="flex-1 px-2.5 py-1 text-xs border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={handleCreateTag}
                    className="px-2.5 py-1 text-xs bg-slate-200 text-slate-700 rounded-md hover:bg-slate-300 font-medium"
                  >
                    + Add Tag
                  </button>
                </div>
              </div>

              <div className="pt-4 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Price Modal */}
      {showPriceModal && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">Log Price for {selectedProduct.name}</h2>
            <form onSubmit={handleRecordPrice} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Store / Location</label>
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Price Paid (€)</label>
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Regular Shelf Price (€)</label>
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
                  checked={isDiscount || (Boolean(regularPrice) && parseFloat(paidPrice) < parseFloat(regularPrice))}
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
                <p className="text-xs text-slate-500">Price History & Deal Scoring</p>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            {/* Deal Analysis Card */}
            {historyData?.analysis && (
              <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">Deal Quality Score</span>
                  {historyData.analysis.deal_rating === 'ALL_TIME_LOW' ? (
                    <span className="inline-flex items-center text-xs font-bold text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full">
                      <Flame className="w-3.5 h-3.5 mr-1" /> Historic Low Price!
                    </span>
                  ) : historyData.analysis.deal_rating === 'GREAT_DEAL' ? (
                    <span className="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                      <ThumbsUp className="w-3.5 h-3.5 mr-1" /> Great Deal (-{historyData.analysis.discount_pct}%)
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
                    <strong className="text-slate-900 text-sm">€{historyData.analysis.current_price.toFixed(2)}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">Normal Baseline</span>
                    <strong className="text-slate-900 text-sm">€{historyData.analysis.baseline_regular_price.toFixed(2)}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">All-Time Low</span>
                    <strong className="text-emerald-700 text-sm">€{historyData.analysis.all_time_low.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Normalized Price Trend Chart */}
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

            {/* List of price logs */}
            <div className="mt-5 space-y-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Recorded Prices</h3>
              {(!historyData?.records || historyData.records.length === 0) ? (
                <p className="text-xs text-slate-400">No prices recorded yet.</p>
              ) : (
                [...historyData.records].reverse().map(r => (
                  <div key={r.id} className="p-3 bg-slate-50 rounded-lg flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-800">{r.store_name || `Store #${r.firefly_account_id}`}</span>
                      <span className="block text-slate-400 text-[10px]">{r.recorded_date}</span>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center space-x-1.5 justify-end">
                        <strong className="text-sm text-slate-900">€{r.paid_price.toFixed(2)}</strong>
                        {r.is_discount && (
                          <span className="text-[10px] text-amber-700 bg-amber-100 font-semibold px-1.5 py-0.2 rounded">
                            SALE
                          </span>
                        )}
                      </div>
                      {r.normalized_unit_price && (
                        <span className="text-[10px] text-slate-500 font-medium block">
                          €{r.normalized_unit_price.toFixed(2)} / {selectedProduct.default_unit === 'g' ? 'kg' : selectedProduct.default_unit === 'ml' ? 'L' : selectedProduct.default_unit}
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
