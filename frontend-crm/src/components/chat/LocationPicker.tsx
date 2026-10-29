import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Icon from '../../Icon';

/** Центр по умолчанию — Душанбе. */
const DEFAULT_CENTER: [number, number] = [38.5598, 68.787];

/**
 * 29.10.2026 — выбор точки на карте для отправки места клиенту (решение
 * владельца: интерактивная карта, библиотека Leaflet, плитки OpenStreetMap).
 * Клик по карте ставит точку; «Моё местоположение» — по браузеру.
 */
export default function LocationPicker({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (loc: { latitude: number; longitude: number; name?: string; address?: string }) => Promise<boolean>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const place = (lat: number, lng: number, pan = false) => {
    setPoint({ lat, lng });
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
    else markerRef.current = L.circleMarker([lat, lng], { radius: 9, color: '#d52b2b', weight: 3, fillColor: '#d52b2b', fillOpacity: 0.85 }).addTo(map);
    if (pan) map.setView([lat, lng], 16);
  };

  useEffect(() => {
    if (!boxRef.current) return;
    const map = L.map(boxRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    // Окно открывается с анимацией — пересчитать размер, когда оно встало.
    const t = setTimeout(() => map.invalidateSize(), 250);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) return setGeoError('Браузер не умеет определять местоположение');
    navigator.geolocation.getCurrentPosition(
      (pos) => place(pos.coords.latitude, pos.coords.longitude, true),
      () => setGeoError('Не удалось определить местоположение — поставьте точку на карте'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async () => {
    if (!point || busy) return;
    setBusy(true);
    const ok = await onSend({ latitude: point.lat, longitude: point.lng, name: name.trim() || undefined, address: address.trim() || undefined });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
      <motion.div
        className="dialog-card chat-location-card"
        role="dialog"
        aria-modal="true"
        aria-label="Отправить место"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        data-testid="location-picker"
      >
        <div className="dialog-title">Отправить место</div>
        <div className="dialog-message" style={{ marginBottom: 10 }}>Нажмите на карту, чтобы поставить точку.</div>
        <div ref={boxRef} className="chat-location-map" data-testid="location-map" />
        <div className="chat-location-row">
          <button type="button" className="btn btn-sm btn-secondary" onClick={myLocation}>
            <Icon name="my_location" size={16} /> Моё местоположение
          </button>
          <span className="chat-location-coords">{point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Точка не выбрана'}</span>
        </div>
        {geoError && <div className="form-error-text">{geoError}</div>}
        <div className="form-grid-2" style={{ marginTop: 10 }}>
          <div className="form-group">
            <label>Название <span className="chat-optional">— необязательно</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Например: Офис GrantChina" />
          </div>
          <div className="form-group">
            <label>Адрес <span className="chat-optional">— необязательно</span></label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} placeholder="Улица, дом" />
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!point || busy} data-testid="location-send">
            {busy ? 'Отправляем…' : 'Отправить место'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
