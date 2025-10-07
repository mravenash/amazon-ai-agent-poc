import './App.css';
import '@cloudscape-design/global-styles/index.css';
import { Suspense, lazy } from 'react';
import { Spinner } from '@cloudscape-design/components';

const AppShell = lazy(() => import('./components/AppShell'));

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="center-fullvh">
          <Spinner size="large" />
        </div>
      }
    >
      <AppShell />
    </Suspense>
  );
}
