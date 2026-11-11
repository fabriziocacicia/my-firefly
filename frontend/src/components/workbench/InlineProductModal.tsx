import React, { useEffect, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { Brand, MeasureUnit, Product } from '../../types';

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
  const [defaultUnit, setDefaultUnit] = useState<MeasureUnit>('g');
  const [packageSize, setPackageSize] = useState('500');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    setSelectedBrandId('');
    setNewBrandName('');
    setShowNewBrand(false);
    setDefaultUnit('g');
    setPackageSize('500');
    setError(null);

    api.products
      .listBrands()
      .then(setBrands)
      .catch(err => console.error('Failed to load brands:', err));
  }, [isOpen, initialName]);

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
    const pkg = parseFloat(packageSize);
    if (!pkg || pkg <= 0) {
      setError('Package size must be greater than zero.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      let brandId: number | undefined = selectedBrandId ? Number(selectedBrandId) : undefined;
      if (showNewBrand && newBrandName.trim()) {
        const createdBrand = await api.products.createBrand({ name: newBrandName.trim() });
        brandId = createdBrand.id;
      }

      const product = await api.products.create({
        name: name.trim(),
        brand_id: brandId,
        default_unit: defaultUnit,
        package_size: pkg,
        tag_ids: [],
      });
      onCreated(product);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">Quick Add Product</h2>
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
              Product Name *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Penne Rigate N.41"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700">Brand</label>
              <button
                type="button"
                onClick={() => setShowNewBrand(v => !v)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                {showNewBrand ? 'Choose existing' : '+ New Brand'}
              </button>
            </div>

            {showNewBrand ? (
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)}
                  placeholder="New brand name..."
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <button
                  type="button"
                  onClick={handleQuickCreateBrand}
                  className="px-3 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-900 inline-flex items-center"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Default Unit
              </label>
              <select
                value={defaultUnit}
                onChange={e => {
                  const next = e.target.value as MeasureUnit;
                  setDefaultUnit(next);
                  if (next === 'g' || next === 'ml') setPackageSize('500');
                  else setPackageSize('1');
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="g">Grams (g → €/kg)</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="ml">Milliliters (ml → €/L)</option>
                <option value="l">Liters (L)</option>
                <option value="pcs">Pieces (pcs)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Package Size
              </label>
              <input
                type="number"
                step="any"
                min="0.001"
                required
                value={packageSize}
                onChange={e => setPackageSize(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
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
