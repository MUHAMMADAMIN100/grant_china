import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Payment, PaymentMethod, PaymentPurpose, PaymentReceipt, PaymentStage } from '../api/types';
import {
  DEFAULT_PAYMENT_PURPOSE,
  PAYMENT_AMOUNT_RE,
  PAYMENT_METHOD_LABEL,
  PAYMENT_PURPOSE_LABEL,
  PAYMENT_STAGE_KIND,
  PAYMENT_STAGE_LABEL,
  RECEIPT_REQUIRED_PURPOSES,
  canWritePayments,
  paymentPurposesFor,
} from '../api/types';
import { addPaymentReceipts, createPayment, removePaymentReceipt, submitPayment, updatePayment } from '../api/payments';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { buildFileUrl } from '../utils/fileUrl';
import ReceiptDropzone, { MAX_RECEIPT_FILES } from './ReceiptDropzone';
import Icon from '../Icon';
import { todayInputValue } from '../utils/datetime';

/**
 * Сегодняшняя дата ЛОКАЛЬНЫМИ компонентами, а не через toISOString():
 * toISOString() отдаёт сутки по UTC, и в Душанбе (UTC+5) с 00:00 до 05:00
 * это вчерашнее число. Ночью первого числа месяца календарь гасил бы
 * сегодняшний день, а поле по умолчанию подставляло предыдущий месяц —
 * платёж уезжал в уже закрываемый расчётный период и раздувал базу бонуса.
 * Бэкенд такую дату принимает (его верхняя граница считается по суткам
 * Душанбе), то есть интерфейс запрещал бы то, что сервер считает корректным.
 */
const todayStr = todayInputValue;

