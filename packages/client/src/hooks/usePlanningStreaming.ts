import { useState, useEffect, useRef, useCallback } from 'react'
import type { ServerEvent, PlanningMessage, ActivityEntry, Shelf, QARequest } from '@pi-factory/shared'
import type { AgentStreamState, ToolCallState } from './useAgentStreaming'
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
          artifactId: msg.metadata?.artifactId,
          artifactName: msg.metadata?.artifactName,
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
  const qaPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopQAPoll = useCallback(() => {
    if (qaPollRef.current) { clearInterval(qaPollRef.current); qaPollRef.current = null }
  }, [])

  // Poll for pending QA request via HTTP (reliable fallback for WebSocket broadcasts)
  const startQAPoll = useCallback((wsId: string) => {
    if (qaPollRef.current) return
    qaPollRef.current = setInterval(async () => {
      try {
        const request = await api.getPendingQA(wsId)
        if (request) {
          setActiveQARequest(request)
          setAgentStream((prev) => ({ ...prev, status: 'awaiting_qa' as any, isActive: false }))
          stopQAPoll()
        }
      } catch { /* ignore */ }
    }, 500)
  }, [stopQAPoll])

  useEffect(() => {
    setMessages([])
    setAgentStream(INITIAL_AGENT_STREAM)
    setActiveQARequest(null)
    stopQAPoll()
  }, [workspaceId, stopQAPoll])

  useEffect(() => stopQAPoll, [stopQAPoll])

  // Seed with initial messages loaded from server, or clear on reset
  useEffect(() => {
    if (!initialMessages) return
    if (initialMessages.length === 0) {
      setMessages([])
      setAgentStream(INITIAL_AGENT_STREAM)
    } else {
      setMessages((prev) => {
        // Merge: keep HTTP-loaded messages as the base, then append any
        // WS-delivered messages that arrived before the HTTP response.
        const byId = new Map(initialMessages.map((m) => [m.id, m]))
        for (const m of prev) {
          if (!byId.has(m.id)) byId.set(m.id, m)
        }
        return Array.from(byId.values()).sort((a, b) =>
          (a.timestamp || '').localeCompare(b.timestamp || '')
        )
      })
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
            isActive: msg.status !== 'idle' && msg.status !== 'error' && msg.status !== 'awaiting_qa',
          }))
          // Clear QA dialog when agent resumes (not awaiting anymore)
          if (msg.status !== 'awaiting_qa') {
            setActiveQARequest(null)
            stopQAPoll()
          }
          break

        case 'qa:request':
          setActiveQARequest(msg.request)
          break

        case 'planning:message':
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.message.id)) return prev
            return [...prev, msg.message]
          })
          // Fallback: also derive activeQARequest from the persisted QA message.
          // This covers cases where the separate qa:request event doesn't arrive.
          if (msg.message.role === 'qa' && msg.message.metadata?.qaRequest && !msg.message.metadata?.qaResponse) {
            setActiveQARequest(msg.message.metadata.qaRequest as QARequest)
            setAgentStream((prev) => ({
              ...prev,
              status: 'awaiting_qa' as any,
              isActive: false,
            }))
          }
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
          // When ask_questions starts, poll for the QA request via HTTP
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
          // Server has reset the session — clear all local state
          setMessages([])
          setAgentStream(INITIAL_AGENT_STREAM)
          setActiveQARequest(null)
          stopQAPoll()
          break

        case 'shelf:updated':
          setShelf(msg.shelf)
          break
      }
    })
  }, [subscribe])

  // Convert messages to entries for TaskChat
  const entries = messagesToEntries(messages)

  // Restore active QA request from persisted messages on load
  // (if the last qa message is a request without a matching response)
  useEffect(() => {
    if (messages.length === 0) return
    // Find the last QA request message that doesn't have a corresponding response
    const qaMessages = messages.filter((m) => m.role === 'qa')
    if (qaMessages.length === 0) return

    const lastQA = qaMessages[qaMessages.length - 1]
    if (lastQA.metadata?.qaRequest && !lastQA.metadata?.qaResponse) {
      setActiveQARequest(lastQA.metadata.qaRequest as QARequest)
    }
  }, [initialMessages]) // Only on initial load

  return { agentStream, entries, shelf, activeQARequest }
}

export const PLANNING_TASK_ID = '__planning__'
