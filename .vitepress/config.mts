import { defineConfig, type DefaultTheme } from 'vitepress'
import { resolve } from 'node:path'
import siteData from '../.generated_vitepress/site-data.json'

const base = process.env.VITEPRESS_BASE ?? '/aosp-docs/'
const sidebar = siteData.sidebar as DefaultTheme.SidebarItem[]

export default defineConfig({
  lang: 'zh-CN',
  title: 'Android Framework',
  titleTemplate: ':title · Android Framework',
  description: 'Android / AOSP Framework 源码与系统设计技术笔记',
  base,
  srcDir: '.generated_docs',
  outDir: 'dist',
  cleanUrls: false,
  lastUpdated: false,
  sitemap: {
    hostname: 'https://maoqb.github.io/aosp-docs/',
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#0b8f55' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Android Framework · AOSP 源码笔记' }],
    ['meta', { property: 'og:description', content: '从源码出发，梳理 Android Framework 的设计、调用链与实现细节。' }],
    ['meta', { property: 'og:image', content: `https://maoqb.github.io${base}og-aosp-notes.png` }],
  ],
  markdown: {
    lineNumbers: false,
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'AOSP Docs',
    nav: [
      { text: '首页', link: '/' },
      { text: '笔记', link: siteData.firstArticle },
    ],
    sidebar: {
      '/Notes/': sidebar,
    },
    outline: {
      level: [2, 3],
      label: '本页目录',
    },
    search: {
      provider: 'local',
    },
    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    langMenuLabel: '切换语言',
    externalLinkIcon: true,
  },
  vite: {
    publicDir: resolve(process.cwd(), '.generated_public'),
    // Mermaid ships optional renderers as lazy chunks; the large ELK renderer is
    // never downloaded unless a note explicitly requests that layout engine.
    build: {
      chunkSizeWarningLimit: 1600,
    },
  },
})
