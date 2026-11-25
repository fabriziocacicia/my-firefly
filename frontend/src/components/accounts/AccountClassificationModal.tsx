import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, HelpCircle, User, X } from 'lucide-react';
import { api } from '../../api/client';
import { Company, FireflyExpenseAccount } from '../../types';
import { BusinessTypesTagInput } from '../common/BusinessTypesTagInput';
import { CategoryCombobox } from '../common/CategoryCombobox';
import { CompanyCombobox, CompanySelection } from '../common/CompanyCombobox';
import {
  EffectiveAccountRole,
  normalizeRole,
  ROLE_META,
  ROLE_ORDER,
} from './roleUtils';

interface AccountClassificationModalProps {
  account: FireflyExpenseAccount;
  companies: Company[];
  categories: string[];
  allAvailableBusinessTypes: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function getInitialBusinessTypes(
  account: FireflyExpenseAccount,
  effectiveRole: EffectiveAccountRole,
  companies: Company[]
): string[] {
  const rawBusinessTypes = account.business_types || [];
  if (effectiveRole !== 'chain') return rawBusinessTypes;

  const comp = companies.find((c) => c.id === account.company_id);
  const inherited = comp?.business_types?.length
    ? comp.business_types
    : account.inherited_business_types || [];
  const inheritedLower = new Set(inherited.map((t) => t.trim().toLowerCase()));
  return rawBusinessTypes.filter((t) => !inheritedLower.has(t.trim().toLowerCase()));
}

export const AccountClassificationModal: React.FC<AccountClassificationModalProps> = ({
  account,
  companies,
  categories,
  allAvailableBusinessTypes,
  onClose,
  onSaved,
}) => {
  const initialRole = normalizeRole(account.role, account.company_id);
  const supportsInitialCategory = ['local_business', 'ecommerce', 'service'].includes(
    initialRole
  );

  const [modalRole, setModalRole] = useState<EffectiveAccountRole>(initialRole);
  const [modalCompanySelection, setModalCompanySelection] =
    useState<CompanySelection | null>({
      companyId: account.company_id ?? null,
      companyName: account.company_name ?? '',
      isNew: false,
    });
  const [modalCategory, setModalCategory] = useState<string | null>(
    supportsInitialCategory ? account.category || null : null
  );
  const [modalBusinessTypes, setModalBusinessTypes] = useState<string[]>(() =>
    getInitialBusinessTypes(account, initialRole, companies)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const selectedChainCompany = useMemo(() => {
    if (modalRole !== 'chain' || !modalCompanySelection?.companyId) return null;
    return companies.find((c) => c.id === modalCompanySelection.companyId) || null;
  }, [modalRole, modalCompanySelection, companies]);

  const chainInheritedTypes = useMemo(() => {
    return selectedChainCompany?.business_types || [];
  }, [selectedChainCompany]);

  // Ensure branch-specific types never duplicate types inherited from the selected chain
  useEffect(() => {
    if (modalRole === 'chain' && chainInheritedTypes.length > 0) {
      const inheritedLower = new Set(
        chainInheritedTypes.map((t) => t.trim().toLowerCase())
      );
      setModalBusinessTypes((prev) =>
        prev.filter((t) => !inheritedLower.has(t.trim().toLowerCase()))
      );
    }
  }, [modalRole, chainInheritedTypes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      let companyId: number | null = null;
      let category: string | null = null;
      let businessTypes: string[] = [];

      if (modalRole === 'chain') {
        if (
          !modalCompanySelection?.companyId &&
          !modalCompanySelection?.companyName?.trim()
        ) {
          setError('Please select or enter a parent retail chain name.');
          setSaving(false);
          return;
        }

        if (modalCompanySelection.isNew && modalCompanySelection.companyName.trim()) {
          const created = await api.companies.create({
            name: modalCompanySelection.companyName.trim(),
            business_types:
              modalBusinessTypes.length > 0 ? modalBusinessTypes : undefined,
          });
          companyId = created.id;
          // The new chain owns these business_types; branch inherits them without duplicating
          businessTypes = [];
        } else {
          companyId = modalCompanySelection.companyId ?? null;
          const inheritedLower = new Set(
            chainInheritedTypes.map((t) => t.trim().toLowerCase())
          );
          businessTypes = modalBusinessTypes.filter(
            (t) => !inheritedLower.has(t.trim().toLowerCase())
          );
        }

        if (!companyId) {
          setError('Please select a valid parent chain.');
          setSaving(false);
          return;
        }
      } else if (modalRole === 'local_business') {
        category = modalCategory?.trim() || null;
        businessTypes = modalBusinessTypes;
      } else if (modalRole === 'ecommerce' || modalRole === 'service') {
        category = modalCategory?.trim() || null;
        businessTypes = [];
      }

      await api.accounts.updateMetadata(account.id, {
        role: modalRole,
        company_id: companyId,
        category,
        business_types: businessTypes,
      });

      await onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save classification');
    } finally {
      setSaving(false);
    }
  };

  const ActiveRoleIcon = ROLE_META[modalRole].icon;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="classify-account-title"
    >
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <ActiveRoleIcon className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="classify-account-title"
                className="text-base font-bold text-slate-900 leading-tight"
              >
                Classify: {account.name}
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                Firefly Account #{account.id}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Role Selection Grid */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Account Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_ORDER.map((roleKey) => {
                const meta = ROLE_META[roleKey];
                const Icon = meta.icon;
                const isSelected = modalRole === roleKey;

                return (
                  <button
                    key={roleKey}
                    type="button"
                    onClick={() => setModalRole(roleKey)}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition cursor-pointer ${
                      isSelected
                        ? meta.modalTileActiveClass
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isSelected ? meta.modalIconActiveClass : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <span className="font-semibold text-xs block">{meta.label}</span>
                      <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">
                        {meta.description}
                      </span>
                    </div>
                  </button>
                );
              })}
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
                  initialNewName={
                    modalCompanySelection?.isNew
                      ? modalCompanySelection.companyName
                      : ''
                  }
                  onChange={(sel) => setModalCompanySelection(sel)}
                  placeholder="Search or type new chain (e.g. Conad, Lidl, Eni)..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Branch Business Types
                </label>
                <BusinessTypesTagInput
                  value={modalBusinessTypes}
                  onChange={setModalBusinessTypes}
                  inheritedTypes={chainInheritedTypes}
                  allAvailableTypes={allAvailableBusinessTypes}
                  placeholder="Add branch-specific type (e.g. Bar/Cafe, Carwash)..."
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Types with badge <strong>Chain:</strong> are inherited automatically
                  from the parent chain. You can add extra types specific to this branch.
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
                  allAvailableTypes={allAvailableBusinessTypes}
                  placeholder="Add business type (e.g. Bar/Cafe, Tobacconist, Pharmacy)..."
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Physical business types that describe this venue (multiple types
                  supported, e.g. Bar + Tobacconist).
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
                Category tag indicating what this{' '}
                {modalRole === 'ecommerce' ? 'online shop' : 'service'} provides.
              </p>
            </div>
          )}

          {modalRole === 'person' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2">
              <User className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                Marked as a person. Excluded from retail chain and business type
                categorization.
              </span>
            </div>
          )}

          {modalRole === 'unclassified' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
              <span>
                Standard account with no assigned role. You can classify it at any time.
              </span>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
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
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Classification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
