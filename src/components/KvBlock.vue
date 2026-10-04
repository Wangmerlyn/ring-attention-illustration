<script setup>
defineProps({
  label: String,
  color: String,
  reducedMotion: Boolean,
})
</script>

<template>
  <span class="kv-block" :style="{ '--kv-color': color }">
    <Transition name="kv-swap" :css="!reducedMotion">
      <span :key="label" class="kv-label" :style="{ '--label-color': color }">{{ label }}</span>
    </Transition>
  </span>
</template>

<style scoped>
.kv-block {
  position: relative;
  overflow: hidden;
}

.kv-label {
  display: block;
  color: color-mix(in srgb, var(--label-color) 88%, #35352e);
}

.kv-swap-enter-active {
  transition: transform 420ms cubic-bezier(.22, 1, .36, 1), opacity 320ms ease-out;
}

.kv-swap-leave-active {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  pointer-events: none;
  transition: transform 320ms cubic-bezier(.4, 0, .2, 1), opacity 220ms ease-in;
}

.kv-swap-enter-from {
  opacity: 0;
  transform: translateY(90%) scale(.96);
}

.kv-swap-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.kv-swap-leave-from {
  opacity: 1;
  transform: translateY(-50%);
}

.kv-swap-leave-to {
  opacity: 0;
  transform: translateY(-150%) scale(.96);
}
</style>
