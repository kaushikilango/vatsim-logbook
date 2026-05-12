import { useEffect, useState } from 'react'
import { api } from '../api'

export function useFlights(initialLimit = 100) {
  const [flights, setFlights] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)
  const [filters, setFilters] = useState({})
  const limit = initialLimit

  useEffect(() => { setOffset(0) }, [filters])

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.flights(limit, offset, filters)
      .then(data => {
        setFlights(data.flights)
        setTotal(data.total)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [limit, offset, filters])

  return { flights, total, loading, error, offset, setOffset, limit, filters, setFilters }
}

export function useFlight(id) {
  const [flight, setFlight] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    api.flight(id)
      .then(data => {
        setFlight(data)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [id])

  return { flight, loading, error }
}

export function useStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.stats()
      .then(data => { setStats(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return { stats, loading }
}
