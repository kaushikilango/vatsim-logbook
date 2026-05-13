import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Globe from 'globe.gl'
import { api } from '../api'

// ── Aircraft family ───────────────────────────────────────────────────────────
function aircraftFamily(ac) {
  if (!ac) return 'other'
  const c = ac.toUpperCase()
  if (/^(A3[3-9][0-9K]?|B74|B77|B78|B76|A38)/.test(c)) return 'widebody'
  if (/^(A3[12][0-9N]?|B73|B38|E[12][7-9]|C[12-9][0-9]|CRJ)/.test(c)) return 'narrowbody'
  return 'other'
}

const COLOR = {
  widebody:   '#58a6ff',
  narrowbody: '#f0883e',
  other:      '#8b949e',
  active:     '#3fb950',
  airport:    '#ffd700',
}

const LEGEND = [
  { color: COLOR.widebody,   label: 'Widebody' },
  { color: COLOR.narrowbody, label: 'Narrowbody' },
  { color: COLOR.other,      label: 'Other / unknown' },
  { color: COLOR.active,     label: 'Active flight' },
]

function buildArcs(flights) {
  const map = new Map()
  for (const f of flights) {
    if (f.start_lat == null || f.end_lat == null) continue
    const key = `${f.departure}→${f.arrival}`
    if (!map.has(key)) {
      map.set(key, {
        id: f.id, callsign: f.callsign,
        departure: f.departure ?? '?', arrival: f.arrival ?? '?',
        aircraft_short: f.aircraft_short ?? '',
        startLng: f.start_lng, startLat: f.start_lat,
        endLng: f.end_lng,     endLat: f.end_lat,
        max_altitude: f.max_altitude ?? 0,
        count: 0, isActive: false,
      })
    }
    const e = map.get(key)
    e.count++
    if (!f.logoff_time) e.isActive = true
  }
  return [...map.values()]
}

function buildPoints(flights) {
  const map = new Map()
  for (const f of flights) {
    for (const [icao, lat, lng] of [
      [f.departure, f.start_lat, f.start_lng],
      [f.arrival,   f.end_lat,   f.end_lng],
    ]) {
      if (lat == null) continue
      const k = icao || `${lat},${lng}`
      const e = map.get(k) || { lat, lng, icao: icao ?? '', count: 0 }
      e.count++
      map.set(k, e)
    }
  }
  return [...map.values()]
}

