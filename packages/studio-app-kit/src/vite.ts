import type { Plugin, PluginOption } from 'vite'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Studio compiles Vuetify's Sass with ./settings.scss (14 px fields, 16 px
// card titles, denser lists, button weight). Vuetify's precompiled CSS uses
// the stock settings, so apps built with it look different inside Studio.
// This plugin swaps each Vuetify stylesheet for its Sass source compiled
// with Studio's settings, as vite-plugin-vuetify's `styles.configFile` does,
// so Studio's apps match it.

const settings = fileURLToPath(new URL('settings.scss', import.meta.url))
const prefix = 'virtual:studio-vuetify:'

// occt-import-js (the STEP parser, ADR 0039) is built with Emscripten's
// embind, which creates its function wrappers with `new Function(...)`. App
// frames forbid that (`script-src` has no 'unsafe-eval', ADR 0017), so STEP
// failed in the 3D Models app. This replaces embind's craftInvokerFunction
// and __emval_get_method_caller with the closures Emscripten itself uses
// when built with DYNAMIC_EXECUTION=0: the same conversions, without
// evaluating code.

const occtModule = /[/\\]occt-import-js[/\\]dist[/\\]occt-import-js\.js$/

const evalFreeInvoker = `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){
  var argCount=argTypes.length;
  if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}
  var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
  var needsDestructorStack=usesDestructorStack(argTypes);
  var returns=argTypes[0].name!=="void";
  var paramDestructors=[];
  if(!needsDestructorStack){for(var i=isClassMethodFunc?1:2;i<argCount;++i){if(argTypes[i].destructorFunction!==null){paramDestructors.push(i)}}}
  var invokerFn=function(...args){
    var destructors=needsDestructorStack?[]:null;
    var wired=[cppTargetFunc];
    var thisWired;
    if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this);wired.push(thisWired)}
    for(var i=0;i<argCount-2;++i){wired.push(argTypes[i+2].toWireType(destructors,args[i]))}
    var rv=cppInvokerFunc(...wired);
    if(needsDestructorStack){runDestructors(destructors)}
    else{for(var j=0;j<paramDestructors.length;++j){var k=paramDestructors[j];argTypes[k].destructorFunction(k===1?thisWired:wired[isClassMethodFunc?k:k-1])}}
    if(returns){return argTypes[0].fromWireType(rv)}
  };
  return createNamedFunction(humanName,invokerFn)
}
`

const evalFreeMethodCaller = `var __emval_get_method_caller=(argCount,argTypes,kind)=>{
  var types=emval_lookupTypes(argCount,argTypes);
  var retType=types.shift();
  argCount--;
  var invokerFunction=function(obj,func,destructorsRef,args){
    var values=kind===0?[obj]:[];
    var offset=0;
    for(var i=0;i<argCount;++i){values.push(types[i].readValueFromPointer(args+offset));offset+=types[i].argPackAdvance}
    var rv=kind===1?Reflect.construct(func,values):func.call(...values);
    if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}
  };
  var functionName=\`methodCaller<(\${types.map(t=>t.name).join(", ")}) => \${retType.name}>\`;
  return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))
};
`

/** Parts of occt-import-js replaced: from `start` up to `end`. */
const replacements = [
  { start: 'function craftInvokerFunction(', end: 'var ensureOverloadTable=', code: evalFreeInvoker },
  { start: 'var __emval_get_method_caller=', end: 'var __emval_get_property=', code: evalFreeMethodCaller },
]

