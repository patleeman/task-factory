import type { PlanningAgentStatus, PlanningMessage, QARequest } from '@task-factory/shared'

export interface PlanningQALifecycleState {
  activeRequest: QARequest | null
  resolvedRequestIds: Set<string>
}

export type PlanningQALifecycleEvent =
  | { type: 'status'; status: PlanningAgentStatus }
  | { type: 'request'; request: QARequest }
  | { type: 'message'; message: PlanningMessage }

export function createPlanningQALifecycleState(): PlanningQALifecycleState {
  return {
    activeRequest: null,
    resolvedRequestIds: new Set<string>(),
  }
}

function sameRequestId(a: QARequest | null, b: QARequest | null): boolean {
  return a?.requestId === b?.requestId
}

export function reducePlanningQALifecycleState(
  state: PlanningQALifecycleState,
  event: PlanningQALifecycleEvent,
): PlanningQALifecycleState {
  if (event.type === 'status') {
    if (event.status === 'awaiting_qa' || !state.activeRequest) {
      return state
    }

    let nextResolvedRequestIds = state.resolvedRequestIds
    if (!nextResolvedRequestIds.has(state.activeRequest.requestId)) {
      nextResolvedRequestIds = new Set(nextResolvedRequestIds)
      nextResolvedRequestIds.add(state.activeRequest.requestId)
    }

    return {
      activeRequest: null,
      resolvedRequestIds: nextResolvedRequestIds,
    }
  }

  if (event.type === 'request') {
    if (state.resolvedRequestIds.has(event.request.requestId)) {
      return state
    }

    if (sameRequestId(state.activeRequest, event.request)) {
      return state
    }

    return {
      activeRequest: event.request,
      resolvedRequestIds: state.resolvedRequestIds,
    }
  }

  if (event.message.role !== 'qa') {
    return state
  }

  const responseRequestId = event.message.metadata?.qaResponse?.requestId
  const messageRequest = event.message.metadata?.qaRequest

  let nextResolvedRequestIds = state.resolvedRequestIds
  if (responseRequestId && !nextResolvedRequestIds.has(responseRequestId)) {
    nextResolvedRequestIds = new Set(nextResolvedRequestIds)
    nextResolvedRequestIds.add(responseRequestId)
  }

  let nextActiveRequest = state.activeRequest
  if (responseRequestId && nextActiveRequest?.requestId === responseRequestId) {
    nextActiveRequest = null
  }

  if (messageRequest && !nextResolvedRequestIds.has(messageRequest.requestId)) {
    nextActiveRequest = messageRequest
  }

  const activeChanged = !sameRequestId(nextActiveRequest, state.activeRequest)
  const resolvedChanged = nextResolvedRequestIds !== state.resolvedRequestIds

  if (!activeChanged && !resolvedChanged) {
    return state
  }

  return {
    activeRequest: nextActiveRequest,
    resolvedRequestIds: nextResolvedRequestIds,
  }
}

export function hydratePlanningQALifecycleFromMessages(messages: PlanningMessage[]): PlanningQALifecycleState {
  let state = createPlanningQALifecycleState()

  for (const message of messages) {
    state = reducePlanningQALifecycleState(state, {
      type: 'message',
      message,
    })
  }

  return state
}
