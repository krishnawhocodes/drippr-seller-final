// In-memory stand-in for api/_lib/firebaseAdmin.ts, used only by the
// end-to-end workflow test. Aliased in at bundle time.

export const store: Record<string, Record<string, unknown>> = {};
export const tokens: Record<string, { uid: string; email?: string }> = {};

function docRef(collection: string, id: string) {
  const key = `${collection}/${id}`;
  return {
    key,
    async get() {
      return {
        exists: Object.prototype.hasOwnProperty.call(store, key),
        id,
        data: () => store[key],
      };
    },
    async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
      store[key] = options?.merge ? { ...(store[key] || {}), ...data } : data;
    },
  };
}

export function getAdmin() {
  return {
    adminAuth: {
      async verifyIdToken(token: string) {
        const decoded = tokens[token];
        if (!decoded) throw new Error("bad token");
        return decoded;
      },
    },
    adminDb: {
      collection(collection: string) {
        return { doc: (id: string) => docRef(collection, id) };
      },
      async runTransaction(
        fn: (tx: {
          get: (ref: ReturnType<typeof docRef>) => Promise<unknown>;
          set: (
            ref: ReturnType<typeof docRef>,
            data: Record<string, unknown>,
            options?: { merge?: boolean },
          ) => void;
        }) => Promise<void>,
      ) {
        return fn({
          get: (ref) => ref.get(),
          set: (ref, data, options) => {
            void ref.set(data, options);
          },
        });
      },
    },
  };
}
