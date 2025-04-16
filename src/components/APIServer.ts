import { Application } from '@oak/oak/application'
import { Router } from '@oak/oak/router'
import { pendingWraps } from './PendingHiveWraps.ts'

const router = new Router()
router.get('/status', (context) => {
	context.response.body = {
		status: 'OK',
	}
})

router.get('/pending-hive-wraps', (context) => {
	context.response.body = Object.fromEntries(pendingWraps.getAllPendingWraps())
})

router.get('/pending-hive-wraps/:username', (ctx) => {
	ctx.response.body = Object.fromEntries(
		pendingWraps.getWrapsByUsername(ctx.params.username),
	)
})

export const app = new Application()
app.use(router.routes())
app.use(router.allowedMethods())
