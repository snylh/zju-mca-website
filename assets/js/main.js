/* =========================================================
   浙大魔协 · main.js
   导航 / 滚动动效 / 筛选 / 弹窗 / FAQ / 互动魔术 / 彩蛋
   ========================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (selector, scope) { return (scope || document).querySelector(selector); };
  var $$ = function (selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); };

  /* ---------------- 0. 工具 ---------------- */
  var toastTimer = null;
  function showToast(message) {
    var toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('is-show');
    }, 2800);
  }

  /* ---------------- 1. 预加载 ---------------- */
  var preloader = $('#preloader');
  var startedAt = Date.now();
  function hidePreloader() {
    if (!preloader) return;
    var wait = Math.max(0, 620 - (Date.now() - startedAt));
    window.setTimeout(function () {
      preloader.classList.add('is-done');
      window.setTimeout(function () {
        preloader.setAttribute('hidden', '');
      }, 800);
    }, wait);
  }
  if (document.readyState === 'complete') {
    hidePreloader();
  } else {
    window.addEventListener('load', hidePreloader);
    window.setTimeout(hidePreloader, 3800); // 兜底
  }

  /* ---------------- 2. 页头与滚动进度 ---------------- */
  var header = $('#siteHeader');
  var progress = $('#scrollProgress');
  var timeline = $('#timeline');
  var timelineFill = $('#timelineFill');
  var sectionIds = ['about', 'activities', 'history', 'stars', 'lab', 'theater', 'join', 'faq'];
  var navLinks = $$('.site-nav a[href^="#"]');
  var ticking = false;

  function updateScrollUI() {
    var y = window.scrollY || window.pageYOffset;

    if (header) {
      header.classList.toggle('is-scrolled', y > 36);
    }

    if (progress) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      progress.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
    }

    // 当前所在章节
    var anchor = y + window.innerHeight * 0.34;
    var currentId = '';
    for (var i = 0; i < sectionIds.length; i++) {
      var section = document.getElementById(sectionIds[i]);
      if (section && section.offsetTop <= anchor) currentId = sectionIds[i];
    }
    navLinks.forEach(function (link) {
      var matches = link.getAttribute('href') === '#' + currentId;
      if (matches) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });

    // 时间线填充
    if (timeline && timelineFill) {
      var rect = timeline.getBoundingClientRect();
      var center = window.innerHeight * 0.58;
      var percent = (center - rect.top) / rect.height;
      percent = Math.max(0, Math.min(1, percent));
      timelineFill.style.height = (percent * 100).toFixed(2) + '%';
    }

    ticking = false;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateScrollUI);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  updateScrollUI();

  /* ---------------- 3. 移动端导航 ---------------- */
  var navToggle = $('#navToggle');
  var siteNav = $('#siteNav');

  function closeNav() {
    if (!navToggle || !siteNav) return;
    navToggle.classList.remove('is-open');
    siteNav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', '打开菜单');
    document.body.classList.remove('nav-open');
  }

  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      var isOpen = navToggle.classList.toggle('is-open');
      siteNav.classList.toggle('is-open', isOpen);
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      navToggle.setAttribute('aria-label', isOpen ? '关闭菜单' : '打开菜单');
      document.body.classList.toggle('nav-open', isOpen);
    });

    $$('a', siteNav).forEach(function (link) {
      link.addEventListener('click', closeNav);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeNav();
    });

    document.addEventListener('click', function (event) {
      if (!siteNav.classList.contains('is-open')) return;
      if (siteNav.contains(event.target) || navToggle.contains(event.target)) return;
      closeNav();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 900) closeNav();
    });
  }

  /* ---------------- 4. 滚动显现 ---------------- */
  var revealItems = $$('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    revealItems.forEach(function (item) {
      var parent = item.parentElement;
      if (parent) {
        var siblings = $$('.reveal', parent).filter(function (el) { return el.parentElement === parent; });
        var index = siblings.indexOf(item);
        if (index > 0) item.style.setProperty('--delay', Math.min(index * 0.07, 0.28).toFixed(2) + 's');
      }
      revealObserver.observe(item);
    });
  } else {
    revealItems.forEach(function (item) { item.classList.add('is-in'); });
  }

  /* ---------------- 5. 数字滚动 ---------------- */
  var counters = $$('[data-count]');
  function animateCounter(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    var target = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (reduceMotion) { el.textContent = String(target); return; }
    var start = target > 1900 ? target - 80 : 0;
    var duration = 1500;
    var begin = null;

    function step(timestamp) {
      if (begin === null) begin = timestamp;
      var p = Math.min(1, (timestamp - begin) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(start + (target - start) * eased));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { counterObserver.observe(el); });
  } else {
    counters.forEach(animateCounter);
  }

  /* ---------------- 6. 活动筛选 ---------------- */
  var filterButtons = $$('.filter-btn');
  var eventCards = $$('.event-card');
  filterButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var filter = button.getAttribute('data-filter');
      filterButtons.forEach(function (btn) {
        var active = btn === button;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      eventCards.forEach(function (card) {
        var cats = (card.getAttribute('data-cat') || '').split(/\s+/);
        var show = filter === 'all' || cats.indexOf(filter) !== -1;
        card.classList.toggle('is-hidden', !show);
      });
    });
  });

  /* ---------------- 7. 活动详情弹窗 ---------------- */
  $$('.event-media img').forEach(function (img) {
    function markMissing() {
      img.classList.add('is-missing');
      img.setAttribute('aria-hidden', 'true');
    }
    img.addEventListener('error', markMissing);
    if (img.complete && img.naturalWidth === 0) markMissing();
  });

  var detailDialog = $('#detailDialog');
  var detailImg = $('#detailImg');
  var detailTag = $('#detailTag');
  var detailTitle = $('#detailTitle');
  var detailDesc = $('#detailDesc');
  var detailPoints = $('#detailPoints');

  function openDetail(card) {
    if (!detailDialog || typeof detailDialog.showModal !== 'function') return;
    var title = card.getAttribute('data-title') || '';
    var tag = card.getAttribute('data-tag') || '';
    var desc = card.getAttribute('data-desc') || '';
    var points = (card.getAttribute('data-points') || '').split('||').filter(Boolean);
    var img = card.getAttribute('data-img') || '';
    var altImg = $('img', card);

    if (detailImg) {
      detailImg.src = img;
      detailImg.alt = (altImg && altImg.alt) || title;
    }
    if (detailTag) detailTag.textContent = tag;
    if (detailTitle) detailTitle.textContent = title;
    if (detailDesc) detailDesc.textContent = desc;
    if (detailPoints) {
      detailPoints.innerHTML = '';
      points.forEach(function (point) {
        var li = document.createElement('li');
        li.textContent = point;
        detailPoints.appendChild(li);
      });
    }
    detailDialog.showModal();
    document.body.classList.add('dialog-open');
  }

  eventCards.forEach(function (card) {
    var trigger = $('.event-media', card);
    if (trigger) {
      trigger.addEventListener('click', function () { openDetail(card); });
    }
  });

  function bindDialog(dialog) {
    if (!dialog) return;
    $$('[data-close-dialog]', dialog).forEach(function (btn) {
      btn.addEventListener('click', function () { dialog.close(); });
    });
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', function () {
      document.body.classList.remove('dialog-open');
    });
  }
  bindDialog(detailDialog);
  bindDialog($('#sourcesDialog'));

  var sourcesOpen = $('#sourcesOpen');
  var sourcesDialog = $('#sourcesDialog');
  if (sourcesOpen && sourcesDialog && typeof sourcesDialog.showModal === 'function') {
    sourcesOpen.addEventListener('click', function () {
      sourcesDialog.showModal();
      document.body.classList.add('dialog-open');
    });
  }

  /* ---------------- 8. FAQ 手风琴 ---------------- */
  var faqItems = $$('.faq-item');

  function setFaqState(item, open) {
    item.classList.toggle('is-open', open);
    var button = $('.faq-question', item);
    var answer = $('.faq-answer', item);
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (answer) {
      answer.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) answer.removeAttribute('inert');
      else answer.setAttribute('inert', '');
    }
  }

  faqItems.forEach(function (item) {
    var question = $('.faq-question', item);
    if (!question) return;
    setFaqState(item, false);
    question.addEventListener('click', function () {
      var willOpen = !item.classList.contains('is-open');
      faqItems.forEach(function (other) { setFaqState(other, false); });
      if (willOpen) setFaqState(item, true);
    });
  });

  /* ---------------- 9. 星光榜滚动暂停 ---------------- */
  var starsMarquee = $('#starsMarquee');
  var starsToggle = $('#starsToggle');
  if (starsMarquee && starsToggle) {
    starsToggle.addEventListener('click', function () {
      var paused = starsMarquee.classList.toggle('is-paused');
      starsToggle.setAttribute('aria-pressed', paused ? 'true' : 'false');
      starsToggle.textContent = paused ? '继续滚动' : '暂停滚动';
    });
  }

  /* ---------------- 10. 互动魔术：三张牌 ---------------- */
  var trick = $('#trick');
  var trickCards = $$('.trick-card');
  var predictionText = $('#predictionText');
  var trickResult = $('#trickResult');
  var trickReset = $('#trickReset');

  if (trick && trickCards.length) {
    var picked = false;

    trickCards.forEach(function (card) {
      card.addEventListener('click', function () {
        if (picked) return;
        picked = true;
        card.classList.add('is-flipped');
        trick.classList.add('is-revealed');
        if (predictionText) predictionText.textContent = '预言成真：红桃 A';
        trickCards.forEach(function (other) {
          if (other !== card) other.disabled = true;
        });
        window.setTimeout(function () {
          trickCards.forEach(function (other) { other.classList.add('is-flipped'); });
          trickCards.forEach(function (other) { other.disabled = true; });
          if (trickResult) {
            trickResult.textContent = '三张，都是红桃 A。魔术，就是让你在以为有选择的地方，看见惊喜。';
          }
        }, reduceMotion ? 120 : 620);
      });
    });

    if (trickReset) {
      trickReset.addEventListener('click', function () {
        picked = false;
        trick.classList.remove('is-revealed');
        trickCards.forEach(function (card) {
          card.classList.remove('is-flipped');
          card.disabled = true;
        });
        if (predictionText) predictionText.textContent = '你选的，会是红桃 A';
        if (trickResult) trickResult.textContent = '';
        window.setTimeout(function () {
          trickCards.forEach(function (card) { card.disabled = false; });
        }, reduceMotion ? 60 : 480);
      });
    }
  }

  /* ---------------- 11. 复制公众号 ---------------- */
  var copyWechat = $('#copyWechat');
  if (copyWechat) {
    copyWechat.addEventListener('click', function () {
      var text = copyWechat.getAttribute('data-copy') || '浙大魔协';
      function done() { showToast('已复制「' + text + '」，去微信搜索吧 ✦'); }
      function fallback() {
        try {
          var area = document.createElement('textarea');
          area.value = text;
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          document.body.removeChild(area);
          done();
        } catch (err) {
          showToast('请手动在微信搜索：' + text);
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }
    });
  }

  /* ---------------- 12. 回到顶部 & 年份 ---------------- */
  var backToTop = $('#backToTop');
  if (backToTop) {
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------------- 13. 自定义光标 ---------------- */
  var cursorDot = $('#cursorDot');
  var cursorRing = $('#cursorRing');
  var finePointer = window.matchMedia('(pointer: fine)').matches;
  if (finePointer && !reduceMotion && cursorDot && cursorRing) {
    document.documentElement.classList.add('has-cursor');
    var mouseX = window.innerWidth / 2;
    var mouseY = window.innerHeight / 2;
    var ringX = mouseX;
    var ringY = mouseY;

    document.addEventListener('pointermove', function (event) {
      mouseX = event.clientX;
      mouseY = event.clientY;
      cursorDot.style.transform = 'translate3d(' + mouseX + 'px,' + mouseY + 'px,0) translate(-50%,-50%)';
    }, { passive: true });

    (function ringLoop() {
      ringX += (mouseX - ringX) * 0.16;
      ringY += (mouseY - ringY) * 0.16;
      cursorRing.style.transform = 'translate3d(' + ringX.toFixed(1) + 'px,' + ringY.toFixed(1) + 'px,0) translate(-50%,-50%)';
      requestAnimationFrame(ringLoop);
    })();

    var hoverTargets = 'a, button, .event-media, .trick-card, .faq-question, .filter-btn, .copy-chip';
    document.addEventListener('pointerover', function (event) {
      if (event.target.closest && event.target.closest(hoverTargets)) {
        document.documentElement.classList.add('is-hovering');
      }
    });
    document.addEventListener('pointerout', function (event) {
      if (event.target.closest && event.target.closest(hoverTargets)) {
        document.documentElement.classList.remove('is-hovering');
      }
    });
  }

  /* ---------------- 14. 隐藏彩蛋 ---------------- */
  var eggBuffer = '';
  var eggLastTime = 0;
  document.addEventListener('keydown', function (event) {
    var tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!/^[a-z]$/i.test(event.key)) return;
    var now = Date.now();
    if (now - eggLastTime > 1500) eggBuffer = '';
    eggLastTime = now;
    eggBuffer = (eggBuffer + event.key.toLowerCase()).slice(-8);
    if (eggBuffer.indexOf('magic') !== -1) {
      eggBuffer = '';
      fireSparkles();
      showToast('✦ 你发现了隐藏的魔术：爱魔术，爱魔方，爱魔协。');
    }
  });

  function fireSparkles() {
    if (reduceMotion) return;
    var chars = ['✦', '✧', '♠', '♥', '♦', '♣'];
    for (var i = 0; i < 26; i++) {
      (function (index) {
        window.setTimeout(function () {
          var spark = document.createElement('span');
          spark.textContent = chars[Math.floor(Math.random() * chars.length)];
          spark.style.cssText = 'position:fixed;left:' + (10 + Math.random() * 80) + 'vw;top:' +
            (18 + Math.random() * 55) + 'vh;z-index:500;pointer-events:none;font-size:' +
            (12 + Math.random() * 22) + 'px;color:' +
            (Math.random() > 0.5 ? '#f5c26b' : '#5ee7df') + ';text-shadow:0 0 18px currentColor;';
          document.body.appendChild(spark);
          var anim = spark.animate([
            { opacity: 0, transform: 'translateY(0) scale(0.4) rotate(0deg)' },
            { opacity: 1, transform: 'translateY(-60px) scale(1.1) rotate(40deg)', offset: 0.35 },
            { opacity: 0, transform: 'translateY(-140px) scale(0.8) rotate(90deg)' }
          ], { duration: 1500 + Math.random() * 900, easing: 'cubic-bezier(.16,1,.3,1)' });
          anim.onfinish = function () { spark.remove(); };
        }, index * 28);
      })(i);
    }
  }

  /* ---------------- 15. 平滑锚点（兼顾固定页头） ---------------- */
  $$('a[href^="#"]').forEach(function (link) {
    var href = link.getAttribute('href');
    if (!href || href === '#') return;
    var target = document.getElementById(href.slice(1));
    if (!target) return;
    link.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      var headerOffset = (header && header.classList.contains('is-scrolled')) ? 74 : 88;
      var top = target.getBoundingClientRect().top + window.scrollY - headerOffset;
      window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
      if (history.replaceState) history.replaceState(null, '', href);
      closeNav();
    });
  });

  /* ---------------- 16. 控制台彩蛋 ---------------- */
  try {
    console.log('%c✦ 浙大魔协 · MAGIC & CUBE ✦', 'color:#f5c26b;font-size:18px;font-weight:bold;');
    console.log('%c爱魔术，爱魔方，爱魔协。欢迎加入我们！', 'color:#9a91b8;font-size:12px;');
  } catch (err) { /* noop */ }
})();
