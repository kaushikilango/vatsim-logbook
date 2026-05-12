import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export function useLive() {
  const [position, setPosition] = useState(null)
  const [online, setOnline] = useState(false)
  const ws = useRef(null)
  const closed = useRef(false)
  const pingRef = useRef(null)

  // Seed initial online state from HTTP status (avoids up-to-15s blank on load)
  useEffect(() => {
    api.status().then(s => {
      if (s.online) setOnline(true)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    closed.current = false

    function connect() {
      if (closed.current) return
      const socket = new WebSocket(api.wsUrl())
      ws.current = socket

      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'position') {
          setOnline(true)
          setPosition(msg)
        } else if (msg.type === 'offline') {
          setOnline(false)
          setPosition(null)
        }
      }

      socket.onclose = () => {
        clearInterval(pingRef.current)
        if (!closed.current) setTimeout(connect, 3000)
      }

      socket.onerror = () => socket.close()

      pingRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping')
      }, 30000)
    }

    connect()
    return () => {
      closed.current = true
      clearInterval(pingRef.current)
      ws.current?.close()
    }
  }, [])

  return { position, online }
}
