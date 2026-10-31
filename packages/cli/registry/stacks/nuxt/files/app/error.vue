<script setup lang="ts">
import type { NuxtError } from "#app";

// Renders outside the layout for any uncaught error, including unknown routes. Show the status
// and fixed text only: an error's message can carry server detail.
const props = defineProps<{ error: NuxtError }>();
const status = computed(() => props.error.statusCode ?? 500);
useHead({ title: () => String(status.value) });
</script>

<template>
  <main class="shell">
    <h1>{{ status }}</h1>
    <p v-if="status === 404">We couldn't find this page.</p>
    <p v-else>Something went wrong.</p>
    <button type="button" @click="clearError({ redirect: '/' })">Back to notes</button>
  </main>
</template>
