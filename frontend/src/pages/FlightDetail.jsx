import { useParams, Link } from 'react-router-dom'
import { useEffect, useRef, useState, useMemo } from 'react'
import { useFlight } from '../hooks/useFlights'
import { useLive } from '../hooks/useLive'
import { api } from '../api'
import { AreaChart, Area, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { MapContainer, TileLayer as LeafletTileLayer, Polyline, CircleMarker, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import WeatherBlock from '../components/WeatherBlock'
import { fmt, fmtTime, fmtTimeDate } from '../utils/time'

// Altitude colour bands (matches LiveTracker)
function altColor(alt) {
  if (alt == null) return '#58a6ff'
  if (alt > 35000) return '#a78bfa'
  if (alt > 20000) return '#58a6ff'
  if (alt > 5000)  return '#34d399'
  return '#fbbf24'
}

// Catmull-Rom spline — interpolates smooth points between p1 and p2
function catmullRomInterp(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  const cr = (a, b, c, d) =>
    0.5 * ((2*b) + (-a + c)*t + (2*a - 5*b + 4*c - d)*t2 + (-a + 3*b - 3*c + d)*t3)
  return {
    latitude:  cr(p0.latitude,  p1.latitude,  p2.latitude,  p3.latitude),
    longitude: cr(p0.longitude, p1.longitude, p2.longitude, p3.longitude),
    altitude:  p1.altitude + (p2.altitude - p1.altitude) * t,
  }
}

const SMOOTH_STEPS = 8

// Densify the path using Catmull-Rom so turns render as smooth curves
function smoothPath(positions) {
  if (positions.length < 2) return positions
  const n   = positions.length
  const out = []
  for (let i = 0; i < n - 1; i++) {
    const p0 = positions[Math.max(0, i - 1)]
    const p1 = positions[i]
    const p2 = positions[i + 1]
    const p3 = positions[Math.min(n - 1, i + 2)]
    out.push(p1)
    for (let j = 1; j < SMOOTH_STEPS; j++)
      out.push(catmullRomInterp(p0, p1, p2, p3, j / SMOOTH_STEPS))
  }
  out.push(positions[n - 1])
  return out
}

// Fading altitude-coloured segments from (smoothed) positions array
function buildSegments(positions) {
  if (positions.length < 2) return []
  const total = positions.length
  return positions.slice(1).map((pt, i) => {
    const recency = (i + 1) / total
    return {
      positions: [
        [positions[i].latitude, positions[i].longitude],
        [pt.latitude, pt.longitude],
      ],
      color:   altColor(pt.altitude),
      opacity: 0.2 + recency * 0.8,
      weight:  1.5 + recency * 2.5,
    }
  })
}

// Plane icon for leaflet
function makePlaneIcon(heading, color) {
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30"
                style="transform:rotate(${heading}deg);filter:drop-shadow(0 1px 3px rgba(0,0,0,0.9))">
             <path fill="${color}" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
           </svg>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    className: '',
  })
}

// Fit map to flight path on first load
function MapReady({ positions }) {
  const map    = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && positions.length > 1) {
      map.fitBounds(
        positions.map(p => [p.latitude, p.longitude]),
        { padding: [40, 40] }
      )
      fitted.current = true
    }
  }, [map, positions])
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function duration(flight) {
  const live  = !flight.logoff_time
  const start = flight.dep_time || flight.logon_time
  const end   = live ? new Date().toISOString() : (flight.arr_time || flight.logoff_time)
  if (!start || !end) return '—'
  const mins  = Math.round((new Date(end) - new Date(start)) / 60000)
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function fmtAlt(ft) {
  if (!ft) return '—'
  if (ft >= 1000) return `FL${Math.round(ft / 100).toString().padStart(3, '0')}`
  return `${ft.toLocaleString()} ft`
}

function InfoRow({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, color: accent || 'var(--text)' }}>{value}</span>
    </div>
  )
}

function calcEta(curLat, curLng, curGs, arrLat, arrLng) {
  if (!curGs || curGs < 50 || !arrLat) return null
  const R  = 3440.065
  const φ1 = Math.PI / 180 * curLat, φ2 = Math.PI / 180 * arrLat
  const dφ = Math.PI / 180 * (arrLat - curLat)
  const dλ = Math.PI / 180 * (arrLng - curLng)
  const a  = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  const distNm   = 2 * R * Math.asin(Math.sqrt(a))
  const minsLeft = (distNm / curGs) * 60
  return fmtTimeDate(new Date(Date.now() + minsLeft * 60000))
}

