// All user-visible copy. Components and handlers import from here; no copy literals elsewhere.

export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function londonDate(iso: string): { day: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "Europe/London" })
    .formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { day: get("day"), month: get("month") };
}

// "until 11:30", "till 11.30am", "until 12pm", "until 3:30 pm" → "HH:MM"; anything else → null.
function parseTime(text: string): string | null {
  const m = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i);
  if (!m || (!m[2] && !m[3])) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ?? "00";
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || Number(minutes) > 59) return null;
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

export const ru = {
  searchArea: "Искать здесь",
  searching: "Ищем…",
  nearMe: "Рядом со мной",
  hint: "Нажмите «Рядом со мной» или передвиньте карту и нажмите «Искать здесь».",
  noCafes: "Здесь не нашлось кафе",
  quota: "Лимит поиска на сегодня исчерпан, попробуйте завтра",
  searchFailed: "Поиск не удался, попробуйте ещё раз",
  locationOff: "Геолокация выключена — передвиньте карту и нажмите «Искать здесь»",
  reading: "Читаем меню…",
  noMenu: "Меню не найдено в интернете",
  noBreakfast: "Нет завтраков в меню",
  failed: "Не удалось прочитать меню",
  retry: "Повторить",
  showMenu: "Всё меню",
  hideMenu: "Свернуть",
  askWithoutEgg: "Попросите без яйца",
  openNow: "Открыто",
  closed: "Закрыто",
  sourceMenu: "Меню на сайте",
  googleMaps: "Google Карты",
  chain: "Сеть",
  hideChains: "Без сетей",
  showChains: "Показать сети",
  fullscreen: "Карта на весь экран",
  closeMap: "Закрыть карту",
  more: "Подробнее",
  privatePage: "Это личная страница. Попросите у Романа ссылку.",
  footer: "Это фильтр по предпочтениям, а не по аллергенам. Мы читаем только то, что написано в меню.",
  options: (n: number) => `${n} без яиц`,
  adaptable: (n: number) => `+${n} можно без яйца`,
  eggHidden: (n: number) => `${n} ${plural(n, ["блюдо", "блюда", "блюд"])} с яйцом скрыто`,
  menuRead: (iso: string) => {
    const { day, month } = londonDate(iso);
    return `Меню прочитано ${day} ${MONTHS[month - 1]}`;
  },
  servedUntil: (text: string | null) => {
    const time = text ? parseTime(text) : null;
    return time ? `завтраки до ${time}` : null;
  },
};
