/**
 * Reconnect tokens live in localStorage, one per room and role.
 * Wrapped in try/catch: storage can throw (private mode, blocked cookies), and the
 * game must still work; the player just won't keep their seat across reloads.
 */
const key = (code: string, kind: "host" | "player") => `family-party:${code}:${kind}`;

export const tokenStore = {
  get(code: string, kind: "host" | "player"): string | null {
    try {
      return localStorage.getItem(key(code, kind));
    } catch {
      return null;
    }
  },
  set(code: string, kind: "host" | "player", token: string) {
    try {
      localStorage.setItem(key(code, kind), token);
    } catch {
      /* ignore */
    }
  },
  clear(code: string, kind: "host" | "player") {
    try {
      localStorage.removeItem(key(code, kind));
    } catch {
      /* ignore */
    }
  },
};
