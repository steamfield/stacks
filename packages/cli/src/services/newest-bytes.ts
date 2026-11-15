/**
 * A byte buffer that keeps only the newest bytes a child process wrote, up to a fixed capacity.
 *
 * `services/processes.ts` feeds every output chunk of a child into one of these, so a step that
 * prints gigabytes still costs the CLI a bounded amount of memory. When the buffer is full, the
 * oldest bytes are dropped and `truncated` turns true. Reading the text back starts at the first
 * whole UTF-8 character, since the cut can land in the middle of one.
 */
export class NewestBytes {
  private chunks: Uint8Array[] = [];
  private size = 0;
  /** Some bytes were dropped to stay within the capacity. */
  truncated = false;

  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.capacity) {
      this.truncated = true;
      const first = this.chunks[0];
      if (first === undefined) break;
      const excess = this.size - this.capacity;
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        // A copy, so the dropped bytes are released with the original chunk.
        this.chunks[0] = first.slice(excess);
        this.size -= excess;
      }
    }
  }

  /** The kept bytes decoded as UTF-8. */
  text(): string {
    const all = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(all.subarray(this.truncated ? firstCharStart(all) : 0));
  }
}

/** The index of the first byte that isn't a UTF-8 continuation byte (`10xxxxxx`). */
function firstCharStart(bytes: Uint8Array): number {
  let start = 0;
  while (((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return start;
}
