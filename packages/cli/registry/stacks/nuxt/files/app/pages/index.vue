<script setup lang="ts">
// useFetch runs on the server during SSR and hands its result to the client, so the first
// paint already has the notes. The key names the request; refresh() reruns it after a write.
const { data, error, refresh } = await useFetch("/api/notes", { key: "notes" });
</script>

<template>
  <section>
    <h1>Notes</h1>
    <p v-if="error" role="alert">Couldn't load notes. Try again.</p>
    <ul v-else aria-label="Notes">
      <li v-for="note in data?.notes ?? []" :key="note.id">{{ note.text }}</li>
    </ul>
    <AddNoteForm @added="refresh()" />
  </section>
</template>
