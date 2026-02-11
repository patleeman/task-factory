import { useEffect, useRef, useState, useCallback } from 'react'
import type { ServerEvent, ClientEvent } from '@pi-factory/shared'

type MessageHandler = (event: ServerEvent) => void

/**
 * WebSocket hook with a subscription model.
 *
 * Instead of exposing `lastMessage` (which loses events due to React 18
 * automatic batching), consumers register handlers via `subscribe()`.
 * Every WebSocket message is delivered to every handler synchronously —
 * no message is ever dropped.
 */
export function useWebSocket(workspaceId: string | null) {
  const ws = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const subscribersRef = useRef(new Set<MessageHandler>())

  useEffect(() => {
    if (!workspaceId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    ws.current = new WebSocket(wsUrl)

    ws.current.onopen = () => {
      setIsConnected(true)
      // Subscribe to workspace
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'subscribe', workspaceId }))
      }
    }

    ws.current.onclose = () => {
      setIsConnected(false)
    }

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent
        // Deliver to all subscribers synchronously — no batching, no lost messages
        for (const handler of subscribersRef.current) {
          handler(data)
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }

    return () => {
      ws.current?.close()
    }
  }, [workspaceId])

  /**
   * Register a message handler. Returns an unsubscribe function.
   * Call in a useEffect to manage lifecycle.
   */
  const subscribe = useCallback((handler: MessageHandler): (() => void) => {
    subscribersRef.current.add(handler)
    return () => {
      subscribersRef.current.delete(handler)
    }
  }, [])

  const sendMessage = useCallback((message: ClientEvent) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message))
    }
  }, [])

  return { subscribe, sendMessage, isConnected }
}
