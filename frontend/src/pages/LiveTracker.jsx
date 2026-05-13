import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useLive } from '../hooks/useLive'
import { api } from '../api'
import Runways from '../components/Runways'
import WeatherBlock from '../components/WeatherBlock'

const MAX_LIVE_TRAIL = 5000   // cap only for live-appended points; historical always shown in full

// ── Altitude colour bands ─────────────────────────────────────────────────────
function altColor(alt) {
  if (alt == null) return '#58a6ff'
  if (alt > 35000) return '#a78bfa'   // violet  — cruise
  if (alt > 20000) return '#58a6ff'   // blue    — high
  if (alt > 5000)  return '#34d399'   // green   — climbing/descending
  return '#fbbf24'                     // yellow  — low / approach
}

// Fading, altitude-coloured segments from trail array [{lat,lng,alt}]
function buildSegments(trail) {
  if (trail.length < 2) return []
  const total = trail.length
  return trail.slice(1).map((pt, i) => {
    const recency = (i + 1) / total           // 0 = oldest, 1 = newest
    return {
      positions: [[trail[i].lat, trail[i].lng], [pt.lat, pt.lng]],
      color:   altColor(pt.alt),
      opacity: 0.2 + recency * 0.8,
      weight:  1.5 + recency * 2.5,
    }
  })
}

