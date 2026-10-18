/* =========================================================
   浙大魔协 · hero-cube.js
   3D 魔方拖拽 / 星空 canvas / 鼠标聚光
   ========================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 1. 3D 魔方 ---------------- */
  var cube = document.getElementById('heroCube');
  var scene = document.getElementById('cubeScene');

  if (cube) {
    var faceDefs = [
      { cls: 'f-front', color: 'c0' },
      { cls: 'f-back', color: 'c1' },
      { cls: 'f-right', color: 'c2' },
      { cls: 'f-left', color: 'c3' },
      { cls: 'f-top', color: 'c4' },
      { cls: 'f-bottom', color: 'c5' }
    ];

    if (!cube.querySelector('.cube-face')) {
      faceDefs.forEach(function (def) {
        var face = document.createElement('div');
        face.className = 'cube-face ' + def.cls;
        for (var i = 0; i < 9; i++) {
          var sticker = document.createElement('div');
          sticker.className = 'sticker ' + def.color;
          face.appendChild(sticker);
        }
        cube.appendChild(face);
      });
    }

    var curX = -24;
    var curY = -34;
    var tgtX = curX;
    var tgtY = curY;
    var velX = 0;
    var velY = 0;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    var prevFrame = performance.now();
    var autoSpeed = reduceMotion ? 0 : 0.055;

    cube.style.transform = 'rotateX(' + curX + 'deg) rotateY(' + curY + 'deg)';

    function clampPitch(value) {
      return Math.max(-68, Math.min(68, value));
    }

    function loop(now) {
      var dt = Math.min(3, Math.max(0.2, (now - prevFrame) / 16.667));
      prevFrame = now;

      if (!dragging) {
        tgtY += autoSpeed * dt + velY * dt;
        tgtX = clampPitch(tgtX + velX * dt);
        velX *= Math.pow(0.94, dt);
        velY *= Math.pow(0.94, dt);
      }

      var ease = Math.min(1, 0.11 * dt);
      curX += (tgtX - curX) * ease;
      curY += (tgtY - curY) * ease;
      cube.style.transform = 'rotateX(' + curX.toFixed(2) + 'deg) rotateY(' + curY.toFixed(2) + 'deg)';

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    if (scene) {
      scene.addEventListener('pointerdown', function (event) {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        velX = 0;
        velY = 0;
        scene.setPointerCapture && scene.setPointerCapture(event.pointerId);
      });

      scene.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        var dx = event.clientX - lastX;
        var dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        tgtY += dx * 0.42;
        tgtX = clampPitch(tgtX - dy * 0.38);
        velY = dx * 0.24;
        velX = -dy * 0.2;
      });

      function endDrag(event) {
        if (!dragging) return;
        dragging = false;
        if (scene.releasePointerCapture && event && event.pointerId !== undefined) {
          try { scene.releasePointerCapture(event.pointerId); } catch (err) { /* noop */ }
        }
      }
      scene.addEventListener('pointerup', endDrag);
      scene.addEventListener('pointercancel', endDrag);
      scene.addEventListener('lostpointercapture', function () { dragging = false; });
    }
  }

  /* ---------------- 2. 星空 canvas ---------------- */
  var canvas = document.getElementById('starfield');
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var stars = [];
    var rafId = null;
    var lastDraw = 0;
    var starTimer = 0;
    var running = true;

    function buildStars() {
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(1, rect.width);
      var h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var count = Math.min(170, Math.max(45, Math.round((w * h) / 11000)));
      stars = [];
      for (var i = 0; i < count; i++) {
        var warm = Math.random() < 0.14;
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.4 + 0.3,
          a: Math.random() * 0.5 + 0.15,
          tw: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.22 + 0.04,
          warm: warm,
          big: Math.random() < 0.06
        });
      }
    }

    function paint(time) {
      var rect = canvas.getBoundingClientRect();
      var w = rect.width;
      var h = rect.height;
      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (!reduceMotion) {
          s.y += s.speed * 0.35;
          s.tw += 0.012;
          if (s.y > h + 4) { s.y = -4; s.x = Math.random() * w; }
        }
        var alpha = reduceMotion ? s.a : s.a * (0.62 + 0.38 * Math.sin(s.tw + time * 0.0006));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.big ? s.r * 1.5 : s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.warm
          ? 'rgba(245, 194, 107, ' + alpha.toFixed(3) + ')'
          : 'rgba(246, 242, 255, ' + alpha.toFixed(3) + ')';
        ctx.fill();

        if (s.big) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3.4, 0, Math.PI * 2);
          ctx.fillStyle = s.warm
            ? 'rgba(245, 194, 107, ' + (alpha * 0.09).toFixed(3) + ')'
            : 'rgba(139, 108, 255, ' + (alpha * 0.09).toFixed(3) + ')';
          ctx.fill();
        }
      }
    }

    function frame(time) {
      if (!running) return;
      if (time - lastDraw > 32) {
        paint(time);
        lastDraw = time;
      }
      rafId = requestAnimationFrame(frame);
    }

    buildStars();
    paint(0);
    if (!reduceMotion) rafId = requestAnimationFrame(frame);

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        buildStars();
        paint(0);
      }, 160);
    });

    var heroSection = document.querySelector('.hero');
    if (heroSection && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        var entry = entries[0];
        if (!entry) return;
        running = entry.isIntersecting;
        if (running && !reduceMotion && rafId === null) {
          lastDraw = 0;
          rafId = requestAnimationFrame(frame);
        }
        if (!running && rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      }, { threshold: 0 }).observe(heroSection);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      } else if (!reduceMotion) {
        running = true;
        lastDraw = 0;
        rafId = requestAnimationFrame(frame);
      }
    });
  }

  /* ---------------- 3. 鼠标聚光 ---------------- */
  var hero = document.querySelector('.hero');
  if (hero && window.matchMedia('(pointer: fine)').matches) {
    var spotPending = false;
    var spotX = 0;
    var spotY = 0;

    hero.addEventListener('pointermove', function (event) {
      var rect = hero.getBoundingClientRect();
      spotX = ((event.clientX - rect.left) / rect.width) * 100;
      spotY = ((event.clientY - rect.top) / rect.height) * 100;
      if (spotPending) return;
      spotPending = true;
      requestAnimationFrame(function () {
        hero.style.setProperty('--mx', spotX.toFixed(2) + '%');
        hero.style.setProperty('--my', spotY.toFixed(2) + '%');
        spotPending = false;
      });
    });
  }
})();
