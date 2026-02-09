/** Sleep for time (ms) */
export const sleep = (time: number): Promise<void> => {
  return new Promise((resolve, _reject) => {
    setTimeout(() => {
      resolve()
    }, time)
  })
}

/**
 * Get the remaining time until something expires in user-friendly format
 * @param expiry expiration time in ms
 * @returns The time remaining till expiration
 */
export const timeUntil = (expiry: number) => {
  const ms = new Date(expiry).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const s = ms / 1000
  const m = s / 60
  const h = m / 60
  const d = h / 24
  return d >= 1
    ? `in ${Math.round(d)} day${d >= 1.5 ? 's' : ''}`
    : h >= 1
    ? `in ${Math.round(h)} hour${h >= 1.5 ? 's' : ''}`
    : m >= 1
    ? `in ${Math.round(m)} minute${m >= 1.5 ? 's' : ''}`
    : `in ${Math.round(s)} second${s >= 1.5 ? 's' : ''}`
}
