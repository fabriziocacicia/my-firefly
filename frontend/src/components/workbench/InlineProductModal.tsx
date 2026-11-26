import React, { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
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
import { TagMultiCombobox } from '../common/TagMultiCombobox';
import { formatFireflyDescriptionPreview } from './productUtils';

interface InlineProductModalProps {
  isOpen: boolean;
  initialName?: string;
  onClose: () => void;
  onCreated: (product: Product) => void;
}

export const InlineProductModal: React.FC<InlineProductModalProps> = ({
  isOpen,
  initialName = '',
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState(initialName);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [newBrandName, setNewBrandName] = useState('');
  const [showNewBrand, setShowNewBrand] = useState(false);

  const [saleMode, setSaleMode] = useState<SaleMode>('packaged');
  const [packCount, setPackCount] = useState('1');
  const [unitSize, setUnitSize] = useState('500');
  const [defaultUnit, setDefaultUnit] = useState<MeasureUnit>('g');

  const [categories, setCategories] = useState<FireflyCategoryBrief[]>([]);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');

  const [tags, setTags] = useState<Tag[]>([]);
  const [implications, setImplications] = useState<TagImplication[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    setSelectedBrandId('');
    setNewBrandName('');
    setShowNewBrand(false);
    setSaleMode('packaged');
    setPackCount('1');
    setUnitSize('500');
    setDefaultUnit('g');
    setSelectedCategoryName('');
    setSelectedTagIds([]);
    setError(null);

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
  }, [isOpen, initialName]);

  const activeBrandName = useMemo(() => {
    if (showNewBrand && newBrandName.trim()) return newBrandName.trim();
    return brands.find(b => String(b.id) === selectedBrandId)?.name || null;
  }, [showNewBrand, newBrandName, brands, selectedBrandId]);

  const fireflyPreview = useMemo(
    () =>
      formatFireflyDescriptionPreview({
        name,
        brandName: activeBrandName,
        saleMode,
        packCount: parseInt(packCount, 10) || 1,
        unitSize: parseFloat(unitSize) || 1,
        defaultUnit,
      }),
    [name, activeBrandName, saleMode, packCount, unitSize, defaultUnit]
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
      let brandId: number | undefined = selectedBrandId ? Number(selectedBrandId) : undefined;
      if (showNewBrand && newBrandName.trim()) {
        const createdBrand = await api.products.createBrand({ name: newBrandName.trim() });
        brandId = createdBrand.id;
      }

      const matchedCategory = categories.find(
        c => c.name.toLowerCase() === selectedCategoryName.trim().toLowerCase()
      );

      const product = await api.products.create({
        name: name.trim(),
        brand_id: brandId,
        sale_mode: saleMode,
        pack_count: parsedPackCount,
        unit_size: parsedUnitSize,
        default_unit: defaultUnit,
        firefly_category_id: matchedCategory?.id ?? null,
        firefly_category_name: selectedCategoryName.trim() || null,
        tag_ids: selectedTagIds,
      });
      onCreated(product);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create item');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">Quick Add Canonical Item</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Item Name (without brand or size) *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Fusilli Integrali Bio, Uova Bio, Mele Rosse"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {fireflyPreview && (
              <p className="mt-1 text-[11px] text-slate-500">
                Firefly transaction title:{' '}
                <strong className="text-slate-800">{fireflyPreview}</strong>
              </p>
            )}
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
              <span className="text-xs font-semibold text-slate-700">Sale Mode &amp; Packaging</span>
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

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Firefly Tags
            </label>
            <TagMultiCombobox
              tags={tags}
              implications={implications}
              selectedTagIds={selectedTagIds}
              onChange={setSelectedTagIds}
              onTagCreated={created =>
                setTags(prev => (prev.some(t => t.id === created.id) ? prev : [...prev, created]))
              }
            />
          </div>

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
              {submitting ? 'Creating...' : 'Create & Select'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
