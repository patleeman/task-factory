import { useState, useEffect, useRef } from 'react'
import type { ServerEvent, PlanningAgentStatus, PlanningMessage, Shelf } from '@pi-factory/shared'

export interface PlanningToolCallState {
  toolCallId: string
  toolName: string
  output: string
  isComplete: boolean
  isError: boolean
}

export interface PlanningStreamState {
  status: PlanningAgentStatus
  streamingText: string
  thinkingText: string
  toolCalls: PlanningToolCallState[]
  messages: PlanningMessage[]
  shelf: Shelf | null
  isActive: boolean
}

const INITIAL_STATE: PlanningStreamState = {
  status: 'idle',
  streamingText: '',
  thinkingText: '',
  toolCalls: [],
  messages: [],
  shelf: null,
  isActive: false,
}

/**
 * Tracks live planning agent streaming state for a workspace.
 */
export function usePlanningStreaming(
  workspaceId: string | null,
  subscribe: (handler: (event: ServerEvent) => void) => () => void,
  initialMessages?: PlanningMessage[],
): PlanningStreamState {
  const [state, setState] = useState<PlanningStreamState>(INITIAL_STATE)
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  useEffect(() => {
    setState(INITIAL_STATE)
  }, [workspaceId])

  // Seed with initial messages loaded from server, or clear on reset
  useEffect(() => {
    if (!initialMessages) return
    setState((prev) => {
      // Reset requested (empty array passed after a reset call)
      if (initialMessages.length === 0 && prev.messages.length > 0) {
        return { ...INITIAL_STATE }
      }
      // Seed only if we haven't received any streaming messages yet
      if (initialMessages.length > 0 && prev.messages.length === 0) {
        return { ...prev, messages: initialMessages }
      }
      return prev
    })
  }, [initialMessages])

  useEffect(() => {
    return subscribe((msg) => {
      const currentWsId = workspaceIdRef.current
      if (!currentWsId) return

      // Only handle planning events for our workspace
      if ('workspaceId' in msg && (msg as any).workspaceId !== currentWsId) return

      switch (msg.type) {
        case 'planning:status':
          setState((prev) => ({
            ...prev,
            status: msg.status,
            isActive: msg.status !== 'idle' && msg.status !== 'error',
          }))
          break

        case 'planning:message':
          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, msg.message],
          }))
          break

        case 'planning:streaming_text':
          setState((prev) => ({
            ...prev,
            streamingText: prev.streamingText + msg.delta,
          }))
          break

        case 'planning:streaming_end':
          setState((prev) => ({
            ...prev,
            streamingText: '',
          }))
          break

        case 'planning:thinking_delta':
          setState((prev) => ({
            ...prev,
            thinkingText: prev.thinkingText + msg.delta,
            status: 'thinking',
          }))
          break

        case 'planning:thinking_end':
          setState((prev) => ({
            ...prev,
            thinkingText: '',
          }))
          break

        case 'planning:tool_start':
          setState((prev) => ({
            ...prev,
            status: 'tool_use',
            toolCalls: [
              ...prev.toolCalls,
              {
                toolCallId: msg.toolCallId,
                toolName: msg.toolName,
                output: '',
                isComplete: false,
                isError: false,
              },
            ],
          }))
          break

        case 'planning:tool_update':
          setState((prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.map((tc) =>
              tc.toolCallId === msg.toolCallId
                ? { ...tc, output: tc.output + msg.delta }
                : tc
            ),
          }))
          break

        case 'planning:tool_end':
          setState((prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.map((tc) =>
              tc.toolCallId === msg.toolCallId
                ? { ...tc, isComplete: true, isError: msg.isError }
                : tc
            ),
          }))
          break

        case 'planning:turn_end':
          setState((prev) => ({
            ...prev,
            toolCalls: [],
          }))
          break

        case 'shelf:updated':
          setState((prev) => ({
            ...prev,
            shelf: msg.shelf,
          }))
          break
      }
    })
  }, [subscribe])

  return state
}
