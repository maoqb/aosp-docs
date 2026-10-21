import DefaultTheme from 'vitepress/theme'
import { defineComponent, h, nextTick, onMounted, watch } from 'vue'
import { useRoute } from 'vitepress'
import HomeIndex from './HomeIndex.vue'
import ProfileMenu from './ProfileMenu.vue'
import './custom.css'

let drawioLoader: Promise<void> | undefined
let mermaidLoader: Promise<typeof import('mermaid')> | undefined

function applyImageWidths() {
  document.querySelectorAll<HTMLImageElement>('.vp-doc img[title^="w="]').forEach((image) => {
    const width = image.title.match(/^w=(\d+)/)?.[1]
    if (!width) return
    image.style.width = `${Math.min(Number(width), 2400)}px`
    image.style.maxWidth = '100%'
  })
}

async function renderMermaid() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'))
  if (!nodes.length) return
  for (const node of nodes) {
    const source = node.dataset.mermaidSource
    if (!source) continue
    const bytes = Uint8Array.from(window.atob(source), (character) => character.charCodeAt(0))
    node.textContent = new TextDecoder().decode(bytes)
  }
  mermaidLoader ??= import('mermaid')
  const { default: mermaid } = await mermaidLoader
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    themeVariables: {
      primaryColor: '#e8f7ef',
      primaryTextColor: '#17211b',
      primaryBorderColor: '#5aa57b',
      lineColor: '#587064',
      secondaryColor: '#f3f7f4',
      tertiaryColor: '#ffffff',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    },
  })
  await mermaid.run({ nodes })
}

function loadDrawio() {
  if ((window as Window & { GraphViewer?: unknown }).GraphViewer) return Promise.resolve()
  if (drawioLoader) return drawioLoader
  drawioLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-drawio-viewer]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('draw.io viewer failed to load')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://viewer.diagrams.net/js/viewer-static.min.js'
    script.async = true
    script.dataset.drawioViewer = 'true'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('draw.io viewer failed to load')), { once: true })
    document.head.append(script)
  })
  return drawioLoader
}

async function renderDrawio() {
  if (!document.querySelector('.mxgraph')) return
  await loadDrawio()
  const viewer = (window as Window & {
    GraphViewer?: { processElements?: () => void }
  }).GraphViewer
  viewer?.processElements?.()
}

async function enhanceDocument() {
  applyImageWidths()
  const results = await Promise.allSettled([renderMermaid(), renderDrawio()])
  for (const result of results) {
    if (result.status === 'rejected') console.warn(result.reason)
  }
}

const Layout = defineComponent({
  setup() {
    const route = useRoute()
    onMounted(() => void enhanceDocument())
    watch(
      () => route.path,
      async () => {
        await nextTick()
        await enhanceDocument()
      },
    )
    return () => h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(ProfileMenu),
    })
  },
})

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('HomeIndex', HomeIndex)
  },
}
