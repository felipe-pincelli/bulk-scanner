import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH é definido no GitHub Actions ("/bulk-scanner/"), pois o GitHub Pages
// publica o site em https://<usuario>.github.io/bulk-scanner/.
// Localmente fica "/" (http://localhost:5173/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
});
