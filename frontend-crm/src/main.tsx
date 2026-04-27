import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { UIProvider } from './ui/Dialogs';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/admin">
      <UIProvider>
        <App />
      </UIProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
