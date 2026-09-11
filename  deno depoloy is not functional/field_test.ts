/**
 * Field-app storage + media helpers (in-memory IDB stub, no browser).
 */
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

function installMemoryIdb() {
  const rows = new Map();
  const store = {
    put(obj) {
      rows.set(obj.id, structuredClone(obj));
      return idbResult(obj.id);
    },
    get(id) {
      const v = rows.get(id);
      return idbResult(v ? structuredClone(v) : undefined);
    },
    getAll() {
      return idbResult([...rows.values()].map((v) => structuredClone(v)));
    },
    delete(id) {
      rows.delete(id);
      return idbResult(undefined);
    },
    createIndex() {},
  };
  const db = {
    objectStoreNames: { contains: () => rows.size > 0 },
    createObjectStore() {
      return store;
    },
    transaction() {
      return { objectStore: () => store };
    },
    close() {},
  };
  function idbResult(result) {
    const r = { result, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  }
  globalThis.indexedDB = {
    open() {
      const r = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
}
installMemoryIdb();
import {
  mediaTypeOnly,
  mimeFromDataUrl,
  normalizeMediaDataUrl,
} from "../src/mediaOptimize.js";
import {
  getPackage,
  listDrafts,
  listPendingPackages,
  pushDraft,
  savePackageLocal,
  stripDraftAnswers,
  withoutMedia,
} from "../src/localStore.js";

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k: string, v: string) => {
    store[k] = String(v);
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() {
    return Object.keys(store).length;
  },
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
(globalThis as { window?: unknown }).window = globalThis;

const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQAAAQH/AAAAA//Z";
const TINY_AUDIO = "data:audio/webm;codecs=opus;base64," + "A".repeat(120);

Deno.test("mediaTypeOnly drops codecs", () => {
  assertEquals(mediaTypeOnly("audio/webm;codecs=opus"), "audio/webm");
  assertEquals(mediaTypeOnly("not-a-mime"), "");
});

Deno.test("normalizeMediaDataUrl strips codecs=opus so API can decode", () => {
  const n = normalizeMediaDataUrl(TINY_AUDIO, "audio/webm;codecs=opus");
  assert(n.startsWith("data:audio/webm;base64,"));
  assert(!n.includes("codecs="));
  assertEquals(mimeFromDataUrl(n, "audio/webm"), "audio/webm");
});

Deno.test("stripDraftAnswers removes _draft before Send", () => {
  const a = stripDraftAnswers({ _draft: true, draft: true, q1: "yes" });
  assertEquals(a._draft, undefined);
  assertEquals(a.draft, undefined);
  assertEquals(a.q1, "yes");
});

Deno.test("withoutMedia drops blobs from queue lists", () => {
  const stripped = withoutMedia({
    id: "x",
    photoDataUrl: TINY_JPEG,
    audioDataUrl: TINY_AUDIO,
    flags: { photo: false, audio: false },
  });
  assertEquals(stripped.photoDataUrl, undefined);
  assertEquals(stripped.audioDataUrl, undefined);
  assertEquals(stripped.hasPhoto, true);
  assertEquals(stripped.hasAudio, true);
});

Deno.test("draft checkpoint does not wipe a stored photo", async () => {
  const id = await savePackageLocal(
    {
      form_key: "t-survey",
      submitted_by: "tester",
      geo: { lat: 17.4, lng: 78.5 },
      answers: { _draft: true, q1: "a" },
      photoDataUrl: TINY_JPEG,
      audioDataUrl: TINY_AUDIO,
      recordIndex: 1,
    },
    { draft: true },
  );
  await savePackageLocal(
    {
      id,
      form_key: "t-survey",
      submitted_by: "tester",
      geo: { lat: 17.4, lng: 78.5 },
      answers: { _draft: true, q1: "b" },
      photoDataUrl: "",
      audioDataUrl: "",
      recordIndex: 1,
    },
    { draft: true },
  );
  const pkg = await getPackage(id);
  assert(pkg.photoDataUrl && pkg.photoDataUrl.length > 50, "photo must stay");
  assert(pkg.audioDataUrl && pkg.audioDataUrl.length > 50, "audio must stay");
});

Deno.test("listDrafts(media:false) has no photo/audio payloads", async () => {
  await savePackageLocal(
    {
      form_key: "t-survey",
      submitted_by: "tester",
      geo: { lat: 17.4, lng: 78.5 },
      answers: { _draft: true },
      photoDataUrl: TINY_JPEG,
      audioDataUrl: TINY_AUDIO,
      recordIndex: 2,
    },
    { draft: true },
  );
  const drafts = await listDrafts({ media: false });
  assert(drafts.length >= 1);
  for (const d of drafts) {
    assertEquals(d.photoDataUrl, undefined);
    assertEquals(d.audioDataUrl, undefined);
  }
});

Deno.test("pushDraft strips _draft and queues", async () => {
  const id = await savePackageLocal(
    {
      form_key: "t-survey",
      submitted_by: "tester",
      geo: { lat: 17.4, lng: 78.5 },
      answers: { _draft: true, q1: "c" },
      photoDataUrl: TINY_JPEG,
      audioDataUrl: TINY_AUDIO,
      recordIndex: 3,
    },
    { draft: true },
  );
  await pushDraft(id);
  const pkg = await getPackage(id);
  assertEquals(pkg.phase, "queued");
  assertEquals(pkg.qa.answers._draft, undefined);
  const pending = await listPendingPackages();
  assert(pending.some((p) => p.id === id));
  assert(!pending.find((p) => p.id === id)?.photoDataUrl);
});

Deno.test("queued save without photo is rejected", async () => {
  await assertRejects(
    () =>
      savePackageLocal({
        form_key: "t-survey",
        geo: { lat: 17.4, lng: 78.5 },
        answers: {},
        photoDataUrl: "",
        audioDataUrl: TINY_AUDIO,
      }),
    Error,
    "photo",
  );
});
