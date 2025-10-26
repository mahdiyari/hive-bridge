/** Return true if the peer address is accessible at /status
 * - has a 2s timeout
 * @param address - without http://
 */
export const checkPeerStatus = (
  address: string,
  timeout = 2000
): Promise<boolean> => {
  return new Promise((resolve) => {
    const myTimer = setTimeout(() => {
      resolve(false)
    }, timeout)
    fetch('http://' + address + '/status')
      .then((res) => res.json())
      .then((res: any) => {
        if (res.status === 'OK') {
          resolve(true)
          return
        }
        resolve(false)
      })
      .catch(() => {
        resolve(false)
      })
      .finally(() => {
        clearTimeout(myTimer)
      })
  })
}