/** occt-import-js's code with embind's invokers and method callers built without `new Function`. */
export function withoutEval (code: string): string {
  let result = code
  for (const replacement of replacements) {
    const start = result.indexOf(replacement.start)
    const end = result.indexOf(replacement.end, start)
    if (start === -1 || end === -1) {
      throw new Error(`occt-import-js changed: ${replacement.start} was not found. Check @basyx/studio-app-kit/vite against the new version.`)
    }
    result = `${result.slice(0, start)}${replacement.code}${result.slice(end)}`
  }
  if (/newFunc\(\s*Function/.test(result)) {
    throw new Error('occt-import-js changed: it still builds functions from strings. Check @basyx/studio-app-kit/vite against the new version.')
  }
  return result
}

/** Builds occt-import-js without `new Function`, for app frames; also needed for worker bundles. */
export function occtWithoutEval (): Plugin {
  return {
    name: 'studio-occt-without-eval',
    enforce: 'pre',
    transform (code, id) {
      return occtModule.test(id.split('?', 1)[0]!) ? { code: withoutEval(code), map: null } : null
    },
  }
}

export function vuetifySettings (): Plugin {
  return {
    name: 'studio-vuetify-settings',
    enforce: 'pre',
    async resolveId (source, importer) {
      let css: string | undefined
      if (source === 'vuetify/styles') {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- the Vite plugin context
        css = (await this.resolve('vuetify/lib/styles/main.css', importer, { skipSelf: true }))?.id
      } else if (source.endsWith('.css') && importer && /[/\\]vuetify[/\\]lib[/\\]/.test(importer)) {
        css = resolve(dirname(importer), source)
      }
      const sass = css?.replace(/\.css$/, '.sass')
      return sass && existsSync(sass) ? `${prefix}${sass}` : null
    },
    load (id) {
      if (!id.startsWith(prefix)) {
        return null
      }
      const file = id.slice(prefix.length)
      const layers = file.replace(/([/\\]vuetify[/\\]lib[/\\]).*$/, '$1styles/generic/_layers.scss')
      // The settings first, so Vuetify's settings module is configured before
      // the stylesheet uses it. Then the order of Vuetify's cascade layers:
      // apps load component styles before vuetify/styles, which would put the
      // reset layer above the components (buttons lose their weight and size).
      // Forward slashes, as Sass reads a backslash in a string as an escape
      // (Windows paths).
      const uses = [settings, layers, file].map(path => `@use '${path.replaceAll('\\', '/')}'\n`)
      return uses.join('')
    },
  }
}

/** Whether the project (the working directory) can import a package. */
function hasPackage (name: string): boolean {
  try {
    createRequire(join(process.cwd(), 'package.json')).resolve(name)
    return true
  } catch {
    return false
  }
}

export interface StudioAppOptions {
  /** The folder of the UI's `index.html`, relative to the project. Default `ui`. */
  root?: string
}

/**
 * The Vite preset of a Studio app (ADR 0043): the UI in `ui/` is built to
 * `dist/ui/` with relative URLs, as Studio serves it under
 * `/app/<installation>/ui/` (`studio-app pack` packages `dist/`); Vuetify
 * is compiled with Studio's Sass settings; workers are ES modules, and
 * occt-import-js runs without `new Function` in them too. In the dev
 * server, Vuetify and the kit are not pre-bundled, so their stylesheets
 * get Studio's settings as well.
 *
 *   export default defineConfig({ plugins: [vue(), studioApp()] })
 */
export function studioApp (options: StudioAppOptions = {}): PluginOption[] {
  const root = options.root ?? 'ui'
  const depth = root.split('/').filter(Boolean).map(() => '..').join('/')
  return [
    {
      name: 'studio-app',
      config: () => ({
        root,
        base: './',
        build: { outDir: `${depth}/dist/${root}`, emptyOutDir: true },
        worker: { format: 'es', plugins: () => [occtWithoutEval()] },
        optimizeDeps: {
          exclude: ['vuetify', '@basyx/studio-app-kit', '@basyx/file-viewer'],
          // The file viewer is served as it is (its 3D view's WebAssembly and
          // worker URLs are Vite imports); its one CommonJS dependency of
          // the 3D view is pre-bundled.
          include: hasPackage('@basyx/file-viewer') ? ['@basyx/file-viewer > occt-import-js'] : [],
        },
      }),
    },
    vuetifySettings(),
    occtWithoutEval(),
  ]
}
