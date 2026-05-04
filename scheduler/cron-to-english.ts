// V3 page 5 / transcript ch.10 — translate cron expressions to friendly English
// for the dashboard Schedule tab. Used by routes/scheduled.ts when rendering
// missions to the UI; raw cron is preserved in cron.yaml.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function cronToEnglish(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts;

  const time = formatTime(hour, min);
  const days = formatDow(dow);
  const monthly = formatDom(dom, month);

  if (dow !== "*" && dom === "*" && month === "*") {
    return `${days} at ${time}`;
  }
  if (dom === "*" && month === "*" && dow === "*") {
    return `Every day at ${time}`;
  }
  if (monthly && dow === "*") {
    return `${monthly} at ${time}`;
  }
  return `${days || "Every day"} ${monthly ? "(" + monthly + ")" : ""} at ${time}`.trim();
}

function formatTime(hour: string, min: string): string {
  if (hour === "*" && min === "*") return "every minute";
  if (hour === "*") return `:${min.padStart(2, "0")} of every hour`;
  if (min === "*") return `every minute of hour ${hour}`;
  const h = Number(hour);
  const m = Number(min);
  if (Number.isNaN(h) || Number.isNaN(m)) return `${hour}:${min}`;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDow(dow: string): string {
  if (dow === "*") return "";
  if (dow === "1-5") return "Weekdays";
  if (dow === "0,6" || dow === "6,0") return "Weekends";
  if (/^\d$/.test(dow)) return DAYS[Number(dow)] + "s";
  if (/^\d(,\d)+$/.test(dow)) return dow.split(",").map((d) => DAYS[Number(d)]).join(", ");
  return dow;
}

function formatDom(dom: string, month: string): string {
  if (dom === "*" && month === "*") return "";
  if (dom !== "*" && month === "*") return `the ${ordinal(Number(dom))} of every month`;
  if (dom !== "*" && month !== "*") return `${MONTHS[Number(month) - 1]} ${ordinal(Number(dom))}`;
  return "";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Sanity self-check (not run unless invoked directly).
if (/cron-to-english\.(ts|js)$/.test(process.argv[1] ?? "")) {
  const cases = [
    ["0 7 * * *", "Every day at 7:00 AM"],
    ["0 9,13,17 * * *", "9,13,17:00 of every hour at"], // multi-hour, fallback path
    ["0 8 * * 1", "Mons at 8:00 AM"],
    ["0 18 * * 5", "Fris at 6:00 PM"],
    ["30 10 * * *", "Every day at 10:30 AM"],
    ["0 6 * * 1-5", "Weekdays at 6:00 AM"],
  ];
  for (const [c] of cases) console.log(`${c}  →  ${cronToEnglish(c)}`);
}
