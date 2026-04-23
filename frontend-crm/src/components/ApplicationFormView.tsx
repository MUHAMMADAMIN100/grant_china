import { FORM_SECTIONS, countProgress, displayValue } from '../formSchema';
import Icon from '../Icon';

type Props = {
  form: any;
};

export default function ApplicationFormView({ form }: Props) {
  const progress = countProgress(form || {});
  const percent = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;
  const empty = progress.filled === 0;

  return (
    <div className="af-view">
      <div className="af-view-header">
        <div>
          <h3 className="af-view-title">Анкета студента</h3>
          <div className="af-view-sub">
            {empty
              ? 'Студент ещё не начал заполнять анкету'
              : `Заполнено ${progress.filled} из ${progress.total} полей (${percent}%)`}
          </div>
        </div>
        {!empty && (
          <div className="af-view-bar">
            <div className="af-view-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>

      {empty ? (
        <div className="af-view-empty">
          <Icon name="hourglass_empty" size={40} />
          <div>Анкета не заполнена</div>
        </div>
      ) : (
        <div className="af-view-sections">
          {FORM_SECTIONS.map((s) => (
            <div key={s.key} className="af-view-section">
              <div className="af-view-section-head">
                <div className="af-view-section-icon">
                  <Icon name={s.icon} size={16} />
                </div>
                <div>
                  <div className="af-view-section-title">{s.title}</div>
                  {s.titleEn && <div className="af-view-section-title-en">{s.titleEn}</div>}
                </div>
              </div>
              {s.fields && (
                <div className="af-view-grid">
                  {s.fields.map((f) => (
                    <div key={f.key} className="af-view-field">
                      <div className="af-view-label">{f.label}</div>
                      <div className="af-view-value">{displayValue(f, form?.[s.key]?.[f.key])}</div>
                    </div>
                  ))}
                </div>
              )}
              {s.table && (
                <div className="af-view-table">
                  {(form?.[s.key] || []).map((row: any, ri: number) => {
                    const hasData = s.table!.columns.some((c) => row?.[c.key]?.toString().trim());
                    if (!hasData && !s.table!.rowLabels) return null;
                    return (
                      <div key={ri} className="af-view-table-row">
                        {s.table!.rowLabels && (
                          <div className="af-view-row-label">
                            {s.table!.rowLabels[ri] || `#${ri + 1}`}
                          </div>
                        )}
                        <div className="af-view-row-cells">
                          {s.table!.columns.map((c) => (
                            <div key={c.key} className="af-view-field">
                              <div className="af-view-label">{c.label}</div>
                              <div className="af-view-value">{displayValue(c, row?.[c.key])}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
