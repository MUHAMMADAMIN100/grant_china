import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CRM деплоится по пути /admin (и на собственном домене grant-china-crm.vercel.app/admin,
// и проксируется через grantchina.tj/admin). Поэтому base = '/admin/'.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { port: 5174 },
});