const SPEEDS = [
  { label: '30×', ms: 500 }, { label: '60×', ms: 250 },
  { label: '120×', ms: 125 }, { label: '300×', ms: 50 },
]
const tooltipStyle = { background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 12 }

const ALT_LEGEND = [
  { color: '#a78bfa', label: 'FL350+' },
  { color: '#58a6ff', label: 'FL200–350' },
  { color: '#34d399', label: 'FL050–200' },
  { color: '#fbbf24', label: 'Below FL050' },
]

// ── Component ─────────────────────────────────────────────────────────────────
export default function FlightDetail() {
  const { id } = useParams()
  const { flight, loading, error } = useFlight(id)
  const { position: livePos } = useLive()

  const [replay,     setReplay]     = useState(false)
  const [playing,    setPlaying]    = useState(false)
  const [replayIdx,  setReplayIdx]  = useState(0)
  const [speedIdx,   setSpeedIdx]   = useState(1)
  const [arrAirport, setArrAirport] = useState(null)
  const intervalRef = useRef(null)

  const positions = flight?.positions ?? []
  const isLive    = !!flight && !flight.logoff_time

  useEffect(() => {
    if (!flight?.arrival || !isLive) return
    api.airport(flight.arrival).then(setArrAirport).catch(() => {})
  }, [flight?.arrival, isLive])

  useEffect(() => {
    if (!replay || !playing) { clearInterval(intervalRef.current); return }
    intervalRef.current = setInterval(() => {
      setReplayIdx(i => {
        if (i >= positions.length - 1) { setPlaying(false); return i }
        return i + 1
      })
    }, SPEEDS[speedIdx].ms)
    return () => clearInterval(intervalRef.current)
  }, [replay, playing, speedIdx, positions.length])

  const smoothed = useMemo(() => smoothPath(positions), [positions])

  const segments = useMemo(() => buildSegments(smoothed), [smoothed])

  // Replay slices the smoothed path at the original-position boundary
  const replayLatLngs = useMemo(() =>
    smoothed.slice(0, replayIdx * SMOOTH_STEPS + 1).map(p => [p.latitude, p.longitude]),
    [smoothed, replayIdx])

  const allLatLngs = useMemo(() =>
    positions.map(p => [p.latitude, p.longitude]), [positions])

  // ── Early returns ─────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 52px)', color: 'var(--muted)' }}>
      Loading…
    </div>
  )
  if (error)   return <p style={{ padding: 24, color: 'var(--red)' }}>Error: {error}</p>
  if (!flight) return <p style={{ padding: 24, color: 'var(--red)' }}>Flight not found.</p>

  const curPos     = positions[replayIdx]
  const lastKnown  = positions.length > 0 ? positions[positions.length - 1] : null
  const currentPos = livePos ?? (lastKnown ? {
    lat: lastKnown.latitude, lng: lastKnown.longitude,
    heading: lastKnown.heading, groundspeed: lastKnown.groundspeed,
  } : null)

  const eta = isLive && currentPos && arrAirport
    ? calcEta(currentPos.lat, currentPos.lng, currentPos.groundspeed ?? livePos?.groundspeed,
              arrAirport.latitude, arrAirport.longitude)
    : null

  const altData = positions.map((p, i) => ({ t: i, alt: p.altitude }))
  const gsData  = positions.map((p, i) => ({ t: i, gs: p.groundspeed }))

  let plane2D = null
  if (replay && curPos)
    plane2D = { lat: curPos.latitude, lng: curPos.longitude, heading: curPos.heading || 0, color: '#f0883e' }
  else if (!replay && isLive && currentPos)
    plane2D = { lat: currentPos.lat, lng: currentPos.lng, heading: currentPos.heading || 0, color: '#3fb950' }

  function toggleReplay() {
    if (replay) { setReplay(false); setPlaying(false); setReplayIdx(0) }
    else         { setReplay(true);  setReplayIdx(0);  setPlaying(true) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 20px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <Link to="/" style={{ color: 'var(--muted)', fontSize: 12 }}>← Logbook</Link>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span style={{ fontWeight: 700, fontSize: 18 }}>{flight.callsign}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15, color: 'var(--muted)' }}>{flight.departure ?? '?'}</span>
          <span style={{ color: 'var(--border)', fontSize: 14 }}>──›</span>
          <span style={{ fontSize: 15, color: 'var(--muted)' }}>{flight.arrival ?? '?'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {flight.aircraft_short && <span style={chipStyle}>{flight.aircraft_short}</span>}
          {flight.flight_rules && (
            <span style={chipStyle}>
              {flight.flight_rules === 'I' ? 'IFR' : flight.flight_rules === 'V' ? 'VFR' : flight.flight_rules}
            </span>
          )}
          <span style={chipStyle}>{duration(flight)}</span>
        </div>
        {isLive && (
          <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, background: '#0d2b0d', color: 'var(--green)', border: '1px solid #2ea04333', fontWeight: 600 }}>
            ● LIVE
          </span>
        )}
        {positions.length > 0 && (
          <button
            onClick={toggleReplay}
            style={{
              marginLeft: 'auto', padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border)',
              background: replay ? '#f0883e22' : 'var(--surface)',
              color: replay ? '#f0883e' : 'var(--muted)',
            }}
          >
            {replay ? '✕ Exit Replay' : '▶ Replay'}
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <div style={{
          width: 260, flexShrink: 0, background: 'var(--surface)',
          borderRight: '1px solid var(--border)', overflowY: 'auto',
          padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 20,
        }}>
          <div>
            <p style={sectionTitle}>Flight Data</p>
            <InfoRow label="Departed"     value={fmt(flight.dep_time  || flight.logon_time)} />
            {isLive
              ? <InfoRow label="ETA" value={eta
                  ? <span style={{ color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{eta}</span>
                  : <span style={{ color: 'var(--green)' }}>In flight</span>} />
              : <InfoRow label="Arrived"  value={fmt(flight.arr_time || flight.logoff_time)} />
            }
            <InfoRow label="Duration"     value={duration(flight)} />
            <InfoRow label="Max Altitude" value={fmtAlt(flight.max_altitude)} accent="#58a6ff" />
            <InfoRow label="Max G/Speed"  value={flight.max_gs ? flight.max_gs + ' kt' : '—'} accent="#58a6ff" />
            {flight.planned_alt > 0 && <InfoRow label="Planned Alt" value={fmtAlt(flight.planned_alt)} />}
            {flight.cruise_tas  > 0 && <InfoRow label="Cruise TAS"  value={flight.cruise_tas + ' kt'} />}
            {flight.alternate        && <InfoRow label="Alternate"   value={flight.alternate} />}
            {(livePos?.transponder || lastKnown?.transponder) && (
              <InfoRow label="Squawk" value={livePos?.transponder ?? lastKnown.transponder} />
            )}
            <InfoRow label="Track Points" value={positions.length.toLocaleString()} />
          </div>

          {(flight.departure || flight.arrival) && (
            <div>
              <p style={sectionTitle}>Weather</p>
              {flight.departure && (
                <div style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>{flight.departure}</p>
                  <WeatherBlock icao={flight.departure} />
                </div>
              )}
              {flight.arrival && flight.arrival !== flight.departure && (
                <div>
                  <p style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>{flight.arrival}</p>
                  <WeatherBlock icao={flight.arrival} />
                </div>
              )}
            </div>
          )}

          {flight.route && (
            <div>
              <p style={sectionTitle}>Route</p>
              <p style={{
                fontSize: 11, color: 'var(--muted)', lineHeight: 1.7,
                fontFamily: 'monospace', wordBreak: 'break-all',
                background: '#0d1117', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)',
              }}>
                {flight.route}
              </p>
            </div>
          )}

          {replay && curPos && (
            <div>
              <p style={sectionTitle}>Replay Position</p>
              <InfoRow label="Time"     value={fmtTime(curPos.timestamp)} />
              <InfoRow label="Altitude" value={fmtAlt(curPos.altitude)} accent="#58a6ff" />
              <InfoRow label="G/Speed"  value={curPos.groundspeed + ' kt'} />
              <InfoRow label="Heading"  value={curPos.heading + '°'} />
              {curPos.transponder && <InfoRow label="Squawk" value={curPos.transponder} />}
              <InfoRow label="Progress" value={`${replayIdx + 1} / ${positions.length}`} />
            </div>
          )}

          {altData.length > 0 && (
            <div>
              <p style={sectionTitle}>Altitude</p>
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={altData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#58a6ff" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <YAxis tickFormatter={v => `FL${Math.round(v / 100)}`} tick={{ fill: '#8b949e', fontSize: 9 }} width={36} tickCount={4} domain={[0, 'auto']} />
                  <Tooltip formatter={v => [v.toLocaleString() + ' ft', 'Alt']} contentStyle={tooltipStyle} labelFormatter={() => ''} />
                  {flight.planned_alt > 0 && <ReferenceLine y={flight.planned_alt} stroke="#58a6ff44" strokeDasharray="4 4" />}
                  {replay && <ReferenceLine x={replayIdx} stroke="#f0883e88" strokeDasharray="3 3" />}
                  <Area type="monotone" dataKey="alt" stroke="#58a6ff" fill="url(#altGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {gsData.length > 0 && (
            <div>
              <p style={sectionTitle}>Ground Speed</p>
              <ResponsiveContainer width="100%" height={90}>
                <AreaChart data={gsData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3fb950" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 9 }} width={36} tickCount={3} />
                  <Tooltip formatter={v => [v + ' kt', 'G/S']} contentStyle={tooltipStyle} labelFormatter={() => ''} />
                  {replay && <ReferenceLine x={replayIdx} stroke="#f0883e88" strokeDasharray="3 3" />}
                  <Area type="monotone" dataKey="gs" stroke="#3fb950" fill="url(#gsGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Map area ── */}
        {positions.length > 0 ? (
          <div style={{ flex: 1, position: 'relative', background: '#0a0e13' }}>
            <MapContainer
              center={[20, 0]}
              zoom={2}
              style={{ width: '100%', height: '100%' }}
              zoomControl={false}
            >
              <MapReady positions={positions} />
              <LeafletTileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                subdomains="abcd"
                maxZoom={19}
              />

              {/* Altitude-coloured fading trail */}
              {!replay && segments.map((seg, i) => (
                <Polyline key={i} positions={seg.positions}
                  color={seg.color} weight={seg.weight} opacity={seg.opacity} />
              ))}

              {/* Replay trail */}
              {replay && replayLatLngs.length > 1 && (
                <Polyline positions={replayLatLngs}
                  pathOptions={{ color: '#f0883e', weight: 2.5, opacity: 0.9 }} />
              )}

              {/* Origin dot */}
              {allLatLngs.length > 0 && (
                <CircleMarker center={allLatLngs[0]} radius={5}
                  pathOptions={{ fillColor: '#3fb950', fillOpacity: 1, color: '#000', weight: 1 }} />
              )}

              {/* Destination dot */}
              {!isLive && allLatLngs.length > 0 && (
                <CircleMarker center={allLatLngs[allLatLngs.length - 1]} radius={5}
                  pathOptions={{ fillColor: '#f85149', fillOpacity: 1, color: '#000', weight: 1 }} />
              )}

              {/* Plane marker */}
              {plane2D && (
                <Marker
                  position={[plane2D.lat, plane2D.lng]}
                  icon={makePlaneIcon(plane2D.heading, plane2D.color)}
                />
              )}
            </MapContainer>

            {/* Replay controls */}
            {replay && (
              <div style={{
                position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                zIndex: 1000, background: 'rgba(13,17,23,0.95)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
                backdropFilter: 'blur(4px)', minWidth: 340,
              }}>
                <button
                  onClick={() => setPlaying(p => !p)}
                  style={{ background: 'none', border: 'none', color: '#f0883e', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
                >
                  {playing ? '⏸' : '▶'}
                </button>
                <input
                  type="range" min={0} max={positions.length - 1} value={replayIdx}
                  onChange={e => { setPlaying(false); setReplayIdx(Number(e.target.value)) }}
                  style={{ flex: 1, accentColor: '#f0883e' }}
                />
                <span style={{ color: 'var(--muted)', fontSize: 11, minWidth: 72, textAlign: 'center' }}>
                  {fmtTime(curPos?.timestamp)}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {SPEEDS.map((s, i) => (
                    <button key={s.label} onClick={() => setSpeedIdx(i)} style={{
                      padding: '2px 7px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: speedIdx === i ? '#f0883e22' : 'transparent',
                      color: speedIdx === i ? '#f0883e' : 'var(--muted)',
                    }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Altitude legend */}
            {!replay && (
              <div style={{
                position: 'absolute', bottom: 16, right: 16, zIndex: 1000,
                background: 'rgba(13,17,23,0.85)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5,
              }}>
                {ALT_LEGEND.map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                    <span style={{ width: 20, height: 3, borderRadius: 2, background: color, display: 'inline-block', boxShadow: `0 0 3px ${color}88` }} />
                    <span style={{ color: 'var(--muted)' }}>{label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', background: '#0a0e13' }}>
            No track data recorded for this flight.
          </div>
        )}
      </div>
    </div>
  )
}

const chipStyle = {
  fontSize: 11, padding: '2px 8px', borderRadius: 12,
  background: '#161b22', color: 'var(--muted)', border: '1px solid var(--border)',
}
const sectionTitle = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--muted)', marginBottom: 8, fontWeight: 600,
}
