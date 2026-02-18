import { useState, useEffect, useRef, useCallback } from 'react'
import type { ServerEvent, PlanningMessage, ActivityEntry, Shelf, QARequest } from '@task-factory/shared'
import type { AgentStreamState, ToolCallState } from './useAgentStreaming'
import {
  createPlanningQALifecycleState,
  hydratePlanningQALifecycleFromMessages,
  reducePlanningQALifecycleState,
  type PlanningQALifecycleEvent,
} from './planning-qa-state'
import { api } from '../api'

export interface PlanningStreamState {
  /** Agent stream state — same type as execution agent, drop into TaskChat directly */
  agentStream: AgentStreamState
  /** Messages as ActivityEntry[] — same type as execution agent, drop into TaskChat directly */
  entries: ActivityEntry[]
  /** Shelf state */
  shelf: Shelf | null
  /** Active QA request (if agent is awaiting user answers) */
  activeQARequest: QARequest | null
  /**
   * Client-side fallback: mark a QA request as resolved immediately after a
   * successful submit response, even if WS lifecycle events arrive late.
   */
  resolveQARequestLocally: (requestId: string) => void
}

const INITIAL_AGENT_STREAM: AgentStreamState = {
  status: 'idle',
  streamingText: '',
  thinkingText: '',
  toolCalls: [],
  contextUsage: null,
  isActive: false,
}

/**
 * Convert PlanningMessage[] to ActivityEntry[] so TaskChat renders them identically.
 * Returns entries in newest-first order to match the activity API convention
 * (TaskChat applies .reverse() to get chronological rendering order).
 */
function messagesToEntries(messages: PlanningMessage[]): ActivityEntry[] {
  const entries = messages.map((msg): ActivityEntry => {
    if (msg.role === 'tool') {
      return {
        type: 'chat-message',
        id: msg.id,
        taskId: PLANNING_TASK_ID,
        role: 'agent',
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: {
          toolName: msg.metadata?.toolName,
          args: msg.metadata?.args,
          isError: msg.metadata?.isError,
          artifactId: msg.metadata?.artifactId,
          artifactName: msg.metadata?.artifactName,
          artifactHtml: msg.metadata?.artifactHtml,
          draftTask: msg.metadata?.draftTask,
        },
      }
    }
    if (msg.role === 'qa') {
      // QA messages render as agent messages with qa metadata
      const isResponse = !!msg.metadata?.qaResponse
      return {
        type: 'chat-message',
        id: msg.id,
        taskId: PLANNING_TASK_ID,
        role: isResponse ? 'user' : 'agent',
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: {
          qaRequest: msg.metadata?.qaRequest,
          qaResponse: msg.metadata?.qaResponse,
        },
      }
    }
    if (msg.role === 'system') {
      return {
        type: 'system-event',
        id: msg.id,
        taskId: PLANNING_TASK_ID,
        event: 'phase-change',
        message: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
      }
    }
    return {
      type: 'chat-message',
      id: msg.id,
      taskId: PLANNING_TASK_ID,
      role: msg.role === 'user' ? 'user' : 'agent',
      content: msg.content,
      timestamp: msg.timestamp,
    }
  })
  // Reverse to newest-first — TaskChat will .reverse() again for chronological rendering
  entries.reverse()
  return entries
}

/**
 * Tracks live planning agent streaming state for a workspace.
 * Returns data in the same format as useAgentStreaming so TaskChat works for both.
 */
