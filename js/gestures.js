// Поза руки по 21 точке MediaPipe — собственные правила.
// Прямота пальцев считается по углам в 3D, поэтому жест распознаётся,
// даже если палец смотрит прямо в камеру. Для «почти правильных» поз —
// конкретная подсказка, какой палец согнуть или выпрямить.

export const POSE = {
  NONE: 'NONE',   // руки нет в кадре
  POINT: 'POINT', // указательный палец — указка
  PALM: 'PALM',   // открытая ладонь — включить управление, листать
  FIST: 'FIST',   // кулак — вернуть общий вид / выйти из режима
  PINCH: 'PINCH', // большой + указательный сведены — увеличить / рисовать
  OTHER: 'OTHER',
};

export const POSE_NAMES = {
  [POSE.POINT]: 'указатель',
  [POSE.PALM]: 'ладонь',
  [POSE.FIST]: 'кулак',
  [POSE.PINCH]: 'щипок',
  [POSE.OTHER]: 'жест не распознан',
  [POSE.NONE]: 'руки не видно',
};

const FINGERS = [
  { name: 'указательный палец', mcp: 5, pip: 6, tip: 8 },
  { name: 'средний палец', mcp: 9, pip: 10, tip: 12 },
  { name: 'безымянный палец', mcp: 13, pip: 14, tip: 16 },
  { name: 'мизинец', mcp: 17, pip: 18, tip: 20 },
];

// Щипок: расстояние между кончиками большого и указательного в долях ладони.
// Гистерезис: сомкнуто при < PINCH_ON, разомкнуто при > PINCH_OFF.
export const PINCH_ON = 0.3;
export const PINCH_OFF = 0.45;

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) });

function angle3(u, v) {
  const dot = u.x * v.x + u.y * v.y + u.z * v.z;
  const l = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, dot / l))) * 180) / Math.PI;
}

function list(names) {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

export function fingerStates(lm, world) {
  if (world) {
    return FINGERS.map(f => {
      const bend = angle3(sub3(world[f.pip], world[f.mcp]), sub3(world[f.tip], world[f.pip]));
      return bend < 40 ? 'ext' : bend > 75 ? 'curl' : 'half';
    });
  }
  const wrist = lm[0];
  return FINGERS.map(f => {
    const r = d(lm[f.tip], wrist) / d(lm[f.pip], wrist);
    return r > 1.15 ? 'ext' : r < 1.08 ? 'curl' : 'half';
  });
}

/** Расстояние большой–указательный в долях ладони (3D, если есть). */
export function pinchRatio(lm, world) {
  if (world) return d3(world[4], world[8]) / (d3(world[0], world[9]) || 1);
  return d(lm[4], lm[8]) / (d(lm[0], lm[9]) || 1);
}

/**
 * lm — 21 точка (экран или кадр), world — те же точки в 3D.
 * pinched — был ли щипок на прошлом кадре (для гистерезиса).
 */
export function classifyHand(lm, world = null, pinched = false) {
  const st = fingerStates(lm, world);
  const [index, ...others] = st;
  const nExt = st.filter(s => s === 'ext').length;
  const nCurl = st.filter(s => s === 'curl').length;
  const pr = pinchRatio(lm, world);
  const namesWhere = test => FINGERS.filter((_, i) => test(st[i], i)).map(f => f.name);

  // Щипок проверяем первым: при нём указательный согнут к большому.
  if (pr < (pinched ? PINCH_OFF : PINCH_ON) && nExt < 4) return { pose: POSE.PINCH, pinch: pr };
  if (nExt === 4 || (nExt === 3 && nCurl === 0)) return { pose: POSE.PALM, pinch: pr };
  if (index === 'ext' && others.every(s => s !== 'ext') && others.filter(s => s === 'curl').length >= 2) {
    return { pose: POSE.POINT, pinch: pr };
  }
  if (nExt === 0 && nCurl >= 3) return { pose: POSE.FIST, pinch: pr };

  // Почти-позы: что именно исправить.
  if (pr < PINCH_OFF + 0.15) return { pose: POSE.OTHER, near: POSE.PINCH, pinch: pr, hint: 'Сведи большой и указательный пальцы плотнее — до касания' };
  if (index === 'ext') {
    return { pose: POSE.OTHER, near: POSE.POINT, pinch: pr, hint: `Для указки согни ${list(namesWhere((s, i) => i > 0 && s !== 'curl'))}` };
  }
  if (nExt >= 2 && nCurl === 0) {
    return { pose: POSE.OTHER, near: POSE.PALM, pinch: pr, hint: `Раскрой ладонь полностью — выпрями ${list(namesWhere(s => s !== 'ext'))}` };
  }
  if (nCurl >= 2) {
    return { pose: POSE.OTHER, near: POSE.FIST, pinch: pr, hint: `Сожми кулак плотнее — согни ${list(namesWhere(s => s !== 'curl'))}` };
  }
  return { pose: POSE.OTHER, pinch: pr };
}
