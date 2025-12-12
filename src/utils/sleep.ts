/** Sleep for time (ms) */
export const sleep = (time: number): Promise<void> => {
  return new Promise((resolve, _reject) => {
    setTimeout(() => {
      resolve()
    }, time)
  })
}
