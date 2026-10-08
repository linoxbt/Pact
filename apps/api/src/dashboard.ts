import type { FastifyInstance } from 'fastify';
import { enforceRequestLimit, jsonSafe } from '@pact/operations';
import type { ApiContext } from './server.js';

export function registerDashboardRoutes(app: FastifyInstance, ctx: ApiContext) {
  app.get('/v2/dashboard', async request => {
    const owner = await ctx.ownerAuth!.authenticate(request.headers.authorization);
    await enforceRequestLimit(ctx.database, `owner:${owner.id}`, 240);
    const since = new Date(Date.now() - 86_400_000);
    const [stats, hourly, recent, agentStats, keyStats] = await Promise.all([
      ctx.database.query(`SELECT count(*)::int AS requests,
        count(*) FILTER(WHERE decision='allowed')::int AS allowed,
        count(*) FILTER(WHERE decision='denied')::int AS denied,
        count(*) FILTER(WHERE decision='pending_approval')::int AS pending,
        round(avg(latency_ms) FILTER(WHERE upstream_status IS NOT NULL))::int AS latency_ms
        FROM pact_proxy_activity WHERE owner_id=$1 AND created_at >= $2`, [owner.id,since]),
      ctx.database.query(`SELECT date_trunc('hour',created_at) AS hour,
        count(*) FILTER(WHERE decision='allowed')::int AS allowed,
        count(*) FILTER(WHERE decision='denied')::int AS denied,
        count(*) FILTER(WHERE decision='pending_approval')::int AS pending
        FROM pact_proxy_activity WHERE owner_id=$1 AND created_at >= $2 GROUP BY 1 ORDER BY 1`, [owner.id,since]),
      ctx.database.query(`SELECT v.*,a.name AS agent_name FROM pact_proxy_activity v
        JOIN pact_connected_agents a ON a.id=v.agent_id WHERE v.owner_id=$1
        AND v.created_at >= now()-interval '30 days' ORDER BY v.created_at DESC,v.id DESC LIMIT 8`, [owner.id]),
      ctx.database.query(`SELECT agent_id,count(*) FILTER(WHERE created_at >= $2)::int AS requests,
        count(*) FILTER(WHERE created_at >= $2 AND decision='allowed')::int AS allowed,
        count(*) FILTER(WHERE created_at >= $2 AND decision='denied')::int AS denied,
        count(*) FILTER(WHERE created_at >= $2 AND decision='pending_approval')::int AS pending,
        round(avg(latency_ms) FILTER(WHERE created_at >= $2 AND upstream_status IS NOT NULL))::int AS latency_ms,
        max(created_at) AS last_seen FROM pact_proxy_activity WHERE owner_id=$1
        AND created_at >= now()-interval '30 days' GROUP BY agent_id`, [owner.id,since]),
      ctx.database.query(`SELECT agent_id,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>now())::int AS active
        FROM pact_integration_keys WHERE owner_id=$1 GROUP BY agent_id`,[owner.id]),
    ]);
    return jsonSafe({stats:stats.rows[0],hourly:hourly.rows,recent:recent.rows,
      agentStats:agentStats.rows,keyStats:keyStats.rows,since:since.toISOString(),updatedAt:new Date().toISOString()});
  });
}
