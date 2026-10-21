<script setup lang="ts">
import { withBase } from 'vitepress'
import siteData from '../../.generated_vitepress/site-data.json'

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
        v-for="topic in siteData.topics"
        :key="topic.title"
        :href="withBase(topic.articles[0].link)"
      >
        <span>{{ topic.title }}</span>
        <small>{{ topic.articles.length }} 篇</small>
        <span class="home-topics__arrow" aria-hidden="true">→</span>
      </a>
    </nav>
  </section>
</template>
