export const fetchTimeout = async (
  url: string,
  init?: any,
  timeout: number = 5000,
) => {
  const constroller = new AbortController();
  setTimeout(() => constroller.abort(), timeout);
  return fetch(url, {
    ...init,
    signal: constroller.signal,
  });
};

/**
 * Runs `request` with a signal that aborts after `timeout` ms, covering the
 * response body too. The timer is cleared once the request settles.
 */
export const withTimeout = async <T>(
  timeout: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};
