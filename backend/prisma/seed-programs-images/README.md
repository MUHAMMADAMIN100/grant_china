# Картинки для seed-programs

Сюда положи изображения для начального импорта программ. Имена файлов = порядковый номер программы в seed-programs.ts.

- `1.jpg` (или .png / .webp) → Уси (Wuxi)
- `2.jpg` → Тунжэнь (Tongren)
- `3.jpg` → Цзуньи (Zunyi)
- `4.jpg` → Циндао (Qingdao)
- `5.jpg` → Нанкин (Nanjing)

После того как положишь файлы сюда, запусти:

```bash
cd backend
npx ts-node prisma/seed-programs.ts
```

Скрипт скопирует файлы в `backend/uploads/<uuid>.<ext>` и пропишет `imageUrl` в БД. На проде картинки уйдут вместе с программой в Telegram-канал (если `PUBLIC_API_BASE` и `TELEGRAM_CHANNEL_ID` заданы в env).

Картинки в этой папке **не коммитятся** в git (см. .gitignore рядом).
