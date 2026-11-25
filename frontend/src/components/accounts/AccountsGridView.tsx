import React from 'react';
import { Building2, Tag as TagIcon } from 'lucide-react';
import { FireflyExpenseAccount } from '../../types';
import { BusinessTypePills } from './BusinessTypePills';
import { normalizeRole, ROLE_META } from './roleUtils';

interface AccountsGridViewProps {
  accounts: FireflyExpenseAccount[];
  onEditAccount: (account: FireflyExpenseAccount) => void;
}

export const AccountsGridView: React.FC<AccountsGridViewProps> = ({
  accounts,
  onEditAccount,
}) => {
  return (
    <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
      {accounts.map((acc) => {
        const effectiveRole = normalizeRole(acc.role, acc.company_id);
        const isUnclassified = effectiveRole === 'unclassified';
        const roleMeta = ROLE_META[effectiveRole];
        const RoleIcon = roleMeta.icon;
        const supportsCategory =
          effectiveRole === 'local_business' ||
          effectiveRole === 'ecommerce' ||
          effectiveRole === 'service';

        return (
          <div
            key={acc.id}
            className={`p-4 rounded-xl border bg-white shadow-xs transition flex flex-col justify-between ${roleMeta.cardBorderClass}`}
          >
            <div>
              {/* Card Header: Icon, Name, ID & Action Button */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start space-x-2.5 min-w-0">
                  <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${roleMeta.iconWrapperClass}`}>
                    <RoleIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      className="font-semibold text-sm text-slate-900 leading-snug truncate"
                      title={acc.name}
                    >
                      {acc.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-400 font-mono">#{acc.id}</span>
                      {!acc.active && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onEditAccount(acc)}
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
                  {effectiveRole === 'chain' ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 truncate">
                        <Building2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span className="truncate font-medium text-slate-800">
                          {acc.company_name || 'Chain Branch'}
                        </span>
                      </div>

                      <BusinessTypePills
                        types={acc.effective_business_types}
                        inheritedTypes={acc.inherited_business_types}
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={`flex items-center gap-1.5 font-medium truncate ${roleMeta.cardHeaderTextClass}`}
                        >
                          <RoleIcon
                            className={`w-3.5 h-3.5 shrink-0 ${roleMeta.cardHeaderIconClass}`}
                          />
                          <span>{roleMeta.label}</span>
                        </div>
                        {supportsCategory && acc.category && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${roleMeta.cardCategoryBadgeClass}`}
                          >
                            <TagIcon className="w-2.5 h-2.5 opacity-70" />
                            {acc.category}
                          </span>
                        )}
                      </div>

                      {effectiveRole === 'local_business' && (
                        <BusinessTypePills types={acc.effective_business_types} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