type Props = {
  studentId: string;
  stage: PaymentStage;
  /** Если передан — форма в режиме редактирования уже существующего DRAFT/REJECTED платежа. */
  payment?: Payment | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function PaymentFormModal({ studentId, stage, payment, onClose, onSaved }: Props) {
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  /**
   * 12.08.2026: запись в платежи открыта FOUNDER, ADMIN и EMPLOYEE
   * (canWritePayments, зеркало @Roles на бэкенде). Защита в глубину
   * сохраняется: форма сама проверяет право, а не полагается на то, кто её
   * открыл. Кнопки скрываются, а не гасятся: disabled без объяснения
   * читается как поломка.
   */
  const canWrite = canWritePayments(me?.role);
  const isEdit = !!payment;
  const kind = PAYMENT_STAGE_KIND[stage];
  /**
   * Пять типов оплат по роли и региону (paymentPurposesFor — зеркало бэкенда).
   * С 12.08.2026 менеджерам ТJ/BOTH и Администратору доступны все пять,
   * включая «Оплату за регистрацию в университете»; у Китая — свой список.
   * Недоступный пункт не появляется в выпадающем списке вовсе.
   */
  const purposeOptions = paymentPurposesFor(stage, me?.role, me?.region);

  /**
   * У платежа, сохранённого ДО перехода на новые типы, purpose историческй
   * (например «Другое»). Его нельзя молча подменить действующим значением —
   * это исказило бы уже проведённую запись. Поэтому в режиме правки такой
   * тип показывается в списке дополнительным пунктом, и пока пользователь
   * его не сменил, бэкенд оставляет старое значение как есть.
   */
  const initialPurpose = payment?.purpose ?? DEFAULT_PAYMENT_PURPOSE[stage];
  const purposeChoices = purposeOptions.includes(initialPurpose)
    ? purposeOptions
    : [initialPurpose, ...purposeOptions];

  const [purpose, setPurpose] = useState<PaymentPurpose>(initialPurpose);
  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? 'CASH');
  const [amount, setAmount] = useState(payment?.amount ?? '');
  // Смешанная оплата: разбивка «сколько наличными / сколько безналом».
  const [cashPart, setCashPart] = useState(payment?.cashAmount ?? '');
  const [cashlessPart, setCashlessPart] = useState(payment?.cashlessAmount ?? '');
  const [paidAt, setPaidAt] = useState(payment ? payment.paidAt.slice(0, 10) : todayStr());
  const [reference, setReference] = useState(payment?.reference ?? '');
  const [comment, setComment] = useState(payment?.comment ?? '');
  // ТЗ v3 раздел 2 — мультизагрузка: было `file: File | null`, то есть ровно
  // один чек на платёж при создании.
  const [files, setFiles] = useState<File[]>([]);
  const [receipts, setReceipts] = useState<PaymentReceipt[]>(payment?.receipts ?? []);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [addingReceipt, setAddingReceipt] = useState(false);
  const [touched, setTouched] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const amountValid = PAYMENT_AMOUNT_RE.test(amount) && parseFloat(amount) > 0;

  /**
   * Разбивка смешанной оплаты. Считаем в КОПЕЙКАХ (целые числа), а не
   * float-суммах: 0.1 + 0.2 !== 0.3, и честная разбивка вроде 33.33 + 66.67
   * из-за плавающей точки случайно проходила бы или падала. Бэкенд сверяет
   * Decimal'ами — фронт обязан давать тот же вердикт.
   */
  const toCents = (v: string) => Math.round(parseFloat(v) * 100);
  const cashValid = PAYMENT_AMOUNT_RE.test(cashPart) && parseFloat(cashPart) > 0;
  const cashlessValid = PAYMENT_AMOUNT_RE.test(cashlessPart) && parseFloat(cashlessPart) > 0;
  const partsMatch =
    cashValid && cashlessValid && amountValid && toCents(cashPart) + toCents(cashlessPart) === toCents(amount);
  const mixedValid = method !== 'MIXED' || partsMatch;

  /**
   * Удобство: ввёл общую сумму и наличную часть — безналичная досчитывается
   * сама (и наоборот). Только подстановка значения в пустое/пересчёт другого
   * поля; вручную введённое пользователем значение не перетирается без нужды.
   */
  const complement = (fromCash: boolean, raw: string) => {
    if (!amountValid || !PAYMENT_AMOUNT_RE.test(raw)) return;
    const rest = toCents(amount) - toCents(raw);
    if (rest <= 0) return;
    const restStr = (rest / 100).toFixed(2);
    if (fromCash) setCashlessPart(restStr);
    else setCashPart(restStr);
  };
  const requiresReceiptAlways = RECEIPT_REQUIRED_PURPOSES.includes(purpose);
  const hasReceipt = isEdit ? receipts.length > 0 : files.length > 0;

  // ТЗ 1.3: для Проживания/Питания сохранение (даже черновика/правки) заблокировано
  // без чека. Для остальных назначений черновик без чека разрешён, но
  // подтверждение (отправка на одобрение) требует чек всегда — так же, как
  // проверяет бэкенд (RECEIPT_REQUIRED_ON_CREATE_PURPOSES / hasLiveReceipt).
  // Правило одинаково важно в обоих режимах: при редактировании менеджер
  // может сменить назначение на «Проживание»/«Питание» уже после того, как
  // черновик был сохранён без чека — hasReceipt в этот момент честно смотрит
  // на актуальный receipts (уже загруженные ранее чеки не теряются).
  const draftDisabled = requiresReceiptAlways && !hasReceipt;
  const submitDisabled = !hasReceipt;
  const receiptRequiredCaption = 'Для назначения «Проживание» и «Питание» чек обязателен';

  const buildErrorMessage = (e: any, fallback: string) => e?.response?.data?.message || fallback;

  const doCreate = async (submit: boolean) => {
    if (!amountValid) { setTouched(true); toast('Введите корректную сумму', 'error'); return; }
    if (!mixedValid) { setTouched(true); toast('Части смешанной оплаты должны сходиться с общей суммой', 'error'); return; }
    if (submit && submitDisabled) { toast('Прикрепите чек перед отправкой на одобрение', 'error'); return; }
    if (!submit && draftDisabled) { toast(receiptRequiredCaption, 'error'); return; }
    setSaving(submit ? 'submit' : 'draft');
    try {
      /**
       * ТЗ v3 раздел 2 — ВСЕ чеки уходят ОДНИМ запросом вместе с платежом.
       *
       * Промежуточная версия слала первый файл с платежом, а остальные
       * догружала по одному, и это порождало опасный сценарий: если после
       * успешного createPayment падал любой следующий шаг, модалка оставалась
       * в режиме создания с целым списком файлов, и повторное нажатие
       * «Подтвердить» создавало ВТОРОЙ платёж на ту же сумму. Список при этом
       * не перезагружался, так что уже созданный черновик менеджер не видел и
       * повторял операцию с высокой вероятностью.
       *
       * Один запрос убирает саму возможность частичного успеха: платёж и его
       * подтверждения появляются вместе либо не появляются вовсе, и повтор
       * после ошибки снова безопасен.
       */
      await createPayment({
        studentId,
        stage,
        purpose,
        method,
        amount,
        cashAmount: method === 'MIXED' ? cashPart : undefined,
        cashlessAmount: method === 'MIXED' ? cashlessPart : undefined,
        paidAt,
        reference: reference.trim() || undefined,
        comment: comment.trim() || undefined,
        submit,
        files,
      });

      toast(submit ? 'Платёж отправлен на одобрение Основателю' : 'Черновик платежа сохранён', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      toast(buildErrorMessage(e, 'Ошибка сохранения платежа'), 'error');
    } finally {
      setSaving(null);
    }
  };

  const doSaveEdit = async (thenSubmit: boolean) => {
    if (!payment) return;
    if (!amountValid) { setTouched(true); toast('Введите корректную сумму', 'error'); return; }
    if (!mixedValid) { setTouched(true); toast('Части смешанной оплаты должны сходиться с общей суммой', 'error'); return; }
    // Защита в глубину: та же проверка, что и на создании (doCreate) — без
    // неё смена назначения на «Проживание»/«Питание» в уже существующем
    // черновике проходила бы мимо блокировки кнопки (проблема 5 ревью).
    if (!thenSubmit && draftDisabled) { toast(receiptRequiredCaption, 'error'); return; }
    if (thenSubmit && submitDisabled) { toast('Прикрепите чек перед отправкой на одобрение', 'error'); return; }
    setSaving(thenSubmit ? 'submit' : 'draft');
    try {
      await updatePayment(payment.id, {
        purpose,
        method,
        amount,
        // Смена способа со смешанного на обычный обязана затереть старую
        // разбивку — иначе бэкенд честно откажет «части только у смешанной».
        cashAmount: method === 'MIXED' ? cashPart : null,
        cashlessAmount: method === 'MIXED' ? cashlessPart : null,
        paidAt,
        reference: reference.trim(),
        comment: comment.trim(),
      });
      if (thenSubmit) {
        await submitPayment(payment.id);
        toast('Платёж отправлен на одобрение Основателю', 'success');
      } else {
        toast('Изменения сохранены', 'success');
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast(buildErrorMessage(e, 'Ошибка сохранения платежа'), 'error');
    } finally {
      setSaving(null);
    }
  };

  /**
   * ТЗ v3 раздел 2 — догрузка чеков к уже сохранённому платежу тоже пачкой
   * (input ниже с multiple). Файлы уходят по одному последовательно: пятнадцать
   * параллельных multipart по 20 МБ забивают канал и часть отваливается по
   * таймауту. Ошибка одного файла не отменяет остальные — успешные остаются
   * загруженными, а список неудачных показывается одним сообщением.
   */
  const onAddReceiptFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0 || !payment) return;
    if (picked.length > MAX_RECEIPT_FILES) {
      toast(
        `За один раз можно приложить не более ${MAX_RECEIPT_FILES} файлов — выбрано ${picked.length}. Загрузите их в несколько приёмов.`,
        'error',
      );
      return;
    }
    setAddingReceipt(true);
    try {
      // Одним запросом: бэкенд принимает пачку, и дробить её на N обращений
      // значит получить состояние «часть чеков легла, часть нет» вместо
      // «легли все или ни одного».
      const added = await addPaymentReceipts(payment.id, picked);
      // Список чеков бэкенд отдаёт по убыванию createdAt (PAYMENT_SELECT.receipts),
      // поэтому пачку кладём сверху в обратном порядке — иначе локальный список
      // разошёлся бы с тем, что придёт после перезагрузки карточки.
      if (added.length > 0) setReceipts((prev) => [...added.slice().reverse(), ...prev]);
      toast(added.length === 1 ? 'Чек добавлен' : `Добавлено чеков: ${added.length}`, 'success');
    } catch (err: any) {
      toast(buildErrorMessage(err, 'Не удалось загрузить чеки'), 'error');
    } finally {
      setAddingReceipt(false);
    }
  };

  const onRemoveReceipt = async (docId: string) => {
    try {
      await removePaymentReceipt(docId);
      setReceipts((prev) => prev.filter((r) => r.id !== docId));
      toast('Чек удалён', 'success');
    } catch (err: any) {
      toast(buildErrorMessage(err, 'Ошибка удаления чека'), 'error');
    }
  };

  const busy = saving !== null;

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card payment-form-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-form-header">
          <div className="dialog-title" style={{ marginBottom: 2 }}>
            {isEdit ? 'Редактирование платежа' : 'Внесение платежа'}
          </div>
          <div className="dialog-message" style={{ margin: 0 }}>{PAYMENT_STAGE_LABEL[stage]}</div>
        </div>

        {payment?.status === 'REJECTED' && payment.rejectionReason && (
          <div className="payment-rejected-banner">
            <Icon name="report" size={18} />
            <div>
              <b>Отклонён Основателем.</b> Причина: {payment.rejectionReason}
              <div style={{ marginTop: 2, fontWeight: 500 }}>Исправьте данные и отправьте на одобрение заново.</div>
            </div>
          </div>
        )}

        <div className="form-grid-2">
          <div className="form-group">
            <label>Назначение платежа *</label>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as PaymentPurpose)} disabled={busy}>
              {purposeChoices.map((p) => (
                <option key={p} value={p}>{PAYMENT_PURPOSE_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Способ оплаты *</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={busy}>
              {(['CASH', 'CASHLESS', 'MIXED'] as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label>Сумма (сомони) *</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              onBlur={() => setTouched(true)}
              placeholder="0.00"
              inputMode="decimal"
              className={touched && !amountValid ? 'input-error' : ''}
              disabled={busy}
            />
            {touched && !amountValid && <div className="form-error-text">Введите сумму больше нуля (до 2 знаков после точки)</div>}
          </div>
          <div className="form-group">
            <label>Дата поступления *</label>
            {/* max — подсказка интерфейса: на этой дате строится отчётность и
                база премий, будущая дата искажает и то, и другое (жёсткая
                проверка стоит на бэкенде). */}
            <input type="date" value={paidAt} max={todayStr()} onChange={(e) => setPaidAt(e.target.value)} disabled={busy} />
          </div>
        </div>

        {method === 'MIXED' && (
          <div className="form-grid-2">
            <div className="form-group">
              <label>Из них наличными (сомони) *</label>
              <input
                value={cashPart}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, '');
                  setCashPart(v);
                  complement(true, v);
                }}
                onBlur={() => setTouched(true)}
                placeholder="0.00"
                inputMode="decimal"
                className={touched && method === 'MIXED' && !cashValid ? 'input-error' : ''}
                disabled={busy}
              />
            </div>
            <div className="form-group">
              <label>Из них безналом (сомони) *</label>
              <input
                value={cashlessPart}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, '');
                  setCashlessPart(v);
                  complement(false, v);
                }}
                onBlur={() => setTouched(true)}
                placeholder="0.00"
                inputMode="decimal"
                className={touched && method === 'MIXED' && !cashlessValid ? 'input-error' : ''}
                disabled={busy}
              />
            </div>
          </div>
        )}
        {method === 'MIXED' && touched && !mixedValid && (
          <div className="form-error-text" style={{ marginTop: -6, marginBottom: 8 }}>
            Обе части должны быть больше нуля и в сумме давать общую сумму платежа
          </div>
        )}

        {/* Квитанция нужна и безналу, и безналичной части смешанной оплаты. */}
        {(method === 'CASHLESS' || method === 'MIXED') && (
          <div className="form-group">
            <label>Номер квитанции / транзакции</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              placeholder="Для сверки с банковской выпиской"
              disabled={busy}
            />
          </div>
        )}

        <div className="form-group">
          <label>Комментарий</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} disabled={busy} />
        </div>

        {isEdit ? (
          <div className="payment-receipts">
            <div className="payment-receipts-title">Чеки и квитанции</div>
            {receipts.length === 0 && (
              <div className="payment-receipts-empty">
                Нет прикреплённых файлов
                {requiresReceiptAlways && (
                  <div className="form-error-text" style={{ marginTop: 4 }}>{receiptRequiredCaption}</div>
                )}
              </div>
            )}
            {receipts.length > 0 && (
              <div className="payment-receipts-list">
                {receipts.map((r) => (
                  <div key={r.id} className="payment-receipt-item">
                    <a href={buildFileUrl(r.url)} target="_blank" rel="noreferrer">
                      <Icon name="description" size={16} />
                      <span>{r.originalName}</span>
                    </a>
                    {canWrite && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemoveReceipt(r.id)} disabled={busy}>
                        <Icon name="delete" size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canWrite && (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => receiptInputRef.current?.click()}
                  disabled={addingReceipt || busy}
                >
                  <Icon name={addingReceipt ? 'progress_activity' : 'add'} size={14} style={{ marginRight: 4 }} />
                  {addingReceipt ? 'Загрузка…' : 'Добавить чеки'}
                </button>
                {/* accept повторяет серверный фильтр (payments.controller.ts):
                    image/* пропускал бы, например, SVG и GIF, которые бэкенд
                    отбивает — менеджер выбирал бы файл и получал отказ уже
                    после загрузки. DOCX добавлен по ТЗ v3 раздел 2. */}
                <input
                  ref={receiptInputRef}
                  type="file"
                  hidden
                  multiple
                  accept={
                    'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,' +
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
                    '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.docx'
                  }
                  onChange={onAddReceiptFiles}
                />
              </>
            )}
          </div>
        ) : (
          <ReceiptDropzone
            files={files}
            onChange={setFiles}
            disabled={busy}
            hint={
              requiresReceiptAlways
                ? undefined // причина уже объяснена подписью под кнопками (receiptRequiredCaption) — не дублируем текст
                : 'Обязателен для отправки на одобрение; черновик можно сохранить и без него.'
            }
            error={requiresReceiptAlways && files.length === 0 ? receiptRequiredCaption : undefined}
          />
        )}

        {canWrite && draftDisabled && (
          // ТЗ 1.3: подпись видна в обоих режимах — и при создании, и при
          // редактировании (кнопка «Сохранить» ниже блокируется без !isEdit,
          // иначе смену назначения на Проживание/Питание можно было бы
          // сохранить в уже существующем черновике без чека). Без права записи
          // подпись не показываем: она объясняет, почему заблокирована кнопка,
          // которой в этом случае вообще нет.
          <div className="form-error-text" style={{ marginBottom: 4 }}>{receiptRequiredCaption}</div>
        )}

        <div className="dialog-actions">
          {/* Без права записи единственное действие — уйти, и подпись «Отмена»
              обманывала бы: отменять нечего. */}
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {canWrite ? 'Отмена' : 'Закрыть'}
          </button>
          {canWrite && (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => (isEdit ? doSaveEdit(false) : doCreate(false))}
                disabled={busy || draftDisabled}
                title={draftDisabled ? receiptRequiredCaption : undefined}
              >
                {saving === 'draft' ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Сохранить черновик'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => (isEdit ? doSaveEdit(true) : doCreate(true))}
                disabled={busy || submitDisabled}
                title={submitDisabled ? 'Прикрепите чек, чтобы отправить на одобрение' : undefined}
              >
                {saving === 'submit' ? 'Отправка…' : 'Подтвердить'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
