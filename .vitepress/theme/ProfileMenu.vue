<script setup lang="ts">
import { ref } from 'vue'
import wechatQr from '../../assets/images/wechat.png'

const dialog = ref<HTMLDialogElement>()
const isOpen = ref(false)

function openProfile() {
  dialog.value?.showModal()
  isOpen.value = true
}

function closeProfile() {
  dialog.value?.close()
}

function closeOnBackdrop(event: MouseEvent) {
  const panel = dialog.value
  if (!panel || event.target !== panel) return
  const bounds = panel.getBoundingClientRect()
  if (
    event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom
  ) closeProfile()
}
</script>

<template>
  <button
    class="profile-button"
    type="button"
    title="个人信息"
    aria-label="个人信息"
    aria-haspopup="dialog"
    aria-controls="profile-dialog"
    :aria-expanded="isOpen"
    @click="openProfile"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" stroke-linecap="round" />
    </svg>
  </button>

  <dialog
    id="profile-dialog"
    ref="dialog"
    class="profile-dialog"
    aria-labelledby="profile-title"
    aria-describedby="profile-description"
    @click="closeOnBackdrop"
    @close="isOpen = false"
  >
    <div class="profile-dialog__header">
      <h2 id="profile-title">个人信息</h2>
      <button class="profile-dialog__close" type="button" aria-label="关闭个人信息" autofocus @click="closeProfile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <p class="profile-dialog__name">maoqb</p>
    <p class="profile-dialog__role">Android Framework 开发者</p>
    <img class="profile-dialog__qr" :src="wechatQr" alt="maoqb 的微信二维码" width="912" height="1354" />
    <p id="profile-description" class="profile-dialog__hint">微信扫一扫，添加好友</p>
  </dialog>
</template>

<style scoped>
.profile-button,
.profile-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 160ms ease, background-color 160ms ease;
}

.profile-button {
  margin-left: 16px;
}

.profile-button:hover,
.profile-dialog__close:hover {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.profile-button:focus-visible,
.profile-dialog__close:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}

.profile-button svg,
.profile-dialog__close svg {
  width: 21px;
  height: 21px;
}

.profile-dialog {
  position: fixed;
  inset: 0;
  width: min(360px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  margin: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  padding: 20px 24px 24px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
  white-space: normal;
}

.profile-dialog::backdrop {
  background: rgba(10, 22, 15, 0.45);
  backdrop-filter: blur(4px);
}

.profile-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.profile-dialog__header h2 {
  font-size: 15px;
  font-weight: 600;
}

.profile-dialog__name {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
}

.profile-dialog__role {
  margin-top: 4px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.profile-dialog__qr {
  display: block;
  width: min(100%, 270px);
  height: auto;
  margin: 20px auto 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: #fff;
}

.profile-dialog__hint {
  color: var(--vp-c-text-2);
  font-size: 13px;
  text-align: center;
}

@media (max-width: 767px) {
  .profile-button {
    margin-left: 0;
  }
}
</style>
