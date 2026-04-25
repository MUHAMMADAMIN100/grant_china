import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import App from './App';
import StudentLogin from './pages/StudentLogin';
import StudentCabinet from './pages/StudentCabinet';
import { initAnalytics, trackPageView } from './analytics';
import './index.css';

initAnalytics();

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteTracker />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<StudentLogin />} />
        <Route path="/cabinet" element={<StudentCabinet />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
