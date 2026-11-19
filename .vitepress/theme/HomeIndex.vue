<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import siteData from '../../.generated_vitepress/site-data.json'

const topicDescriptions: Record<string,string> = {
  WMS:'窗口层级 · 布局与绘制 · Surface',
  Binder:'跨进程通信 · 驱动 · Native',
  ServiceManager:'系统服务注册 · 查询 · 生命周期',
  AOSP:'源码编译 · 工具链 · 环境配置',
  'C / C++':'C++ 语言 · 内存 · Native 实践',
  其他:'输入系统 · 调试 · 系统实践',
}
const iconMap = ['◈','⌘','◧','▣','⟡','◎']
const topics=computed(()=>siteData.topics)
const count=computed(()=>topics.value.reduce((sum,t)=>sum+t.articles.length,0))
const featured=computed(()=>topics.value.flatMap(t=>t.articles.map(a=>({...a,category:t.title}))).slice(0,6))
const detail=(s:string)=>topicDescriptions[s]??'Android 系统架构与工程笔记'
</script>

<template>
  <div class="studio-home">
    <section class="studio-hero" aria-labelledby="site-title">
      <div class="studio-hero__body">
        <div class="studio-hero__eyebrow"><span class="studio-pulse"></span> ANDROID FRAMEWORK · KNOWLEDGE BASE</div>
        <h1 id="site-title">理解系统，<br><span>从源码开始。</span></h1>
        <p>记录 Android Framework 的架构、实现与调试实践。从 WMS、Binder 到图形栈，把复杂的系统设计整理成可追溯的技术笔记。</p>
        <div class="studio-hero__actions">
          <a :href="withBase(siteData.firstArticle)" class="studio-hero__primary">开始阅读 <span aria-hidden="true">↗</span></a>
          <a :href="withBase('/editor/')" class="studio-hero__secondary">进入写作工作台 <span aria-hidden="true">↗</span></a>
        </div>
        <div class="studio-hero__facts">
          <span><b>{{count}}</b> 篇技术笔记</span><i></i>
          <span><b>{{topics.length}}</b> 个知识主题</span><i></i>
          <span>持续整理 · GitHub 驱动</span>
        </div>
      </div>
      <div class="studio-hero__graphic" aria-hidden="true">
        <div class="studio-graphic__top"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span>framework / system / window</span></div>
        <div class="studio-graphic__tree">
          <div class="sg-root"><span class="sg-icon">◆</span> Android Framework <small>core</small></div>
          <div class="sg-branch">
            <div class="sg-node"><span class="sg-symbol">◫</span><span>WindowManager</span><small>WMS</small></div>
            <div class="sg-sub"><span>DisplayContent</span><span>DisplayArea</span><span>WindowState</span></div>
            <div class="sg-node"><span class="sg-symbol">↔</span><span>Binder IPC</span><small>native</small></div>
            <div class="sg-sub"><span>ProcessState</span><span>ServiceManager</span></div>
          </div>
        </div>
        <div class="studio-graphic__footer"><span>Architecture, not just APIs.</span><span class="sg-status">● 源码驱动</span></div>
      </div>
    </section>

    <section class="studio-section" aria-labelledby="topics-title">
      <div class="studio-section__title"><div><span class="studio-kicker">KNOWLEDGE MAP</span><h2 id="topics-title">按主题探索</h2><p>从概念模型到源码调用链，系统化整理关键技术。</p></div><span class="studio-section__count">{{topics.length}} collections</span></div>
      <nav class="studio-topic-grid" aria-label="笔记主题">
        <a v-for="(topic,index) in topics" :key="topic.title" :href="withBase(topic.articles[0].link)" class="studio-topic">
          <div class="studio-topic__heading"><span class="studio-topic__glyph">{{iconMap[index%iconMap.length]}}</span><span class="studio-topic__count">{{topic.articles.length}} 篇</span></div>
          <h3>{{topic.title}}</h3>
          <p>{{detail(topic.title)}}</p>
          <span class="studio-topic__cta">查看笔记 <span aria-hidden="true">↗</span></span>
        </a>
      </nav>
    </section>

    <section class="studio-section studio-section--latest" aria-labelledby="notes-title">
      <div class="studio-section__title"><div><span class="studio-kicker">READING LIST</span><h2 id="notes-title">技术笔记</h2><p>选取当前知识库中的文章，随时进入阅读。</p></div></div>
      <div class="studio-notes-grid">
        <a v-for="(article,index) in featured" :key="article.link" :href="withBase(article.link)" class="studio-note">
          <span class="studio-note__index">{{String(index+1).padStart(2,'0')}}</span>
          <span class="studio-note__copy"><strong>{{article.title}}</strong><small>{{article.category}}</small></span>
          <span class="studio-note__arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
    <footer class="studio-home__footer"><span>AOSP NOTES <span>·</span> Built on GitHub & VitePress</span><a :href="withBase('/editor/')">打开写作工作台 ↗</a></footer>
  </div>
</template>
