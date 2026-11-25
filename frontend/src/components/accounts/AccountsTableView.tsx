import React from 'react';
import { Building2, Tag as TagIcon } from 'lucide-react';
import { FireflyExpenseAccount } from '../../types';
import { BusinessTypePills } from './BusinessTypePills';
import { AccountFilter, normalizeRole, ROLE_META } from './roleUtils';

interface AccountsTableViewProps {
  accounts: FireflyExpenseAccount[];
  filter: AccountFilter;
  onEditAccount: (account: FireflyExpenseAccount) => void;
}

export const AccountsTableView: React.FC<AccountsTableViewProps> = ({
  accounts,
  filter,
  onEditAccount,
}) => {
  const showRoleCol = filter === 'all';
  const showChainCol = filter === 'all' || filter === 'chains';
  const showBusinessTypesCol =
    filter === 'all' || filter === 'chains' || filter === 'local_business';
  const showCategoryCol =
    filter === 'all' ||
    filter === 'local_business' ||
    filter === 'ecommerce' ||
    filter === 'service';

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="py-3 px-4">Account</th>
            {showRoleCol && <th className="py-3 px-4">Role</th>}
            {showChainCol && (
              <th className="py-3 px-4">{filter === 'chains' ? 'Parent Chain' : 'Chain'}</th>
            )}
            {showBusinessTypesCol && <th className="py-3 px-4">Business Types</th>}
            {showCategoryCol && <th className="py-3 px-4">Category / Sector Tag</th>}
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
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
              <tr key={acc.id} className="hover:bg-slate-50/80 transition">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`p-1.5 rounded-md shrink-0 ${roleMeta.iconWrapperClass}`}>
                      <RoleIcon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 truncate" title={acc.name}>
                          {acc.name}
                        </span>
                        {!acc.active && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            Inactive
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 font-mono">#{acc.id}</span>
                    </div>
                  </div>
                </td>

                {showRoleCol && (
                  <td className="py-3 px-4 whitespace-nowrap">
                    {!isUnclassified ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleMeta.tableBadgeClass}`}
                      >
                        {roleMeta.tableLabel}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                )}

                {showChainCol && (
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

                {showBusinessTypesCol && (
                  <td className="py-3 px-4">
                    {acc.effective_business_types && acc.effective_business_types.length > 0 ? (
                      <BusinessTypePills
                        types={acc.effective_business_types}
                        inheritedTypes={acc.inherited_business_types}
                        dense
                      />
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                )}

                {showCategoryCol && (
                  <td className="py-3 px-4">
                    {supportsCategory && acc.category ? (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${roleMeta.tableCategoryBadgeClass}`}
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
                    onClick={() => onEditAccount(acc)}
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
  );
};
