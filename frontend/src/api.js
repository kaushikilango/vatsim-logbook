const BASE = import.meta.env.VITE_API_URL ?? ''

async function get(url) {
  const r = await fetch(BASE + url)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

export const api = {
  flights: (limit = 100, offset = 0, filters = {}) => {
    const p = new URLSearchParams({ limit, offset })
    if (filters.search)    p.set('search',    filters.search)
    if (filters.departure) p.set('departure', filters.departure)
    if (filters.arrival)   p.set('arrival',   filters.arrival)
    if (filters.aircraft)  p.set('aircraft',  filters.aircraft)
    return get(`/api/flights?${p}`)
  },

  flight: (id) =>
    get(`/api/flights/${id}`),

  track: (id) =>
    get(`/api/flights/${id}/track`),

  globe: () =>
    get('/api/globe'),

  stats: () =>
    get('/api/stats'),

  statsMonthly:  () => get('/api/stats/monthly'),
  statsAirports: () => get('/api/stats/airports'),
  statsAircraft: () => get('/api/stats/aircraft'),
  statsRoutes:   () => get('/api/stats/routes'),

  airport: (icao) =>
    get(`/api/airports/${icao}`),

  runways: (icao) =>
    get(`/api/airports/${icao}/runways`),

  status: () =>
    get('/api/status'),

  wsUrl: () => {
    const base = import.meta.env.VITE_API_URL ?? window.location.origin
    return base.replace(/^http/, 'ws') + '/ws/live'
  },
}
