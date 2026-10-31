<script setup lang="ts">
const { appTitle } = useRuntimeConfig().public;
useHead({ titleTemplate: (page) => (page ? `${page} · ${appTitle}` : appTitle) });
</script>

<template>
  <div class="shell">
    <header>
      <NuxtLink to="/" class="brand">{{ appTitle }}</NuxtLink>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
