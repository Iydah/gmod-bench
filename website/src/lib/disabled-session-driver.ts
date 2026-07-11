import type { SessionDriver } from "astro";

const DISABLED_MESSAGE = "Sessions are disabled for this public website";

export default function createDisabledSessionDriver(): SessionDriver {
  const reject = async (): Promise<never> => {
    throw new Error(DISABLED_MESSAGE);
  };

  return {
    getItem: reject,
    setItem: reject,
    removeItem: reject,
  };
}
