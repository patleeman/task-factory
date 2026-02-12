import { useState, useEffect, useRef } from 'react'
import type { ServerEvent, PlanningMessage, ActivityEntry, Shelf } from '@pi-factory/shared'
import type { AgentStreamState, ToolCallState } from './useAgentStreaming'

export interface PlanningStreamState {
  /** Agent stream state — same type as execution agent, drop into TaskChat directly */
  agentStream: AgentStreamState
  /** Messages as ActivityEntry[] — same type as execution agent, drop into TaskChat directly */
  entries: ActivityEntry[]
  /** Shelf state */
  shelf: Shelf | null
}

const INITIAL_AGENT_STREAM: AgentStreamState = {
  status: 'idle',
  streamingText: '',
  thinkingText: '',
  toolCalls: [],
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
        },
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
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  useEffect(() => {
    setMessages([])
    setAgentStream(INITIAL_AGENT_STREAM)
  }, [workspaceId])

  // Seed with initial messages loaded from server, or clear on reset
  useEffect(() => {
    if (!initialMessages) return
    if (initialMessages.length === 0) {
      setMessages([])
      setAgentStream(INITIAL_AGENT_STREAM)
    } else {
      setMessages((prev) => prev.length === 0 ? initialMessages : prev)
    }
  }, [initialMessages])

  useEffect(() => {
    return subscribe((msg) => {
      const currentWsId = workspaceIdRef.current
      if (!currentWsId) return

      if ('workspaceId' in msg && (msg as any).workspaceId !== currentWsId) return

      switch (msg.type) {
        case 'planning:status':
          setAgentStream((prev) => ({
            ...prev,
            status: msg.status as any,
            isActive: msg.status !== 'idle' && msg.status !== 'error',
          }))
          break

        case 'planning:message':
          setMessages((prev) => [...prev, msg.message])
          break

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
          // Server has reset the session — clear all local state
          setMessages([])
          setAgentStream(INITIAL_AGENT_STREAM)
          break

        case 'shelf:updated':
          setShelf(msg.shelf)
          break
      }
    })
  }, [subscribe])

  // Convert messages to entries for TaskChat
  const entries = messagesToEntries(messages)

  return { agentStream, entries, shelf }
}

export const PLANNING_TASK_ID = '__planning__'
