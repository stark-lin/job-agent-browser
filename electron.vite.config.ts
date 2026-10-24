import { en } from './src/shared/i18n/locales/en'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, cpSync } from 'node:fs'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), { name: 'profile-pdf-worker', writeBundle() {
      mkdirSync(resolve(__dirname, 'out/main'), { recursive: true })
      cpSync(resolve(__dirname, 'resources/fonts'), resolve(__dirname, 'out/main/fonts'), { recursive: true })
      copyFileSync(resolve(__dirname, 'src/platform/import/pdf-worker.mjs'), resolve(__dirname, 'out/main/pdf-worker.mjs'))
    } }],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/platform/electron/main/index.ts'),
          'job-agent-mcp': resolve(__dirname, 'src/platform/mcp-server/stdio.ts'),
          'resume-output-worker': resolve(__dirname, 'src/platform/resume-output/worker.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/platform/electron/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), {
      name: 'application-title',
      transformIndexHtml: (html) => html.replace('%APP_TITLE%', en.app.title)
    }],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
