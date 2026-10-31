import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// assetsDir vazio: os arquivos saem todos na raiz (facilita o upload pelo site do GitHub)
export default defineConfig({ plugins: [react()], base: './', build: { assetsDir: '', chunkSizeWarningLimit: 900 } })
