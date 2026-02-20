/**
 * Ask Questions Extension
 *
 * Registers an `ask_questions` tool that any agent (planning or foreman) can
 * call to disambiguate unclear task descriptions by presenting multiple-choice
 * questions to the user.
 *
 * When invoked the tool broadcasts a QA request via a global callback, then
 * blocks (returns a Promise) until the user submits their answers through the
 * UI.  The resolved answers are returned as the tool result so the agent can
 * continue with the user's choices.
 *
 * Communication: the planning-agent-service (or agent-execution-service)
 * registers a callback on `globalThis.__piFactoryQACallbacks` before starting
 * the agent session.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

interface QAAnswer {
  questionId: string;
  selectedOption: string;
}

declare global {
  var __piFactoryQACallbacks: Map<string, {
    askQuestions: (requestId: string, questions: { id: string; text: string; options: string[] }[], callerWorkspaceId?: string) => Promise<QAAnswer[]>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'ask_questions',
    label: 'Ask Questions',
    description:
      'Ask the user multiple-choice questions to clarify ambiguity before proceeding. ' +
      'Each question must include 2–6 concrete options. The tool blocks until the user ' +
      'responds and returns their selected answers. Use this whenever a task description ' +
      'is vague or could be interpreted in multiple ways. ' +
      'IMPORTANT: Call this tool directly — do NOT write the questions in your text response. ' +
      'The tool renders an interactive UI for the user to click answers.',
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          id: Type.String({ description: 'Unique identifier for this question (e.g. "q1")' }),
          text: Type.String({ description: 'The question to ask the user' }),
          options: Type.Array(Type.String(), {
            description: 'Possible answers (2–6 options)',
            minItems: 2,
          }),
        }),
        {
          description: 'List of questions to present to the user',
          minItems: 1,
        },
      ),
      workspaceId: Type.Optional(Type.String({ description: 'Workspace ID for routing the question to the correct UI session' })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const { questions, workspaceId } = params;
      const requestId = crypto.randomUUID();

      const callbacks = globalThis.__piFactoryQACallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Q&A callbacks not available — cannot present questions to the user. Proceed with your best judgement.',
          }],
          details: {} as Record<string, unknown>,
        };
      }

      // Extract workspaceId from context if not provided in params
      const effectiveWorkspaceId = workspaceId || (_ctx as { workspaceId?: string })?.workspaceId;
      if (!effectiveWorkspaceId) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Q&A request failed: workspace context not available. Cannot route questions to the correct session.',
          }],
          details: {} as Record<string, unknown>,
        };
      }

      // Look up the callback for the specific workspace
      const cb = callbacks.get(effectiveWorkspaceId);
      if (!cb) {
        return {
          content: [{
            type: 'text' as const,
            text: `Q&A request failed: no callback registered for workspace ${effectiveWorkspaceId}. The session may have been reset.`,
          }],
          details: {} as Record<string, unknown>,
        };
      }

      try {
        // Race the QA promise against the abort signal so we don't hang
        // if the agent session is cancelled while waiting for user answers.
        const qaPromise = cb.askQuestions(requestId, questions, effectiveWorkspaceId);

        const abortPromise = signal
          ? new Promise<never>((_resolve, reject) => {
              if (signal.aborted) {
                reject(new Error('Aborted'));
                return;
              }
              signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
            })
          : null;

        const answers = abortPromise
          ? await Promise.race([qaPromise, abortPromise])
          : await qaPromise;

        const lines = answers.map((a) => {
          const question = questions.find((item) => item.id === a.questionId);
          return `**${question?.text || a.questionId}**: ${a.selectedOption}`;
        });

        return {
          content: [{
            type: 'text' as const,
            text: `User answered ${answers.length} question(s):\n\n${lines.join('\n')}`,
          }],
          details: {} as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Q&A request failed: ${err instanceof Error ? err.message : String(err)}. Proceed with your best judgement.`,
          }],
          details: {} as Record<string, unknown>,
        };
      }
    },
  });
}
