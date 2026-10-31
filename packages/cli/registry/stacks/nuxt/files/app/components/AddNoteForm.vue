<script setup lang="ts">
import type { FieldErrors } from "#shared/schemas/note";

const emit = defineEmits<{ added: [] }>();

const text = ref("");
const pending = ref(false);
const errors = ref<FieldErrors>({});
const failed = ref(false);

// The server validates with the same schema and answers 400 with data.fields; the form shows
// those messages rather than repeating the rules here.
// $fetch rejects with a FetchError whose `data` is the parsed error body.
type ErrorBody = { statusCode?: number; data?: { fields?: FieldErrors } };

function fieldsFrom(error: unknown): FieldErrors | undefined {
  if (typeof error !== "object" || error === null || !("data" in error)) return undefined;
  const body = error.data as ErrorBody | undefined;
  return body?.statusCode === 400 ? body.data?.fields : undefined;
}

async function submit() {
  pending.value = true;
  failed.value = false;
  try {
    await $fetch("/api/notes", { method: "POST", body: { text: text.value } });
    text.value = "";
    errors.value = {};
    emit("added");
  } catch (error) {
    const fields = fieldsFrom(error);
    if (fields) errors.value = fields;
    else failed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form novalidate @submit.prevent="submit">
    <label for="note-text">Note</label>
    <input
      id="note-text"
      v-model="text"
      name="text"
      :aria-invalid="errors.text ? 'true' : undefined"
      :aria-describedby="errors.text ? 'note-text-error' : undefined"
    />
    <p v-if="errors.text" id="note-text-error" role="alert">
      {{ errors.text }}
    </p>
    <p v-if="failed" role="alert">Couldn't save the note. Try again.</p>
    <button type="submit" :disabled="pending">Add note</button>
  </form>
</template>