export function usePlanningStreaming(
  workspaceId: string | null,
  subscribe: (handler: (event: ServerEvent) => void) => () => void,
  initialMessages?: PlanningMessage[],
): PlanningStreamState {
  const [messages, setMessages] = useState<PlanningMessage[]>([])
  const [agentStream, setAgentStream] = useState<AgentStreamState>(INITIAL_AGENT_STREAM)
  const [shelf, setShelf] = useState<Shelf | null>(null)
  const [activeQARequest, setActiveQARequest] = useState<QARequest | null>(null)

  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  const messagesRef = useRef<PlanningMessage[]>(messages)
  messagesRef.current = messages

  const qaLifecycleRef = useRef(createPlanningQALifecycleState())
  const qaPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopQAPoll = useCallback(() => {
    if (qaPollRef.current) {
      clearInterval(qaPollRef.current)
      qaPollRef.current = null
    }
  }, [])

  const applyQALifecycleEvent = useCallback((
    event: PlanningQALifecycleEvent,
    options: { markAwaitingOnOpen?: boolean } = {},
  ) => {
    const previousState = qaLifecycleRef.current
    const nextState = reducePlanningQALifecycleState(previousState, event)
    qaLifecycleRef.current = nextState

    if (nextState !== previousState) {
      setActiveQARequest(nextState.activeRequest)
    }

    const requestId = event.type === 'request'
      ? event.request.requestId
      : event.type === 'message'
        ? event.message.metadata?.qaRequest?.requestId
        : null

    if (options.markAwaitingOnOpen && requestId && nextState.activeRequest?.requestId === requestId) {
      setAgentStream((prev) => ({
        ...prev,
        status: 'awaiting_qa' as any,
        isActive: false,
      }))
    }

    return nextState
  }, [])

  const resolveQARequestLocally = useCallback((requestId: string) => {
    if (!requestId) return

    const nextState = applyQALifecycleEvent({
      type: 'message',
      message: {
        id: `local-qa-response-${requestId}`,
        role: 'qa',
        content: '',
        timestamp: new Date().toISOString(),
        metadata: {
          qaResponse: {
            requestId,
            answers: [],
          },
        },
      },
    })

    if (nextState.resolvedRequestIds.has(requestId)) {
      stopQAPoll()
    }
  }, [applyQALifecycleEvent, stopQAPoll])

  // Poll for pending QA request via HTTP (reliable fallback for WebSocket broadcasts)
  const startQAPoll = useCallback((wsId: string) => {
    if (qaPollRef.current) return

    qaPollRef.current = setInterval(async () => {
      try {
        const request = await api.getPendingQA(wsId)
        if (!request) return

        const nextState = applyQALifecycleEvent(
          { type: 'request', request },
          { markAwaitingOnOpen: true },
        )

        if (
          nextState.activeRequest?.requestId === request.requestId
          || nextState.resolvedRequestIds.has(request.requestId)
        ) {
          stopQAPoll()
        }
      } catch {
        // ignore
      }
    }, 500)
  }, [applyQALifecycleEvent, stopQAPoll])

  const recoverPendingQARequest = useCallback(async (wsId: string) => {
    try {
      const request = await api.getPendingQA(wsId)
      if (!request) return
      if (workspaceIdRef.current !== wsId) return

      const nextState = applyQALifecycleEvent(
        { type: 'request', request },
        { markAwaitingOnOpen: true },
      )

      if (
        nextState.activeRequest?.requestId === request.requestId
        || nextState.resolvedRequestIds.has(request.requestId)
      ) {
        stopQAPoll()
      }
    } catch {
      // ignore
    }
  }, [applyQALifecycleEvent, stopQAPoll])

  useEffect(() => {
    setMessages([])
    setAgentStream(INITIAL_AGENT_STREAM)
    setActiveQARequest(null)
    qaLifecycleRef.current = createPlanningQALifecycleState()
    stopQAPoll()

    if (!workspaceId) return
    void recoverPendingQARequest(workspaceId)
  }, [workspaceId, recoverPendingQARequest, stopQAPoll])

  useEffect(() => stopQAPoll, [stopQAPoll])

  // Seed with initial messages loaded from server, then recover pending QA via HTTP fallback.
  useEffect(() => {
    if (!initialMessages) return

    if (initialMessages.length === 0) {
      setMessages([])
      setAgentStream(INITIAL_AGENT_STREAM)
      setActiveQARequest(null)
      qaLifecycleRef.current = createPlanningQALifecycleState()
      stopQAPoll()

      if (workspaceId) {
        void recoverPendingQARequest(workspaceId)
      }
      return
    }

    // Merge: keep HTTP-loaded messages as the base, then append any
    // WS-delivered messages that arrived before the HTTP response.
    const byId = new Map(initialMessages.map((m) => [m.id, m]))
    for (const message of messagesRef.current) {
      if (!byId.has(message.id)) {
        byId.set(message.id, message)
      }
    }

    const mergedMessages = Array.from(byId.values()).sort((a, b) =>
      (a.timestamp || '').localeCompare(b.timestamp || '')
    )

    setMessages(mergedMessages)

    const restoredQAState = hydratePlanningQALifecycleFromMessages(mergedMessages)
    qaLifecycleRef.current = restoredQAState
    setActiveQARequest(restoredQAState.activeRequest)

    if (restoredQAState.activeRequest) {
      setAgentStream((prev) => ({
        ...prev,
        status: 'awaiting_qa' as any,
        isActive: false,
      }))
      return
    }

    if (workspaceId) {
      void recoverPendingQARequest(workspaceId)
    }
  }, [initialMessages, recoverPendingQARequest, stopQAPoll, workspaceId])

  useEffect(() => {
    return subscribe((msg) => {
      const currentWsId = workspaceIdRef.current
      if (!currentWsId) return

      if ('workspaceId' in msg && (msg as any).workspaceId !== currentWsId) return

      switch (msg.type) {
        case 'planning:status': {
          setAgentStream((prev) => ({
            ...prev,
            status: msg.status as any,
            contextUsage: msg.contextUsage !== undefined ? msg.contextUsage : prev.contextUsage,
            isActive: msg.status !== 'idle' && msg.status !== 'error' && msg.status !== 'awaiting_qa',
          }))

          const nextQAState = applyQALifecycleEvent({ type: 'status', status: msg.status })
          if (msg.status !== 'awaiting_qa' && !nextQAState.activeRequest) {
            stopQAPoll()
          }
          break
        }

        case 'planning:context_usage':
          setAgentStream((prev) => ({
            ...prev,
            contextUsage: msg.usage,
          }))
          break

        case 'qa:request': {
          const nextQAState = applyQALifecycleEvent(
            { type: 'request', request: msg.request },
            { markAwaitingOnOpen: true },
          )

          if (
            nextQAState.activeRequest?.requestId === msg.request.requestId
            || nextQAState.resolvedRequestIds.has(msg.request.requestId)
          ) {
            stopQAPoll()
          }
          break
        }

        case 'planning:message': {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.message.id)) {
              return prev
            }

            return [...prev, msg.message]
          })

          // Fallback: also derive activeQARequest from persisted QA messages.
          // This covers cases where the separate qa:request event doesn't arrive.
          const nextQAState = applyQALifecycleEvent(
            { type: 'message', message: msg.message },
            { markAwaitingOnOpen: true },
          )

          const responseRequestId = msg.message.metadata?.qaResponse?.requestId
          if (responseRequestId && nextQAState.resolvedRequestIds.has(responseRequestId)) {
            stopQAPoll()
          }

          const messageRequestId = msg.message.metadata?.qaRequest?.requestId
          if (messageRequestId && nextQAState.activeRequest?.requestId === messageRequestId) {
            stopQAPoll()
          }

          break
        }

        case 'planning:streaming_text':
          setAgentStream((prev) => ({
            ...prev,
            streamingText: prev.streamingText + msg.delta,
          }))
          break

        case 'planning:streaming_end':
          setAgentStream((prev) => ({
            ...prev,
            streamingText: '',
          }))
          break

        case 'planning:thinking_delta':
          setAgentStream((prev) => ({
            ...prev,
            thinkingText: prev.thinkingText + msg.delta,
            status: 'thinking',
          }))
          break

        case 'planning:thinking_end':
          setAgentStream((prev) => ({
            ...prev,
            thinkingText: '',
          }))
          break

        case 'planning:tool_start':
          setAgentStream((prev) => ({
            ...prev,
            status: 'tool_use',
            toolCalls: [
              ...prev.toolCalls,
              {
                toolCallId: msg.toolCallId,
                toolName: msg.toolName,
                input: (msg as any).input,
                output: '',
                isComplete: false,
                isError: false,
              } as ToolCallState,
            ],
          }))

          // When ask_questions starts, poll for the QA request via HTTP.
          if (msg.toolName === 'ask_questions' && currentWsId) {
            startQAPoll(currentWsId)
          }
          break

        case 'planning:tool_update':
          setAgentStream((prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.map((tc) =>
              tc.toolCallId === msg.toolCallId
                ? { ...tc, output: tc.output + msg.delta }
                : tc
            ),
          }))
          break

        case 'planning:tool_end':
          // Remove the completed tool call from the live stream — it's already
          // persisted as a planning:message entry and will render there instead.
          // This prevents duplication (same tool showing in entries AND live stream).
          setAgentStream((prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.filter((tc) => tc.toolCallId !== msg.toolCallId),
          }))
          break

        case 'planning:turn_end':
          setAgentStream((prev) => ({
            ...prev,
            toolCalls: [],
          }))
          break

        case 'planning:session_reset':
          // Server has reset the session — clear all local state.
          setMessages([])
          setAgentStream(INITIAL_AGENT_STREAM)
          setActiveQARequest(null)
          qaLifecycleRef.current = createPlanningQALifecycleState()
          stopQAPoll()
          break

        case 'shelf:updated':
          setShelf(msg.shelf)
          break
      }
    })
  }, [applyQALifecycleEvent, startQAPoll, stopQAPoll, subscribe])

  // Convert messages to entries for TaskChat
  const entries = messagesToEntries(messages)

  return { agentStream, entries, shelf, activeQARequest, resolveQARequestLocally }
}

export const PLANNING_TASK_ID = '__planning__'
