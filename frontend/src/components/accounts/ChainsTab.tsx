import React from 'react';
import { Building2, Edit2, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { Company } from '../../types';

interface ChainsTabProps {
  companies: Company[];
  loading: boolean;
  onNewChain: () => void;
  onEditChain: (company: Company) => void;
  onDeleteChain: (company: Company) => void;
  onViewBranches: (companyName: string) => void;
}

export const ChainsTab: React.FC<ChainsTabProps> = ({
  companies,
  loading,
  onNewChain,
  onEditChain,
  onDeleteChain,
  onViewBranches,
}) => {
  return (
    <div className="mt-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Parent Retail Chains</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Chains group individual store branches (e.g. Conad, Lidl) and define default
            business types that all branches inherit.
          </p>
        </div>
        <button
          onClick={onNewChain}
          className="inline-flex items-center px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          New Chain
        </button>
      </div>

      {loading && companies.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          Loading parent retail chains...
        </div>
      ) : companies.length === 0 ? (
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
                        <span className="text-[11px] text-slate-400 italic mt-0.5 block">
                          No types set
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEditChain(comp)}
                      aria-label={`Edit ${comp.name}`}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition cursor-pointer"
                      title="Edit Chain"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteChain(comp)}
                      aria-label={`Delete ${comp.name}`}
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
                  type="button"
                  onClick={() => onViewBranches(comp.name)}
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
  );
};
