import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import Logbook from './pages/Logbook'
import Globe from './pages/Globe'
import LiveTracker from './pages/LiveTracker'
import FlightDetail from './pages/FlightDetail'
import Stats from './pages/Stats'

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/"           element={<Logbook />} />
        <Route path="/stats"      element={<Stats />} />
        <Route path="/globe"      element={<Globe />} />
        <Route path="/live"       element={<LiveTracker />} />
        <Route path="/flight/:id" element={<FlightDetail />} />
        <Route path="*"           element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
