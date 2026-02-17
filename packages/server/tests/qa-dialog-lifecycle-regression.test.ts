import { describe, expect, it } from 'vitest';
import type { PlanningMessage, QARequest } from '@task-factory/shared';
import {
  createPlanningQALifecycleState,
  hydratePlanningQALifecycleFromMessages,
  reducePlanningQALifecycleState,
} from '../../client/src/hooks/planning-qa-state.ts';

const now = '2026-02-17T19:00:00.000Z';

function makeRequest(requestId: string): QARequest {
  return {
    requestId,
    questions: [
      {
        id: `${requestId}-q1`,
        text: 'Choose one',
        options: ['A', 'B'],
      },
    ],
  };
}

function makeQARequestMessage(request: QARequest, id = `${request.requestId}-request`): PlanningMessage {
  return {
    id,
    role: 'qa',
    content: 'request',
    timestamp: now,
    metadata: {
      qaRequest: request,
    },
  };
}

function makeQAResponseMessage(requestId: string, id = `${requestId}-response`): PlanningMessage {
  return {
    id,
    role: 'qa',
    content: 'response',
    timestamp: now,
    metadata: {
      qaResponse: {
        requestId,
        answers: [],
      },
    },
  };
}

describe('planning QA lifecycle regression checks', () => {
  it('closes active QA immediately when matching QA response message arrives without a status event', () => {
    const request = makeRequest('req-1');

    let state = createPlanningQALifecycleState();
    state = reducePlanningQALifecycleState(state, { type: 'request', request });
    expect(state.activeRequest?.requestId).toBe('req-1');

    state = reducePlanningQALifecycleState(state, {
      type: 'message',
      message: makeQAResponseMessage('req-1'),
    });

    expect(state.activeRequest).toBeNull();
    expect(state.resolvedRequestIds.has('req-1')).toBe(true);
  });

  it('ignores stale duplicate QA request events after the request has already been resolved', () => {
    const request = makeRequest('req-2');

    let state = createPlanningQALifecycleState();
    state = reducePlanningQALifecycleState(state, { type: 'request', request });
    state = reducePlanningQALifecycleState(state, {
      type: 'message',
      message: makeQAResponseMessage('req-2'),
    });

    state = reducePlanningQALifecycleState(state, { type: 'request', request });
    expect(state.activeRequest).toBeNull();

    state = reducePlanningQALifecycleState(state, {
      type: 'message',
      message: makeQARequestMessage(request, 'req-2-stale-request'),
    });
    expect(state.activeRequest).toBeNull();
  });

  it('treats a non-awaiting status transition as closure so stale requests cannot reopen', () => {
    const request = makeRequest('req-3');

    let state = createPlanningQALifecycleState();
    state = reducePlanningQALifecycleState(state, { type: 'request', request });
    expect(state.activeRequest?.requestId).toBe('req-3');

    state = reducePlanningQALifecycleState(state, {
      type: 'status',
      status: 'streaming',
    });

    expect(state.activeRequest).toBeNull();
    expect(state.resolvedRequestIds.has('req-3')).toBe(true);

    state = reducePlanningQALifecycleState(state, { type: 'request', request });
    expect(state.activeRequest).toBeNull();
  });

  it('restores only the latest unresolved QA request from persisted history', () => {
    const answeredRequest = makeRequest('req-answered');
    const pendingRequest = makeRequest('req-pending');

    const messages: PlanningMessage[] = [
      makeQARequestMessage(answeredRequest, 'msg-1'),
      makeQAResponseMessage('req-answered', 'msg-2'),
      makeQARequestMessage(answeredRequest, 'msg-3-stale-duplicate'),
      makeQARequestMessage(pendingRequest, 'msg-4'),
    ];

    const state = hydratePlanningQALifecycleFromMessages(messages);

    expect(state.activeRequest?.requestId).toBe('req-pending');
    expect(state.resolvedRequestIds.has('req-answered')).toBe(true);
    expect(state.resolvedRequestIds.has('req-pending')).toBe(false);
  });
});
