/** Timeout bullshit that doesn't have a timeout i.e. ethers.js calls */
export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('Timeout exceeded')), ms)
		),
	])
}
