import { useEffect, useRef, useState, useCallback } from 'react'
import type { ServerEvent, ClientEvent } from '@pi-factory/shared'

export function useWebSocket(workspaceId: string | null) {
  const ws = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<ServerEvent | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    ws.current = new WebSocket(wsUrl)

    ws.current.onopen = () => {
      setIsConnected(true)
      // Subscribe to workspace
      sendMessage({ type: 'subscribe', workspaceId })
    }

    ws.current.onclose = () => {
      setIsConnected(false)
    }

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent
        setLastMessage(data)
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }

    return () => {
      ws.current?.close()
    }
  }, [workspaceId])

  const sendMessage = useCallback((message: ClientEvent) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message))
    }
  }, [])

  return { sendMessage, lastMessage, isConnected }
}
