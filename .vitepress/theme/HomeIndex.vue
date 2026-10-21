<script setup lang="ts">
import { withBase } from 'vitepress'
import siteData from '../../.generated_vitepress/site-data.json'

const topicDescriptions: Record<string, string> = {
  Binder: '进程通信、对象传递与驱动机制',
  ServiceManager: '系统服务的注册、查询与发现',
  AOSP: '源码构建、配置与工具链',
  'C / C++': 'Native 层语言与工程实践',
  其他: '调试工具与开发随记',
}

function topicDescription(title: string) {
  return topicDescriptions[title] ?? 'Android 系统学习与实践'
}
</script>

<template>
  <section class="home-index" aria-labelledby="home-index-title">
    <header class="home-index__header">
      <div>
        <p class="home-index__eyebrow">TOPICS</p>
        <h2 id="home-index-title">主题</h2>
      </div>
      <p>{{ siteData.topics.length }} 个主题</p>
    </header>

    <nav class="home-topics" aria-label="笔记主题">
      <a
        v-for="(topic, index) in siteData.topics"
        :key="topic.title"
        :href="withBase(topic.articles[0].link)"
        class="home-topic-card"
      >
        <div class="home-topic-card__meta">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          <small>{{ topic.articles.length }} 篇笔记</small>
        </div>
        <h3>{{ topic.title }}</h3>
        <p>{{ topicDescription(topic.title) }}</p>
        <span class="home-topic-card__link">
          浏览主题
          <span aria-hidden="true">↗</span>
        </span>
      </a>
    </nav>
  </section>
</template>
