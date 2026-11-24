import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { FireflyExpenseAccount, Company, AccountRole } from '../types';
import { CompanyCombobox, CompanySelection } from '../components/common/CompanyCombobox';
import { CategoryCombobox } from '../components/common/CategoryCombobox';
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
  Sparkles,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

export const AccountsAndChainsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<FireflyExpenseAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    'all' | 'chains' | 'physical_store' | 'ecommerce' | 'service' | 'person' | 'unclassified' | 'independent'
  >('all');
  const [activeTab, setActiveTab] = useState<'accounts' | 'chains'>('accounts');
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 48;

  // Rapid Triage Wizard State (temporary on this branch to migrate legacy independent accounts)
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

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

  // Unified Classification Modal
  const [classifyingAccount, setClassifyingAccount] = useState<FireflyExpenseAccount | null>(null);
  const [modalRole, setModalRole] = useState<AccountRole>('unclassified');
  const [modalCompanySelection, setModalCompanySelection] = useState<CompanySelection | null>(null);
  const [modalCategory, setModalCategory] = useState<string | null>(null);
  const [savingClassification, setSavingClassification] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);

  // Manage Companies State
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [compFormName, setCompFormName] = useState('');
  const [compFormCategory, setCompFormCategory] = useState<string | null>(null);
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

  // Open Unified Classification Modal
  const openClassifyModal = (acc: FireflyExpenseAccount) => {
    setClassifyingAccount(acc);
    const effectiveRole: AccountRole = acc.role || (acc.company_id ? 'chain' : 'unclassified');
    setModalRole(effectiveRole);
    setModalCompanySelection({
      companyId: acc.company_id ?? null,
      companyName: acc.company_name ?? '',
      isNew: false,
    });
    const supportsCategory = ['physical_store', 'ecommerce', 'service', 'independent'].includes(effectiveRole);
    setModalCategory(supportsCategory ? acc.category || null : null);
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

      if (modalRole === 'chain') {
        if (!modalCompanySelection?.companyId && !modalCompanySelection?.companyName?.trim()) {
          setClassificationError('Please select or enter a parent retail chain name.');
          setSavingClassification(false);
          return;
        }

        if (modalCompanySelection.isNew && modalCompanySelection.companyName.trim()) {
          const created = await api.companies.create({
            name: modalCompanySelection.companyName.trim(),
          });
          companyId = created.id;
        } else {
          companyId = modalCompanySelection.companyId ?? null;
        }

        if (!companyId) {
          setClassificationError('Please select a valid parent chain.');
          setSavingClassification(false);
          return;
        }
      } else if (['physical_store', 'ecommerce', 'service', 'independent'].includes(modalRole)) {
        category = modalCategory?.trim() || null;
      }

      await api.accounts.updateMetadata(classifyingAccount.id, {
        role: modalRole,
        company_id: companyId,
        category: category,
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
      setCompFormCategory(comp.default_category || null);
      setCompFormNotes(comp.notes || '');
    } else {
      setEditingCompany(null);
      setCompFormName('');
      setCompFormCategory(null);
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
          default_category: compFormCategory?.trim() || undefined,
          notes: compFormNotes.trim() || undefined,
        });
      } else {
        await api.companies.create({
          name: compFormName.trim(),
          default_category: compFormCategory?.trim() || undefined,
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

  // Legacy independent accounts to migrate
  const legacyIndependentAccounts = useMemo(() => {
    return accounts.filter((a) => a.role === 'independent');
  }, [accounts]);

  const currentOnboardingAccount = legacyIndependentAccounts[onboardingIndex];

  // Quick triage classification for onboarding
  const handleQuickClassify = async (targetRole: AccountRole) => {
    if (!currentOnboardingAccount || onboardingSaving) return;
    setOnboardingSaving(true);
    try {
      await api.accounts.updateMetadata(currentOnboardingAccount.id, {
        role: targetRole,
        company_id: null,
        category: currentOnboardingAccount.category || null,
      });

      // Optimistically update local account role
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === currentOnboardingAccount.id ? { ...a, role: targetRole } : a
        )
      );

      if (onboardingIndex + 1 < legacyIndependentAccounts.length) {
        setOnboardingIndex((idx) => idx + 1);
      } else {
        setOnboardingCompleted(true);
        await loadData();
      }
    } catch (err: any) {
      alert(`Errore nel salvataggio della classificazione: ${err.message || 'Errore di rete'}`);
    } finally {
      setOnboardingSaving(false);
    }
  };

  // Keyboard shortcuts listener for rapid triage wizard
  useEffect(() => {
    if (!onboardingOpen || onboardingCompleted || !currentOnboardingAccount) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === '1') {
        e.preventDefault();
        handleQuickClassify('physical_store');
      } else if (e.key === '2') {
        e.preventDefault();
        handleQuickClassify('ecommerce');
      } else if (e.key === '3') {
        e.preventDefault();
        handleQuickClassify('service');
      } else if (e.key === '4') {
        e.preventDefault();
        handleQuickClassify('person');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOnboardingOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onboardingOpen, onboardingCompleted, currentOnboardingAccount, onboardingSaving]);

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const query = search.toLowerCase();
      const matchesSearch =
        a.name.toLowerCase().includes(query) ||
        (a.company_name && a.company_name.toLowerCase().includes(query)) ||
        (a.category && a.category.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      const effectiveRole: AccountRole = a.role || (a.company_id ? 'chain' : 'unclassified');

      if (filter === 'chains') return effectiveRole === 'chain';
      if (filter === 'physical_store') return effectiveRole === 'physical_store';
      if (filter === 'ecommerce') return effectiveRole === 'ecommerce';
      if (filter === 'service') return effectiveRole === 'service';
      if (filter === 'person') return effectiveRole === 'person';
      if (filter === 'unclassified') return effectiveRole === 'unclassified';
      if (filter === 'independent') return effectiveRole === 'independent';
      return true;
    });
  }, [accounts, search, filter]);

  // Counts for filter chips
  const counts = useMemo(() => {
    let chains = 0;
    let physical_store = 0;
    let ecommerce = 0;
    let service = 0;
    let person = 0;
    let unclassified = 0;
    let independent = 0;

    for (const a of accounts) {
      const effectiveRole: AccountRole = a.role || (a.company_id ? 'chain' : 'unclassified');
      if (effectiveRole === 'chain') chains++;
      else if (effectiveRole === 'physical_store') physical_store++;
      else if (effectiveRole === 'ecommerce') ecommerce++;
      else if (effectiveRole === 'service') service++;
      else if (effectiveRole === 'person') person++;
      else if (effectiveRole === 'independent') independent++;
      else unclassified++;
    }

    return {
      all: accounts.length,
      chains,
      physical_store,
      ecommerce,
      service,
      person,
      unclassified,
      independent,
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
            Classify Firefly III expense accounts by role (Chains, Independent Stores, Persons) and assign custom category tags.
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
          {/* Migration / Rapid Triage Banner for Legacy Independent Accounts */}
          {legacyIndependentAccounts.length > 0 && (
            <div className="mt-6 p-4 rounded-xl border border-amber-300 bg-amber-50/90 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-700 shrink-0 mt-0.5">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-amber-950">
                      Nuovi Ruoli Disponibili: {legacyIndependentAccounts.length} account da specificare
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900 uppercase tracking-wide">
                      Azione Rapida
                    </span>
                  </div>
                  <p className="text-xs text-amber-900/80 mt-1 leading-relaxed max-w-2xl">
                    Specifica rapidamente se questi account sono <strong>Negozi Fisici</strong>, <strong>E-Commerce</strong> o <strong>Servizi/Utenze</strong>. Le categorie già associate (es. Farmacia, Integratori) verranno <strong>preservate al 100%</strong>.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setOnboardingIndex(0);
                  setOnboardingCompleted(false);
                  setOnboardingOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-semibold rounded-lg shadow-xs transition shrink-0 cursor-pointer"
              >
                <span>Avvia Revisione Rapida ({legacyIndependentAccounts.length})</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Controls & Filter Bar */}
          <div className="mt-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, company, or category..."
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
                  onClick={() => setFilter('physical_store')}
                  className={`px-2.5 py-1.5 rounded-md transition ${
                    filter === 'physical_store' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Physical Shops ({counts.physical_store})
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
                {counts.independent > 0 && (
                  <button
                    onClick={() => setFilter('independent')}
                    className={`px-2.5 py-1.5 rounded-md transition flex items-center gap-1 ${
                      filter === 'independent' ? 'bg-white text-amber-900 shadow-xs' : 'text-amber-800 hover:text-amber-950 bg-amber-200/60'
                    }`}
                  >
                    <span>⚠️ Da Specificare ({counts.independent})</span>
                  </button>
                )}
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
                const effectiveRole: AccountRole = acc.role || (acc.company_id ? 'chain' : 'unclassified');
                const isUnclassified = effectiveRole === 'unclassified';

                return (
                  <div
                    key={acc.id}
                    className={`p-4 rounded-xl border bg-white shadow-xs transition flex flex-col justify-between ${
                      effectiveRole === 'chain'
                        ? 'border-indigo-100/80 hover:border-indigo-200'
                        : effectiveRole === 'physical_store'
                        ? 'border-emerald-100/80 hover:border-emerald-200'
                        : effectiveRole === 'ecommerce'
                        ? 'border-sky-100/80 hover:border-sky-200'
                        : effectiveRole === 'service'
                        ? 'border-purple-100/80 hover:border-purple-200'
                        : effectiveRole === 'independent'
                        ? 'border-amber-200 hover:border-amber-300 bg-amber-50/20'
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
                                : effectiveRole === 'physical_store'
                                ? 'bg-emerald-50 text-emerald-600'
                                : effectiveRole === 'ecommerce'
                                ? 'bg-sky-50 text-sky-600'
                                : effectiveRole === 'service'
                                ? 'bg-purple-50 text-purple-600'
                                : effectiveRole === 'independent'
                                ? 'bg-amber-100 text-amber-700'
                                : effectiveRole === 'person'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {effectiveRole === 'chain' ? (
                              <Building2 className="w-4 h-4" />
                            ) : effectiveRole === 'physical_store' ? (
                              <Store className="w-4 h-4" />
                            ) : effectiveRole === 'ecommerce' ? (
                              <Globe className="w-4 h-4" />
                            ) : effectiveRole === 'service' ? (
                              <Zap className="w-4 h-4" />
                            ) : effectiveRole === 'independent' ? (
                              <Store className="w-4 h-4" />
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
                          className={`text-xs px-2.5 py-1 rounded-md font-medium shrink-0 transition border ${
                            isUnclassified
                              ? 'text-slate-600 bg-slate-50 hover:bg-slate-100 border-slate-200'
                              : 'text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 border-indigo-200/80'
                          }`}
                        >
                          {isUnclassified ? 'Classify' : 'Edit'}
                        </button>
                      </div>

                      {/* Classified Metadata Row (Clean and non-invasive) */}
                      {!isUnclassified && (
                        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                          {effectiveRole === 'chain' && (
                            <>
                              <div className="flex items-center gap-1.5 truncate">
                                <Building2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                <span className="truncate font-medium text-slate-800">
                                  {acc.company_name || 'Chain Branch'}
                                </span>
                              </div>
                              {acc.category && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800 shrink-0">
                                  {acc.category}
                                </span>
                              )}
                            </>
                          )}

                          {effectiveRole === 'physical_store' && (
                            <>
                              <div className="flex items-center gap-1.5 text-emerald-700 font-medium truncate">
                                <Store className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                <span>Negozio Fisico</span>
                              </div>
                              {acc.category && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 shrink-0">
                                  {acc.category}
                                </span>
                              )}
                            </>
                          )}

                          {effectiveRole === 'ecommerce' && (
                            <>
                              <div className="flex items-center gap-1.5 text-sky-700 font-medium truncate">
                                <Globe className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                <span>E-Commerce</span>
                              </div>
                              {acc.category && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800 shrink-0">
                                  {acc.category}
                                </span>
                              )}
                            </>
                          )}

                          {effectiveRole === 'service' && (
                            <>
                              <div className="flex items-center gap-1.5 text-purple-700 font-medium truncate">
                                <Zap className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                                <span>Servizio / Utenza</span>
                              </div>
                              {acc.category && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800 shrink-0">
                                  {acc.category}
                                </span>
                              )}
                            </>
                          )}

                          {effectiveRole === 'independent' && (
                            <>
                              <div className="flex items-center gap-1.5 text-amber-800 font-medium truncate">
                                <Store className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span>Da Specificare</span>
                              </div>
                              {acc.category && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 shrink-0">
                                  {acc.category}
                                </span>
                              )}
                            </>
                          )}

                          {effectiveRole === 'person' && (
                            <div className="flex items-center gap-1.5 text-slate-500 truncate">
                              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>Personal Contact</span>
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
                    {(filter === 'all' ||
                      filter === 'chains' ||
                      filter === 'physical_store' ||
                      filter === 'ecommerce' ||
                      filter === 'service' ||
                      filter === 'independent') && (
                      <th className="py-3 px-4">Category Tag</th>
                    )}
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedAccounts.map((acc) => {
                    const effectiveRole: AccountRole = acc.role || (acc.company_id ? 'chain' : 'unclassified');
                    const isUnclassified = effectiveRole === 'unclassified';

                    return (
                      <tr key={acc.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`p-1.5 rounded-md shrink-0 ${
                                effectiveRole === 'chain'
                                  ? 'bg-indigo-50 text-indigo-600'
                                  : effectiveRole === 'physical_store'
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : effectiveRole === 'ecommerce'
                                  ? 'bg-sky-50 text-sky-600'
                                  : effectiveRole === 'service'
                                  ? 'bg-purple-50 text-purple-600'
                                  : effectiveRole === 'independent'
                                  ? 'bg-amber-100 text-amber-700'
                                  : effectiveRole === 'person'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-slate-100 text-slate-400'
                              }`}
                            >
                              {effectiveRole === 'chain' ? (
                                <Building2 className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'physical_store' ? (
                                <Store className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'ecommerce' ? (
                                <Globe className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'service' ? (
                                <Zap className="w-3.5 h-3.5" />
                              ) : effectiveRole === 'independent' ? (
                                <Store className="w-3.5 h-3.5" />
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
                            ) : effectiveRole === 'physical_store' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                Negozio Fisico
                              </span>
                            ) : effectiveRole === 'ecommerce' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200/60">
                                E-Commerce
                              </span>
                            ) : effectiveRole === 'service' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200/60">
                                Servizio
                              </span>
                            ) : effectiveRole === 'independent' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                Da Specificare
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

                        {(filter === 'all' ||
                          filter === 'chains' ||
                          filter === 'physical_store' ||
                          filter === 'ecommerce' ||
                          filter === 'service' ||
                          filter === 'independent') && (
                          <td className="py-3 px-4">
                            {acc.category ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  effectiveRole === 'chain'
                                    ? 'bg-indigo-50 text-indigo-700'
                                    : effectiveRole === 'physical_store'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : effectiveRole === 'ecommerce'
                                    ? 'bg-sky-50 text-sky-700'
                                    : effectiveRole === 'service'
                                    ? 'bg-purple-50 text-purple-700'
                                    : 'bg-amber-50 text-amber-800'
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
                            className={`text-xs px-2.5 py-1 rounded-md font-medium transition border ${
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
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
                Chains group individual store branches (e.g. Conad, Lidl) and hold their business sector category.
              </p>
            </div>
            <button
              onClick={() => openCompanyModal()}
              className="inline-flex items-center px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
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
                          <div className="flex items-center gap-2 mt-0.5">
                            {comp.default_category ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                <TagIcon className="w-3 h-3 mr-1" />
                                {comp.default_category}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No category</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openCompanyModal(comp)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition"
                          title="Edit Chain"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteCompany(comp)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition"
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
                      className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline"
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
                  ) : modalRole === 'physical_store' ? (
                    <Store className="w-5 h-5" />
                  ) : modalRole === 'ecommerce' ? (
                    <Globe className="w-5 h-5" />
                  ) : modalRole === 'service' ? (
                    <Zap className="w-5 h-5" />
                  ) : modalRole === 'independent' ? (
                    <Store className="w-5 h-5" />
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
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
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
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
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
                        Inherits chain&apos;s sector
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('physical_store')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                      modalRole === 'physical_store'
                        ? 'border-emerald-600 bg-emerald-50/40 text-emerald-900 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <Store
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        modalRole === 'physical_store' ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">Negozio Fisico</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Standalone local shop
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('ecommerce')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
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
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
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
                      <span className="font-semibold text-xs block">Servizio / Utenza</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Subscription, utility, bills
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('person')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
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
                      <span className="font-semibold text-xs block">Personal Contact</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        Individual peer
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalRole('unclassified')}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
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
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Parent Retail Chain *
                  </label>
                  <CompanyCombobox
                    companies={companies}
                    selectedCompanyId={modalCompanySelection?.companyId ?? null}
                    initialNewName={modalCompanySelection?.isNew ? modalCompanySelection.companyName : ''}
                    onChange={(sel) => setModalCompanySelection(sel)}
                    placeholder="Search or type new chain (e.g. Conad, Lidl)..."
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    The account will inherit this retail chain&apos;s default sector category.
                  </p>
                </div>
              )}

              {['physical_store', 'ecommerce', 'service', 'independent'].includes(modalRole) && (
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Sector Category Tag
                  </label>
                  <CategoryCombobox
                    categories={categories}
                    selectedCategory={modalCategory}
                    onChange={(cat) => setModalCategory(cat)}
                    placeholder="Search or type sector (e.g. Pharmacy, Supplements, Clothes, Streaming)..."
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Direct category tag for this account (e.g. Farmacia, Integratori, Abbigliamento, Software).
                  </p>
                </div>
              )}

              {modalRole === 'person' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Marked as a personal contact. Excluded from retail chain and sector categorization.</span>
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
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingClassification}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  {savingClassification ? 'Saving...' : 'Save Classification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rapid Triage Onboarding Wizard Modal (Temporary on this branch) */}
      {onboardingOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-800">
                  <Sparkles className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Revisione Rapida Account
                  </h2>
                  <p className="text-xs text-slate-500">
                    Classificazione a 1 clic con scorciatoie da tastiera
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOnboardingOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
                title="Chiudi (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {onboardingCompleted || legacyIndependentAccounts.length === 0 ? (
              /* All Done State */
              <div className="py-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Tutto completato! 🎉
                  </h3>
                  <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
                    Tutti i tuoi account sono stati aggiornati con successo ai nuovi ruoli e le categorie esistenti sono state preservate.
                  </p>
                </div>
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setOnboardingOpen(false);
                      loadData();
                    }}
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-xs transition"
                  >
                    Chiudi e torna alla pagina
                  </button>
                </div>
              </div>
            ) : currentOnboardingAccount ? (
              /* Wizard Step */
              <div className="mt-5 space-y-5">
                {/* Progress bar */}
                <div>
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-600 mb-1.5">
                    <span>Account {onboardingIndex + 1} di {legacyIndependentAccounts.length}</span>
                    <span>{Math.round(((onboardingIndex) / legacyIndependentAccounts.length) * 100)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${((onboardingIndex) / legacyIndependentAccounts.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Account card highlight */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] font-mono text-slate-400 block mb-0.5">
                        #{currentOnboardingAccount.id}
                      </span>
                      <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                        {currentOnboardingAccount.name}
                      </h3>
                    </div>
                    {currentOnboardingAccount.category && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200/60">
                        <TagIcon className="w-3.5 h-3.5" />
                        <span>Categoria: {currentOnboardingAccount.category}</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Scegli il tipo appropriato: la categoria attuale verrà mantenuta intatta.
                  </p>
                </div>

                {/* Big Action Buttons Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {/* [1] Physical Store */}
                  <button
                    type="button"
                    disabled={onboardingSaving}
                    onClick={() => handleQuickClassify('physical_store')}
                    className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 hover:border-emerald-400 text-left transition group cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <div className="flex items-center justify-between">
                      <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200 transition">
                        <Store className="w-5 h-5" />
                      </div>
                      <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-emerald-200 text-emerald-900">
                        1
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <span className="font-bold text-sm text-emerald-950 block">
                        Negozio Fisico
                      </span>
                      <span className="text-[11px] text-emerald-800/80 block mt-0.5">
                        Negozio o bottega locale
                      </span>
                    </div>
                  </button>

                  {/* [2] E-Commerce */}
                  <button
                    type="button"
                    disabled={onboardingSaving}
                    onClick={() => handleQuickClassify('ecommerce')}
                    className="p-3.5 rounded-xl border border-sky-200 bg-sky-50/40 hover:bg-sky-50 hover:border-sky-400 text-left transition group cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <div className="flex items-center justify-between">
                      <div className="p-2 rounded-lg bg-sky-100 text-sky-700 group-hover:bg-sky-200 transition">
                        <Globe className="w-5 h-5" />
                      </div>
                      <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-sky-200 text-sky-900">
                        2
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <span className="font-bold text-sm text-sky-950 block">
                        E-Commerce
                      </span>
                      <span className="text-[11px] text-sky-800/80 block mt-0.5">
                        Store online o piattaforma web
                      </span>
                    </div>
                  </button>

                  {/* [3] Service / Utility */}
                  <button
                    type="button"
                    disabled={onboardingSaving}
                    onClick={() => handleQuickClassify('service')}
                    className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/40 hover:bg-purple-50 hover:border-purple-400 text-left transition group cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <div className="flex items-center justify-between">
                      <div className="p-2 rounded-lg bg-purple-100 text-purple-700 group-hover:bg-purple-200 transition">
                        <Zap className="w-5 h-5" />
                      </div>
                      <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-purple-200 text-purple-900">
                        3
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <span className="font-bold text-sm text-purple-950 block">
                        Servizio / Utenza
                      </span>
                      <span className="text-[11px] text-purple-800/80 block mt-0.5">
                        Abbonamenti, software, bollette
                      </span>
                    </div>
                  </button>

                  {/* [4] Person */}
                  <button
                    type="button"
                    disabled={onboardingSaving}
                    onClick={() => handleQuickClassify('person')}
                    className="p-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 hover:border-slate-400 text-left transition group cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <div className="flex items-center justify-between">
                      <div className="p-2 rounded-lg bg-slate-100 text-slate-700 group-hover:bg-slate-200 transition">
                        <User className="w-5 h-5" />
                      </div>
                      <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-slate-200 text-slate-800">
                        4
                      </span>
                    </div>
                    <div className="mt-2.5">
                      <span className="font-bold text-sm text-slate-900 block">
                        Persona
                      </span>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        Contatto personale o privato
                      </span>
                    </div>
                  </button>
                </div>

                {/* Footer helpers */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const acc = currentOnboardingAccount;
                      setOnboardingOpen(false);
                      openClassifyModal(acc);
                    }}
                    className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
                  >
                    È una filiale di catena? Configura in dettaglio →
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={onboardingSaving}
                      onClick={() => {
                        if (onboardingIndex + 1 < legacyIndependentAccounts.length) {
                          setOnboardingIndex((i) => i + 1);
                        } else {
                          setOnboardingCompleted(true);
                        }
                      }}
                      className="px-3 py-1.5 text-slate-500 hover:text-slate-800 font-medium transition"
                    >
                      Salta
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
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
                className="text-slate-400 hover:text-slate-600"
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
                  Sector Category Tag
                </label>
                <CategoryCombobox
                  categories={categories}
                  selectedCategory={compFormCategory}
                  onChange={(cat) => setCompFormCategory(cat)}
                  placeholder="Search or create sector (e.g. Supermarket, Gas Station)..."
                />
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
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCompany}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
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
