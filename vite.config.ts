import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works under GitHub Pages' /<repo>/ prefix.
  base: './',
  plugins: [react()],
});
