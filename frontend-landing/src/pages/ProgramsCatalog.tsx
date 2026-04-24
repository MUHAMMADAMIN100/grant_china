import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Icon from '../Icon';
import { getPublicProgramFilters, listPublicPrograms, type Program } from '../programs';

const DIRECTION_LABEL: Record<string, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
};

export default function ProgramsCatalog() {
  const [items, setItems] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState<string[]>([]);
  const [majors, setMajors] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [major, setMajor] = useState('');
  const [direction, setDirection] = useState('');
  const [minCost, setMinCost] = useState('');
  const [maxCost, setMaxCost] = useState('');

  useEffect(() => {
    getPublicProgramFilters().then((f) => {
      setCities(f.cities);
      setMajors(f.majors);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      listPublicPrograms({
        search: search || undefined,
        city: city || undefined,
        major: major || undefined,
        direction: direction || undefined,
        minCost: minCost ? Number(minCost) : undefined,
        maxCost: maxCost ? Number(maxCost) : undefined,
      })
        .then(setItems)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search, city, major, direction, minCost, maxCost]);

  const resetFilters = () => {
    setSearch('');
    setCity('');
    setMajor('');
    setDirection('');
    setMinCost('');
    setMaxCost('');
  };

  return (
    <>
      <Header />
      <main className="pc-main">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="section-eyebrow">Каталог программ</div>
            <h2 style={{ textAlign: 'center' }}>Подберите программу в Китае</h2>
            <p className="section-sub">
              Более {items.length} программ в лучших университетах Китая. Отфильтруйте по городу, специальности и стоимости.
            </p>
          </motion.div>

          <motion.div
            className="pc-filters"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="pc-filter">
              <label>Поиск</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Университет, программа..."
              />
            </div>
            <div className="pc-filter">
              <label>Город</label>
              <select value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">Все города</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="pc-filter">
              <label>Специальность</label>
              <select value={major} onChange={(e) => setMajor(e.target.value)}>
                <option value="">Все специальности</option>
                {majors.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="pc-filter">
              <label>Направление</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="">Все</option>
                <option value="BACHELOR">Бакалавриат</option>
                <option value="MASTER">Магистратура</option>
                <option value="LANGUAGE">Языковые курсы</option>
              </select>
            </div>
            <div className="pc-filter">
              <label>Стоимость (CNY/год)</label>
              <div className="pc-range">
                <input type="number" placeholder="от" value={minCost} onChange={(e) => setMinCost(e.target.value)} />
                <input type="number" placeholder="до" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
              </div>
            </div>
            {(search || city || major || direction || minCost || maxCost) && (
              <button className="pc-reset" onClick={resetFilters}>
                <Icon name="close" size={14} /> Сбросить
              </button>
            )}
          </motion.div>

          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="l" className="pc-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Загружаем программы...
              </motion.div>
            ) : items.length === 0 ? (
              <motion.div key="e" className="pc-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Icon name="search_off" size={48} />
                <div style={{ marginTop: 12 }}>Ничего не найдено. Попробуйте изменить фильтры.</div>
              </motion.div>
            ) : (
              <motion.div
                key="g"
                className="pc-grid"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
              >
                {items.map((p) => (
                  <motion.div
                    key={p.id}
                    className="pc-card"
                    variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }}
                    whileHover={{ y: -6 }}
                  >
                    <div className="pc-card-head">
                      <div className="pc-badge">{DIRECTION_LABEL[p.direction]}</div>
                      <div className="pc-card-cost">
                        {p.cost.toLocaleString('ru-RU')} {p.currency}
                        <span> / год</span>
                      </div>
                    </div>
                    <div className="pc-card-name">{p.name}</div>
                    <div className="pc-card-uni">
                      <Icon name="account_balance" size={16} /> {p.university}
                    </div>
                    <div className="pc-card-meta">
                      <span><Icon name="location_on" size={14} /> {p.city}</span>
                      <span><Icon name="school" size={14} /> {p.major}</span>
                      {p.duration && <span><Icon name="schedule" size={14} /> {p.duration}</span>}
                      {p.language && <span><Icon name="translate" size={14} /> {p.language}</span>}
                    </div>
                    {p.description && (
                      <div className="pc-card-desc">{p.description}</div>
                    )}
                    <Link to={`/?program=${p.id}#apply`} className="btn btn-primary pc-card-cta">
                      Подать заявку
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
      <Footer />
    </>
  );
}
