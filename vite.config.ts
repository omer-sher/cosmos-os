import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // BASE_PATH is set by the Pages workflow (e.g. /cosmos-os/); local dev serves from /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173, host: true },
});
