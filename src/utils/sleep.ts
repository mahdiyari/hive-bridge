/** Sleep for time (ms) */
export const sleep = (time: number): Promise<void> => {
  return new Promise((res, _rej) => {
    setTimeout(() => {
      res()
    }, time)
  })
}
