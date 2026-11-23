import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { ReceiptWorkbenchProvider } from './context/ReceiptWorkbenchContext';
import { CatalogPage } from './pages/CatalogPage';
import { ReceiptWorkbenchPage } from './pages/ReceiptWorkbenchPage';
import { AccountsAndChainsPage } from './pages/AccountsAndChainsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { AppTab } from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('workbench');

  return (
    <ReceiptWorkbenchProvider>
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="flex-1">
          {(activeTab === 'accounts-and-chains' || activeTab === 'stores') && <AccountsAndChainsPage />}
          {activeTab === 'catalog' && <CatalogPage />}
          {activeTab === 'workbench' && <ReceiptWorkbenchPage />}
          {activeTab === 'workflows' && <WorkflowsPage />}
        </main>
        <footer className="border-t border-slate-200 py-6 bg-white text-center text-xs text-slate-400">
          Firefly III Companion Hub • Local Database: SQLite • API: FastAPI & Python 3
        </footer>
      </div>
    </ReceiptWorkbenchProvider>
  );
}

export default App;
