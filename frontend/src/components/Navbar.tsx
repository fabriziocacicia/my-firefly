import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { AppTab } from '../types';
import { Store, Tag, Sparkles, CheckCircle2, AlertCircle, ShoppingCart, Receipt } from 'lucide-react';

interface NavbarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, onTabChange }) => {
  const [status, setStatus] = useState<{ connected: boolean; version?: string } | null>(null);

  useEffect(() => {
    api.firefly.getStatus()
      .then(res => setStatus({ connected: res.connected, version: res.version }))
      .catch(() => setStatus({ connected: false }));
  }, []);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 gap-2">
          <div className="flex items-center space-x-2.5 shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div className="hidden md:block">
              <span className="font-bold text-lg text-slate-900 tracking-tight">Firefly Hub</span>
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Companion</span>
            </div>
          </div>

          <nav className="flex items-center space-x-1 sm:space-x-2 overflow-x-auto no-scrollbar py-1">
            <button
              onClick={() => onTabChange('stores')}
              className={`flex items-center px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'stores'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Store className="w-4 h-4 mr-1 sm:mr-1.5 shrink-0" />
              <span className="sm:hidden">Stores</span>
              <span className="hidden sm:inline">Companies & Stores</span>
            </button>

            <button
              onClick={() => onTabChange('catalog')}
              className={`flex items-center px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'catalog'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Tag className="w-4 h-4 mr-1 sm:mr-1.5 shrink-0" />
              <span className="sm:hidden">Catalog</span>
              <span className="hidden sm:inline">Products & Prices</span>
            </button>

            <button
              onClick={() => onTabChange('workbench')}
              className={`flex items-center px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'workbench'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Receipt className="w-4 h-4 mr-1 sm:mr-1.5 shrink-0" />
              <span className="sm:hidden">Workbench</span>
              <span className="hidden sm:inline">Receipt Workbench</span>
            </button>

            <button
              onClick={() => onTabChange('workflows')}
              className={`flex items-center px-2.5 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'workflows'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Sparkles className="w-4 h-4 mr-1 sm:mr-1.5 shrink-0" />
              <span className="sm:hidden">Workflows</span>
              <span className="hidden sm:inline">Quick Workflows</span>
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            {status ? (
              status.connected ? (
                <div className="flex items-center space-x-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 sm:px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-medium hidden lg:inline">Firefly {status.version || 'Connected'}</span>
                  <span className="font-medium lg:hidden">{status.version || 'Live'}</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200/80 px-2 sm:px-2.5 py-1 rounded-full">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span className="font-medium hidden sm:inline">Firefly Offline</span>
                </div>
              )
            ) : (
              <span className="text-xs text-slate-400">...</span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
