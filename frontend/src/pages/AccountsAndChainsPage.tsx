import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import {
  FireflyExpenseAccount,
  FireflyAssetAccount,
  FireflyRevenueAccount,
  Company,
} from '../types';
import { AssetAccountsTab } from '../components/accounts/AssetAccountsTab';
import { AssetAccountConfigModal } from '../components/accounts/AssetAccountConfigModal';
import { VoucherRechargeModal } from '../components/accounts/VoucherRechargeModal';
import { AccountClassificationModal } from '../components/accounts/AccountClassificationModal';
import { ChainFormModal } from '../components/accounts/ChainFormModal';
import { AccountFilter, normalizeRole } from '../components/accounts/roleUtils';
import {
  Building2,
  Store,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  Tag as TagIcon,
  User,
  HelpCircle,
  LayoutGrid,
  List,
  Globe,
  Zap,
  Wallet,
} from 'lucide-react';

export const AccountsAndChainsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<FireflyExpenseAccount[]>([]);
  const [assetAccounts, setAssetAccounts] = useState<FireflyAssetAccount[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<FireflyRevenueAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [activeTab, setActiveTab] = useState<'accounts' | 'chains' | 'assets'>('accounts');
  const [configuringAsset, setConfiguringAsset] = useState<FireflyAssetAccount | null>(null);
  const [rechargingAsset, setRechargingAsset] = useState<FireflyAssetAccount | null>(null);
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 48;

  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try {
      return (localStorage.getItem('my-firefly:accounts-view-mode') as 'grid' | 'table') || 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleSetViewMode = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    try {
      localStorage.setItem('my-firefly:accounts-view-mode', mode);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // Unified Classification Modal State
  const [classifyingAccount, setClassifyingAccount] = useState<FireflyExpenseAccount | null>(null);

  // Manage Companies Modal State
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [accsRes, compsRes, catsRes, assetsRes, revsRes] = await Promise.allSettled([
        api.firefly.listExpenseAccounts(),
        api.companies.list(),
        api.categories.list(),
        api.firefly.getAssetAccounts(),
        api.firefly.getRevenueAccounts(),
      ]);

      if (accsRes.status === 'fulfilled') {
        setAccounts(accsRes.value);
      } else {
        console.error('Failed to load accounts:', accsRes.reason);
      }

      if (compsRes.status === 'fulfilled') {
        setCompanies(compsRes.value);
      } else {
        console.error('Failed to load companies:', compsRes.reason);
      }

      if (catsRes.status === 'fulfilled') {
        setCategories(catsRes.value);
      } else {
        console.error('Failed to load categories:', catsRes.reason);
      }

      if (assetsRes.status === 'fulfilled') {
        setAssetAccounts(assetsRes.value);
      } else {
        console.error('Failed to load asset accounts:', assetsRes.reason);
      }

      if (revsRes.status === 'fulfilled') {
        setRevenueAccounts(revsRes.value);
      } else {
        console.error('Failed to load revenue accounts:', revsRes.reason);
      }

      if (accsRes.status === 'rejected') {
        setLoadError(`Expense accounts error: ${accsRes.reason?.message || 'Failed to fetch'}`);
      } else if (compsRes.status === 'rejected') {
        setLoadError(`Chains error: ${compsRes.reason?.message || 'Failed to fetch'}`);
      } else if (catsRes.status === 'rejected') {
        setLoadError(`Categories error: ${catsRes.reason?.message || 'Failed to fetch'}`);
      } else if (assetsRes.status === 'rejected') {
        setLoadError(`Asset accounts error: ${assetsRes.reason?.message || 'Failed to fetch'}`);
      } else if (revsRes.status === 'rejected') {
        setLoadError(`Revenue accounts error: ${revsRes.reason?.message || 'Failed to fetch'}`);
      }
    } catch (err: any) {
      console.error('Failed to load accounts, companies, and categories:', err);
      setLoadError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const refreshAssets = async () => {
    const [assetsRes, revsRes] = await Promise.allSettled([
      api.firefly.getAssetAccounts(),
      api.firefly.getRevenueAccounts(),
    ]);
    if (assetsRes.status === 'fulfilled') setAssetAccounts(assetsRes.value);
    if (revsRes.status === 'fulfilled') setRevenueAccounts(revsRes.value);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Collect all existing business types across accounts and companies for quick suggestion
  const allExistingBusinessTypes = useMemo(() => {
    const set = new Set<string>();
    companies.forEach((c) => (c.business_types || []).forEach((t) => set.add(t)));
    accounts.forEach((a) => {
      (a.effective_business_types || a.business_types || []).forEach((t) => set.add(t));
    });
    return Array.from(set);
  }, [companies, accounts]);

  const openClassifyModal = (acc: FireflyExpenseAccount) => {
    setClassifyingAccount(acc);
  };

  const openCompanyModal = (comp?: Company) => {
    setEditingCompany(comp ?? null);
    setCompanyModalOpen(true);
  };

  const handleDeleteCompany = async (comp: Company) => {
    if (
      !window.confirm(
        `Are you sure you want to delete chain "${comp.name}"? Linked stores will be set to unclassified.`
      )
    ) {
      return;
    }

    try {
      await api.companies.delete(comp.id);
      await loadData();
    } catch (err: any) {
      alert(`Failed to delete chain: ${err.message}`);
    }
  };

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const query = search.toLowerCase();
      const matchesSearch =
        a.name.toLowerCase().includes(query) ||
        (a.company_name && a.company_name.toLowerCase().includes(query)) ||
        (a.category && a.category.toLowerCase().includes(query)) ||
        (a.effective_business_types && a.effective_business_types.some((t) => t.toLowerCase().includes(query))) ||
        (a.business_types && a.business_types.some((t) => t.toLowerCase().includes(query)));

      if (!matchesSearch) return false;

      const effectiveRole = normalizeRole(a.role, a.company_id);

      if (filter === 'chains') return effectiveRole === 'chain';
      if (filter === 'local_business') return effectiveRole === 'local_business';
      if (filter === 'ecommerce') return effectiveRole === 'ecommerce';
      if (filter === 'service') return effectiveRole === 'service';
      if (filter === 'person') return effectiveRole === 'person';
      if (filter === 'unclassified') return effectiveRole === 'unclassified';
      return true;
    });
  }, [accounts, search, filter]);

  // Counts for filter chips
  const counts = useMemo(() => {
    let chains = 0;
    let local_business = 0;
    let ecommerce = 0;
    let service = 0;
    let person = 0;
    let unclassified = 0;

    for (const a of accounts) {
      const effectiveRole = normalizeRole(a.role, a.company_id);
      if (effectiveRole === 'chain') chains++;
      else if (effectiveRole === 'local_business') local_business++;
      else if (effectiveRole === 'ecommerce') ecommerce++;
      else if (effectiveRole === 'service') service++;
      else if (effectiveRole === 'person') person++;
      else unclassified++;
    }

    return {
      all: accounts.length,
      chains,
      local_business,
      ecommerce,
      service,
      person,
      unclassified,
    };
  }, [accounts]);

  const totalPages = Math.ceil(filteredAccounts.length / ITEMS_PER_PAGE) || 1;
  const paginatedAccounts = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredAccounts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAccounts, page]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Accounts & Chains
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage Firefly III expense accounts (Chains, Local Businesses, E-Commerce, Services, Persons) and asset accounts / meal vouchers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 shadow-xs transition"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Sync from Firefly
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            onClick={loadData}
            className="font-semibold text-red-800 hover:underline shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-6 flex border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('accounts')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'accounts'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Store className="w-4 h-4" />
          Expense Accounts ({accounts.length})
        </button>

        <button
          onClick={() => setActiveTab('chains')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'chains'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Chains ({companies.length})
        </button>

        <button
          onClick={() => setActiveTab('assets')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'assets'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Wallet className="w-4 h-4" />
          Asset Accounts ({assetAccounts.length})
        </button>
      </div>

      {/* TAB 1: Expense Accounts Directory */}
      {activeTab === 'accounts' ? (
        <>
          {/* Controls & Filter Bar */}
          <div className="mt-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, chain, business type, or category..."
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Filter Chips */}
              <div className="flex flex-wrap bg-slate-100 p-1 rounded-lg text-xs font-semibold gap-1">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All ({counts.all})
                </button>
                <button
                  onClick={() => setFilter('chains')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'chains' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Chains ({counts.chains})
                </button>
                <button
                  onClick={() => setFilter('local_business')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'local_business' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Local Businesses ({counts.local_business})
                </button>
                <button
                  onClick={() => setFilter('ecommerce')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'ecommerce' ? 'bg-white text-sky-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  E-Commerce ({counts.ecommerce})
                </button>
                <button
                  onClick={() => setFilter('service')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'service' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Services ({counts.service})
                </button>
                <button
                  onClick={() => setFilter('person')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'person' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Persons ({counts.person})
                </button>
                <button
                  onClick={() => setFilter('unclassified')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'unclassified' ? 'bg-white text-amber-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Unclassified ({counts.unclassified})
                </button>
              </div>

              {/* Grid / Table View Switcher */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-slate-500">
                <button
                  type="button"
                  onClick={() => handleSetViewMode('grid')}
                  className={`p-1.5 rounded-md transition ${
                    viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-xs' : 'hover:text-slate-900'
                  }`}
                  title="Grid View (Cards)"
                  aria-label="Grid View (Cards)"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleSetViewMode('table')}
                  className={`p-1.5 rounded-md transition ${
                    viewMode === 'table' ? 'bg-white text-indigo-600 shadow-xs' : 'hover:text-slate-900'
                  }`}
                  title="Table View (Dense)"
                  aria-label="Table View (Dense)"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              Loading expense accounts from Firefly III...
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl mt-6">
              No accounts match the current search or filter.
            </div>
          ) : viewMode === 'grid' ? (
            /* Quiet Cards Grid View */
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {paginatedAccounts.map((acc) => {
                const effectiveRole = normalizeRole(acc.role, acc.company_id);
                const isUnclassified = effectiveRole === 'unclassified';

                return (
                  <div
                    key={acc.id}
                    className={`p-4 rounded-xl border bg-white shadow-xs transition flex flex-col justify-between ${
                      effectiveRole === 'chain'
                        ? 'border-indigo-100/80 hover:border-indigo-200'
                        : effectiveRole === 'local_business'
                        ? 'border-emerald-100/80 hover:border-emerald-200'
                        : effectiveRole === 'ecommerce'
                        ? 'border-sky-100/80 hover:border-sky-200'
                        : effectiveRole === 'service'
                        ? 'border-purple-100/80 hover:border-purple-200'
                        : effectiveRole === 'person'
                        ? 'border-slate-200 hover:border-slate-300'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      {/* Card Header: Icon, Name, ID & Action Button */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start space-x-2.5 min-w-0">
                          <div
                            className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                              effectiveRole === 'chain'
                                ? 'bg-indigo-50 text-indigo-600'
                                : effectiveRole === 'local_business'
                                ? 'bg-emerald-50 text-emerald-600'
                                : effectiveRole === 'ecommerce'
                                ? 'bg-sky-50 text-sky-600'
                                : effectiveRole === 'service'
                                ? 'bg-purple-50 text-purple-600'
                                : effectiveRole === 'person'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {effectiveRole === 'chain' ? (
                              <Building2 className="w-4 h-4" />
                            ) : effectiveRole === 'local_business' ? (
                              <Store className="w-4 h-4" />
                            ) : effectiveRole === 'ecommerce' ? (
                              <Globe className="w-4 h-4" />
                            ) : effectiveRole === 'service' ? (
                              <Zap className="w-4 h-4" />
                            ) : effectiveRole === 'person' ? (
                              <User className="w-4 h-4" />
                            ) : (
                              <HelpCircle className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-sm text-slate-900 leading-snug truncate" title={acc.name}>
                              {acc.name}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-400 font-mono">#{acc.id}</span>
                              {!acc.active && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                                  Inactive
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openClassifyModal(acc)}
                          className={`text-xs px-2.5 py-1 rounded-md font-medium shrink-0 transition border cursor-pointer ${
                            isUnclassified
                              ? 'text-slate-600 bg-slate-50 hover:bg-slate-100 border-slate-200'
                              : 'text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 border-indigo-200/80'
                          }`}
                        >
                          {isUnclassified ? 'Classify' : 'Edit'}
                        </button>
                      </div>

                      {/* Classified Metadata Row */}
                      {!isUnclassified && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs">
                          {effectiveRole === 'chain' && (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1.5 truncate">
                                <Building2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                <span className="truncate font-medium text-slate-800">
                                  {acc.company_name || 'Chain Branch'}
                                </span>
                              </div>

                              {/* Multi-type badges (Inherited & Local) */}
                              {acc.effective_business_types && acc.effective_business_types.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {acc.effective_business_types.map((type) => {
                                    const isInherited = acc.inherited_business_types?.includes(type);
                                    return (
                                      <span
                                        key={type}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                                          isInherited
                                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200/70 shadow-2xs'
                                            : 'bg-emerald-50 text-emerald-800 border-emerald-200/80 shadow-2xs'
                                        }`}
                                        title={isInherited ? 'Inherited from parent chain' : 'Local branch addition'}
                                      >
                                        {isInherited && (
                                          <span className="text-[9px] uppercase tracking-wider text-indigo-500 font-bold">
                                            Chain:
                                          </span>
                                        )}
                                        {type}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {effectiveRole === 'local_business' && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                                  <Store className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  <span>Local Business</span>
                                </div>
                                {acc.category && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shrink-0">
                                    <TagIcon className="w-2.5 h-2.5 opacity-70" />
                                    {acc.category}
                                  </span>
                                )}
                              </div>

                              {/* Multi-type badges */}
                              {acc.effective_business_types && acc.effective_business_types.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {acc.effective_business_types.map((type) => (
                                    <span
                                      key={type}
                                      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs"
                                    >
                                      {type}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {effectiveRole === 'ecommerce' && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-sky-700 font-medium truncate">
                                <Globe className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                <span>E-Commerce</span>
                              </div>
                              {acc.category && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800 shrink-0">
                                  <TagIcon className="w-2.5 h-2.5 opacity-70" />
                                  {acc.category}
                                </span>
                              )}
                            </div>
                          )}

                          {effectiveRole === 'service' && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-purple-700 font-medium truncate">
                                <Zap className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                                <span>Service / Utility</span>
                              </div>
                              {acc.category && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800 shrink-0">
                                  <TagIcon className="w-2.5 h-2.5 opacity-70" />
                                  {acc.category}
                                </span>
                              )}
                            </div>
                          )}

                          {effectiveRole === 'person' && (
                            <div className="flex items-center gap-1.5 text-slate-500 truncate">
                              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>Person</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* High-Density Table View */
            <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Account</th>
                    {filter === 'all' && <th className="py-3 px-4">Role</th>}
                    {(filter === 'all' || filter === 'chains') && (
                      <th className="py-3 px-4">{filter === 'chains' ? 'Parent Chain' : 'Chain'}</th>
                    )}
                    {(filter === 'all' || filter === 'chains' || filter === 'local_business') && (
                      <th className="py-3 px-4">Business Types</th>
                    )}
                    {(filter === 'all' ||
                      filter === 'local_business' ||
                      filter === 'ecommerce' ||
                      filter === 'service') && (
                      <th className="py-3 px-4">Category / Sector Tag</th>
                    )}
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedAccounts.map((acc) => {
                    const effectiveRole = normalizeRole(acc.role, acc.company_id);
                    const isUnclassified = effectiveRole === 'unclassified';

                    return (
                      <tr key={acc.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`p-1.5 rounded-md shrink-0 ${
                                effectiveRole === 'chain'
                                  ? 'bg-indigo-50 text-indigo-600'
                                  : effectiveRole === 'local_business'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : effectiveRole === 'ecommerce'
                                  ? 'bg-sky-50 text-sky-600'
                                  : effectiveRole === 'service'
                                  ? 'bg-purple-50 text-purple-600'
                                  : effectiveRole === 'person'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-slate-100 text-slate-400'
                              }`}
                            >
                              {effectiveRole === 'chain' ? (
                                <Building2 className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'local_business' ? (
                                <Store className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'ecommerce' ? (
                                <Globe className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'service' ? (
                                <Zap className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'person' ? (
                                <User className="w-3.5 h-3.5" />
                              ) : (
                                <HelpCircle className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-900 truncate" title={acc.name}>
                                  {acc.name}
                                </span>
                                {!acc.active && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                                    Inactive
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-slate-400 font-mono">#{acc.id}</span>
                            </div>
                          </div>
                        </td>

                        {filter === 'all' && (
                          <td className="py-3 px-4 whitespace-nowrap">
                            {effectiveRole === 'chain' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                                Chain Branch
                              </span>
                            ) : effectiveRole === 'local_business' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                Local Business
                              </span>
                            ) : effectiveRole === 'ecommerce' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200/60">
                                E-Commerce
                              </span>
                            ) : effectiveRole === 'service' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200/60">
                                Service
                              </span>
                            ) : effectiveRole === 'person' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                Person
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                        )}

                        {(filter === 'all' || filter === 'chains') && (
                          <td className="py-3 px-4">
                            {effectiveRole === 'chain' && acc.company_name ? (
                              <span className="font-medium text-slate-800 flex items-center gap-1.5 truncate">
                                <Building2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                {acc.company_name}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                        )}

                        {(filter === 'all' || filter === 'chains' || filter === 'local_business') && (
                          <td className="py-3 px-4">
                            {acc.effective_business_types && acc.effective_business_types.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {acc.effective_business_types.map((type) => {
                                  const isInherited = acc.inherited_business_types?.includes(type);
                                  return (
                                    <span
                                      key={type}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold border ${
                                        isInherited
                                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200/70'
                                          : 'bg-emerald-50 text-emerald-800 border-emerald-200/80'
                                      }`}
                                      title={isInherited ? 'Inherited from chain' : 'Local business type'}
                                    >
                                      {isInherited && (
                                        <span className="text-[9px] uppercase tracking-wider text-indigo-500 font-bold">
                                          Chain:
                                        </span>
                                      )}
                                      {type}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                        )}

                        {(filter === 'all' ||
                          filter === 'local_business' ||
                          filter === 'ecommerce' ||
                          filter === 'service') && (
                          <td className="py-3 px-4">
                            {effectiveRole !== 'chain' && acc.category ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  effectiveRole === 'local_business'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : effectiveRole === 'ecommerce'
                                    ? 'bg-sky-50 text-sky-700'
                                    : 'bg-purple-50 text-purple-700'
                                }`}
                              >
                                <TagIcon className="w-3 h-3 opacity-70" />
                                {acc.category}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                        )}

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openClassifyModal(acc)}
                            className={`text-xs px-2.5 py-1 rounded-md font-medium transition border cursor-pointer ${
                              isUnclassified
                                ? 'text-slate-600 bg-slate-50 hover:bg-slate-100 border-slate-200'
                                : 'text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 border-indigo-200/80'
                            }`}
                          >
                            {isUnclassified ? 'Classify' : 'Edit'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4">
              <span className="text-xs text-slate-500">
                Showing{' '}
                <strong className="text-slate-800">
                  {(page - 1) * ITEMS_PER_PAGE + 1}
                </strong>{' '}
                to{' '}
                <strong className="text-slate-800">
                  {Math.min(page * ITEMS_PER_PAGE, filteredAccounts.length)}
                </strong>{' '}
                of <strong className="text-slate-800">{filteredAccounts.length}</strong> accounts
              </span>

              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : activeTab === 'chains' ? (
        /* TAB 2: Chains Management */
        <div className="mt-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Parent Retail Chains</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Chains group individual store branches (e.g. Conad, Lidl) and define default business types that all branches inherit.
              </p>
            </div>
            <button
              onClick={() => openCompanyModal()}
              className="inline-flex items-center px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Chain
            </button>
          </div>

          {companies.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl">
              No parent chains created yet. Click &quot;New Chain&quot; above to create one.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {companies.map((comp) => (
                <div
                  key={comp.id}
                  className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs hover:border-slate-300 transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm text-slate-900">{comp.name}</h3>
                          {/* Business Types Badges */}
                          {comp.business_types && comp.business_types.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {comp.business_types.map((type) => (
                                <span
                                  key={type}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100"
                                >
                                  <TagIcon className="w-2.5 h-2.5 mr-1 text-indigo-500" />
                                  {type}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic mt-0.5 block">No types set</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openCompanyModal(comp)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition cursor-pointer"
                          title="Edit Chain"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteCompany(comp)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition cursor-pointer"
                          title="Delete Chain"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {comp.notes && (
                      <p className="mt-3 text-xs text-slate-500 line-clamp-2 bg-slate-50 p-2 rounded-lg">
                        {comp.notes}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium text-slate-700">
                      {comp.store_count ?? 0} {comp.store_count === 1 ? 'branch' : 'branches'} linked
                    </span>
                    <button
                      onClick={() => {
                        setSearch(comp.name);
                        setFilter('chains');
                        setActiveTab('accounts');
                      }}
                      className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline cursor-pointer"
                    >
                      View Branches →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* TAB 3: Asset Accounts Management */
        <AssetAccountsTab
          assetAccounts={assetAccounts}
          loading={loading}
          onConfigure={(acc) => setConfiguringAsset(acc)}
          onRecharge={(acc) => setRechargingAsset(acc)}
        />
      )}

      {/* Unified Account Classification Modal */}
      {classifyingAccount && (
        <AccountClassificationModal
          account={classifyingAccount}
          companies={companies}
          categories={categories}
          allAvailableBusinessTypes={allExistingBusinessTypes}
          onClose={() => setClassifyingAccount(null)}
          onSaved={loadData}
        />
      )}

      {/* Create / Edit Chain Modal */}
      {companyModalOpen && (
        <ChainFormModal
          company={editingCompany}
          allAvailableBusinessTypes={allExistingBusinessTypes}
          onClose={() => setCompanyModalOpen(false)}
          onSaved={loadData}
        />
      )}

      {configuringAsset && (
        <AssetAccountConfigModal
          account={configuringAsset}
          revenueAccounts={revenueAccounts}
          onClose={() => setConfiguringAsset(null)}
          onSaved={refreshAssets}
        />
      )}

      {rechargingAsset && (
        <VoucherRechargeModal
          account={rechargingAsset}
          revenueAccounts={revenueAccounts}
          onClose={() => setRechargingAsset(null)}
          onSuccess={refreshAssets}
        />
      )}
    </div>
  );
};
