import type { ExpressionSpecification } from "maplibre-gl";

// color: map fill; button: selected button (未踏 is white on the map, so its button uses grey)
export type Level = { value: number; label: string; guide: string; color: string; button: string };

// Highest first, as in the table header.
export const LEVELS: Level[] = [
  { value: 5, label: "居住", guide: "島に住んだ（3か月程度の長期滞在を含む）", color: "#e0463c", button: "#e0463c" },
  { value: 4, label: "宿泊", guide: "島内で泊まった（船中泊は除く）", color: "#f39237", button: "#f39237" },
  { value: 3, label: "訪問", guide: "島を歩いた（泊まってはいない）", color: "#f4cf3a", button: "#f4cf3a" },
  { value: 2, label: "接地", guide: "港・空港で降り立っただけ（乗り継ぎなど）", color: "#72bf6a", button: "#72bf6a" },
  { value: 1, label: "通過", guide: "船で寄港した、または橋を車・鉄道で渡った（降りていない）", color: "#5aa5dc", button: "#5aa5dc" },
  { value: 0, label: "未踏", guide: "行っていない", color: "#ffffff", button: "#9ba7af" },
];

export const colorOf = (v: number) => LEVELS.find((l) => l.value === v)!.color;

// MapLibre expression: feature-state "level" -> fill color
export const levelColorExpression = [
  "match",
  ["coalesce", ["feature-state", "level"], 0],
  ...LEVELS.flatMap((l) => [l.value, l.color]),
  "#ffffff",
] as unknown as ExpressionSpecification;

// Short labels for the law that designates the island
export const LAW_LABEL: Record<string, string> = {
  離島振興法: "離島振興法",
  沖縄振興特別措置法: "沖縄振興特措法",
  奄美群島振興開発特別措置法: "奄美群島特措法",
  小笠原諸島振興開発特別措置法: "小笠原諸島特措法",
  法対象外: "対象外",
};
