/**
 * Pi-Factory Context Extension
 *
 * Example repo-local extension. Loaded from pi-factory's own extensions/
 * directory, NOT from ~/.pi/agent/extensions/.
 *
 * This injects pi-factory task context into the agent session so the agent
 * knows it's operating within pi-factory's task system.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.notify('Pi-Factory extension loaded', 'info');
  });

  pi.on('before_agent_start', async (event, _ctx) => {
    // Append pi-factory awareness to system prompt
    return {
      systemPrompt:
        event.systemPrompt +
        '\n\n' +
        '# Pi-Factory Context\n' +
        'You are running inside Pi-Factory, a TPS-inspired agent work queue.\n' +
        'Report progress clearly. Update quality gates when done.\n' +
        'If you are blocked, say so explicitly.\n',
    };
  });
}
