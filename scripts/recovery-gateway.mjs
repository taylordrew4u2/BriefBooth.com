import gateway from './zoom-gateway.js';
import { handleRecovery } from './recovery-backend.mjs';
import { finishGoogleConnection } from './recovery-google-connection.mjs';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Existing consultant callbacks retain their original destination. Only
    // this workspace's namespaced state is handled by the current backend.
    if (url.pathname === '/api/google/callback' && url.searchParams.get('state')?.startsWith('r1_')) {
      return finishGoogleConnection(request, env);
    }
    if (url.pathname.startsWith('/api/recovery/')) {
      return handleRecovery(request, env, ctx);
    }
    return gateway.fetch(request);
  },
};
