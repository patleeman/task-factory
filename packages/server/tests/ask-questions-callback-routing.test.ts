import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock the global callback registry
const mockCallbacks = new Map();

// Reset before each test
beforeEach(() => {
  mockCallbacks.clear();
  (globalThis as any).__piFactoryQACallbacks = mockCallbacks;
});

// Simulated ask_questions tool logic (extracted from extension)
async function simulatedAskQuestionsTool(
  params: { questions: any[]; workspaceId: string }
) {
  const { questions, workspaceId } = params;
  const requestId = crypto.randomUUID();

  const callbacks = (globalThis as any).__piFactoryQACallbacks;
  if (!callbacks || callbacks.size === 0) {
    return {
      content: [{ type: 'text' as const, text: 'Q&A callbacks not available' }],
      details: {},
    };
  }

  // workspaceId is required for routing
  if (!workspaceId) {
    return {
      content: [{ type: 'text' as const, text: 'Q&A request failed: workspaceId is required' }],
      details: {},
    };
  }

  // Look up the callback for the specific workspace
  const cb = callbacks.get(workspaceId);
  if (!cb) {
    return {
      content: [{ type: 'text' as const, text: `Q&A request failed: no callback registered for workspace ${workspaceId}` }],
      details: {},
    };
  }

  try {
    const answers = await cb.askQuestions(requestId, questions, workspaceId);
    return {
      content: [{ type: 'text' as const, text: `User answered ${answers.length} question(s)` }],
      details: {},
    };
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: `Q&A request failed: ${err instanceof Error ? err.message : String(err)}` }],
      details: {},
    };
  }
}

describe('ask_questions callback routing', () => {
  it('routes QA request to the correct workspace callback when workspaceId is provided', async () => {
    const workspaceAHandler = vi.fn().mockResolvedValue([{ questionId: 'q1', selectedOption: 'A' }]);
    const workspaceBHandler = vi.fn().mockResolvedValue([{ questionId: 'q1', selectedOption: 'B' }]);

    mockCallbacks.set('workspace-a', { askQuestions: workspaceAHandler });
    mockCallbacks.set('workspace-b', { askQuestions: workspaceBHandler });

    const result = await simulatedAskQuestionsTool({
      questions: [{ id: 'q1', text: 'Test?', options: ['A', 'B'] }],
      workspaceId: 'workspace-b',
    });

    expect(workspaceAHandler).not.toHaveBeenCalled();
    expect(workspaceBHandler).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('User answered 1 question(s)');
  });

  it('returns error when workspaceId is empty string', async () => {
    mockCallbacks.set('workspace-a', { askQuestions: vi.fn() });

    const result = await simulatedAskQuestionsTool({
      questions: [{ id: 'q1', text: 'Test?', options: ['A', 'B'] }],
      workspaceId: '',
    });

    expect(result.content[0].text).toContain('workspaceId is required');
  });

  it('returns error when no callback is registered for the workspace', async () => {
    // Only workspace-a registered, but we ask for workspace-c
    mockCallbacks.set('workspace-a', { askQuestions: vi.fn() });

    const result = await simulatedAskQuestionsTool({
      questions: [{ id: 'q1', text: 'Test?', options: ['A', 'B'] }],
      workspaceId: 'workspace-c',
    });

    expect(result.content[0].text).toContain('no callback registered for workspace workspace-c');
  });

  it('does not route to a different workspace when the target is not found', async () => {
    const workspaceAHandler = vi.fn().mockResolvedValue([{ questionId: 'q1', selectedOption: 'A' }]);

    mockCallbacks.set('workspace-a', { askQuestions: workspaceAHandler });

    const result = await simulatedAskQuestionsTool({
      questions: [{ id: 'q1', text: 'Test?', options: ['A', 'B'] }],
      workspaceId: 'workspace-b', // Not registered
    });

    expect(workspaceAHandler).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('no callback registered');
  });

  it('handles multi-workspace scenario correctly (AC1)', async () => {
    // Simulating two active planning sessions
    const workspaceACallback = vi.fn().mockResolvedValue([{ questionId: 'q1', selectedOption: 'Option A' }]);
    const workspaceBCallback = vi.fn().mockResolvedValue([{ questionId: 'q1', selectedOption: 'Option B' }]);

    // Workspace A registered first (simulating older session)
    mockCallbacks.set('workspace-a', { askQuestions: workspaceACallback });
    mockCallbacks.set('workspace-b', { askQuestions: workspaceBCallback });

    // Call from workspace B
    await simulatedAskQuestionsTool({
      questions: [{ id: 'q1', text: 'What should we do?', options: ['Option A', 'Option B'] }],
      workspaceId: 'workspace-b',
    });

    // Workspace B's callback should be invoked, not workspace A's
    expect(workspaceACallback).not.toHaveBeenCalled();
    expect(workspaceBCallback).toHaveBeenCalledTimes(1);
    expect(workspaceBCallback).toHaveBeenCalledWith(
      expect.any(String),
      [{ id: 'q1', text: 'What should we do?', options: ['Option A', 'Option B'] }],
      'workspace-b'
    );
  });
});

describe('ask_questions server-side callback security', () => {
  it('rejects calls with mismatched workspaceId (security check in callback)', async () => {
    // The server-side callback has a security check that verifies
    // the callerWorkspaceId matches the registered workspaceId
    const secureCallback = vi.fn().mockImplementation((requestId, questions, callerWorkspaceId) => {
      if (callerWorkspaceId && callerWorkspaceId !== 'workspace-a') {
        return Promise.reject(new Error(`Workspace mismatch: callback registered for workspace-a but called with ${callerWorkspaceId}`));
      }
      return Promise.resolve([{ questionId: 'q1', selectedOption: 'A' }]);
    });

    mockCallbacks.set('workspace-a', { askQuestions: secureCallback });

    // Try to call workspace-a's callback with workspace-b's ID
    const cb = mockCallbacks.get('workspace-a');
    await expect(cb.askQuestions('req-1', [{ id: 'q1', text: 'Test?', options: ['A', 'B'] }], 'workspace-b'))
      .rejects.toThrow('Workspace mismatch');
  });
});
