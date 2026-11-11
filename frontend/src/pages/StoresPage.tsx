import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { FireflyExpenseAccount, Company } from '../types';
import { Building2, Store, Search, RefreshCw } from 'lucide-react';

export const StoresPage: React.FC = () => {
  const [accounts, setAccounts] = useState<FireflyExpenseAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unmapped' | 'mapped'>('all');

  // Mapping modal state
  const [selectedAccount, setSelectedAccount] = useState<FireflyExpenseAccount | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accs, comps] = await Promise.all([
        api.firefly.getExpenseAccounts(),
        api.companies.list()
      ]);
      setAccounts(accs);
      setCompanies(comps);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openMapModal = (acc: FireflyExpenseAccount) => {
    setSelectedAccount(acc);
    // Intelligent guess: if name is "Acqua e Sapone via Milano Catania", guess company="Acqua e Sapone", store="via Milano Catania"
    const lower = acc.name.toLowerCase();
    let guessedCompany = acc.name;
    let guessedStore = acc.name;

    for (const c of companies) {
      if (lower.startsWith(c.name.toLowerCase())) {
        guessedCompany = c.name;
        guessedStore = acc.name.slice(c.name.length).trim() || acc.name;
        break;
      }
    }

    setCompanyName(acc.mapped_company_name || guessedCompany);
    setStoreName(acc.mapped_store_name || guessedStore);
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !companyName.trim()) return;

    setSaving(true);
    try {
      await api.companies.quickMap({
        company_name: companyName.trim(),
        store_name: storeName.trim() || selectedAccount.name,
        firefly_account_id: selectedAccount.id,
        firefly_account_name: selectedAccount.name
      });
      setSelectedAccount(null);
      await loadData();
    } catch (err: any) {
      alert(`Error saving mapping: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const filtered = accounts.filter(a => {
    const matchesSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.mapped_company_name && a.mapped_company_name.toLowerCase().includes(search.toLowerCase()));
    if (!matchesSearch) return false;
    if (filter === 'unmapped') return !a.is_mapped;
    if (filter === 'mapped') return a.is_mapped;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Companies & Stores Mapping</h1>
          <p className="text-sm text-slate-500 mt-1">
            Group individual Firefly expense accounts (e.g. multiple Conad or Acqua & Sapone branches) under parent companies for cross-store price comparisons.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Sync from Firefly
        </button>
      </div>

      {/* Filters & Search */}
      <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Firefly accounts or companies..."
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex bg-slate-200/70 p-1 rounded-lg text-xs font-semibold">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-md transition ${filter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            All ({accounts.length})
          </button>
          <button
            onClick={() => setFilter('unmapped')}
            className={`px-3 py-1.5 rounded-md transition ${filter === 'unmapped' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-600'}`}
          >
            Unmapped ({accounts.filter(a => !a.is_mapped).length})
          </button>
          <button
            onClick={() => setFilter('mapped')}
            className={`px-3 py-1.5 rounded-md transition ${filter === 'mapped' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'}`}
          >
            Mapped ({accounts.filter(a => a.is_mapped).length})
          </button>
        </div>
      </div>

      {/* Grid of Accounts */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-12 text-center text-slate-400 text-sm">
            Fetching expense accounts from Firefly III...
          </div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-400 text-sm">
            No accounts match the current filter.
          </div>
        ) : (
          filtered.map(acc => (
            <div
              key={acc.id}
              className={`p-4 rounded-xl border transition-all ${
                acc.is_mapped
                  ? 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                  : 'bg-amber-50/50 border-amber-200/80 hover:border-amber-300'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className={`p-2 rounded-lg ${acc.is_mapped ? 'bg-blue-50 text-blue-600' : 'bg-amber-100 text-amber-700'}`}>
                    <Store className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-slate-900 leading-snug">{acc.name}</h3>
                    <p className="text-xs text-slate-400">Firefly ID #{acc.id}</p>
                  </div>
                </div>

                <button
                  onClick={() => openMapModal(acc)}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
                    acc.is_mapped
                      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      : 'bg-amber-600 text-white hover:bg-amber-700 shadow-xs'
                  }`}
                >
                  {acc.is_mapped ? 'Edit' : 'Map Store'}
                </button>
              </div>

              {acc.is_mapped && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div className="flex items-center text-slate-600">
                    <Building2 className="w-3.5 h-3.5 mr-1 text-slate-400" />
                    <span>Company: <strong className="text-slate-800">{acc.mapped_company_name}</strong></span>
                  </div>
                  <span className="text-slate-500">{acc.mapped_store_name}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Mapping Modal */}
      {selectedAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">Map Firefly Account to Company</h2>
            <p className="text-xs text-slate-500 mt-1">
              Firefly Account: <span className="font-medium text-slate-800">{selectedAccount.name}</span>
            </p>

            <form onSubmit={handleSaveMapping} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Parent Company / Chain
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Acqua & Sapone, Conad, Lidl, MD"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {companies.slice(0, 5).map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCompanyName(c.name)}
                      className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded hover:bg-slate-200"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Store / Branch Label
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. Via Milano Catania"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedAccount(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm"
                >
                  {saving ? 'Saving...' : 'Save Mapping'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
