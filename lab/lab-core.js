/*!
 * 浙大魔协 · 魔方实验室 —— 逻辑内核（lab-core.js）
 * ------------------------------------------------------------------
 * 纯函数 + 数据模型，不操作 DOM，浏览器（window.LabCore）与 Node（module.exports）均可运行，
 * 便于对「转动 / 打乱 / 公式解析 / 成绩统计」做单元自测。
 *
 * 坐标系（与 CSS 3D 完全一致）：
 *   x 向右，y 向下，z 指向观察者（屏幕外）。
 *   六个面：R = +x（右）、L = -x（左）、U = -y（上）、D = +y（下）、F = +z（前）、B = -z（后）
 *
 * 面的「顺时针」定义：从该面的外侧正视它，顺时针旋转 90°。
 * 对应到本坐标系的旋转矩阵写在 FACE_INFO[face].cw 中，CSS 动画轴见 cssAxis / cwAngle。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.LabCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ============================== 矩阵工具（3×3 整数矩阵） ============================== */

  var IDENTITY = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  function cloneMat(m) {
    return [m[0].slice(), m[1].slice(), m[2].slice()];
  }

  function matMul(a, b) {
    var out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
      }
    }
    return out;
  }

  function matT(a) {
    return [
      [a[0][0], a[1][0], a[2][0]],
      [a[0][1], a[1][1], a[2][1]],
      [a[0][2], a[1][2], a[2][2]]
    ];
  }

  function matVec(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
  }

  function matEquals(a, b) {
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }

  /* ============================== 六个面的定义 ==============================
   * axisIndex / layer：该面所在的坐标轴与层（-1 / +1）
   * normal：该面朝外的方向
   * cssAxis / cwAngle：CSS rotate3d 的旋转轴与「顺时针」角度
   * cw：顺时针 90° 的世界旋转矩阵（作用于列向量：v' = cw · v）
   * view：记号说明里小魔方的展示视角
   */
  var FACE_ORDER = ['U', 'D', 'L', 'R', 'F', 'B'];

  var FACE_INFO = {
    U: {
      letter: 'U', name: '顶层', look: '从上方看',
      color: '#F7D154',
      axisIndex: 1, layer: -1,
      normal: [0, -1, 0],
      cssAxis: [0, 1, 0], cwAngle: -90,
      cw: [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
      view: { x: -24, y: -34 }
    },
    D: {
      letter: 'D', name: '底层', look: '从下方看',
      color: '#F2EFE6',
      axisIndex: 1, layer: 1,
      normal: [0, 1, 0],
      cssAxis: [0, 1, 0], cwAngle: 90,
      cw: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
      view: { x: 26, y: -34 }
    },
    L: {
      letter: 'L', name: '左面', look: '从左侧看',
      color: '#F5A24B',
      axisIndex: 0, layer: -1,
      normal: [-1, 0, 0],
      cssAxis: [1, 0, 0], cwAngle: -90,
      cw: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
      view: { x: -22, y: 34 }
    },
    R: {
      letter: 'R', name: '右面', look: '从右侧看',
      color: '#F25C5C',
      axisIndex: 0, layer: 1,
      normal: [1, 0, 0],
      cssAxis: [1, 0, 0], cwAngle: 90,
      cw: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
      view: { x: -22, y: -34 }
    },
    F: {
      letter: 'F', name: '前面', look: '从前方看',
      color: '#46D98A',
      axisIndex: 2, layer: 1,
      normal: [0, 0, 1],
      cssAxis: [0, 0, 1], cwAngle: 90,
      cw: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      view: { x: -24, y: -32 }
    },
    B: {
      letter: 'B', name: '后面', look: '从后方看',
      color: '#5A7CF5',
      axisIndex: 2, layer: -1,
      normal: [0, 0, -1],
      cssAxis: [0, 0, 1], cwAngle: -90,
      cw: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
      view: { x: -20, y: 150 }
    }
  };

  var DIRECTIONS = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1]
  ];

  function dirKey(v) {
    return v[0] + ',' + v[1] + ',' + v[2];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  /** 由世界方向向量找到对应的面字母（U/D/L/R/F/B） */
  function faceForNormal(n) {
    for (var i = 0; i < FACE_ORDER.length; i++) {
      var f = FACE_ORDER[i];
      var m = FACE_INFO[f].normal;
      if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) return f;
    }
    return null;
  }

  /** 世界方向对应的贴纸颜色 */
  function colorForNormal(n) {
    var f = faceForNormal(n);
    return f ? FACE_INFO[f].color : null;
  }

  /* ============================== 魔方模型 ============================== */

  /**
   * 创建 26 个小块（不去创建中心那块不可见的）。
   * 每个小块：
   *   home  → 复原时的坐标 [x,y,z]（仅用于调试/展示）
   *   pos   → 当前坐标，取值 -1 / 0 / 1
   *   orient→ 3×3 方向矩阵 O，把「小块局部方向」映射为「世界方向」
   *   colors→ 以局部方向为键的贴纸颜色（null = 内部暗面）
   */
  function createCube() {
    var cubies = [];
    for (var x = -1; x <= 1; x++) {
      for (var y = -1; y <= 1; y++) {
        for (var z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          var pos = [x, y, z];
          var colors = {};
          for (var i = 0; i < DIRECTIONS.length; i++) {
            var n = DIRECTIONS[i];
            colors[dirKey(n)] = dot(pos, n) === 1 ? colorForNormal(n) : null;
          }
          cubies.push({
            home: pos.slice(),
            pos: pos.slice(),
            orient: cloneMat(IDENTITY),
            colors: colors
          });
        }
      }
    }
    return { cubies: cubies };
  }

  /** 面 + 转数 → 旋转矩阵。turns：1 顺时针 / -1 逆时针 / 2 转 180° */
  function rotationMatrix(face, turns) {
    var info = FACE_INFO[face];
    if (!info) throw new Error('未知的转动面：' + face);
    if (turns === 1) return cloneMat(info.cw);
    if (turns === -1) return matT(info.cw);
    if (turns === 2) return matMul(info.cw, info.cw);
    throw new Error('非法的转动步数：' + turns);
  }

  /**
   * 对魔方施加一步转动（原地修改 cube）。
   * 世界旋转 R：位置 pos' = R·pos，朝向 O' = R·O。
   */
  function applyMove(cube, move) {
    if (!move || !FACE_INFO[move.face]) throw new Error('非法的转动：' + JSON.stringify(move));
    var info = FACE_INFO[move.face];
    var R = rotationMatrix(move.face, move.turns);
    for (var i = 0; i < cube.cubies.length; i++) {
      var c = cube.cubies[i];
      if (c.pos[info.axisIndex] === info.layer) {
        c.pos = matVec(R, c.pos);
        c.orient = matMul(R, c.orient);
      }
    }
    return cube;
  }

  function applySequence(cube, moves) {
    for (var i = 0; i < moves.length; i++) applyMove(cube, moves[i]);
    return cube;
  }

  /** 判定是否复原：每一个世界朝向上的贴纸颜色都必须与「该位置期望的面」一致 */
  function isSolved(cube) {
    for (var i = 0; i < cube.cubies.length; i++) {
      var c = cube.cubies[i];
      var Ot = matT(c.orient);
      for (var d = 0; d < DIRECTIONS.length; d++) {
        var n = DIRECTIONS[d];
        var local = matVec(Ot, n); // 世界方向 n 对应小块的局部方向
        var color = c.colors[dirKey(local)];
        var expected = dot(c.pos, n) === 1 ? colorForNormal(n) : null;
        if (color !== expected) return false;
      }
    }
    return true;
  }

  /* ============================== 转动记号解析 ============================== */

  /** "R" / "R'" / "R2" → { face:'R', turns:1|-1|2 }；非法返回 null */
  function parseMove(token) {
    if (token == null) return null;
    var t = String(token).trim().toUpperCase().replace(/[\u2019\u2018\u2032`]/g, "'");
    if (!t) return null;
    var m = /^([UDLRFB])(2?)('?)$/.exec(t);
    if (!m) return null;
    var turns = m[2] === '2' ? 2 : (m[3] === "'" ? -1 : 1);
    return { face: m[1], turns: turns };
  }

  /** 一串记号（空格分隔）→ 转动数组；非法记号会被忽略 */
  function parseSequence(text) {
    if (Array.isArray(text)) {
      return text.map(function (t) { return typeof t === 'string' ? parseMove(t) : t; }).filter(Boolean);
    }
    if (!text) return [];
    return String(text).split(/\s+/).map(parseMove).filter(Boolean);
  }

  /** 转动 → 标准记号 */
  function moveId(move) {
    if (!move) return '';
    var suffix = move.turns === 2 ? '2' : (move.turns === -1 ? "'" : '');
    return move.face + suffix;
  }

  /** 一组转动 → 空格分隔的记号文本 */
  function sequenceToString(moves) {
    return (moves || []).map(moveId).join(' ');
  }

  /** 逆转动：R → R'，R' → R，R2 → R2 */
  function invertMove(move) {
    return { face: move.face, turns: move.turns === 2 ? 2 : -move.turns };
  }

  function inverseSequence(moves) {
    var out = [];
    for (var i = moves.length - 1; i >= 0; i--) out.push(invertMove(moves[i]));
    return out;
  }

  /* ============================== 随机打乱 ============================== */

  /** mulberry32：给自测用的可复现随机数 */
  function makeRng(seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 生成随机打乱（默认 20 步）。
   * 约束：相邻两步不会是同一个面；同时避免「同一轴上的对 face 连续」这种明显可优化的组合。
   */
  function randomScramble(length, rng) {
    var rand = typeof rng === 'function' ? rng : Math.random;
    var n = Math.max(1, Math.floor(length || 20));
    var seq = [];
    var prev = null;
    for (var i = 0; i < n; i++) {
      var face = null;
      for (var guard = 0; guard < 40; guard++) {
        var pick = FACE_ORDER[Math.floor(rand() * FACE_ORDER.length) % FACE_ORDER.length];
        var sameFace = prev && pick === prev;
        var sameAxis = prev && FACE_INFO[pick].axisIndex === FACE_INFO[prev].axisIndex;
        if (!sameFace && !sameAxis) { face = pick; break; }
        face = pick;
      }
      var turns = [1, -1, 2][Math.floor(rand() * 3)];
      seq.push({ face: face, turns: turns });
      prev = face;
    }
    return seq;
  }

  /* ============================== 成绩统计 / 时间格式 ============================== */

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * 毫秒 → 秒表文本。
   *   8340   → "8.34"
   *   65430  → "1:05.43"
   */
  function formatTime(ms) {
    if (ms == null || !isFinite(ms)) return '--';
    var cs = Math.round(Math.max(0, ms) / 10);
    var minutes = Math.floor(cs / 6000);
    var seconds = Math.floor(cs / 100) % 60;
    var centis = cs % 100;
    if (minutes > 0) return minutes + ':' + pad2(seconds) + '.' + pad2(centis);
    return seconds + '.' + pad2(centis);
  }

  /** 单个成绩条数超过上限时截断 */
  function trimTimes(list, max) {
    var limit = max || 100;
    return (list || []).filter(function (t) {
      return typeof t === 'number' && isFinite(t) && t > 0;
    }).slice(0, limit);
  }

  /** 最佳成绩（毫秒 / null） */
  function bestOf(times) {
    var list = trimTimes(times);
    if (!list.length) return null;
    return Math.min.apply(null, list);
  }

  /**
   * ao5：最近 5 次去掉一个最好、一个最差后的平均（毫秒）。
   * 入参顺序为「最新在前」；不足 5 次返回 null。
   */
  function averageOf5(times) {
    var list = trimTimes(times);
    if (list.length < 5) return null;
    var five = list.slice(0, 5).slice().sort(function (a, b) { return a - b; });
    var sum = five[1] + five[2] + five[3];
    return sum / 3;
  }

  /** 汇总：最佳 / ao5 / 次数 */
  function statsOf(times) {
    var list = trimTimes(times);
    return {
      best: bestOf(list),
      ao5: averageOf5(list),
      count: list.length
    };
  }

  return {
    IDENTITY: IDENTITY,
    FACE_ORDER: FACE_ORDER,
    FACE_INFO: FACE_INFO,
    DIRECTIONS: DIRECTIONS,
    // 矩阵
    matMul: matMul,
    matT: matT,
    matVec: matVec,
    matEquals: matEquals,
    // 模型
    createCube: createCube,
    applyMove: applyMove,
    applySequence: applySequence,
    isSolved: isSolved,
    rotationMatrix: rotationMatrix,
    // 记号
    parseMove: parseMove,
    parseSequence: parseSequence,
    moveId: moveId,
    sequenceToString: sequenceToString,
    invertMove: invertMove,
    inverseSequence: inverseSequence,
    randomScramble: randomScramble,
    makeRng: makeRng,
    // 统计
    formatTime: formatTime,
    trimTimes: trimTimes,
    bestOf: bestOf,
    averageOf5: averageOf5,
    statsOf: statsOf
  };
});
