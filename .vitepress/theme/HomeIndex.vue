<script setup lang="ts">
import { withBase } from 'vitepress'
import siteData from '../../.generated_vitepress/site-data.json'

const articleCount = siteData.topics.reduce((count, topic) => count + topic.articles.length, 0)
</script>

<template>
  <section class="home-index" aria-labelledby="home-index-title">
    <header class="home-index__header">
      <div>
        <p class="home-index__eyebrow">SOURCE NOTES</p>
        <h2 id="home-index-title">笔记目录</h2>
      </div>
      <p>{{ siteData.topics.length }} 个主题 · {{ articleCount }} 篇笔记</p>
    </header>

    <section v-for="topic in siteData.topics" :key="topic.title" class="home-topic">
      <div class="home-topic__heading">
        <h3>{{ topic.title }}</h3>
        <span>{{ topic.articles.length }}</span>
      </div>
      <ol class="home-articles">
        <li v-for="article in topic.articles" :key="article.link">
          <a :href="withBase(article.link)">{{ article.title }}</a>
          <p>{{ article.excerpt }}</p>
        </li>
      </ol>
    </section>
  </section>
</template>
