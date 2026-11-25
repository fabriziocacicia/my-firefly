import React, { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { api } from '../../api/client';
import { Company } from '../../types';
import { BusinessTypesTagInput } from '../common/BusinessTypesTagInput';

interface ChainFormModalProps {
  company: Company | null;
  allAvailableBusinessTypes: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const ChainFormModal: React.FC<ChainFormModalProps> = ({
  company,
  allAvailableBusinessTypes,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState(company?.name ?? '');
  const [businessTypes, setBusinessTypes] = useState<string[]>(
    company?.business_types ?? []
  );
  const [notes, setNotes] = useState(company?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        business_types: businessTypes,
        notes: notes.trim() || undefined,
      };

      if (company) {
        await api.companies.update(company.id, payload);
      } else {
        await api.companies.create(payload);
      }

      await onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save chain');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chain-form-title"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
        <div className="flex items-start justify-between">
          <h2 id="chain-form-title" className="text-lg font-bold text-slate-900">
            {company ? 'Edit Chain' : 'New Parent Chain'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Chain Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Conad, Carrefour, Lidl, Eni"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Chain Business Types
            </label>
            <BusinessTypesTagInput
              value={businessTypes}
              onChange={setBusinessTypes}
              allAvailableTypes={allAvailableBusinessTypes}
              placeholder="e.g. Supermarket, Gas Station, Pharmacy..."
            />
            <p className="mt-1 text-[11px] text-slate-400">
              All branches linked to this chain will automatically inherit these business
              types.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this retail chain..."
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="pt-3 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              {saving ? 'Saving...' : company ? 'Update Chain' : 'Create Chain'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
