import { useParams, Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useFlight } from '../hooks/useFlights'
import { useLive } from '../hooks/useLive'
import { api } from '../api'
import { AreaChart, Area, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import WeatherBlock from '../components/WeatherBlock'
import { fmt, fmtTime, fmtTimeDate } from '../utils/time'

if (import.meta.env.VITE_CESIUM_TOKEN) {
  Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function altColor(alt) {
  if (!alt || alt <= 0) return '#58a6ff'
  if (alt > 35000) return '#a78bfa'
  if (alt > 20000) return '#58a6ff'
  if (alt > 5000)  return '#34d399'
  return '#fbbf24'
}

function buildColorSegments(positions) {
  if (positions.length < 2) return []
  const segs = []
  let cur = { color: altColor(positions[0].altitude), pts: [positions[0]] }
  for (let i = 1; i < positions.length; i++) {
    const c = altColor(positions[i].altitude)
    if (c === cur.color) {
      cur.pts.push(positions[i])
    } else {
      cur.pts.push(positions[i])  // overlap to close gap between segments
      segs.push(cur)
      cur = { color: c, pts: [positions[i]] }
    }
  }
  segs.push(cur)
  return segs
}

function planeSvgUrl(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="${color}"><path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function toCarto(p) {
  return Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, (p.altitude || 0) * 0.3048)
}

function duration(flight) {
  const live  = !flight.logoff_time
  const start = flight.dep_time || flight.logon_time
  const end   = live ? new Date().toISOString() : (flight.arr_time || flight.logoff_time)
  if (!start || !end) return '—'
  const mins = Math.round((new Date(end) - new Date(start)) / 60000)
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function fmtAlt(ft) {
  if (!ft) return '—'
  if (ft >= 1000) return `FL${Math.round(ft / 100).toString().padStart(3, '0')}`
  return `${ft.toLocaleString()} ft`
}

function calcEta(curLat, curLng, curGs, arrLat, arrLng) {
  if (!curGs || curGs < 50 || !arrLat) return null
  const R  = 3440.065
  const φ1 = Math.PI / 180 * curLat, φ2 = Math.PI / 180 * arrLat
  const dφ = Math.PI / 180 * (arrLat - curLat)
  const dλ = Math.PI / 180 * (arrLng - curLng)
  const a  = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return fmtTimeDate(new Date(Date.now() + (2 * R * Math.asin(Math.sqrt(a)) / curGs) * 3600000))
}

function InfoRow({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, color: accent || 'var(--text)' }}>{value}</span>
    </div>
  )
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
export default function FlightDetail3D() {
  const { id } = useParams()
  const { flight, loading, error } = useFlight(id)
  const { position: livePos } = useLive()

  const mountRef       = useRef(null)
  const viewerRef      = useRef(null)
  const pathEntRef     = useRef([])
  const planeEntRef    = useRef(null)
  const cameraFitDone  = useRef(false)

  const [replay,    setReplay]    = useState(false)
  const [playing,   setPlaying]   = useState(false)
  const [replayIdx, setReplayIdx] = useState(0)
  const [speedIdx,  setSpeedIdx]  = useState(1)
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

  // ── Cesium init (once, when mountRef is ready) ────────────────────────────
  useEffect(() => {
    const el = mountRef.current
    if (!el || viewerRef.current) return

    const viewer = new Cesium.Viewer(el, {
      baseLayerPicker:       false,
      animation:             false,
      timeline:              false,
      fullscreenButton:      false,
      geocoder:              false,
      homeButton:            false,
      infoBox:               false,
      sceneModePicker:       false,
      selectionIndicator:    false,
      navigationHelpButton:  false,
      terrainProvider:       new Cesium.EllipsoidTerrainProvider(),
    })

    // Remove default imagery and use CARTO Dark (matches app theme, shows roads)
    viewer.imageryLayers.removeAll()
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 19,
        credit: '© OpenStreetMap contributors © CARTO',
      })
    )

    // Dark space background
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0d1117')
    viewer.scene.skyBox.show    = false
    viewer.scene.sun.show       = false
    viewer.scene.moon.show      = false
    viewer.scene.skyAtmosphere.show = true

    // Hide the Cesium credit banner
    if (viewer.cesiumWidget.creditContainer) {
      viewer.cesiumWidget.creditContainer.style.display = 'none'
    }

    viewerRef.current = viewer
    return () => {
      viewer.destroy()
      viewerRef.current   = null
      pathEntRef.current  = []
      planeEntRef.current = null
    }
  }, [])

  // ── Update path + aircraft when data or replay changes ───────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || positions.length === 0) return

    // Remove old path entities
    pathEntRef.current.forEach(e => viewer.entities.remove(e))
    pathEntRef.current = []

    const slice = replay ? positions.slice(0, replayIdx + 1) : positions
    const segs  = buildColorSegments(slice)

    segs.forEach(seg => {
      const entity = viewer.entities.add({
        polyline: {
          positions: seg.pts.map(toCarto),
          width:     2.5,
          material:  Cesium.Color.fromCssColorString(seg.color),
          clampToGround: false,
        },
      })
      pathEntRef.current.push(entity)
    })

    // Determine aircraft position + heading
    const markerSrc = replay
      ? positions[replayIdx]
      : livePos
        ? { latitude: livePos.lat, longitude: livePos.lng, altitude: livePos.altitude, heading: livePos.heading }
        : positions[positions.length - 1]

    const planeColor = replay ? '#f0883e' : (isLive ? '#3fb950' : '#79c0ff')
    const heading    = markerSrc?.heading ?? 0

    if (markerSrc) {
      const pos = Cesium.Cartesian3.fromDegrees(
        markerSrc.longitude ?? markerSrc.lng,
        markerSrc.latitude  ?? markerSrc.lat,
        ((markerSrc.altitude || 0) * 0.3048) + 200,
      )

      if (!planeEntRef.current) {
        planeEntRef.current = viewer.entities.add({
          position: pos,
          billboard: {
            image:             planeSvgUrl(planeColor),
            width:             32,
            height:            32,
            rotation:          -Cesium.Math.toRadians(heading),
            alignedAxis:       Cesium.Cartesian3.UNIT_Z,
            verticalOrigin:    Cesium.VerticalOrigin.CENTER,
            horizontalOrigin:  Cesium.HorizontalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      } else {
        planeEntRef.current.position = new Cesium.ConstantPositionProperty(pos)
        planeEntRef.current.billboard.image    = planeSvgUrl(planeColor)
        planeEntRef.current.billboard.rotation = -Cesium.Math.toRadians(heading)
      }
    }

    // Fly camera to fit path — only once on initial load
    if (!cameraFitDone.current && !replay && pathEntRef.current.length > 0) {
      cameraFitDone.current = true
      const sphere = Cesium.BoundingSphere.fromPoints(positions.map(toCarto))
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), sphere.radius * 2.8),
      })
    }
  }, [positions, replay, replayIdx, isLive, livePos])

  // ── Derived values ────────────────────────────────────────────────────────
  const curPos     = positions[replayIdx]
  const lastKnown  = positions.length > 0 ? positions[positions.length - 1] : null
  const currentPos = livePos ?? (lastKnown
    ? { lat: lastKnown.latitude, lng: lastKnown.longitude, heading: lastKnown.heading, groundspeed: lastKnown.groundspeed }
    : null)
  const eta = isLive && currentPos && arrAirport
    ? calcEta(currentPos.lat, currentPos.lng, currentPos.groundspeed ?? livePos?.groundspeed,
              arrAirport.latitude, arrAirport.longitude)
    : null
  const altData = positions.map((p, i) => ({ t: i, alt: p.altitude }))
  const gsData  = positions.map((p, i) => ({ t: i, gs: p.groundspeed }))

  function toggleReplay() {
    if (replay) { setReplay(false); setPlaying(false); setReplayIdx(0) }
    else         { setReplay(true);  setReplayIdx(0);  setPlaying(true) }
  }

  function resetCamera() {
    const viewer = viewerRef.current
    if (!viewer || positions.length === 0) return
    const sphere = Cesium.BoundingSphere.fromPoints(positions.map(toCarto))
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), sphere.radius * 2.8),
    })
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

        {flight ? (
          <>
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
          </>
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 14 }}>
            {loading ? 'Loading…' : error ? 'Error loading flight' : 'Flight not found'}
          </span>
        )}

        {/* 2D / Globe tab */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 8, background: '#0d1117', borderRadius: 6, padding: 2, border: '1px solid var(--border)' }}>
          <Link to={`/flight/${id}`}
            style={{ padding: '3px 12px', borderRadius: 4, fontSize: 12, textDecoration: 'none', color: 'var(--muted)', background: 'transparent' }}>
            2D
          </Link>
          <span style={{ padding: '3px 12px', borderRadius: 4, fontSize: 12, background: 'var(--surface)', color: '#58a6ff', fontWeight: 600 }}>
            Globe
          </span>
        </div>

        {positions.length > 0 && (
          <button onClick={toggleReplay} style={{
            marginLeft: 'auto', padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: replay ? '#f0883e22' : 'var(--surface)',
            color:      replay ? '#f0883e'   : 'var(--muted)',
          }}>
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
          {loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>}
          {error   && <div style={{ color: 'var(--red)',   fontSize: 13 }}>Error: {error}</div>}

          {flight && (
            <>
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
                  <InfoRow label="Progress" value={`${replayIdx + 1} / ${positions.length}`} />
                </div>
              )}

              {altData.length > 0 && (
                <div>
                  <p style={sectionTitle}>Altitude</p>
                  <ResponsiveContainer width="100%" height={110}>
                    <AreaChart data={altData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="altGrad3d" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#58a6ff" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                      <YAxis tickFormatter={v => `FL${Math.round(v / 100)}`} tick={{ fill: '#8b949e', fontSize: 9 }} width={36} tickCount={4} domain={[0, 'auto']} />
                      <Tooltip formatter={v => [v.toLocaleString() + ' ft', 'Alt']} contentStyle={tooltipStyle} labelFormatter={() => ''} />
                      {flight.planned_alt > 0 && <ReferenceLine y={flight.planned_alt} stroke="#58a6ff44" strokeDasharray="4 4" />}
                      {replay && <ReferenceLine x={replayIdx} stroke="#f0883e88" strokeDasharray="3 3" />}
                      <Area type="monotone" dataKey="alt" stroke="#58a6ff" fill="url(#altGrad3d)" strokeWidth={1.5} dot={false} />
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
                        <linearGradient id="gsGrad3d" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#3fb950" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
                      <YAxis tick={{ fill: '#8b949e', fontSize: 9 }} width={36} tickCount={3} />
                      <Tooltip formatter={v => [v + ' kt', 'G/S']} contentStyle={tooltipStyle} labelFormatter={() => ''} />
                      {replay && <ReferenceLine x={replayIdx} stroke="#f0883e88" strokeDasharray="3 3" />}
                      <Area type="monotone" dataKey="gs" stroke="#3fb950" fill="url(#gsGrad3d)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Cesium globe ── */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

          {positions.length > 0 && (
            <button onClick={resetCamera} style={{
              position: 'absolute', top: 12, right: 12, zIndex: 10,
              padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: 'rgba(13,17,23,0.85)', border: '1px solid var(--border)', color: 'var(--muted)',
            }}>
              ⟳ Reset view
            </button>
          )}

          {replay && (
            <div style={{
              position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
              zIndex: 10, background: 'rgba(13,17,23,0.95)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
              backdropFilter: 'blur(4px)', minWidth: 340,
            }}>
              <button onClick={() => setPlaying(p => !p)}
                style={{ background: 'none', border: 'none', color: '#f0883e', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>
                {playing ? '⏸' : '▶'}
              </button>
              <input type="range" min={0} max={positions.length - 1} value={replayIdx}
                onChange={e => { setPlaying(false); setReplayIdx(Number(e.target.value)) }}
                style={{ flex: 1, accentColor: '#f0883e' }} />
              <span style={{ color: 'var(--muted)', fontSize: 11, minWidth: 72, textAlign: 'center' }}>
                {fmtTime(curPos?.timestamp)}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {SPEEDS.map((s, i) => (
                  <button key={s.label} onClick={() => setSpeedIdx(i)} style={{
                    padding: '2px 7px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: speedIdx === i ? '#f0883e22' : 'transparent',
                    color:      speedIdx === i ? '#f0883e'   : 'var(--muted)',
                  }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!replay && positions.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 16, right: 16, zIndex: 10,
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
