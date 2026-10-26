'use strict';

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const SLOT_MS = 30 * 60 * 1000;
const MIN_DURATION_MS = 30 * 60 * 1000;
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const WORK_START_MIN = 8 * 60;
const WORK_END_MIN = 22 * 60;
const MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

const nowUtc = () => new Date();
const toIso = (d) => d.toISOString();

function parseIso(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mskParts(date) {
  const s = new Date(date.getTime() + MSK_OFFSET_MS);
  return {
    year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate(),
    hour: s.getUTCHours(), minute: s.getUTCMinutes(), second: s.getUTCSeconds()
  };
}

const pad = (n) => String(n).padStart(2, '0');

function formatMsk(d) {
  const p = mskParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

function formatMskDate(d) {
  const p = mskParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function mskDateTimeToUtc(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  const t = /^(\d{2}):(\d{2})$/.exec(timeStr || '');
  if (!d || !t) return null;
  return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1] - 3, +t[2], 0, 0));
}

function mskDayRangeUtc(dateStr) {
  const start = mskDateTimeToUtc(dateStr, '00:00');
  if (!start) return null;
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function minutesOfDayMsk(d) {
  const p = mskParts(d);
  return p.hour * 60 + p.minute;
}

function validateBookingWindow(start, end, now = nowUtc()) {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start) || Number.isNaN(end)) {
    return 'Укажите корректные дату и время со смещением часового пояса.';
  }
  if (!(end > start)) return 'Окончание должно быть позже начала.';
  const dur = end.getTime() - start.getTime();
  if (dur < MIN_DURATION_MS || dur > MAX_DURATION_MS) return 'Продолжительность должна быть от 30 минут до 4 часов.';
  if (start.getTime() % SLOT_MS !== 0 || end.getTime() % SLOT_MS !== 0) return 'Время выбирается с шагом 30 минут.';
  if (formatMskDate(start) !== formatMskDate(end)) return 'Бронирование должно целиком помещаться в один рабочий день (МСК).';
  const sMin = minutesOfDayMsk(start);
  const eMin = minutesOfDayMsk(end);
  if (sMin < WORK_START_MIN || eMin > WORK_END_MIN || sMin >= WORK_END_MIN) {
    return 'Ресурс доступен ежедневно с 08:00 до 22:00 по московскому времени.';
  }
  if (start.getTime() < now.getTime()) return 'Начало не может находиться в прошлом.';
  if (start.getTime() - now.getTime() > MAX_AHEAD_MS) return 'Начало не позднее чем через 30 суток от текущего момента.';
  return null;
}

function slotStarts(start, end) {
  const out = [];
  for (let t = start.getTime(); t < end.getTime(); t += SLOT_MS) out.push(new Date(t).toISOString());
  return out;
}

const intervalsOverlap = (aS, aE, bS, bE) => aS < bE && aE > bS;

module.exports = {
  nowUtc, toIso, parseIso, mskParts, formatMsk, formatMskDate,
  mskDateTimeToUtc, mskDayRangeUtc, validateBookingWindow, slotStarts,
  intervalsOverlap, SLOT_MS
};