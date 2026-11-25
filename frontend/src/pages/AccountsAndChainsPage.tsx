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
import { ExpenseAccountsTab } from '../components/accounts/ExpenseAccountsTab';
import { ChainsTab } from '../components/accounts/ChainsTab';
import { AccountFilter } from '../components/accounts/roleUtils';
import { AlertCircle, Building2, RefreshCw, Store, Wallet } from 'lucide-react';

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

  const handleViewBranches = (companyName: string) => {
    setSearch(companyName);
    setFilter('chains');
    setActiveTab('accounts');
  };

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
        <ExpenseAccountsTab
          accounts={accounts}
          loading={loading}
          search={search}
          filter={filter}
          onSearchChange={setSearch}
          onFilterChange={setFilter}
          onEditAccount={openClassifyModal}
        />
      ) : activeTab === 'chains' ? (
        /* TAB 2: Chains Management */
        <ChainsTab
          companies={companies}
          loading={loading}
          onNewChain={() => openCompanyModal()}
          onEditChain={(comp) => openCompanyModal(comp)}
          onDeleteChain={handleDeleteCompany}
          onViewBranches={handleViewBranches}
        />
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
