// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(registrations => registrations.forEach(reg => reg.unregister()))
    .catch(() => {});
}

if ('caches' in window) {
  caches.keys()
    .then(keys => keys.forEach(key => caches.delete(key)))
    .catch(() => {});
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
