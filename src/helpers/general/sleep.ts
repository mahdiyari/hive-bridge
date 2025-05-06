/** Sleep for time (ms) */
export const sleep = (time: number) => {
	return new Promise((res, _rej) => {
		setTimeout(() => {
			res(true)
		}, time)
	})
}
