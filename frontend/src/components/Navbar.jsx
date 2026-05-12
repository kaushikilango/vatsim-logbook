import { NavLink } from 'react-router-dom'
import { useLive } from '../hooks/useLive'

const navStyle = {
  display: 'flex', alignItems: 'center', gap: 24,
  padding: '0 24px', height: 52,
  background: 'var(--surface)', borderBottom: '1px solid var(--border)',
  position: 'sticky', top: 0, zIndex: 1000,
}

const linkStyle = ({ isActive }) => ({
  color: isActive ? 'var(--accent)' : 'var(--muted)',
  fontWeight: isActive ? 600 : 400,
  fontSize: 14,
})

export default function Navbar() {
  const { online } = useLive()

  return (
    <nav style={navStyle}>
      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginRight: 8 }}>
        VATSIM Logbook
      </span>
      <NavLink to="/"      style={linkStyle}>Logbook</NavLink>
      <NavLink to="/stats" style={linkStyle}>Stats</NavLink>
      <NavLink to="/globe" style={linkStyle}>Globe</NavLink>
      <NavLink to="/live"  style={linkStyle}>Live Tracker</NavLink>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: online ? 'var(--green)' : 'var(--border)',
          boxShadow: online ? '0 0 6px var(--green)' : 'none',
        }} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{online ? 'ONLINE' : 'OFFLINE'}</span>
      </div>
    </nav>
  )
}
