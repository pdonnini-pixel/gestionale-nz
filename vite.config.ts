import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Il commit da cui e' stato costruito quello che il browser sta scaricando.
// Netlify lo passa come COMMIT_REF; fuori da Netlify vale 'dev'.
const commitRef = process.env.COMMIT_REF || process.env.GITHUB_SHA || 'dev'

// Scrive il commit dentro index.html. Serve al controllo pixel, che altrimenti
// non sa se il sito che sta guardando e' gia' la versione appena pubblicata:
// anche quella vecchia risponde 200, e un verde su un sito vecchio non vale
// niente. Costa un meta tag e toglie ogni dubbio.
function markerVersione(): Plugin {
  return {
    name: 'marker-versione',
    transformIndexHtml: {
      order: 'pre',
      handler: () => ({
        tags: [
          {
            tag: 'meta',
            attrs: { name: 'app-commit', content: commitRef },
            injectTo: 'head' as const,
          },
        ],
      }),
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), markerVersione()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks — separare le dipendenze pesanti
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['pdfjs-dist'],
        }
      }
    },
    chunkSizeWarningLimit: 600, // Alza leggermente il warning limit
  }
})
