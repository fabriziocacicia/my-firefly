import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Package, Plus, RefreshCw, Tag as TagIcon } from 'lucide-react';
import { api } from '../../api/client';
import {
  Brand,
  FireflyCategoryBrief,
  MeasureUnit,
  Product,
  SaleMode,
  Tag,
  TagImplication,
} from '../../types';
import { getEffectiveTagsForIds } from '../workbench/productUtils';

interface ItemEditorModalProps {
  isOpen: boolean;
  editingProduct?: Product | null;
  initialName?: string;
  initialCategoryName?: string | null;
  onClose: () => void;
  onSaved: (product: Product, wasEdited: boolean) => void;
}

export const ItemEditorModal: React.FC<ItemEditorModalProps> = ({
  isOpen,
  editingProduct = null,
  initialName = '',
  initialCategoryName = null,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [showNewBrand, setShowNewBrand] = useState(false);

  const [saleMode, setSaleMode] = useState<SaleMode>('packaged');
  const [packCount, setPackCount] = useState('1');
  const [unitSize, setUnitSize] = useState('500');
  const [defaultUnit, setDefaultUnit] = useState<MeasureUnit>('g');

  const [categories, setCategories] = useState<FireflyCategoryBrief[]>([]);
  const [selectedCategoryName, setSelectedCategoryName] = useState('');

  const [tags, setTags] = useState<Tag[]>([]);
  const [implications, setImplications] = useState<TagImplication[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Explicit Firefly propagation confirmation step after editing an already-linked item
  const [pendingPropagationProduct, setPendingPropagationProduct] = useState<Product | null>(null);
  const [propagating, setPropagating] = useState(false);
  const [propagationNotice, setPropagationNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPendingPropagationProduct(null);
    setPropagationNotice(null);
    setError(null);
    setNewBrandName('');
    setShowNewBrand(false);
    setNewTagName('');

    if (editingProduct) {
      setName(editingProduct.name);
      setSelectedBrandId(editingProduct.brand_id ? String(editingProduct.brand_id) : '');
      setSaleMode(editingProduct.sale_mode || 'packaged');
      setPackCount(String(editingProduct.pack_count || 1));
      setUnitSize(String(editingProduct.unit_size || editingProduct.package_size || 1));
      setDefaultUnit((editingProduct.default_unit as MeasureUnit) || 'g');
      setSelectedCategoryName(editingProduct.firefly_category_name || '');
      setSelectedTagIds(editingProduct.tags.map(t => t.id));
    } else {
      setName(initialName);
      setSelectedBrandId('');
      setSaleMode('packaged');
      setPackCount('1');
      setUnitSize('500');
      setDefaultUnit('g');
      setSelectedCategoryName(initialCategoryName || '');
      setSelectedTagIds([]);
    }

    Promise.allSettled([
      api.products.listBrands(),
      api.firefly.getCategories(),
      api.tags.list(),
      api.tags.listImplications(),
    ]).then(([brandsRes, catsRes, tagsRes, impsRes]) => {
      if (brandsRes.status === 'fulfilled') setBrands(brandsRes.value);
      if (catsRes.status === 'fulfilled') setCategories(catsRes.value);
      if (tagsRes.status === 'fulfilled') setTags(tagsRes.value);
      if (impsRes.status === 'fulfilled') setImplications(impsRes.value);
    });
  }, [isOpen, editingProduct, initialName, initialCategoryName]);

  const effectiveTagPreview = useMemo(
    () => getEffectiveTagsForIds(selectedTagIds, tags, implications),
    [selectedTagIds, tags, implications]
  );

  if (!isOpen) return null;

  const handleQuickCreateBrand = async () => {
    if (!newBrandName.trim()) return;
    try {
      const created = await api.products.createBrand({ name: newBrandName.trim() });
      setBrands(prev => (prev.some(b => b.id === created.id) ? prev : [...prev, created]));
      setSelectedBrandId(String(created.id));
      setNewBrandName('');
      setShowNewBrand(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create brand');
    }
  };

  const handleQuickCreateTag = async () => {
    if (!newTagName.trim()) return;
    setAddingTag(true);
    setError(null);
    try {
      const created = await api.tags.create({ name: newTagName.trim() });
      setTags(prev => (prev.some(t => t.id === created.id) ? prev : [...prev, created]));
      setSelectedTagIds(prev => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setNewTagName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Firefly tag');
    } finally {
      setAddingTag(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const parsedPackCount = saleMode === 'loose_weight' ? 1 : parseInt(packCount, 10);
    const parsedUnitSize = saleMode === 'loose_weight' ? 1 : parseFloat(unitSize);

    if (saleMode === 'packaged') {
      if (isNaN(parsedPackCount) || parsedPackCount < 1) {
        setError('Pack count must be at least 1.');
        return;
      }
      if (isNaN(parsedUnitSize) || parsedUnitSize <= 0) {
        setError('Unit size must be greater than zero.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      let brandId: number | null = selectedBrandId ? Number(selectedBrandId) : null;
      if (showNewBrand && newBrandName.trim()) {
        const createdBrand = await api.products.createBrand({ name: newBrandName.trim() });
        brandId = createdBrand.id;
      }

      const matchedCat = categories.find(
        c => c.name.toLowerCase() === selectedCategoryName.trim().toLowerCase()
      );

      if (editingProduct) {
        const updated = await api.products.update(editingProduct.id, {
          name: name.trim(),
          brand_id: brandId,
          sale_mode: saleMode,
          pack_count: parsedPackCount,
          unit_size: parsedUnitSize,
          default_unit: defaultUnit,
          firefly_category_id: matchedCat?.id ?? null,
          firefly_category_name: selectedCategoryName.trim() || null,
          tag_ids: selectedTagIds,
        });
        onSaved(updated, true);
        if ((updated.affected_firefly_count ?? 0) > 0) {
          setPendingPropagationProduct(updated);
        } else {
          onClose();
        }
      } else {
        const created = await api.products.create({
          name: name.trim(),
          brand_id: brandId ?? undefined,
          sale_mode: saleMode,
          pack_count: parsedPackCount,
          unit_size: parsedUnitSize,
          default_unit: defaultUnit,
          firefly_category_id: matchedCat?.id ?? null,
          firefly_category_name: selectedCategoryName.trim() || null,
          tag_ids: selectedTagIds,
        });
        onSaved(created, false);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPropagate = async () => {
    if (!pendingPropagationProduct) return;
    setPropagating(true);
    setError(null);
    try {
      const res = await api.products.propagateFirefly(pendingPropagationProduct.id);
      if (res.failed_transactions.length > 0) {
        setError(
          `Updated ${res.updated_transactions} transaction(s), ${res.failed_transactions.length} failed.`
        );
      } else {
        setPropagationNotice(
          `Updated ${res.updated_transactions} linked Firefly transaction(s) (${res.updated_splits} splits).`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Firefly III');
    } finally {
      setPropagating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">
              {editingProduct ? 'Edit Canonical Item' : 'New Canonical Item'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold"
          >
            &times;
          </button>
        </div>

        {pendingPropagationProduct ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 space-y-1">
                <p className="font-bold text-sm">
                  Propagate changes to Firefly III?
                </p>
                <p>
                  <strong>{pendingPropagationProduct.name}</strong> has{' '}
                  <strong>{pendingPropagationProduct.affected_firefly_count}</strong> linked
                  transaction(s) in Firefly III. Confirm if you want to overwrite their
                  description, category, and expanded tags to match this item card.
                </p>
              </div>
            </div>

            {propagationNotice && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />
                {propagationNotice}
              </div>
            )}

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {propagationNotice ? 'Close' : 'Skip (Keep Local Only)'}
              </button>
              {!propagationNotice && (
                <button
                  type="button"
                  disabled={propagating}
                  onClick={handleConfirmPropagate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold inline-flex items-center"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${propagating ? 'animate-spin' : ''}`} />
                  {propagating
                    ? 'Updating Firefly...'
                    : `Update ${pendingPropagationProduct.affected_firefly_count} Firefly Transaction(s)`}
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Canonical Item Name *
              </label>
              <input
                type="text"
                required
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Mele Rosse Bio 600g, Pasta Barilla Fusilli 1kg"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">Brand</label>
                  <button
                    type="button"
                    onClick={() => setShowNewBrand(v => !v)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {showNewBrand ? 'Choose existing' : '+ New'}
                  </button>
                </div>
                {showNewBrand ? (
                  <div className="flex space-x-1.5">
                    <input
                      type="text"
                      value={newBrandName}
                      onChange={e => setNewBrandName(e.target.value)}
                      placeholder="Brand..."
                      className="flex-1 min-w-0 px-2.5 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleQuickCreateBrand}
                      className="px-2.5 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-900"
                    >
                      Add
                    </button>
                  </div>
                ) : (
                  <select
                    value={selectedBrandId}
                    onChange={e => setSelectedBrandId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">No Brand / Generic</option>
                    {brands.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Firefly Category
                </label>
                <select
                  value={selectedCategoryName}
                  onChange={e => setSelectedCategoryName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">No Category</option>
                  {selectedCategoryName &&
                    !categories.some(
                      c => c.name.toLowerCase() === selectedCategoryName.toLowerCase()
                    ) && (
                      <option value={selectedCategoryName}>{selectedCategoryName}</option>
                    )}
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Sale Mode & Packaging
                </span>
                <div className="inline-flex rounded-lg bg-slate-200/80 p-0.5 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setSaleMode('packaged')}
                    className={`px-2.5 py-1 rounded-md transition ${
                      saleMode === 'packaged'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Packaged
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaleMode('loose_weight');
                      if (defaultUnit === 'pcs') setDefaultUnit('kg');
                    }}
                    className={`px-2.5 py-1 rounded-md transition ${
                      saleMode === 'loose_weight'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Loose Weight
                  </button>
                </div>
              </div>

              {saleMode === 'packaged' ? (
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Units / Pack
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={packCount}
                      onChange={e => setPackCount(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Size / Unit
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      required
                      value={unitSize}
                      onChange={e => setUnitSize(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Measure
                    </label>
                    <select
                      value={defaultUnit}
                      onChange={e => setDefaultUnit(e.target.value as MeasureUnit)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="g">g (→ €/kg)</option>
                      <option value="kg">kg</option>
                      <option value="ml">ml (→ €/L)</option>
                      <option value="l">L</option>
                      <option value="pcs">pcs</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Weighed Unit
                  </label>
                  <select
                    value={defaultUnit}
                    onChange={e => setDefaultUnit(e.target.value as MeasureUnit)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
                  >
                    <option value="kg">kg</option>
                    <option value="g">g (→ €/kg)</option>
                    <option value="l">L</option>
                    <option value="ml">ml (→ €/L)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Firefly Tags</label>
              <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 rounded-lg border border-slate-200 max-h-28 overflow-y-auto">
                {tags.length === 0 ? (
                  <span className="text-xs text-slate-400">
                    No tags synced yet. Add one below or sync from Tag Hierarchy.
                  </span>
                ) : (
                  tags.map(t => {
                    const selected = selectedTagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setSelectedTagIds(prev =>
                            selected ? prev.filter(id => id !== t.id) : [...prev, t.id]
                          )
                        }
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
                          selected
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })
                )}
              </div>

              {effectiveTagPreview.implied.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                  <TagIcon className="w-3 h-3 text-emerald-600" />
                  <span>Auto-implied on Firefly:</span>
                  {effectiveTagPreview.implied.map(t => (
                    <span
                      key={t.id}
                      className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium"
                    >
                      +{t.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  placeholder="New Firefly tag..."
                  className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  disabled={addingTag || !newTagName.trim()}
                  onClick={handleQuickCreateTag}
                  className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:bg-slate-300 font-semibold inline-flex items-center"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  {addingTag ? 'Adding...' : 'Add Tag'}
                </button>
              </div>
            </div>

            {editingProduct?.aliases && editingProduct.aliases.length > 0 && (
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                <span className="font-semibold block mb-1">Linked Firefly Aliases:</span>
                <div className="flex flex-wrap gap-1">
                  {editingProduct.aliases.map(a => (
                    <span key={a.id} className="bg-white border border-slate-200 px-2 py-0.5 rounded">
                      {a.raw_description}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {error}
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
                type="submit"
                disabled={submitting || !name.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold"
              >
                {submitting ? 'Saving...' : editingProduct ? 'Save Changes' : 'Create Item'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
