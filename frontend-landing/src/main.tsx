import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import StudentLogin from './pages/StudentLogin';
import StudentCabinet from './pages/StudentCabinet';
import ProgramsCatalog from './pages/ProgramsCatalog';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<StudentLogin />} />
        <Route path="/cabinet" element={<StudentCabinet />} />
        <Route path="/programs" element={<ProgramsCatalog />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