function arcColor(arc) {
  if (arc.isActive) return COLOR.active
  return COLOR[aircraftFamily(arc.aircraft_short)]
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GlobePage() {
  const mountRef     = useRef(null)
  const globeRef     = useRef(null)
  const arcClicked   = useRef(false)
  const navigate     = useNavigate()

  const [flights,  setFlights]  = useState([])
  const [hovered,  setHovered]  = useState(null)
  const [selected, setSelected] = useState(null)
  const [mouse,    setMouse]    = useState({ x: 0, y: 0 })
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    api.globe()
      .then(data => { setFlights(data); setLoading(false) })
      .catch(e  => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => {
    if (loading || !mountRef.current) return
    const el = mountRef.current

    const arcs = buildArcs(flights)
    const pts  = buildPoints(flights)

    const g = Globe()(el)
      .width(el.clientWidth)
      .height(el.clientHeight)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      // ── Arcs ──────────────────────────────────────────────────────────────
      .arcsData(arcs)
      .arcStartLat(d => d.startLat)
      .arcStartLng(d => d.startLng)
      .arcEndLat(d => d.endLat)
      .arcEndLng(d => d.endLng)
      .arcColor(d => arcColor(d))
      .arcAltitudeAutoScale(0.35)
      .arcStroke(d => d.isActive ? 0.5 : 0.2)
      .arcDashLength(d => d.isActive ? 0.4 : 1)
      .arcDashGap(d => d.isActive ? 0.15 : 0)
      .arcDashAnimateTime(d => d.isActive ? 2000 : 0)
      .arcLabel(() => '')
      .onArcHover(arc => setHovered(arc ?? null))
      .onArcClick(arc => { arcClicked.current = true; setSelected(arc) })
      // ── Airport ICAO labels ───────────────────────────────────────────────
      .labelsData(pts)
      .labelLat(d => d.lat)
      .labelLng(d => d.lng)
      .labelText(d => d.icao)
      .labelSize(0.45)
      .labelColor(() => 'rgba(255, 215, 0, 0.75)')
      .labelDotRadius(0)
      .labelAltitude(0.005)
      .labelResolution(2)

    globeRef.current = g

    const onResize = () => {
      if (el) g.width(el.clientWidth).height(el.clientHeight)
    }
    window.addEventListener('resize', onResize)

    const onMouseMove = e => setMouse({ x: e.clientX, y: e.clientY })
    el.addEventListener('mousemove', onMouseMove)

    const onClick = () => {
      if (arcClicked.current) { arcClicked.current = false; return }
      setSelected(null)
    }
    el.addEventListener('click', onClick)

    return () => {
      window.removeEventListener('resize', onResize)
      el.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('click', onClick)
      el.innerHTML = ''
      globeRef.current = null
    }
  }, [loading, flights])

  const uniqueAirports = new Set(
    flights.flatMap(f => [f.departure, f.arrival]).filter(Boolean)
  ).size

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 52px)', background: '#000' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Status */}
      <div style={{
        position: 'absolute', top: 16, left: 16, color: 'var(--muted)', fontSize: 12,
        background: 'rgba(13,17,23,0.75)', padding: '4px 10px', borderRadius: 6,
      }}>
        {loading
          ? 'Loading flights…'
          : error
            ? <span style={{ color: 'var(--red)' }}>Failed to load: {error}</span>
            : <>{flights.length} flights · {uniqueAirports} airports</>}
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 16, right: 16,
        background: 'rgba(13,17,23,0.88)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7,
      }}>
        {LEGEND.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: color, display: 'inline-block',
              boxShadow: `0 0 5px ${color}88`,
            }} />
            <span style={{ color: 'var(--muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div style={{
          position: 'fixed', left: mouse.x + 16, top: mouse.y - 12,
          background: 'rgba(13,17,23,0.96)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '8px 12px', fontSize: 12,
          pointerEvents: 'none', zIndex: 2000, minWidth: 150,
        }}>
          <div style={{ fontWeight: 700 }}>{hovered.callsign}</div>
          <div style={{ color: 'var(--muted)', marginTop: 3 }}>{hovered.departure} → {hovered.arrival}</div>
          {hovered.aircraft_short && <div style={{ color: 'var(--muted)', marginTop: 2 }}>{hovered.aircraft_short}</div>}
          {hovered.count > 1 && (
            <div style={{ color: COLOR.airport, marginTop: 3, fontWeight: 600 }}>{hovered.count}× on this route</div>
          )}
        </div>
      )}

      {/* Click popup */}
      {selected && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(13,17,23,0.96)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '12px 20px', minWidth: 240, zIndex: 1000,
        }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.callsign}</div>
          <div style={{ color: 'var(--muted)', marginTop: 4 }}>{selected.departure} → {selected.arrival}</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4, display: 'flex', gap: 8 }}>
            {selected.aircraft_short && <span>{selected.aircraft_short}</span>}
            {selected.count > 1 && <span style={{ color: COLOR.airport }}>{selected.count}× flown</span>}
            {selected.max_altitude > 0 && <span>Max FL{Math.round(Number(selected.max_altitude) / 100)}</span>}
          </div>
          <button
            onClick={() => navigate(`/flight/${selected.id}`)}
            style={{ display: 'block', marginTop: 10, fontSize: 12, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}
          >
            View details →
          </button>
          <button
            onClick={() => setSelected(null)}
            style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}
          >×</button>
        </div>
      )}
    </div>
  )
}
