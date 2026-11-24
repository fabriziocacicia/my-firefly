import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { FireflyExpenseAccount, Company, AccountRole } from '../types';
import { CompanyCombobox, CompanySelection } from '../components/common/CompanyCombobox';
import { CategoryCombobox } from '../components/common/CategoryCombobox';
import { BusinessTypesTagInput } from '../components/common/BusinessTypesTagInput';
import {
  Building2,
  Store,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  X,
  AlertCircle,
  Tag as TagIcon,
  User,
  HelpCircle,
  LayoutGrid,
  List,
  Globe,
  Zap,
} from 'lucide-react';

export const AccountsAndChainsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<FireflyExpenseAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'all' | 'chains' | 'local_business' | 'ecommerce' | 'service' | 'person' | 'unclassified'
  >('all');
  const [activeTab, setActiveTab] = useState<'accounts' | 'chains'>('accounts');
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
  const [modalRole, setModalRole] = useState<AccountRole>('unclassified');
  const [modalCompanySelection, setModalCompanySelection] = useState<CompanySelection | null>(null);
  const [modalCategory, setModalCategory] = useState<string | null>(null);
  const [modalBusinessTypes, setModalBusinessTypes] = useState<string[]>([]);
  const [savingClassification, setSavingClassification] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);

  // Manage Companies Modal State
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [compFormName, setCompFormName] = useState('');
  const [compFormBusinessTypes, setCompFormBusinessTypes] = useState<string[]>([]);
  const [compFormNotes, setCompFormNotes] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [accsRes, compsRes, catsRes] = await Promise.allSettled([
        api.firefly.listExpenseAccounts(),
        api.companies.list(),
        api.categories.list(),
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

      if (accsRes.status === 'rejected') {
        setLoadError(`Expense accounts error: ${accsRes.reason?.message || 'Failed to fetch'}`);
      } else if (compsRes.status === 'rejected') {
        setLoadError(`Chains error: ${compsRes.reason?.message || 'Failed to fetch'}`);
      } else if (catsRes.status === 'rejected') {
        setLoadError(`Categories error: ${catsRes.reason?.message || 'Failed to fetch'}`);
      }
    } catch (err: any) {
      console.error('Failed to load accounts, companies, and categories:', err);
      setLoadError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Normalize legacy roles (physical_store, independent) to local_business
  const normalizeRole = (role?: AccountRole, companyId?: number | null): AccountRole => {
    if (role === 'physical_store' || role === 'independent') return 'local_business';
    if (role) return role;
    return companyId ? 'chain' : 'unclassified';
  };

  // Collect all existing business types across accounts and companies for quick suggestion
  const allExistingBusinessTypes = useMemo(() => {
    const set = new Set<string>();
    companies.forEach((c) => (c.business_types || []).forEach((t) => set.add(t)));
    accounts.forEach((a) => {
      (a.effective_business_types || a.business_types || []).forEach((t) => set.add(t));
    });
    return Array.from(set);
  }, [companies, accounts]);

  // Open Unified Classification Modal
  const openClassifyModal = (acc: FireflyExpenseAccount) => {
    setClassifyingAccount(acc);
    const effectiveRole = normalizeRole(acc.role, acc.company_id);
    setModalRole(effectiveRole);
    setModalCompanySelection({
      companyId: acc.company_id ?? null,
      companyName: acc.company_name ?? '',
      isNew: false,
    });
    const supportsCategory = ['local_business', 'ecommerce', 'service'].includes(effectiveRole);
    setModalCategory(supportsCategory ? acc.category || null : null);

    // Strip any business types already inherited from parent chain
    const rawBusinessTypes = acc.business_types || [];
    if (effectiveRole === 'chain') {
      const comp = companies.find((c) => c.id === acc.company_id);
      const inherited = comp?.business_types?.length
        ? comp.business_types
        : (acc.inherited_business_types || []);
      const inheritedLower = new Set(inherited.map((t) => t.trim().toLowerCase()));
      setModalBusinessTypes(rawBusinessTypes.filter((t) => !inheritedLower.has(t.trim().toLowerCase())));
    } else {
      setModalBusinessTypes(rawBusinessTypes);
    }
    setClassificationError(null);
  };

  // Save Classification
  const handleSaveClassification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classifyingAccount) return;

    setSavingClassification(true);
    setClassificationError(null);
    try {
      let companyId: number | null = null;
      let category: string | null = null;
      let businessTypes: string[] = [];

      if (modalRole === 'chain') {
        if (!modalCompanySelection?.companyId && !modalCompanySelection?.companyName?.trim()) {
          setClassificationError('Please select or enter a parent retail chain name.');
          setSavingClassification(false);
          return;
        }

        if (modalCompanySelection.isNew && modalCompanySelection.companyName.trim()) {
          const created = await api.companies.create({
            name: modalCompanySelection.companyName.trim(),
            business_types: modalBusinessTypes.length > 0 ? modalBusinessTypes : undefined,
          });
          companyId = created.id;
          // The new chain owns these business_types, branch inherits them and does not duplicate
          businessTypes = [];
        } else {
          companyId = modalCompanySelection.companyId ?? null;
          // Purge any types already inherited from the selected chain
          const inheritedLower = new Set(chainInheritedTypes.map((t) => t.trim().toLowerCase()));
          businessTypes = modalBusinessTypes.filter((t) => !inheritedLower.has(t.trim().toLowerCase()));
        }

        if (!companyId) {
          setClassificationError('Please select a valid parent chain.');
          setSavingClassification(false);
          return;
        }
      } else if (modalRole === 'local_business') {
        category = modalCategory?.trim() || null;
        businessTypes = modalBusinessTypes;
      } else if (modalRole === 'ecommerce' || modalRole === 'service') {
        category = modalCategory?.trim() || null;
        businessTypes = [];
      } else {
        category = null;
        businessTypes = [];
      }

      await api.accounts.updateMetadata(classifyingAccount.id, {
        role: modalRole,
        company_id: companyId,
        category: category,
        business_types: businessTypes,
      });

      setClassifyingAccount(null);
      await loadData();
    } catch (err: any) {
      setClassificationError(err.message || 'Failed to save classification');
    } finally {
      setSavingClassification(false);
    }
  };

  // Manage Company Modal Handlers
  const openCompanyModal = (comp?: Company) => {
    if (comp) {
      setEditingCompany(comp);
      setCompFormName(comp.name);
      setCompFormBusinessTypes(comp.business_types || []);
      setCompFormNotes(comp.notes || '');
    } else {
      setEditingCompany(null);
      setCompFormName('');
      setCompFormBusinessTypes([]);
      setCompFormNotes('');
    }
    setCompanyError(null);
    setCompanyModalOpen(true);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compFormName.trim()) return;

    setSavingCompany(true);
    setCompanyError(null);
    try {
      if (editingCompany) {
        await api.companies.update(editingCompany.id, {
          name: compFormName.trim(),
          business_types: compFormBusinessTypes,
          notes: compFormNotes.trim() || undefined,
        });
      } else {
        await api.companies.create({
          name: compFormName.trim(),
          business_types: compFormBusinessTypes,
          notes: compFormNotes.trim() || undefined,
        });
      }
      setCompanyModalOpen(false);
      await loadData();
    } catch (err: any) {
      setCompanyError(err.message || 'Failed to save chain');
    } finally {
      setSavingCompany(false);
    }
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

  // Look up selected chain company to show inherited business types in classification modal
  const selectedChainCompany = useMemo(() => {
    if (modalRole !== 'chain' || !modalCompanySelection?.companyId) return null;
    return companies.find((c) => c.id === modalCompanySelection.companyId) || null;
  }, [modalRole, modalCompanySelection, companies]);

  const chainInheritedTypes = useMemo(() => {
    if (!selectedChainCompany) return [];
    return selectedChainCompany.business_types || [];
  }, [selectedChainCompany]);

  // Ensure modalBusinessTypes never duplicates types inherited from the selected chain
  useEffect(() => {
    if (modalRole === 'chain' && chainInheritedTypes.length > 0) {
      const inheritedLower = new Set(chainInheritedTypes.map((t) => t.trim().toLowerCase()));
      setModalBusinessTypes((prev) =>
        prev.filter((t) => !inheritedLower.has(t.trim().toLowerCase()))
      );
    }
  }, [modalRole, chainInheritedTypes]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Accounts & Chains
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Classify Firefly III expense accounts by role (Chains, Local Businesses, E-Commerce, Services, Persons).
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
      ) : (
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
      )}

      {/* Unified Account Classification Modal */}
      {classifyingAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                  {modalRole === 'chain' ? (
                    <Building2 className="w-5 h-5" />
                  ) : modalRole === 'local_business' ? (
                    <Store className="w-5 h-5" />
                  ) : modalRole === 'ecommerce' ? (
                    <Globe className="w-5 h-5" />
                  ) : modalRole === 'service' ? (
                    <Zap className="w-5 h-5" />
                  ) : modalRole === 'person' ? (
                    <User className="w-5 h-5" />
                  ) : (
                    <HelpCircle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 leading-tight">
                    Classify: {classifyingAccount.name}
                  </h2>
                  <span className="text-xs text-slate-400 font-mono">Firefly Account #{classifyingAccount.id}</span>
                </div>
              </div>
              <button
                onClick={() => setClassifyingAccount(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {classificationError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{classificationError}</span>
              </div>
            )}

            <form onSubmit={handleSaveClassification} className="mt-5 space-y-4">
              {/* Role Selection Grid */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Account Role</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModalRole('chain')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      modalRole === 'chain'
                        ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <Building2
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        modalRole === 'chain' ? 'text-indigo-600' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">Chain Branch</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Inherits chain&apos;s types
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('local_business')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      modalRole === 'local_business'
                        ? 'border-emerald-600 bg-emerald-50/40 text-emerald-900 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <Store
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        modalRole === 'local_business' ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">Local Business</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Physical shop, bar, gym, etc.
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('ecommerce')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      modalRole === 'ecommerce'
                        ? 'border-sky-600 bg-sky-50/40 text-sky-900 ring-2 ring-sky-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <Globe
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        modalRole === 'ecommerce' ? 'text-sky-600' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">E-Commerce</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Online store / web shop
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('service')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      modalRole === 'service'
                        ? 'border-purple-600 bg-purple-50/40 text-purple-900 ring-2 ring-purple-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <Zap
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        modalRole === 'service' ? 'text-purple-600' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">Service / Utility</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Subscription, utility, bills
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('person')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      modalRole === 'person'
                        ? 'border-slate-600 bg-slate-100 text-slate-900 ring-2 ring-slate-400/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <User
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        modalRole === 'person' ? 'text-slate-700' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">Person</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Individual peer
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('unclassified')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      modalRole === 'unclassified'
                        ? 'border-amber-600 bg-amber-50/40 text-amber-900 ring-2 ring-amber-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <HelpCircle
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        modalRole === 'unclassified' ? 'text-amber-600' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">Unclassified</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Standard account
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Conditional Inputs Based on Selected Role */}
              {modalRole === 'chain' && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Parent Retail Chain *
                    </label>
                    <CompanyCombobox
                      companies={companies}
                      selectedCompanyId={modalCompanySelection?.companyId ?? null}
                      initialNewName={modalCompanySelection?.isNew ? modalCompanySelection.companyName : ''}
                      onChange={(sel) => setModalCompanySelection(sel)}
                      placeholder="Search or type new chain (e.g. Conad, Lidl, Eni)..."
                    />
                  </div>

                  {/* Branch-Specific Business Types with Inherited Types */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Branch Business Types
                    </label>
                    <BusinessTypesTagInput
                      value={modalBusinessTypes}
                      onChange={setModalBusinessTypes}
                      inheritedTypes={chainInheritedTypes}
                      allAvailableTypes={allExistingBusinessTypes}
                      placeholder="Add branch-specific type (e.g. Bar/Cafe, Carwash)..."
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Types with badge <strong>Chain:</strong> are inherited automatically from the parent chain. You can add extra types specific to this branch.
                    </p>
                  </div>
                </div>
              )}

              {modalRole === 'local_business' && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Business Types *
                    </label>
                    <BusinessTypesTagInput
                      value={modalBusinessTypes}
                      onChange={setModalBusinessTypes}
                      allAvailableTypes={allExistingBusinessTypes}
                      placeholder="Add business type (e.g. Bar/Cafe, Tobacconist, Pharmacy)..."
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Physical business types that describe this venue (multiple types supported, e.g. Bar + Tobacconist).
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Sector Category Tag (Optional)
                    </label>
                    <CategoryCombobox
                      categories={categories}
                      selectedCategory={modalCategory}
                      onChange={(cat) => setModalCategory(cat)}
                      placeholder="Optional merchandise sector (e.g. Healthcare, Food)..."
                    />
                  </div>
                </div>
              )}

              {(modalRole === 'ecommerce' || modalRole === 'service') && (
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Sector Category Tag
                  </label>
                  <CategoryCombobox
                    categories={categories}
                    selectedCategory={modalCategory}
                    onChange={(cat) => setModalCategory(cat)}
                    placeholder="Search or type sector (e.g. Supplements, Electronics, Streaming)..."
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Category tag indicating what this {modalRole === 'ecommerce' ? 'online shop' : 'service'} provides.
                  </p>
                </div>
              )}

              {modalRole === 'person' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Marked as a person. Excluded from retail chain and business type categorization.</span>
                </div>
              )}

              {modalRole === 'unclassified' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>Standard account with no assigned role. You can classify it at any time.</span>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setClassifyingAccount(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingClassification}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                >
                  {savingClassification ? 'Saving...' : 'Save Classification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Chain Modal */}
      {companyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editingCompany ? 'Edit Chain' : 'New Parent Chain'}
              </h2>
              <button
                onClick={() => setCompanyModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {companyError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{companyError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCompany} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Chain Name *
                </label>
                <input
                  type="text"
                  required
                  value={compFormName}
                  onChange={(e) => setCompFormName(e.target.value)}
                  placeholder="e.g. Conad, Carrefour, Lidl, Eni"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Chain Business Types
                </label>
                <BusinessTypesTagInput
                  value={compFormBusinessTypes}
                  onChange={setCompFormBusinessTypes}
                  allAvailableTypes={allExistingBusinessTypes}
                  placeholder="e.g. Supermarket, Gas Station, Pharmacy..."
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  All branches linked to this chain will automatically inherit these business types.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={compFormNotes}
                  onChange={(e) => setCompFormNotes(e.target.value)}
                  placeholder="Optional notes about this retail chain..."
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setCompanyModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCompany}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                >
                  {savingCompany ? 'Saving...' : editingCompany ? 'Update Chain' : 'Create Chain'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