// ── Aircraft icon ─────────────────────────────────────────────────────────────
function aircraftIcon(heading) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${heading}deg);width:36px;height:36px;display:flex;align-items:center;justify-content:center">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="#58a6ff"
           style="filter:drop-shadow(0 0 6px #58a6ffcc)">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
    </div>`,
    iconAnchor: [18, 18],
  })
}

// ── Aircraft marker — moves the Leaflet marker imperatively ──────────────────
function AircraftMarker({ position, autoPan }) {
  const map     = useMapEvents({})
  const markerRef = useRef(null)

  useEffect(() => {
    if (!position) return
    const latlng = [position.lat, position.lng]
    if (!markerRef.current) {
      markerRef.current = L.marker(latlng, { icon: aircraftIcon(position.heading) }).addTo(map)
    } else {
      markerRef.current.setLatLng(latlng)
      markerRef.current.setIcon(aircraftIcon(position.heading))
    }
    if (autoPan) map.panTo(latlng, { animate: true, duration: 1 })
  }, [position, autoPan, map])

  useEffect(() => () => { markerRef.current?.remove() }, [])
  return null
}

// ── Interaction tracker — tells us when the user manually moves the map ───────
function InteractionTracker({ onDrag, onIdle }) {
  useMapEvents({ dragstart: onDrag, zoomstart: onDrag, moveend: onIdle })
  return null
}

// ── Legend row ────────────────────────────────────────────────────────────────
const ALT_LEGEND = [
  { color: '#a78bfa', label: 'FL350+' },
  { color: '#58a6ff', label: 'FL200–350' },
  { color: '#34d399', label: 'FL050–200' },
  { color: '#fbbf24', label: 'Below FL050' },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function LiveTracker() {
  const { position, online } = useLive()

  const [trail,    setTrail]    = useState([])   // [{lat, lng, alt}]
  const [dep,      setDep]      = useState(null) // {icao, name, latitude, longitude}
  const [arr,      setArr]      = useState(null)
  const [autoPan,  setAutoPan]  = useState(true)
  const [loaded,   setLoaded]   = useState(false)
  const idleTimer = useRef(null)

  // Load track history + dep/arr airports on mount
  useEffect(() => {
    api.status().then(async ({ flight_id }) => {
      if (!flight_id) { setLoaded(true); return }

      // Track history
      try {
        const pts = await api.track(flight_id)
        setTrail(pts.map(p => ({
          lat: p.latitude, lng: p.longitude, alt: p.altitude,
        })))
      } catch {}

      // Departure / arrival airports
      try {
        const flight = await api.flight(flight_id)
        if (flight.departure) {
          api.airport(flight.departure).then(setDep).catch(() => {})
        }
        if (flight.arrival) {
          api.airport(flight.arrival).then(setArr).catch(() => {})
        }
      } catch {}

      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  // Append live WS positions to trail
  useEffect(() => {
    if (!position || !loaded) return
    setTrail(prev => [
      ...prev.slice(-(MAX_LIVE_TRAIL - 1)),
      { lat: position.lat, lng: position.lng, alt: position.altitude },
    ])
  }, [position, loaded])

  // Smart auto-pan handlers
  const onDrag = () => {
    setAutoPan(false)
    clearTimeout(idleTimer.current)
  }
  const onIdle = () => {
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setAutoPan(true), 5000)
  }

  const segments = buildSegments(trail)
  const center   = position ? [position.lat, position.lng] : [20, 0]
  const zoom     = position ? 7 : 2

  const fmtAlt = alt => alt != null
    ? (alt >= 1000 ? `FL${Math.round(alt / 100).toString().padStart(3, '0')}` : `${alt.toLocaleString()} ft`)
    : '—'

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 52px)' }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

        <InteractionTracker onDrag={onDrag} onIdle={onIdle} />

        {/* Altitude-coloured fading trail */}
        {segments.map((seg, i) => (
          <Polyline key={i} positions={seg.positions}
            color={seg.color} weight={seg.weight} opacity={seg.opacity} />
        ))}

        {/* Runway rectangles */}
        {dep && <Runways icao={dep.icao} />}
        {arr && <Runways icao={arr.icao} />}

        {/* Departure airport */}
        {dep && (
          <CircleMarker center={[dep.latitude, dep.longitude]}
            radius={2} color="#3fb950" fillColor="#3fb950" fillOpacity={0.5} weight={1}>
            <Popup>
              <strong>{dep.icao}</strong><br />{dep.name}
            </Popup>
          </CircleMarker>
        )}

        {/* Destination airport */}
        {arr && (
          <CircleMarker center={[arr.latitude, arr.longitude]}
            radius={2} color="#f0883e" fillColor="#f0883e" fillOpacity={0.5} weight={1}>
            <Popup>
              <strong>{arr.icao}</strong><br />{arr.name}
            </Popup>
          </CircleMarker>
        )}

        {/* Aircraft */}
        {position && <AircraftMarker position={position} autoPan={autoPan} />}
      </MapContainer>

      {/* HUD */}
      <div style={{
        position: 'absolute', top: 16, right: 16,
        background: 'rgba(22,27,34,0.92)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '12px 16px', minWidth: 190, zIndex: 1000,
      }}>
        {/* Status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: online ? 'var(--green)' : 'var(--border)',
            boxShadow: online ? '0 0 6px var(--green)' : 'none',
          }} />
          <span style={{ fontWeight: 600 }}>{online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>

        {position ? (
          <>
            {/* Route line */}
            {(dep || arr) && (
              <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: '#3fb950' }}>{dep?.icao ?? '?'}</span>
                <span style={{ margin: '0 4px' }}>→</span>
                <span style={{ color: '#f0883e' }}>{arr?.icao ?? '?'}</span>
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
              {[
                ['Callsign', position.callsign],
                ['Altitude', fmtAlt(position.altitude)],
                ['G/Speed',  `${position.groundspeed} kt`],
                ['Heading',  `${position.heading}°`],
                ['Squawk',   position.transponder ?? '—'],
                ['Lat',      position.lat?.toFixed(4)],
                ['Lng',      position.lng?.toFixed(4)],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ color: 'var(--muted)', paddingRight: 12, paddingBottom: 4, fontSize: 12 }}>{k}</td>
                  <td style={{ fontWeight: 500, fontSize: 12 }}>{v}</td>
                </tr>
              ))}
            </table>
            {/* Destination weather */}
            {arr && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {arr.icao} Weather
                </div>
                <WeatherBlock icao={arr.icao} />
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            {online ? 'Waiting for position…' : 'Not connected to VATSIM'}
          </p>
        )}
      </div>

      {/* Altitude legend */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16, zIndex: 1000,
        background: 'rgba(22,27,34,0.88)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {ALT_LEGEND.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{
              width: 24, height: 3, borderRadius: 2,
              background: color, display: 'inline-block',
              boxShadow: `0 0 4px ${color}88`,
            }} />
            <span style={{ color: 'var(--muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Resume tracking button */}
      {!autoPan && position && (
        <button
          onClick={() => setAutoPan(true)}
          style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, padding: '8px 18px', borderRadius: 20,
            background: 'rgba(22,27,34,0.92)', border: '1px solid var(--border)',
            color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
          }}
        >
          ⊕ Resume tracking
        </button>
      )}
    </div>
  )
}
