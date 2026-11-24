import { resolve } from 'node:path'
import { build } from 'esbuild'
import { addServerTemplate, defineNuxtModule } from 'nuxt/kit'

export default defineNuxtModule({
  meta: { name: 'studio-preview-picker' },
  setup (_, nuxt) {
    addServerTemplate({
      filename: '#studio-preview-picker',
      async getContents () {
        const { outputFiles } = await build({
          entryPoints: [resolve(nuxt.options.rootDir, 'app/runtime/preview-element-picker.ts')],
          bundle: true,
          format: 'iife',
          write: false,
        })
        return `export default ${JSON.stringify(outputFiles[0]!.text)}`
      },
    })
  },
})
