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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const shouldReconnectRef = useRef(true)

  useEffect(() => {
    if (!workspaceId) return

    shouldReconnectRef.current = true
    reconnectAttemptsRef.current = 0

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    const connect = () => {
      if (!shouldReconnectRef.current) return

      const socket = new WebSocket(wsUrl)
      ws.current = socket

      socket.onopen = () => {
        setIsConnected(true)
        reconnectAttemptsRef.current = 0

        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'subscribe', workspaceId }))
        }
      }

      socket.onclose = () => {
        setIsConnected(false)

        if (!shouldReconnectRef.current) return

        reconnectAttemptsRef.current += 1
        const retryDelayMs = Math.min(5000, 500 * (2 ** Math.min(reconnectAttemptsRef.current, 4)))

        reconnectTimerRef.current = setTimeout(() => {
          connect()
        }, retryDelayMs)
      }

      socket.onerror = () => {
        // Let onclose handle reconnect scheduling.
        socket.close()
      }

      socket.onmessage = (event) => {
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
    }

    connect()

    return () => {
      shouldReconnectRef.current = false
      setIsConnected(false)

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }

      ws.current?.close()
      ws.current = null
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
