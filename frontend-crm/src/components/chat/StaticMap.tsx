/**
 * 29.10.2026 — место в ленте: неподвижная картинка из плиток OpenStreetMap
 * (живая карта в списке сообщений слишком тяжёлая). Точка — по центру.
 */
const TILE = 256;

function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
}

export const mapLink = (lat: number, lon: number) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=17/${lat.toFixed(6)}/${lon.toFixed(6)}`;

export default function StaticMap({ lat, lon, width = 240, height = 150, zoom = 16 }: { lat: number; lon: number; width?: number; height?: number; zoom?: number }) {
  const { x, y } = tileXY(lat, lon, zoom);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  // Сдвиг сетки 3×3 так, чтобы точка оказалась в центре окна.
  const left = width / 2 - (x - tx + 1) * TILE;
  const top = height / 2 - (y - ty + 1) * TILE;
  const tiles: Array<{ dx: number; dy: number }> = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push({ dx, dy });
  const n = 2 ** zoom;
  return (
    <a className="chat-map" href={mapLink(lat, lon)} target="_blank" rel="noreferrer" style={{ width, height }} title="Открыть на карте">
      <div style={{ position: 'absolute', left, top, width: TILE * 3, height: TILE * 3 }}>
        {tiles.map(({ dx, dy }) => (
          <img
            key={`${dx}:${dy}`}
            src={`https://tile.openstreetmap.org/${zoom}/${(((tx + dx) % n) + n) % n}/${ty + dy}.png`}
            alt=""
            draggable={false}
            loading="lazy"
            style={{ position: 'absolute', left: (dx + 1) * TILE, top: (dy + 1) * TILE, width: TILE, height: TILE }}
          />
        ))}
      </div>
      <span className="chat-map-pin" />
      <span className="chat-map-credit">© OpenStreetMap</span>
    </a>
  );
}
