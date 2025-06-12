import { Application } from '@oak/oak/application'
import { Router } from '@oak/oak/router'
import { pendingWraps } from './PendingWraps.ts'
import { pendingUnwraps } from './PendingUnwraps.ts'
import { peers } from './Peers.ts'
import { operators } from './Operators.ts'
import { isAddress } from '@wevm/viem'

const router = new Router()
router.get('/pending-hive-wraps', (context) => {
	context.response.body = Object.fromEntries(pendingWraps.getAllPendingWraps())
})

router.get('/pending-hive-wraps/:usernameOrAddress', (ctx) => {
	if (isAddress(ctx.params.usernameOrAddress)) {
		const wraps = pendingWraps.getWrapsByAddress(ctx.params.usernameOrAddress)
		ctx.response.body = wraps
		return
	}
	const wraps = pendingWraps.getWrapsByUsername(ctx.params.usernameOrAddress)
	ctx.response.body = wraps
})

router.get('/pending-hive-unwraps', (context) => {
	context.response.body = Object.fromEntries(pendingUnwraps.getAllUnwraps())
})

router.get('/peers', (context) => {
	context.response.body = peers.getAllPeers()
})

router.get('/operators', (context) => {
	context.response.body = operators.getOperatorsStatus()
})

export const app = new Application()

// Some headers
app.use((ctx, next) => {
	ctx.response.headers.set('Content-Type', 'application/json')
	ctx.response.headers.set('X-Content-Type-Options', 'nosniff')
	ctx.response.headers.set('X-Frame-Options', 'DENY')
	ctx.response.headers.set('X-XSS-Protection', '1; mode=block')
	ctx.response.headers.set('Referrer-Policy', 'no-referrer')
	ctx.response.headers.set('Cache-Control', 'no-store')
	ctx.response.headers.set('Access-Control-Allow-Origin', '*')
	ctx.response.headers.set(
		'Access-Control-Allow-Methods',
		'GET, OPTIONS',
	)
	ctx.response.headers.set(
		'Access-Control-Allow-Headers',
		'Content-Type',
	)
	next()
})
app.use(router.routes())
app.use(router.allowedMethods())
