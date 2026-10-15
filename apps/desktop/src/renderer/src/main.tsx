import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary scope="shell" shell><App /></AppErrorBoundary>
  </React.StrictMode>,
);
