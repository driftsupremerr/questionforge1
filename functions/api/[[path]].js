/**
 * Cloudflare Pages Functions: Catch-All API Handler (/api/[[path]])
 * Translates Pages Function requests into the Worker API router
 */

import worker from '../../_worker.js';

export async function onRequest(context) {
  const { request, env } = context;
  return worker.fetch(request, env, context);
}
