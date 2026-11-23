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
} from 'lucide-react';

export const AccountsAndChainsPage: React.FC = () => {
  const [accounts, setAccounts] = useState<FireflyExpenseAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'chains' | 'independent' | 'person' | 'unclassified'>('all');
  const [activeTab, setActiveTab] = useState<'accounts' | 'chains'>('accounts');
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 48;

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // Company Link Modal for Chain branches
  const [assigningAccount, setAssigningAccount] = useState<FireflyExpenseAccount | null>(null);
  const [companySelection, setCompanySelection] = useState<CompanySelection | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Manage Companies State
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [compFormName, setCompFormName] = useState('');
  const [compFormCategory, setCompFormCategory] = useState<string | null>(null);
  const [compFormNotes, setCompFormNotes] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  // Inline Triage Updating State
  const [updatingAccountId, setUpdatingAccountId] = useState<number | null>(null);
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

  // Quick Role Triage Handler
  const handleRoleChange = async (acc: FireflyExpenseAccount, newRole: AccountRole) => {
    if (acc.role === newRole && newRole !== 'chain') return;

    if (newRole === 'chain') {
      openAssignModal(acc);
      return;
    }

    setUpdatingAccountId(acc.id);
    try {
      await api.accounts.updateMetadata(acc.id, {
        role: newRole,
        category: newRole === 'independent' ? acc.category || null : null,
        company_id: null,
      });

      // Update local state optimistically
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === acc.id
            ? {
                ...item,
                role: newRole,
                company_id: null,
                company_name: null,
                category: newRole === 'independent' ? item.category : null,
                is_inherited_category: false,
              }
            : item
        )
      );

      // Refresh categories in background if needed
      const updatedCats = await api.categories.list();
      setCategories(updatedCats);
    } catch (err: any) {
      alert(`Failed to update account role: ${err.message}`);
    } finally {
      setUpdatingAccountId(null);
    }
  };

  // Direct Category Change for Independent Store
  const handleDirectCategoryChange = async (acc: FireflyExpenseAccount, newCategory: string | null) => {
    setUpdatingAccountId(acc.id);
    try {
      await api.accounts.updateMetadata(acc.id, {
        role: 'independent',
        category: newCategory,
        company_id: null,
      });

      setAccounts((prev) =>
        prev.map((item) =>
          item.id === acc.id
            ? { ...item, role: 'independent', category: newCategory, is_inherited_category: false }
            : item
        )
      );

      const updatedCats = await api.categories.list();
      setCategories(updatedCats);
    } catch (err: any) {
      alert(`Failed to update category: ${err.message}`);
    } finally {
      setUpdatingAccountId(null);
    }
  };

  // Open modal to link chain
  const openAssignModal = (acc: FireflyExpenseAccount) => {
    setAssigningAccount(acc);
    setCompanySelection({
      companyId: acc.company_id ?? null,
      companyName: acc.company_name ?? '',
      isNew: false,
    });
    setLinkError(null);
  };

  // Save chain assignment
  const handleSaveCompanyAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningAccount) return;

    setSavingLink(true);
    setLinkError(null);
    try {
      let targetCompanyId = companySelection?.companyId ?? null;

      if (companySelection?.isNew && companySelection.companyName.trim()) {
        const created = await api.companies.create({
          name: companySelection.companyName.trim(),
        });
        targetCompanyId = created.id;
      }

      if (!targetCompanyId) {
        // Unlinking
        await api.accounts.updateMetadata(assigningAccount.id, {
          role: 'unclassified',
          company_id: null,
          category: null,
        });
      } else {
        await api.accounts.updateMetadata(assigningAccount.id, {
          role: 'chain',
          company_id: targetCompanyId,
        });
      }

      setAssigningAccount(null);
      await loadData();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to assign chain');
    } finally {
      setSavingLink(false);
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
      if (filter === 'independent') return effectiveRole === 'independent';
      if (filter === 'person') return effectiveRole === 'person';
      if (filter === 'unclassified') return effectiveRole === 'unclassified';
      return true;
    });
  }, [accounts, search, filter]);

  // Counts for filter chips
  const counts = useMemo(() => {
    let chains = 0;
    let independent = 0;
    let person = 0;
    let unclassified = 0;

    for (const a of accounts) {
      const effectiveRole: AccountRole = a.role || (a.company_id ? 'chain' : 'unclassified');
      if (effectiveRole === 'chain') chains++;
      else if (effectiveRole === 'independent') independent++;
      else if (effectiveRole === 'person') person++;
      else unclassified++;
    }

    return { all: accounts.length, chains, independent, person, unclassified };
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
                onClick={() => setFilter('independent')}
                className={`px-2.5 py-1.5 rounded-md transition ${
                  filter === 'independent' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Independent ({counts.independent})
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
          </div>

          {/* Accounts Grid */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              <div className="col-span-full py-16 text-center text-slate-400 text-sm">
                Loading expense accounts from Firefly III...
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="col-span-full py-16 text-center text-slate-400 text-sm">
                No accounts match the current search or filter.
              </div>
            ) : (
              paginatedAccounts.map((acc) => {
                const effectiveRole: AccountRole = acc.role || (acc.company_id ? 'chain' : 'unclassified');
                const isUpdating = updatingAccountId === acc.id;

                return (
                  <div
                    key={acc.id}
                    className={`p-4 rounded-xl border bg-white shadow-xs transition flex flex-col justify-between ${
                      effectiveRole === 'chain'
                        ? 'border-indigo-100 hover:border-indigo-200'
                        : effectiveRole === 'independent'
                        ? 'border-emerald-100 hover:border-emerald-200'
                        : effectiveRole === 'person'
                        ? 'border-slate-200 bg-slate-50/60'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      {/* Card Header: Icon, Name & ID */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start space-x-2.5 min-w-0">
                          <div
                            className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                              effectiveRole === 'chain'
                                ? 'bg-indigo-50 text-indigo-600'
                                : effectiveRole === 'independent'
                                ? 'bg-emerald-50 text-emerald-600'
                                : effectiveRole === 'person'
                                ? 'bg-slate-200 text-slate-600'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {effectiveRole === 'chain' ? (
                              <Building2 className="w-4 h-4" />
                            ) : effectiveRole === 'independent' ? (
                              <Store className="w-4 h-4" />
                            ) : effectiveRole === 'person' ? (
                              <User className="w-4 h-4" />
                            ) : (
                              <HelpCircle className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-sm text-slate-900 leading-snug truncate">
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

                        {/* Chain link button if role is chain */}
                        {effectiveRole === 'chain' && (
                          <button
                            onClick={() => openAssignModal(acc)}
                            className="text-xs px-2 py-1 rounded font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 shrink-0 transition"
                          >
                            {acc.company_id ? 'Edit Chain' : 'Link Chain'}
                          </button>
                        )}
                      </div>

                      {/* Fast Role Selector */}
                      <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Role</span>
                        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => handleRoleChange(acc, 'chain')}
                            className={`px-2 py-1 rounded-md transition ${
                              effectiveRole === 'chain'
                                ? 'bg-white text-indigo-700 shadow-xs'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="Chain Branch (inherits chain sector)"
                          >
                            Chain
                          </button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => handleRoleChange(acc, 'independent')}
                            className={`px-2 py-1 rounded-md transition ${
                              effectiveRole === 'independent'
                                ? 'bg-white text-emerald-700 shadow-xs'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="Independent Business (direct category tag)"
                          >
                            Shop
                          </button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => handleRoleChange(acc, 'person')}
                            className={`px-2 py-1 rounded-md transition ${
                              effectiveRole === 'person'
                                ? 'bg-white text-slate-800 shadow-xs'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="Personal Contact (no category tags)"
                          >
                            Person
                          </button>
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => handleRoleChange(acc, 'unclassified')}
                            className={`px-1.5 py-1 rounded-md transition ${
                              effectiveRole === 'unclassified'
                                ? 'bg-white text-amber-800 shadow-xs'
                                : 'text-slate-400 hover:text-slate-600'
                            }`}
                            title="Unclassified"
                          >
                            ?
                          </button>
                        </div>
                      </div>

                      {/* Role-Specific Body: Category or Chain Info */}
                      <div className="mt-3">
                        {effectiveRole === 'chain' ? (
                          <div className="flex flex-col gap-1.5 text-xs">
                            <div className="flex items-center justify-between text-slate-600 bg-indigo-50/50 p-2 rounded-lg">
                              <span className="flex items-center gap-1.5 font-medium truncate">
                                <Building2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                {acc.company_name ? acc.company_name : <span className="text-amber-600 italic">No Chain Linked</span>}
                              </span>
                              {acc.category && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800 shrink-0">
                                  {acc.category}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : effectiveRole === 'independent' ? (
                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              Sector Category
                            </label>
                            <CategoryCombobox
                              size="sm"
                              categories={categories}
                              selectedCategory={acc.category || null}
                              onChange={(cat) => handleDirectCategoryChange(acc, cat)}
                              placeholder="Set sector (e.g. Bakery, Pharmacy)..."
                            />
                          </div>
                        ) : effectiveRole === 'person' ? (
                          <div className="text-xs text-slate-500 italic py-1 flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            Personal Contact (excluded from store sectors)
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400 italic py-1">
                            Unclassified account (runs normally)
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

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

      {/* Assign Chain Modal */}
      {assigningAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Link Store to Chain</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Store: <strong className="text-slate-800">{assigningAccount.name}</strong>
                </p>
              </div>
              <button
                onClick={() => setAssigningAccount(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCompanyAssignment} className="mt-5 space-y-4">
              {linkError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{linkError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Parent Chain
                </label>
                <CompanyCombobox
                  companies={companies}
                  selectedCompanyId={companySelection?.companyId ?? null}
                  initialNewName={companySelection?.isNew ? companySelection.companyName : ''}
                  onChange={(sel) => setCompanySelection(sel)}
                  placeholder="Search or create parent chain (e.g. Conad, Lidl)..."
                />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Select an existing chain or type a new name to create it.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setAssigningAccount(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLink}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  {savingLink ? 'Saving...' : 'Save Link'}
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
