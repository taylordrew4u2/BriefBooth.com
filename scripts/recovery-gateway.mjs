import gateway from './zoom-gateway.js';
import { handleRecovery } from './recovery-backend.mjs';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/recovery/')) {
      return handleRecovery(request, env);
    }
    return gateway.fetch(request, env);
  },
};
