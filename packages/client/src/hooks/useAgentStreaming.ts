import { useState, useEffect, useRef } from 'react'
import type { ServerEvent, AgentExecutionStatus } from '@pi-factory/shared'

export interface ToolCallState {
  toolCallId: string
  toolName: string
  input?: Record<string, unknown>
  output: string
  isComplete: boolean
  isError: boolean
  result?: string
}

export interface AgentStreamState {
  /** Current execution status */
  status: AgentExecutionStatus
  /** Accumulated streaming text (live, before message_end) */
  streamingText: string
  /** Accumulated thinking text */
  thinkingText: string
  /** Active tool calls (in progress or recent) */
  toolCalls: ToolCallState[]
  /** Whether the agent is actively producing output */
  isActive: boolean
}

const INITIAL_STATE: AgentStreamState = {
  status: 'idle',
  streamingText: '',
  thinkingText: '',
  toolCalls: [],
  isActive: false,
}

/**
 * Tracks live agent streaming state for a specific task.
 * Uses the WebSocket subscribe pattern so no messages are lost.
 */
export function useAgentStreaming(
  taskId: string | null,
  subscribe: (handler: (event: ServerEvent) => void) => () => void,
): AgentStreamState {
  const [state, setState] = useState<AgentStreamState>(INITIAL_STATE)
  const taskIdRef = useRef(taskId)
  taskIdRef.current = taskId

  // Reset when task changes
  useEffect(() => {
    setState(INITIAL_STATE)
  }, [taskId])

  // Subscribe to streaming events
  useEffect(() => {
    return subscribe((msg) => {
      const currentTaskId = taskIdRef.current
      if (!currentTaskId) return

      // Only handle events for our task
      if ('taskId' in msg && (msg as any).taskId !== currentTaskId) return

      switch (msg.type) {
        case 'agent:execution_status':
          setState((prev) => ({
            ...prev,
            status: msg.status,
            isActive: msg.status !== 'idle' && msg.status !== 'completed' && msg.status !== 'error',
          }))
          break

        case 'agent:streaming_start':
          setState((prev) => ({
            ...prev,
            streamingText: '',
            thinkingText: '',
            status: 'streaming',
            isActive: true,
          }))
          break

        case 'agent:streaming_text':
          setState((prev) => ({
            ...prev,
            streamingText: prev.streamingText + msg.delta,
          }))
          break

        case 'agent:streaming_end':
          setState((prev) => ({
            ...prev,
            streamingText: '',
          }))
          break

        case 'agent:thinking_delta':
          setState((prev) => ({
            ...prev,
            thinkingText: prev.thinkingText + msg.delta,
            status: 'thinking',
          }))
          break

        case 'agent:thinking_end':
          setState((prev) => ({
            ...prev,
            thinkingText: '',
          }))
          break

        case 'agent:tool_start':
          setState((prev) => ({
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
              },
            ],
          }))
          break

        case 'agent:tool_update':
          setState((prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.map((tc) =>
              tc.toolCallId === msg.toolCallId
                ? { ...tc, output: tc.output + msg.delta }
                : tc
            ),
          }))
          break

        case 'agent:tool_end':
          setState((prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.map((tc) =>
              tc.toolCallId === msg.toolCallId
                ? { ...tc, isComplete: true, isError: msg.isError, result: msg.result }
                : tc
            ),
          }))
          break

        case 'agent:turn_end':
          setState((prev) => ({
            ...prev,
            toolCalls: [],
          }))
          break
      }
    })
  }, [subscribe])

  return state
}
