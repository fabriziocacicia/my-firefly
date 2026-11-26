import React, { useEffect, useState } from 'react';
import { BarChart3, Filter } from 'lucide-react';
import { api } from '../../api/client';
import { Tag, TagAnalyticsResponse } from '../../types';

interface CatalogAnalyticsTabProps {
  tags: Tag[];
  availableCategories: string[];
}

export const CatalogAnalyticsTab: React.FC<CatalogAnalyticsTabProps> = ({
  tags,
  availableCategories,
}) => {
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [data, setData] = useState<TagAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.analytics
      .getTagAnalytics({
        tag_ids: selectedTagIds,
        category_name: selectedCategory || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      })
      .then(res => {
        if (active) setData(res);
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load analytics');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTagIds, selectedCategory, startDate, endDate]);

  const toggleTag = (tagId: number) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  return (
    <div className="space-y-5">
      {/* Multi-Tag & Date Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">
              Multi-Tag Intersection &amp; Unit Price Analytics
            </h2>
          </div>
          {selectedTagIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTagIds([])}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 self-start sm:self-auto"
            >
              Clear tag filter ({selectedTagIds.length})
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Select one or more tags to combine them (AND intersection, e.g.{' '}
          <strong>Frutta</strong> + <strong>Bio</strong>). Descendant tags such as{' '}
          <strong>Mele → Frutta</strong> are included automatically.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 ? (
            <span className="text-xs text-slate-400">No tags available yet.</span>
          ) : (
            tags.map(tag => {
              const selected = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    selected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  #{tag.name}
                </button>
              );
            })
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Firefly Category
            </label>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="">All Categories</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <span className="text-xs font-semibold text-slate-500 block">
              Total Spend
            </span>
            <strong className="text-2xl font-bold text-slate-900 mt-1 block">
              €{data.total_spend.toFixed(2)}
            </strong>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <span className="text-xs font-semibold text-slate-500 block">
              Matching Items
            </span>
            <strong className="text-2xl font-bold text-slate-900 mt-1 block">
              {data.matching_item_count}
            </strong>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <span className="text-xs font-semibold text-slate-500 block">
              Recorded Purchases
            </span>
            <strong className="text-2xl font-bold text-slate-900 mt-1 block">
              {data.total_purchases}
            </strong>
          </div>
        </div>
      )}

      {/* Item Breakdown Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Computing spending &amp; unit prices...
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center">
            <BarChart3 className="w-6 h-6 text-slate-300 mb-2" />
            No items match the selected tags and filters.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Item</th>
                <th className="px-3 py-3 text-left font-semibold">Category &amp; Tags</th>
                <th className="px-3 py-3 text-right font-semibold">Purchases</th>
                <th className="px-3 py-3 text-right font-semibold">Latest Unit</th>
                <th className="px-3 py-3 text-right font-semibold">Min / Median</th>
                <th className="px-4 py-3 text-right font-semibold">Total Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map(item => (
                <tr key={item.product_id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{item.product_name}</div>
                    {item.brand_name && (
                      <div className="text-[11px] text-slate-400">{item.brand_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.firefly_category_name && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium text-[10px]">
                          {item.firefly_category_name}
                        </span>
                      )}
                      {item.effective_tag_names.map(tName => (
                        <span
                          key={tName}
                          className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]"
                        >
                          #{tName}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700">
                    {item.purchase_count}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-slate-700">
                    {item.latest_unit_price !== null && item.latest_unit_price !== undefined
                      ? `€${item.latest_unit_price.toFixed(2)} ${item.normalized_unit_label}`
                      : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-500">
                    {item.min_unit_price !== null && item.min_unit_price !== undefined
                      ? `€${item.min_unit_price.toFixed(2)} / €${(
                          item.median_unit_price ?? item.min_unit_price
                        ).toFixed(2)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    €{item.total_spend.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
