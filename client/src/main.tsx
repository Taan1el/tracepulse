import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/roboto-mono';
import './styles/tokens.css';
import App from './App.js';
import { registerOffline } from './local/offline.js';
import { UpdateNotice } from './local/UpdateNotice.js';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UpdateNotice />
    <App />
  </React.StrictMode>
);

registerOffline();
