import { useState, useEffect, useRef } from 'react'
import type { ServerEvent, AgentExecutionStatus } from '@pi-factory/shared'

export interface ToolCallState {
  toolCallId: string
  toolName: string
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
 * Consumes ServerEvents and maintains a reactive state object.
 */
export function useAgentStreaming(taskId: string | null, lastMessage: ServerEvent | null): AgentStreamState {
  const [state, setState] = useState<AgentStreamState>(INITIAL_STATE)
  const stateRef = useRef(state)
  stateRef.current = state

  // Reset when task changes
  useEffect(() => {
    setState(INITIAL_STATE)
  }, [taskId])

  // Process streaming events
  useEffect(() => {
    if (!lastMessage || !taskId) return

    // Only handle events for our task
    if ('taskId' in lastMessage && lastMessage.taskId !== taskId) return

    switch (lastMessage.type) {
      case 'agent:execution_status':
        setState((prev) => ({
          ...prev,
          status: lastMessage.status,
          isActive: lastMessage.status !== 'idle' && lastMessage.status !== 'completed' && lastMessage.status !== 'error',
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
          streamingText: prev.streamingText + lastMessage.delta,
        }))
        break

      case 'agent:streaming_end':
        setState((prev) => ({
          ...prev,
          streamingText: '',
          // Don't set idle — agent may still be working (tool calls, more turns)
        }))
        break

      case 'agent:thinking_delta':
        setState((prev) => ({
          ...prev,
          thinkingText: prev.thinkingText + lastMessage.delta,
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
              toolCallId: lastMessage.toolCallId,
              toolName: lastMessage.toolName,
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
            tc.toolCallId === lastMessage.toolCallId
              ? { ...tc, output: tc.output + lastMessage.delta }
              : tc
          ),
        }))
        break

      case 'agent:tool_end':
        setState((prev) => ({
          ...prev,
          toolCalls: prev.toolCalls.map((tc) =>
            tc.toolCallId === lastMessage.toolCallId
              ? { ...tc, isComplete: true, isError: lastMessage.isError, result: lastMessage.result }
              : tc
          ),
        }))
        break

      case 'agent:turn_end':
        // Clear completed tool calls after a turn ends, keep streaming state
        setState((prev) => ({
          ...prev,
          toolCalls: [],
        }))
        break
    }
  }, [lastMessage, taskId])

  return state
}
