<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import siteData from '../../.generated_vitepress/site-data.json'

const topics = siteData.topics
const total = topics.reduce((n, topic) => n + topic.articles.length, 0)
const query = ref('')
const active = ref<number | null>(null)
const collapsed = ref<number[]>([])
const labels = ['第一篇','第二篇','第三篇','第四篇','第五篇','第六篇','第七篇','第八篇','第九篇','第十篇','第十一篇','第十二篇']
const volumeLabel = (index: number) => labels[index] ?? `第${index + 1}篇`
const chapterLabel = (index: number) => String(index + 1).padStart(2, '0')
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const matches = (value: string) => value.toLocaleLowerCase().includes(normalizedQuery.value)
const chapters = computed(() => topics.map((topic, index) => ({
  ...topic, index,
  articles: normalizedQuery.value
    ? (matches(topic.title) ? topic.articles : topic.articles.filter(article => matches(article.title) || matches(article.excerpt ?? '')))
    : topic.articles,
})).filter(topic => topic.articles.length > 0))
const matchedCount = computed(() => chapters.value.reduce((n, topic) => n + topic.articles.length, 0))
const isOpen = (index: number) => !!normalizedQuery.value || !collapsed.value.includes(index)
const toggle = (index: number) => {
  collapsed.value = isOpen(index) ? [...collapsed.value, index] : collapsed.value.filter(i => i !== index)
}
const showAll = () => { collapsed.value = [] }
const hideAll = () => { collapsed.value = topics.map((_, index) => index) }
function jumpTo(index: number) {
  active.value = index
  if (collapsed.value.includes(index)) collapsed.value = collapsed.value.filter(i => i !== index)
  document.getElementById(`volume-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
watch(query, () => { active.value = null })
</script>

<template>
  <main class="book-home">
    <div class="book-cover">
      <div class="book-cover__edition"><span class="book-cover__rule"></span> THE ANDROID FRAMEWORK NOTEBOOK <span class="book-cover__rule"></span></div>
      <div class="book-cover__intro">
        <div class="book-cover__label">AOSP · 源码阅读与系统设计</div>
        <h1>Android<br><em>Framework</em></h1>
        <p class="book-cover__subtitle">一份持续编写的 Android 系统技术手记</p>
        <p class="book-cover__desc">从系统架构到源码实现，从窗口管理、Binder 到工程实践。按照技术主题组织成篇章，沿着目录逐章阅读。</p>
        <div class="book-cover__actions">
          <a :href="withBase(siteData.firstArticle)" class="book-cover__start">开始阅读 <span aria-hidden="true">→</span></a>
          <a :href="withBase('/editor/')" target="_self" class="book-cover__write">写作工作台 <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <div class="book-cover__foot"><span>NOTES / VOL. 01</span><span>{{ topics.length }} 篇 · {{ total }} 章</span></div>
    </div>

    <div class="book-layout" id="contents">
      <aside class="book-sidebar" aria-label="篇章导航">
        <div class="book-sidebar__eyebrow">CONTENTS</div>
        <strong>篇章导航</strong>
        <nav class="book-nav">
          <button v-for="topic in chapters" :key="topic.index" type="button" :class="{active:active === topic.index}" @click="jumpTo(topic.index)">
            <span>{{ volumeLabel(topic.index) }}</span><span class="book-nav__title">{{ topic.title }}</span>
          </button>
        </nav>
        <div class="book-sidebar__footer">源于实践 · 持续更新</div>
      </aside>

      <section class="book-toc" aria-labelledby="book-toc-title">
        <div class="book-toc__eyebrow">TABLE OF CONTENTS <span>·</span> 目录</div>
        <div class="book-toc__heading">
          <div><h2 id="book-toc-title">目 录</h2><p>按篇章浏览全部技术笔记，选择任一章节开始阅读。</p></div>
          <div class="book-toc__total">{{ topics.length }} 篇 <span>/</span> {{ total }} 章</div>
        </div>
        <div class="book-toc__tools">
          <label class="book-search">
            <span class="book-search__icon" aria-hidden="true">⌕</span>
            <input v-model="query" type="search" placeholder="查找章节、关键词…" aria-label="搜索目录中的章节" />
            <span v-if="query" class="book-search__result">{{ matchedCount }} 章</span>
          </label>
          <div class="book-toc__expand">
            <button type="button" @click="showAll">全部展开</button>
            <span>·</span>
            <button type="button" @click="hideAll">全部收起</button>
          </div>
        </div>

        <div v-if="chapters.length" class="book-volumes">
          <section v-for="topic in chapters" :id="`volume-${topic.index}`" :key="topic.title" class="book-volume" :aria-label="`${volumeLabel(topic.index)} ${topic.title}`">
            <button type="button" class="book-volume__head" :aria-expanded="isOpen(topic.index)" @click="toggle(topic.index)">
              <span class="book-volume__number">{{ volumeLabel(topic.index) }}</span>
              <span class="book-volume__title">{{ topic.title }}</span>
              <span class="book-volume__quantity">{{ topic.articles.length }} 章</span>
              <span class="book-volume__toggle" aria-hidden="true">{{ isOpen(topic.index) ? '−' : '+' }}</span>
            </button>
            <ol v-if="isOpen(topic.index)" class="book-chapters">
              <li v-for="(article, index) in topic.articles" :key="article.link">
                <a :href="withBase(article.link)" class="book-chapter">
                  <span class="book-chapter__index">{{ chapterLabel(index) }}</span>
                  <span class="book-chapter__name">{{ article.title }}</span>
                  <span class="book-chapter__leader" aria-hidden="true"></span>
                  <span class="book-chapter__go" aria-hidden="true">↗</span>
                </a>
              </li>
            </ol>
          </section>
        </div>
        <div v-else class="book-empty">没有找到相关章节，试试其他关键词。</div>
        <footer class="book-colophon">
          <span>AOSP NOTES <b>·</b> Android Framework</span>
          <a :href="withBase('/editor/')" target="_self">继续编写这本书 ↗</a>
        </footer>
      </section>
    </div>
  </main>
</template>
