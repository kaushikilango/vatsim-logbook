import { useEffect, useState } from 'react'
import { Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import { api } from '../api'

const RWY_ZOOM_MIN = 13

function rwyLabelIcon(ident, heading) {
  const rot = (heading || 0) - 90
  return L.divIcon({
    className: '',
    html: `<div style="
      transform:rotate(${rot}deg);
      transform-origin:center center;
      color:#fff;
      font-size:9px;
      font-weight:700;
      font-family:monospace;
      letter-spacing:0.05em;
      text-shadow:0 0 3px #000,0 0 3px #000;
      white-space:nowrap;
      text-align:center;
      pointer-events:none;
    ">${ident}</div>`,
    iconSize: [24, 14],
    iconAnchor: [12, 7],
  })
}

// Renders threshold number markers for one airport, visible only at zoom ≥ 13.
// Must be rendered inside a react-leaflet MapContainer.
export default function Runways({ icao }) {
  const map = useMap()
  const [runways, setRunways] = useState([])
  const [zoom, setZoom] = useState(() => map.getZoom())

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom())
    map.on('zoomend', onZoom)
    return () => map.off('zoomend', onZoom)
  }, [map])

  useEffect(() => {
    if (!icao) return
    api.runways(icao).then(setRunways).catch(() => {})
  }, [icao])

  if (zoom < RWY_ZOOM_MIN) return null

  return runways.flatMap((rwy, i) => {
    if (!rwy.le_lat || !rwy.he_lat) return []
    const leLat = rwy.le_lat + (rwy.he_lat - rwy.le_lat) * 0.08
    const leLon = rwy.le_lon + (rwy.he_lon - rwy.le_lon) * 0.08
    const heLat = rwy.he_lat + (rwy.le_lat - rwy.he_lat) * 0.08
    const heLon = rwy.he_lon + (rwy.le_lon - rwy.he_lon) * 0.08
    return [
      rwy.le_ident && (
        <Marker key={`le${i}`} position={[leLat, leLon]}
          icon={rwyLabelIcon(rwy.le_ident, rwy.le_heading)} interactive={false} />
      ),
      rwy.he_ident && (
        <Marker key={`he${i}`} position={[heLat, heLon]}
          icon={rwyLabelIcon(rwy.he_ident, rwy.he_heading)} interactive={false} />
      ),
    ].filter(Boolean)
  })
}
