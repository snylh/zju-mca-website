/*!
 * 浙大魔协 · 魔方实验室 —— 页面交互 lab.js
 * ------------------------------------------------------------------
 * 依赖：lab-core.js（window.LabCore）
 * 结构：
 *   1. 工具函数 / Toast
 *   2. CubeView：CSS 3D 魔方渲染、拖拽视角、单步转动动画
 *   3. TurnQueue：转动队列（保证动画串行 + 撤销/复原/打乱）
 *   4. 控制面板：面转按钮、打乱、复原、撤销、速度
 *   5. 公式库：数据、选中、公式演示（播放 / 暂停 / 单步 / 重播）
 *   6. 计时器：15 秒观察、空格开始停止、localStorage 成绩、ao5
 *   7. 记号说明：小魔方图示 + 示例演示
 *   8. 键盘快捷键与初始化
 *
 * 全部使用普通 <script> 与原生 API，零外部依赖，可直接 file:// 打开。
 */
(function () {
  'use strict';

  var Core = window.LabCore;
  if (!Core) {
    console.error('[魔方实验室] lab-core.js 未加载，页面无法初始化。');
    return;
  }

  /* ================================================================
   * 1. 工具函数 / Toast
   * ================================================================ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var toastEl = $('#toast');
  var toastTimer = 0;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 2400);
  }

  /* ================================================================
   * 2. CubeView —— CSS 3D 魔方
   * ================================================================ */

  var MINI_FACE_KEYS = ['U', 'D', 'L', 'R', 'F', 'B'];

  /*
   * 局部面方向 → 面元素 class。
   * 坐标系与 lab-core.js 一致：+x 右 / +y 下 / +z 前。
   */
  var FACE_CLASSES = [
    { key: '1,0,0', cls: 'face--xp' },
    { key: '-1,0,0', cls: 'face--xn' },
    { key: '0,1,0', cls: 'face--yp' },
    { key: '0,-1,0', cls: 'face--yn' },
    { key: '0,0,1', cls: 'face--zp' },
    { key: '0,0,-1', cls: 'face--zn' }
  ];

  function CubeView(options) {
    options = options || {};
    this.root = $(options.root || '#cubeRoot');
    this.scene = $(options.scene || '#cubeScene');
    this.viewport = $(options.viewport || '#cubeViewport');
    this.interactive = options.interactive !== false;
    this.maxSize = options.maxSize || 92;
    this.minSize = options.minSize || 40;
    this.cube = Core.createCube();
    this.elements = [];
    this.cubieSize = 62;
    this.spacing = 64;
    this.rotX = -24;
    this.rotY = -32;
    this.dragging = false;
    this._viewTimer = 0;
    this._animSeq = 0;
    this._build();
    if (this.interactive) this._bindPointer();
    this.fit();
  }

  CubeView.prototype._build = function () {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < this.cube.cubies.length; i++) {
      var cubie = this.cube.cubies[i];
      var el = document.createElement('div');
      el.className = 'cubie';
      for (var f = 0; f < FACE_CLASSES.length; f++) {
        var def = FACE_CLASSES[f];
        var face = document.createElement('div');
        face.className = 'face ' + def.cls;
        var color = cubie.colors[def.key];
        if (color) {
          face.style.setProperty('--sticker', color);
        } else {
          face.classList.add('is-inner');
        }
        el.appendChild(face);
      }
      this.elements.push(el);
      frag.appendChild(el);
    }
    this.root.appendChild(frag);
    this.renderAll();
  };

  /** 依据容器尺寸 / 屏幕高度选择小块像素大小，保持魔方完整可见 */
  CubeView.prototype.fit = function () {
    if (!this.viewport) return;
    var rect = this.viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // 旋转视角下立方体投影高度约为边长的 1.5 倍，留出安全边距避免被裁切
    var padX = clamp(rect.width * 0.2, 48, 120);
    var padY = clamp(rect.height * 0.16, 32, 70);
    var maxByWidth = (rect.width - padX) / 3;
    var maxByHeight = ((rect.height - padY) / 1.5 - 4) / 3;
    var size = Math.floor(clamp(Math.min(maxByWidth, maxByHeight), this.minSize, this.maxSize));
    this.cubieSize = size;
    this.spacing = size + 2;
    // 关键：--cubie 只作用在当前魔方容器上，避免两个 CubeView 互相干扰
    this.viewport.style.setProperty('--cubie', size + 'px');
    this.renderAll();
  };

  /** 单个小块的 transform：世界旋转 R · 平移 T · 朝向 O */
  CubeView.prototype.transformFor = function (cubie, axis, angleDeg) {
    var s = this.spacing;
    var p = cubie.pos;
    var m = cubie.orient;
    var rot = 'rotate3d(' + axis[0] + ',' + axis[1] + ',' + axis[2] + ',' + angleDeg.toFixed(3) + 'deg)';
    var move = 'translate3d(' + (p[0] * s) + 'px,' + (p[1] * s) + 'px,' + (p[2] * s) + 'px)';
    var mat = 'matrix3d(' + [
      m[0][0], m[1][0], m[2][0], 0,
      m[0][1], m[1][1], m[2][1], 0,
      m[0][2], m[1][2], m[2][2], 0,
      0, 0, 0, 1
    ].join(',') + ')';
    return rot + ' ' + move + ' ' + mat;
  };

  CubeView.prototype.renderAll = function () {
    for (var i = 0; i < this.cube.cubies.length; i++) {
      this.elements[i].style.transform = this.transformFor(this.cube.cubies[i], [0, 1, 0], 0);
    }
  };

  /**
   * 播放单步转动动画，完成后提交模型状态。
   * @returns {Promise} 动画结束（或 duration=0 立即完成）时 resolve
   */
  CubeView.prototype.animateMove = function (move, duration) {
    var self = this;
    var info = Core.FACE_INFO[move.face];
    var axisIndex = info.axisIndex;
    var affected = [];
    for (var i = 0; i < this.cube.cubies.length; i++) {
      if (this.cube.cubies[i].pos[axisIndex] === info.layer) affected.push(i);
    }
    var angle = info.cwAngle * (move.turns === 2 ? 2 : move.turns);
    var seq = this._animSeq;

    return new Promise(function (resolve) {
      var dur = Math.max(0, duration | 0);
      if (!affected.length || dur === 0) {
        Core.applyMove(self.cube, move);
        self.renderAll();
        resolve();
        return;
      }

      affected.forEach(function (idx) {
        var el = self.elements[idx];
        el.style.transition = 'transform ' + dur + 'ms cubic-bezier(0.25, 0.85, 0.28, 1)';
        el.style.willChange = 'transform';
      });
      // 先让「初始静态 transform」完成一次样式计算，保证过渡从当前状态出发
      void self.root.offsetHeight;
      affected.forEach(function (idx) {
        self.elements[idx].style.transform = self.transformFor(self.cube.cubies[idx], info.cssAxis, angle);
      });

      var finished = false;
      var timer = 0;
      function commit() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        // 动画期间若发生了硬复位（换公式 / 重置演示），丢弃这次提交
        if (seq !== self._animSeq) {
          resolve();
          return;
        }
        // 模型状态在动画结束后一次性提交，避免中途抽屉式错位
        Core.applyMove(self.cube, move);
        affected.forEach(function (idx) {
          var el = self.elements[idx];
          el.style.transition = 'none';
          el.style.willChange = '';
        });
        self.renderAll();
        void self.root.offsetHeight; // 让 transition:none 立即生效
        affected.forEach(function (idx) { self.elements[idx].style.transition = ''; });
        resolve();
      }
      timer = setTimeout(commit, dur + 26);
    });
  };

  /** 直接回到复原状态（不打动画，用于历史过长 / 重置演示） */
  CubeView.prototype.hardReset = function () {
    this._animSeq++;
    for (var i = 0; i < this.elements.length; i++) {
      var el = this.elements[i];
      el.style.transition = 'none';
      el.style.willChange = '';
    }
    this.cube = Core.createCube();
    this.renderAll();
    void this.root.offsetHeight;
    for (var j = 0; j < this.elements.length; j++) this.elements[j].style.transition = '';
  };

  CubeView.prototype._bindPointer = function () {
    var self = this;
    var vp = this.viewport;
    if (!vp) return;
    var activeId = null;
    var lastX = 0;
    var lastY = 0;

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      activeId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      self.dragging = true;
      self.scene.style.transition = '';
      clearTimeout(self._viewTimer);
      vp.classList.add('is-dragging');
      if (vp.setPointerCapture) {
        try { vp.setPointerCapture(activeId); } catch (err) { /* 某些环境不支持捕获，忽略 */ }
      }
      e.preventDefault();
    }

    function onMove(e) {
      if (!self.dragging || e.pointerId !== activeId) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      self.rotY += dx * 0.42;
      self.rotX = clamp(self.rotX - dy * 0.42, -82, 82);
      self.applyView();
      e.preventDefault();
    }

    function onUp(e) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      self.dragging = false;
      vp.classList.remove('is-dragging');
      if (vp.releasePointerCapture) {
        try { vp.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      }
    }

    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('pointermove', onMove);
    vp.addEventListener('pointerup', onUp);
    vp.addEventListener('pointercancel', onUp);
    vp.addEventListener('dblclick', function () { self.resetView(); });
  };

  CubeView.prototype.applyView = function () {
    this.scene.style.transform =
      'rotateX(' + this.rotX.toFixed(2) + 'deg) rotateY(' + this.rotY.toFixed(2) + 'deg)';
  };

  CubeView.prototype.resetView = function () {
    var self = this;
    this.scene.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1)';
    this.rotX = -24;
    this.rotY = -32;
    this.applyView();
    clearTimeout(this._viewTimer);
    this._viewTimer = setTimeout(function () { self.scene.style.transition = ''; }, 590);
  };

  /** 首次进入的入场旋转（尊重 prefers-reduced-motion） */
  CubeView.prototype.intro = function () {
    var self = this;
    if (reduceMotion) {
      this.rotX = -24;
      this.rotY = -32;
      this.applyView();
      return;
    }
    var fromX = -58;
    var fromY = -78;
    var toX = -24;
    var toY = -32;
    var start = performance.now();
    var dur = 1000;
    this.rotX = fromX;
    this.rotY = fromY;
    this.applyView();
    function frame(now) {
      var p = clamp((now - start) / dur, 0, 1);
      var e = 1 - Math.pow(1 - p, 3);
      self.rotX = fromX + (toX - fromX) * e;
      self.rotY = fromY + (toY - fromY) * e;
      self.applyView();
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  /* ================================================================
   * 3. TurnQueue —— 串行转动队列
   * ================================================================ */

  function TurnQueue(view) {
    this.view = view;
    this.pending = [];
    this.busy = false;
    this.gen = 0;
    this.idleWaiters = [];
    this.onChange = null;
  }

  TurnQueue.prototype.exec = function (move, duration, meta) {
    var self = this;
    return new Promise(function (resolve) {
      self.pending.push({
        move: move,
        duration: duration,
        meta: meta || {},
        resolve: resolve,
        gen: self.gen
      });
      self._emitChange();
      self.pump();
    });
  };

  TurnQueue.prototype.pump = function () {
    var self = this;
    if (self.busy) return;
    if (!self.pending.length) {
      self._emitIdle();
      self._emitChange();
      return;
    }
    var task = self.pending.shift();
    if (task.gen !== self.gen) {
      task.resolve({ cancelled: true });
      return self.pump();
    }
    self.busy = true;
    self._emitChange();
    // 用 Promise.resolve().then 包裹，动画函数同步抛错时也能进入 catch，
    // 避免队列卡死（例如非法转动）。
    Promise.resolve()
      .then(function () { return self.view.animateMove(task.move, task.duration); })
      .then(function () {
        // 已经开始播放的转动一定落地，历史记录保持一致
        if (task.meta.onCommit) {
          try { task.meta.onCommit(task.move, task); } catch (err) { console.error('[魔方实验室] onCommit 出错', err); }
        }
        self.busy = false;
        task.resolve({ cancelled: false });
        self._emitChange();
        if (!self.pending.length) self._emitIdle();
        self.pump();
      })
      .catch(function (err) {
        console.error('[魔方实验室] 转动失败', err);
        self.busy = false;
        task.resolve({ cancelled: true, error: err });
        self._emitChange();
        if (!self.pending.length) self._emitIdle();
        self.pump();
      });
  };

  /** 取消尚未开始的队列任务（正在播放的那一步会正常完成） */
  TurnQueue.prototype.cancelPending = function () {
    this.gen++;
    var pending = this.pending.splice(0);
    pending.forEach(function (task) { task.resolve({ cancelled: true }); });
    this._emitChange();
  };

  TurnQueue.prototype.whenIdle = function () {
    var self = this;
    if (!this.busy && !this.pending.length) return Promise.resolve();
    return new Promise(function (resolve) { self.idleWaiters.push(resolve); });
  };

  TurnQueue.prototype._emitChange = function () {
    if (typeof this.onChange === 'function') this.onChange(this);
  };

  TurnQueue.prototype._emitIdle = function () {
    var waiters = this.idleWaiters.splice(0);
    waiters.forEach(function (fn) { fn(); });
  };

  /* ================================================================
   * 4. 控制面板 / 历史记录
   * ================================================================ */

  var SPEEDS = { slow: 460, normal: 250, fast: 140 };
  var speedName = 'normal';

  var ui = {
    cubeStatus: $('#cubeStatus'),
    queueStatus: $('#queueStatus'),
    moveCount: $('#moveCount'),
    faceControls: $('#faceControls'),
    controlPanel: $('#controlPanel'),
    speedControl: $('#speedControl'),
    btnScramble: $('#btnScramble'),
    btnReset: $('#btnReset'),
    btnUndo: $('#btnUndo')
  };

  var view = new CubeView();
  // 公式演示专用的小魔方（不可拖拽，每次演示从复原状态开始）
  var demoView = new CubeView({
    root: '#demoCubeRoot',
    scene: '#demoCubeScene',
    viewport: '#demoCubeViewport',
    interactive: false,
    maxSize: 68
  });
  var queue = new TurnQueue(view);
  var history = [];          // 自复原以来已经落地的转动
  var commandBusy = false;

  function durationFor(move) {
    var base = SPEEDS[speedName] || SPEEDS.normal;
    return move.turns === 2 ? Math.round(base * 1.7) : base;
  }

  function updateQueueMeta() {
    if (!ui.queueStatus) return;
    var pending = queue.pending.length;
    if (queue.busy || pending) {
      ui.queueStatus.textContent = pending ? '执行中 · 还剩 ' + pending + ' 步' : '转动中…';
      ui.queueStatus.classList.add('is-busy');
    } else {
      ui.queueStatus.textContent = '队列空闲';
      ui.queueStatus.classList.remove('is-busy');
    }
  }

  function updateCubeMeta() {
    var solved = Core.isSolved(view.cube);
    if (ui.cubeStatus) {
      ui.cubeStatus.textContent = solved ? '已复原' : '打乱中 · ' + history.length + ' 步';
      ui.cubeStatus.classList.toggle('is-solved', solved);
      ui.cubeStatus.classList.toggle('is-busy', !solved);
    }
    if (ui.moveCount) ui.moveCount.textContent = '历史 ' + history.length + ' 步';
    updateQueueMeta();
  }

  function pushHistory(move) {
    history.push(move);
    updateCubeMeta();
  }

  function popHistory() {
    history.pop();
    updateCubeMeta();
  }

  function userMove(move) {
    if (commandBusy) return;
    queue.exec(move, durationFor(move), { onCommit: pushHistory });
  }

  function setCommandBusy(busy) {
    commandBusy = busy;
    if (ui.controlPanel) ui.controlPanel.classList.toggle('is-busy', busy);
  }

  /** 串行执行「打乱 / 复原 / 撤销 / 同步打乱」等整体操作 */
  function runCommand(name, job) {
    if (commandBusy) {
      toast('正在处理上一步操作，请稍等…');
      return;
    }
    setCommandBusy(true);
    Promise.resolve()
      .then(job)
      .catch(function (err) {
        console.error('[魔方实验室] 操作失败：' + name, err);
        toast('操作失败，请重试');
      })
      .then(function () {
        setCommandBusy(false);
        updateCubeMeta();
      });
  }

  function buildFaceControls() {
    if (!ui.faceControls) return;
    var frag = document.createDocumentFragment();
    Core.FACE_ORDER.forEach(function (face) {
      var info = Core.FACE_INFO[face];
      var row = document.createElement('div');
      row.className = 'face-row';

      var label = document.createElement('span');
      label.className = 'face-label';
      label.style.setProperty('--face-color', info.color);
      label.appendChild(document.createTextNode(face));
      var em = document.createElement('em');
      em.textContent = info.name;
      label.appendChild(em);

      var btns = document.createElement('div');
      btns.className = 'face-btns';
      [1, -1, 2].forEach(function (turns) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-face';
        btn.style.setProperty('--face-color', info.color);
        btn.setAttribute('data-move', face);
        btn.setAttribute('data-turns', String(turns));
        btn.textContent = Core.moveId({ face: face, turns: turns });
        btn.title = '转动 ' + info.name + (turns === -1 ? '，逆时针 90°' : turns === 2 ? '，180°' : '，顺时针 90°');
        btn.addEventListener('click', function () { userMove({ face: face, turns: turns }); });
        btns.appendChild(btn);
      });

      row.appendChild(label);
      row.appendChild(btns);
      frag.appendChild(row);
    });
    ui.faceControls.appendChild(frag);
  }

  function scrambleCube() {
    runCommand('scramble', function () {
      queue.cancelPending();
      return queue.whenIdle().then(function () {
        var seq = Core.randomScramble(20, Math.random);
        var stepDur = reduceMotion ? 0 : Math.round(clamp(SPEEDS[speedName] * 0.32, 70, 130));
        toast('正在打乱 · 20 步');
        var chain = Promise.resolve();
        seq.forEach(function (move) {
          chain = chain.then(function () {
            return queue.exec(move, stepDur, { onCommit: pushHistory });
          });
        });
        return chain.then(function () {
          toast('打乱完成 · 试着把它复原吧');
        });
      });
    });
  }

  function resetCube() {
    runCommand('reset', function () {
      queue.cancelPending();
      return queue.whenIdle().then(function () {
        if (!history.length) {
          toast('魔方已经是复原状态');
          return;
        }
        if (history.length > 40) {
          view.hardReset();
          history.length = 0;
          updateCubeMeta();
          toast('步骤较多，已直接复原');
          return;
        }
        toast('正在复原 · 撤销 ' + history.length + ' 步');
        var seq = history.slice().reverse().map(Core.invertMove);
        var chain = Promise.resolve();
        seq.forEach(function (move) {
          chain = chain.then(function () {
            return queue.exec(move, reduceMotion ? 0 : Math.round(clamp(SPEEDS[speedName] * 0.36, 70, 130)), {
              onCommit: popHistory
            });
          });
        });
        return chain.then(function () {
          history.length = 0;
          updateCubeMeta();
          toast('已复原');
        });
      });
    });
  }

  function undoMove() {
    runCommand('undo', function () {
      queue.cancelPending();
      return queue.whenIdle().then(function () {
        if (!history.length) {
          toast('没有可撤销的步骤');
          return;
        }
        var last = history[history.length - 1];
        return queue.exec(Core.invertMove(last), durationFor(last), {
          onCommit: popHistory
        }).then(function () {
          toast('已撤销 ' + Core.moveId(last));
        });
      });
    });
  }

  function setSpeed(name) {
    if (!SPEEDS[name]) return;
    speedName = name;
    $$('button', ui.speedControl).forEach(function (btn) {
      var active = btn.getAttribute('data-speed') === name;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function initControls() {
    buildFaceControls();
    setSpeed('normal');

    if (ui.btnScramble) ui.btnScramble.addEventListener('click', scrambleCube);
    if (ui.btnReset) ui.btnReset.addEventListener('click', resetCube);
    if (ui.btnUndo) ui.btnUndo.addEventListener('click', undoMove);

    if (ui.speedControl) {
      ui.speedControl.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('button[data-speed]') : null;
        if (btn) setSpeed(btn.getAttribute('data-speed'));
      });
    }

    queue.onChange = updateQueueMeta;
    updateCubeMeta();
  }

  /* ================================================================
   * 5. 公式库
   * ================================================================ */

  var FORMULAS = [
    {
      id: 'cross',
      stage: '底层',
      name: '底层十字',
      en: 'WHITE CROSS',
      moves: "F' U' F",
      desc: '白十字是还原的起点：把 4 个带白色的棱块送到白色中心周围。以右前方那颗白色棱块为例，先用 F\' 把它送到顶层，再用 U\' 换个角度，最后用 F 把它送进正确的槽位。',
      tip: '实际还原时更推荐先做「小白花」，再对齐侧面中心整体压下去，观察会更直观。'
    },
    {
      id: 'first-corner',
      stage: '第一层',
      name: '第一层角块',
      en: 'FIRST LAYER CORNERS',
      moves: "R' D' R D",
      desc: '把含白色的角块放在目标槽位的正上方，反复执行 R\' D\' R D，直到角块落进底层、白色朝向底面。最多重复 6 次一定能让它归位。',
      tip: '中途白色朝向顶面时先别急，继续重复同一组动作，角块会自己「翻」回来。'
    },
    {
      id: 'second-layer',
      stage: '第二层',
      name: '第二层棱块',
      en: 'SECOND LAYER EDGES',
      moves: "U R U' R' U' F' U F",
      desc: '找一颗顶层不含黄色的棱块，转动顶层让它与侧面中心同色，再根据它要落向左前还是右前，用这套「右插」公式送进第二层。',
      tip: '如果棱块已经卡在第二层但方向反了，先用同一公式把它「顶出来」，再重新插入。'
    },
    {
      id: 'top-cross',
      stage: '顶层',
      name: '顶层十字',
      en: 'TOP CROSS',
      moves: "F R U R' U' F'",
      desc: '在顶面做出黄色十字。根据顶面黄块的形状重复执行，直到出现完整的十字；这是 OLL 里最常用的入门公式之一。',
      tip: '出现「一字」时横着放，「L 形」时放在左上角，往往一次就能出十字。'
    },
    {
      id: 'top-corner',
      stage: '顶层',
      name: '顶层角块',
      en: 'TOP CORNERS · SUNE',
      moves: "R U R' U R U2 R'",
      desc: '经典 Sune 公式：把顶面角块的黄色翻到朝上。根据黄角分布重复 1–3 次，就能让整个顶面都变成黄色。',
      tip: 'U2 表示顶层转 180°，也就是连续两个 90°，动画里会一次转到位。'
    },
    {
      id: 'top-edge',
      stage: '顶层',
      name: '顶层棱块',
      en: 'TOP EDGES · U-PERM',
      moves: "R U' R U R U R U' R' U' R2",
      desc: '最后一步调整顶层棱块的位置（U-Perm）：先把已经复原的那一面放到背面，执行公式交换剩余三组棱块。',
      tip: '如果四个棱都不在正确位置，先做一次公式，再换个角度重做一次即可。'
    }
  ];

  var demo = {
    playing: false,
    paused: false,
    stepping: false,
    animating: false,
    index: 0,
    token: 0,
    moves: [],
    tokenEls: []
  };
  var selectedFormula = null;

  var formulaUI = {
    list: $('#formulaList'),
    chip: $('#formulaStageChip'),
    title: $('#formulaTitle'),
    en: $('#formulaEn'),
    desc: $('#formulaDesc'),
    tokens: $('#formulaTokens'),
    stepLabel: $('#formulaStepLabel'),
    bar: $('#formulaProgressBar'),
    tip: $('#formulaTip'),
    play: $('#btnDemoPlay'),
    pause: $('#btnDemoPause'),
    step: $('#btnDemoStep'),
    replay: $('#btnDemoReplay')
  };

  function padIndex(n) { return (n < 10 ? '0' : '') + n; }

  function renderFormulaList() {
    if (!formulaUI.list) return;
    formulaUI.list.innerHTML = '';
    FORMULAS.forEach(function (formula, index) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'formula-card';
      card.setAttribute('data-id', formula.id);
      card.innerHTML =
        '<span class="fc-top"><span class="fc-index">ALG ' + padIndex(index + 1) + '</span>' +
        '<span class="fc-stage">' + formula.stage + '</span></span>' +
        '<span class="fc-name">' + formula.name + '</span>' +
        '<span class="fc-moves">' + formula.moves + '</span>';
      card.addEventListener('click', function () { selectFormula(formula.id); });
      formulaUI.list.appendChild(card);
    });

    // 补一条练习提示，填满卡片区并给出手把手的练习路径
    var hint = document.createElement('article');
    hint.className = 'formula-hint-card';
    hint.innerHTML =
      '<span class="fh-eyebrow">PRACTICE TIP</span>' +
      '<p>演示看节奏，实练记手感：到上方实验台把速度调成「慢速」，跟着高亮的 token 一步一步拧，再把速度调回标准。</p>';
    formulaUI.list.appendChild(hint);
  }

  function renderFormulaTokens(formula) {
    if (!formulaUI.tokens) return;
    formulaUI.tokens.innerHTML = '';
    demo.moves = Core.parseSequence(formula.moves);
    demo.tokenEls = demo.moves.map(function (move, i) {
      var span = document.createElement('span');
      span.className = 'token';
      span.textContent = Core.moveId(move);
      span.setAttribute('data-step', String(i + 1));
      formulaUI.tokens.appendChild(span);
      return span;
    });
  }

  function setDemoIndex(index) {
    var total = demo.moves.length;
    demo.index = clamp(index, 0, total);
    demo.tokenEls.forEach(function (el, i) {
      el.classList.toggle('is-done', i < demo.index);
      el.classList.toggle('is-active', i === demo.index && demo.index < total);
    });
    if (formulaUI.stepLabel) {
      formulaUI.stepLabel.textContent = demo.index + ' / ' + total;
    }
    if (formulaUI.bar) {
      formulaUI.bar.style.width = (total ? (demo.index / total) * 100 : 0) + '%';
    }
  }

  function updateDemoButtons() {
    if (formulaUI.play) {
      formulaUI.play.disabled = demo.playing || demo.stepping;
      formulaUI.play.textContent = demo.playing ? '演示中…' : '▶ 演示';
    }
    if (formulaUI.pause) {
      formulaUI.pause.disabled = !demo.playing;
      formulaUI.pause.textContent = demo.paused ? '继续' : '⏸ 暂停';
      formulaUI.pause.classList.toggle('is-playing', demo.paused);
    }
    if (formulaUI.step) formulaUI.step.disabled = demo.playing || demo.stepping;
    if (formulaUI.replay) formulaUI.replay.disabled = demo.stepping;
  }

  /** 停止演示；resetIndex=true 时同时把演示魔方复位到复原状态 */
  function stopDemo(resetIndex) {
    demo.token++;
    demo.playing = false;
    demo.paused = false;
    demo.stepping = false;
    if (resetIndex) {
      setDemoIndex(0);
      demoView.hardReset();
    }
    updateDemoButtons();
  }

  function selectFormula(id) {
    var formula = FORMULAS.filter(function (f) { return f.id === id; })[0];
    if (!formula) return;
    selectedFormula = formula;
    stopDemo(true);
    if (formulaUI.chip) formulaUI.chip.textContent = formula.stage;
    if (formulaUI.title) formulaUI.title.textContent = formula.name;
    if (formulaUI.en) formulaUI.en.textContent = formula.en;
    if (formulaUI.desc) formulaUI.desc.textContent = formula.desc;
    if (formulaUI.tip) formulaUI.tip.textContent = formula.tip;
    renderFormulaTokens(formula);
    setDemoIndex(0);
    $$('.formula-card', formulaUI.list).forEach(function (card) {
      card.classList.toggle('is-active', card.getAttribute('data-id') === id);
    });
    updateDemoButtons();
  }

  function demoDurationFor(move) {
    return reduceMotion ? 0 : (move.turns === 2 ? 640 : 400);
  }

  /** 演示某条公式；fromStart=true 时先复位演示魔方再从第一步播放 */
  function playDemo(fromStart) {
    if (!demo.moves.length) return;
    stopDemo(false);
    var token = ++demo.token;
    var start = demo.index;
    if (fromStart || start >= demo.moves.length) {
      demoView.hardReset();
      start = 0;
    }
    demo.playing = true;
    demo.paused = false;
    setDemoIndex(start);
    updateDemoButtons();
    stepLoop(token, start);
  }

  function stepLoop(token, start) {
    var moves = demo.moves.slice();
    function next(i) {
      if (demo.token !== token) return;
      if (i >= moves.length) {
        demo.playing = false;
        demo.animating = false;
        updateDemoButtons();
        toast('演示结束 · ' + (selectedFormula ? selectedFormula.name : ''));
        return;
      }
      if (demo.paused) {
        setTimeout(function () { next(i); }, 90);
        return;
      }
      setDemoIndex(i);
      demo.animating = true;
      demoView.animateMove(moves[i], demoDurationFor(moves[i])).then(function () {
        demo.animating = false;
        if (demo.token !== token) return;
        setDemoIndex(i + 1);
        next(i + 1);
      });
    }
    next(clamp(start, 0, moves.length));
  }

  function toggleDemoPause() {
    if (!demo.playing) return;
    demo.paused = !demo.paused;
    updateDemoButtons();
    toast(demo.paused ? '已暂停 · 点「继续」恢复' : '继续演示');
  }

  /** 单步前进：需要从复原状态开始时自动复位演示魔方 */
  function stepDemoOnce() {
    if (demo.playing || demo.stepping) return;
    if (!demo.moves.length) return;
    if (demo.index >= demo.moves.length || demo.index === 0) {
      demoView.hardReset();
      setDemoIndex(0);
    }
    var token = ++demo.token;
    var idx = demo.index;
    demo.stepping = true;
    setDemoIndex(idx);
    updateDemoButtons();
    demoView.animateMove(demo.moves[idx], demoDurationFor(demo.moves[idx])).then(function () {
      demo.stepping = false;
      if (demo.token === token) {
        setDemoIndex(idx + 1);
        updateDemoButtons();
      }
    });
  }

  function initFormulas() {
    renderFormulaList();
    $$('.formula-card', formulaUI.list).forEach(function (card) { card.classList.add('is-active'); });
    if (formulaUI.play) formulaUI.play.addEventListener('click', function () { playDemo(false); });
    if (formulaUI.pause) formulaUI.pause.addEventListener('click', toggleDemoPause);
    if (formulaUI.step) formulaUI.step.addEventListener('click', stepDemoOnce);
    if (formulaUI.replay) formulaUI.replay.addEventListener('click', function () { playDemo(true); });
    selectFormula(FORMULAS[0].id);
  }

  /* ================================================================
   * 6. 计时器
   * ================================================================ */

  var Timer = (function () {
    var STORAGE_KEY = 'zju-moa-lab-times-v1';
    var state = 'idle'; // idle | observing | running
    var times = [];
    var scramble = [];
    var rafId = 0;
    var runStart = 0;
    var inspectEnd = 0;
    var storageOk = true;
    var opts = {};
    var els = {};
    var lastResult = null;

    function cache() {
      els.state = $('#timerState');
      els.badge = $('#timerBadge');
      els.display = $('#timerDisplay');
      els.primary = $('#btnTimerPrimary');
      els.inspect = $('#btnTimerInspect');
      els.scramble = $('#btnTimerScramble');
      els.scrambleText = $('#timerScramble');
      els.sync = $('#btnSyncCube');
      els.best = $('#statBest');
      els.ao5 = $('#statAo5');
      els.count = $('#statCount');
      els.list = $('#timeList');
      els.clear = $('#btnClearTimes');
      els.note = $('#timeListNote');
    }

    function loadTimes() {
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return Core.trimTimes(parsed, 100);
      } catch (err) {
        storageOk = false;
        return [];
      }
    }

    function saveTimes() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(times.slice(0, 100)));
        storageOk = true;
      } catch (err) {
        storageOk = false;
      }
      renderNote();
    }

    function renderNote() {
      if (!els.note) return;
      els.note.textContent = storageOk
        ? '成绩保存在本机浏览器（localStorage），换设备不会同步。'
        : '当前浏览器禁用了本地存储，成绩只在本次页面中保留。';
    }

    function renderScramble() {
      if (!els.scrambleText) return;
      els.scrambleText.innerHTML = '';
      scramble.forEach(function (move) {
        var span = document.createElement('span');
        span.className = 'sc-token';
        span.textContent = Core.moveId(move);
        els.scrambleText.appendChild(span);
      });
    }

    function newScramble() {
      scramble = Core.randomScramble(20, Math.random);
      renderScramble();
    }

    function renderStats() {
      var best = Core.bestOf(times);
      var ao5 = Core.averageOf5(times);
      if (els.best) els.best.textContent = best == null ? '--' : Core.formatTime(best);
      if (els.ao5) els.ao5.textContent = ao5 == null ? '--' : Core.formatTime(ao5);
      if (els.count) els.count.textContent = String(times.length);

      if (!els.list) return;
      els.list.innerHTML = '';
      if (!times.length) {
        var empty = document.createElement('li');
        empty.className = 'time-list-empty';
        empty.textContent = '还没有成绩。按「开始计时」或空格，完成第一次速拧吧。';
        els.list.appendChild(empty);
        return;
      }
      var bestMarked = false;
      times.slice(0, 12).forEach(function (ms, i) {
        var li = document.createElement('li');
        li.className = 'time-row';
        var isBest = best != null && ms === best && !bestMarked;
        if (isBest) bestMarked = true;
        if (i === 0) li.classList.add('is-latest');
        if (isBest) li.classList.add('is-best');

        var index = document.createElement('span');
        index.className = 'tr-index';
        index.textContent = '#' + (times.length - i);

        var tag = document.createElement('span');
        tag.className = 'tr-tag';
        tag.textContent = i === 0 ? '最新' : (isBest ? 'PB' : '');

        var time = document.createElement('span');
        time.className = 'tr-time';
        time.textContent = Core.formatTime(ms);

        li.appendChild(index);
        li.appendChild(tag);
        li.appendChild(time);
        els.list.appendChild(li);
      });
    }

    function setState(next) {
      state = next;
      updateUI();
    }

    function updateUI() {
      var running = state === 'running';
      var observing = state === 'observing';

      if (els.display) {
        els.display.classList.toggle('is-running', running);
        els.display.classList.toggle('is-inspecting', observing);
        els.display.classList.toggle('is-stopped', state === 'idle' && lastResult != null);
      }
      if (els.badge) {
        els.badge.classList.toggle('is-running', running);
        els.badge.classList.toggle('is-inspecting', observing);
        els.badge.textContent = running ? 'SOLVING' : observing ? 'INSPECT' : 'READY';
      }
      if (els.state) {
        els.state.textContent = running
          ? '计时中 · 按空格或按钮停止'
          : observing
            ? '15 秒观察中 · 按空格直接开始'
            : lastResult != null && state === 'idle'
              ? '完成 ' + Core.formatTime(lastResult) + ' · 按空格开始下一次'
              : '准备就绪 · 按空格开始';
      }
      if (els.primary) {
        els.primary.textContent = running ? '停止计时' : observing ? '跳过观察并开始' : '开始计时';
        els.primary.disabled = false;
      }
      if (els.inspect) {
        els.inspect.textContent = observing ? '跳过观察' : '15 秒观察';
        els.inspect.disabled = running;
      }
      if (els.scramble) els.scramble.disabled = running;
      if (els.sync) els.sync.disabled = running;
      if (els.clear) els.clear.disabled = running;
    }

    function tickSolve() {
      if (state !== 'running') return;
      if (els.display) els.display.textContent = Core.formatTime(performance.now() - runStart);
      rafId = requestAnimationFrame(tickSolve);
    }

    function beginSolve() {
      cancelAnimationFrame(rafId);
      lastResult = null;
      setState('running');
      runStart = performance.now();
      if (els.display) els.display.textContent = '0.00';
      rafId = requestAnimationFrame(tickSolve);
    }

    function stopSolve() {
      if (state !== 'running') return;
      var ms = Math.round(performance.now() - runStart);
      cancelAnimationFrame(rafId);
      rafId = 0;
      var prevBest = Core.bestOf(times);
      var isPB = prevBest == null || ms < prevBest;
      lastResult = ms;
      times.unshift(ms);
      times = Core.trimTimes(times, 100);
      saveTimes();
      setState('idle');
      if (els.display) {
        els.display.textContent = Core.formatTime(ms);
        els.display.classList.remove('is-flash');
        void els.display.offsetWidth;
        els.display.classList.add('is-flash');
      }
      renderStats();
      newScramble();
      toast(isPB ? '完成 · ' + Core.formatTime(ms) + ' · 新的个人最佳！' : '完成 · ' + Core.formatTime(ms));
    }

    function tickInspection() {
      if (state !== 'observing') return;
      var left = Math.max(0, inspectEnd - performance.now());
      if (els.display) els.display.textContent = (left / 1000).toFixed(1);
      if (left <= 0) {
        endInspection(true);
        return;
      }
      rafId = requestAnimationFrame(tickInspection);
    }

    function startInspection() {
      if (state === 'running') {
        toast('计时中不能进入观察');
        return;
      }
      if (state === 'observing') return;
      cancelAnimationFrame(rafId);
      lastResult = null;
      inspectEnd = performance.now() + 15000;
      setState('observing');
      tickInspection();
    }

    function endInspection(auto) {
      if (state !== 'observing') return;
      cancelAnimationFrame(rafId);
      rafId = 0;
      setState('idle');
      if (els.display) els.display.textContent = '0.00';
      if (auto) toast('观察结束 · 按空格开始计时');
    }

    function cancelInspection() {
      if (state !== 'observing') return;
      cancelAnimationFrame(rafId);
      rafId = 0;
      setState('idle');
      if (els.display) els.display.textContent = '0.00';
      toast('已取消观察');
    }

    function primaryAction() {
      if (state === 'running') {
        stopSolve();
      } else if (state === 'observing') {
        beginSolve();
      } else {
        beginSolve();
      }
    }

    function clearTimes() {
      if (state === 'running') return;
      if (!times.length) {
        toast('暂时还没有成绩');
        return;
      }
      times = [];
      lastResult = null;
      saveTimes();
      renderStats();
      setState('idle');
      if (els.display) els.display.textContent = '0.00';
      toast('成绩已清空');
    }

    function bind() {
      if (els.primary) els.primary.addEventListener('click', primaryAction);
      if (els.inspect) {
        els.inspect.addEventListener('click', function () {
          if (state === 'observing') beginSolve();
          else startInspection();
        });
      }
      if (els.scramble) {
        els.scramble.addEventListener('click', function () {
          if (state === 'running') return;
          newScramble();
          toast('已生成新的打乱');
        });
      }
      if (els.sync) {
        els.sync.addEventListener('click', function () {
          if (state === 'running') return;
          if (typeof opts.onSyncToCube === 'function') opts.onSyncToCube(scramble.slice());
        });
      }
      if (els.clear) els.clear.addEventListener('click', clearTimes);
    }

    return {
      init: function (options) {
        opts = options || {};
        cache();
        times = loadTimes();
        renderNote();
        bind();
        newScramble();
        renderStats();
        updateUI();
        if (storageOk && times.length) {
          // 恢复历史成绩后，让状态栏知道最近一次成绩
          lastResult = null;
        }
      },
      primaryAction: primaryAction,
      cancelInspection: cancelInspection,
      startInspection: startInspection,
      getState: function () { return state; },
      getTimes: function () { return times.slice(); },
      getScramble: function () { return scramble.slice(); },
      clearTimes: clearTimes
    };
  })();

  /** 把计时器当前打乱同步到 3D 魔方：先复位，再逐步打乱 */
  function syncTimerScrambleToCube(seq) {
    runCommand('sync-scramble', function () {
      queue.cancelPending();
      return queue.whenIdle().then(function () {
        view.hardReset();
        history.length = 0;
        updateCubeMeta();
        var chain = Promise.resolve();
        seq.forEach(function (move) {
          chain = chain.then(function () {
            return queue.exec(move, reduceMotion ? 0 : 85, { onCommit: pushHistory });
          });
        });
        return chain.then(function () {
          updateCubeMeta();
          toast('已同步打乱 · 魔方进入同一条打乱');
        });
      });
    });
  }

  /* ================================================================
   * 7. 记号说明
   * ================================================================ */

  var MINI_FACE_DEFS = [
    { key: 'U', cls: 'mf-u' },
    { key: 'D', cls: 'mf-d' },
    { key: 'L', cls: 'mf-l' },
    { key: 'R', cls: 'mf-r' },
    { key: 'F', cls: 'mf-f' },
    { key: 'B', cls: 'mf-b' }
  ];

  function buildNotation() {
    var grid = $('#notationGrid');
    if (!grid) return;
    var frag = document.createDocumentFragment();

    Core.FACE_ORDER.forEach(function (letter) {
      var info = Core.FACE_INFO[letter];
      var card = document.createElement('article');
      card.className = 'notation-card';
      card.setAttribute('data-face', letter);

      var mini = document.createElement('div');
      mini.className = 'mini-stage';
      mini.setAttribute('aria-hidden', 'true');
      var miniCube = document.createElement('div');
      miniCube.className = 'mini-cube';
      MINI_FACE_DEFS.forEach(function (def) {
        var miniFace = document.createElement('div');
        miniFace.className = 'mini-face ' + def.cls;
        miniFace.style.setProperty('--c', Core.FACE_INFO[def.key].color);
        if (def.key === letter) miniFace.classList.add('is-target');
        miniCube.appendChild(miniFace);
      });
      mini.appendChild(miniCube);
      var turn = document.createElement('span');
      turn.className = 'mini-turn';
      turn.textContent = '↻ 90°';
      mini.appendChild(turn);

      var body = document.createElement('div');
      body.className = 'notation-body';
      body.innerHTML =
        '<div class="notation-letter">' + letter + '<small>' + info.name + '</small></div>' +
        '<p class="notation-desc">' + info.look + '，顺时针转 90°。</p>' +
        '<div class="notation-variants"><span>' + letter + "' 逆时针</span><span>" + letter + '2 180°</span></div>';

      card.appendChild(mini);
      card.appendChild(body);
      frag.appendChild(card);
    });

    grid.appendChild(frag);
  }

  function buildSexyTokens() {
    var wrap = $('#sexyTokens');
    if (!wrap) return;
    Core.parseSequence("R U R' U'").forEach(function (move) {
      var span = document.createElement('span');
      span.className = 'token';
      span.textContent = Core.moveId(move);
      wrap.appendChild(span);
    });
  }

  function demoSequenceOnCube(seq, label) {
    runCommand('demo-sequence', function () {
      queue.cancelPending();
      return queue.whenIdle().then(function () {
        var chain = Promise.resolve();
        seq.forEach(function (move) {
          chain = chain.then(function () {
            return queue.exec(move, reduceMotion ? 0 : 420, { onCommit: pushHistory });
          });
        });
        return chain.then(function () { toast('演示完成 · ' + label); });
      });
    });
  }

  function initNotation() {
    buildNotation();
    buildSexyTokens();
    var btn = $('#btnDemoSexy');
    if (btn) {
      btn.addEventListener('click', function () {
        demoSequenceOnCube(Core.parseSequence("R U R' U'"), 'R U R\' U\'');
      });
    }
  }

  /* ================================================================
   * 8. 键盘 / 尺寸变化 / 初始化
   * ================================================================ */

  function handleKeydown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      Timer.primaryAction();
      return;
    }
    if (e.key === 'Escape') {
      Timer.cancelInspection();
      return;
    }
    var letter = String(e.key || '').toUpperCase();
    if (letter.length === 1 && Core.FACE_INFO[letter]) {
      e.preventDefault();
      userMove({ face: letter, turns: e.shiftKey ? -1 : 1 });
    }
  }

  function initResize() {
    var timer = 0;
    function refit() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        view.fit();
        demoView.fit();
      }, 120);
    }
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    if (window.ResizeObserver) {
      try {
        var ro = new ResizeObserver(refit);
        ro.observe(view.viewport);
        ro.observe(demoView.viewport);
      } catch (err) { /* 忽略 */ }
    }
  }

  function init() {
    initControls();
    initFormulas();
    Timer.init({ onSyncToCube: syncTimerScrambleToCube });
    initNotation();
    initResize();
    document.addEventListener('keydown', handleKeydown);

    updateCubeMeta();

    // 初始 fit + 入场视角（fit 也会触发 renderAll）
    view.fit();
    demoView.fit();
    setTimeout(function () { view.intro(); }, 30);

    // 调试接口：便于自动化测试 / 控制台排查（不参与业务逻辑）
    window.__LAB__ = {
      core: Core,
      view: view,
      demoView: demoView,
      queue: queue,
      timer: Timer,
      formulas: FORMULAS,
      selectedFormula: function () { return selectedFormula; },
      getHistory: function () { return history.slice(); },
      isSolved: function () { return Core.isSolved(view.cube); },
      isDemoSolved: function () { return Core.isSolved(demoView.cube); },
      isCommandBusy: function () { return commandBusy; },
      demoState: function () {
        return {
          playing: demo.playing,
          paused: demo.paused,
          stepping: demo.stepping,
          index: demo.index,
          total: demo.moves.length
        };
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
