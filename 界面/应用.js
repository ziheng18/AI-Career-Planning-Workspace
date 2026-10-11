/*!
 * 界面/应用.js — 路由、进度、存档动作、全局提示
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  var PAGES = [
    { id: 'home', num: '1', label: '总览', group: '开始' },
    { id: 'profile', num: '', label: '基本信息与约束' },
    { id: 'riasec', num: '2', label: '兴趣测评' },
    { id: 'anchor', num: '3', label: '职业锚' },
    { id: 'ability', num: '4', label: '能力自评' },
    { id: 'decision', num: '5', label: '决策输入' },
    { id: 'result', num: '6', label: '结果与画像' },
    { id: 'action', num: '7', label: '行动计划' },
    { id: 'export', num: '8', label: '导出报告' }
  ];

  CP.ui = {
    archive: null,
    route: 'home',

    init: function () {
      var a = CP.store.load();
      if (!a) {
        a = CP.createBlankArchive();
        CP.store.save(a);
      }
      CP.ui.archive = a;
      CP.ui.renderNav();
      CP.ui._wasNarrow = CP.isNarrow();
      CP.ui.go(location.hash ? location.hash.slice(1) : 'home');
      CP.ui.bindGlobal();
      CP.ui.refreshProgress();
    },

    bindGlobal: function () {
      window.addEventListener('hashchange', function () {
        CP.ui.go(location.hash ? location.hash.slice(1) : 'home');
      });

      // 窄屏抽屉
      var btn = document.getElementById('btnDrawer');
      if (btn) btn.onclick = function () { CP.ui.openDrawer(); };
      var close = document.getElementById('btnDrawerClose');
      if (close) close.onclick = function () { CP.ui.closeDrawer(); };
      var scrim = document.getElementById('scrim');
      if (scrim) scrim.onclick = function () { CP.ui.closeDrawer(); };
      // Esc 关闭（键盘用户）。这里做能力检测：环境缺少 addEventListener 时
      // 不应该让整个 bindGlobal 崩掉——那会导致保存/导入/重置全部失效。
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', function (e) {
          var k = e.key || '';
          if (k === 'Escape' || k === 'Esc' || e.keyCode === 27) CP.ui.closeDrawer();
        });
      }
      // 装上状态同步方法（纯 CSS 做不到"关闭时不被 Tab 聚焦"）
      CP.ui.applyDrawerState();
      // 屏幕变宽时自动收起，避免抽屉留在"打开"状态
      if (typeof window.matchMedia === 'function') {
        var mq = window.matchMedia('(min-width: 901px)');
        var onChange = function () { if (mq.matches) CP.ui.closeDrawer(); };
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
        else if (typeof mq.addListener === 'function') mq.addListener(onChange);
      }
      // 旋屏后图表排版需要重算
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('resize', function () {
          if (CP.ui.route === 'result' && CP.isNarrow() !== CP.ui._wasNarrow) {
            CP.ui._wasNarrow = CP.isNarrow();
            CP.ui.render({ keepScroll: true });
          }
        });
      }

      document.getElementById('btnSave').onclick = function () { CP.report.saveArchive(); };
      document.getElementById('btnLoad').onclick = function () { document.getElementById('fileInput').click(); };
      document.getElementById('btnDemo').onclick = function () { CP.loadDemoArchive(); };
      document.getElementById('btnReset').onclick = function () {
        if (!confirm('清空所有作答并重新开始？此操作不可撤销，建议先导出档案 JSON 备份。')) return;
        CP.store.clear();
        CP.ui.archive = CP.createBlankArchive();
        CP.store.save(CP.ui.archive);
        CP.ui.go('home');
        CP.ui.refreshProgress();
        CP.ui.toast('已清空，可以重新开始了');
      };
      document.getElementById('fileInput').onchange = function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        CP.file.readText(f).then(function (text) {
          var obj = JSON.parse(text);
          if (obj.kind && obj.kind !== CP.ARCHIVE_KIND) throw new Error('这不是本工作台的档案文件');
          CP.ui.archive = CP.migrate(obj);
          CP.store.save(CP.ui.archive);
          CP.ui.go('home');
          CP.ui.refreshProgress();
          CP.ui.toast('档案导入成功');
        }).catch(function (err) {
          CP.ui.toast('导入失败：' + err.message);
        }).then(function () {
          e.target.value = '';
        });
      };
    },

    renderNav: function () {
      var nav = document.getElementById('nav');
      nav.innerHTML = PAGES.map(function (p) {
        return '<button class="nav-item" data-route="' + p.id + '">' +
          '<span class="nav-num">' + (p.num || '·') + '</span>' +
          '<span>' + CP.esc(p.label) + '</span>' +
          '<span class="nav-count" data-count="' + p.id + '"></span>' +
          '</button>';
      }).join('');
      nav.querySelectorAll('.nav-item').forEach(function (b) {
        b.onclick = function () {
          // 窄屏：点完导航要收起抽屉，否则内容被盖住
          CP.ui.closeDrawer();
          location.hash = b.getAttribute('data-route');
        };
      });
    },

    /* ---------------- 窄屏抽屉 ---------------- */

    drawerOpen: false,

    openDrawer: function () {
      CP.ui.drawerOpen = true;
      CP.ui.applyDrawerState();
    },

    closeDrawer: function () {
      if (!CP.ui.drawerOpen) { CP.ui.applyDrawerState(); return; }
      CP.ui.drawerOpen = false;
      CP.ui.applyDrawerState();
    },

    /**
     * 把抽屉状态落到 DOM 上。
     *
     * 关键：**只有窄屏才把侧栏当"抽屉"**。
     * 宽屏下侧栏是常驻可见的，若也设成 inert（不可交互）+ aria-hidden，
     * 整条导航会完全点不动——这是必须按断点区分的原因。
     * 纯 CSS 做不到"关闭时不被 Tab 聚焦"，所以 inert 必须由 JS 打状态。
     */
    applyDrawerState: function () {
      var sidebar = document.getElementById('sidebar');
      var scrim = document.getElementById('scrim');
      var btn = document.getElementById('btnDrawer');
      // 断点必须与 CSS 的 @media (max-width: 900px) 保持一致
      var isDrawerMode = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 900px)').matches
        // 拿不到 matchMedia 时按"窄屏"处理：宁可多设一次 inert，也不要漏
        : true;
      var open = !!(CP.ui.drawerOpen && isDrawerMode);

      if (sidebar) {
        // 宽屏：侧栏常驻，清掉所有抽屉痕迹
        var hidden = isDrawerMode && !open;
        sidebar.classList.toggle('open', isDrawerMode && open);
        if (hidden) {
          sidebar.setAttribute('aria-hidden', 'true');
        } else {
          sidebar.removeAttribute('aria-hidden');
        }
        // inert 同时管属性与属性值：部分浏览器只认其中之一
        if ('inert' in sidebar) sidebar.inert = hidden;
        if (hidden) sidebar.setAttribute('inert', '');
        else sidebar.removeAttribute('inert');
      }
      if (btn) btn.setAttribute('aria-expanded', (isDrawerMode && open) ? 'true' : 'false');

      if (scrim) {
        if (isDrawerMode && open) {
          scrim.hidden = false;
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () { scrim.classList.add('show'); });
          } else {
            scrim.classList.add('show');
          }
        } else {
          scrim.classList.remove('show');
          scrim.hidden = true;
        }
      }
      // 只有真正打开抽屉时才锁背景滚动
      var body = document.body;
      if (body && body.classList) body.classList.toggle('drawer-open', isDrawerMode && open);
    },

    /** 渲染当前路由：切高亮、出内容、绑事件、刷进度。 */
    render: function (opt) {
      opt = opt || {};
      var route = CP.ui.route;
      // 决策输入页每次点按钮都会重渲染，默认保留滚动位置，否则页面会跳回顶端。
      // 真正换页（点导航、程序化跳转）时不保留，从页首开始。
      var prevScroll = (opt.keepScroll === false) ? 0 : (window.pageYOffset || document.documentElement.scrollTop || 0);
      document.querySelectorAll('.nav-item').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-route') === route);
      });
      var view = document.getElementById('view');
      view.innerHTML = CP.pages[route] ? CP.pages[route]() : '<div class="empty">页面不存在</div>';

      // 换页时重播入场动画。
      //
      // 为什么需要手动触发：`#view` 元素上就带着 .wrap 类，只在首次加载时建一次，
      // 之后都是换 innerHTML，CSS 动画不会自己重播（实测 getAnimations() 恒为 0）。
      // 而"原地重渲染"（决策页每次点按钮，keepScroll 为真）必须**不播**，
      // 否则点一下按钮整页就淡入一次。
      //
      // keepScroll === false 恰好就是"真正换页"的判据，直接复用，不另造状态。
      //
      // 为什么用内联动画而不是加类：
      //   `#view` 本身就带 .wrap，页面加载时已经播过一次 fade-up。
      //   之后无论"摘类再加类"还是"跨两帧再加类"，这个元素都不会重新开始动画
      //   （实测 getAnimations() 恒为 0、opacity 恒为 1；而同样规则的裸 div 能播）。
      //   内联 animation 的赋值会强制样式系统重新解析，实测可靠。
      //
      // ★ 必须在 JS 里判断 reduced-motion：
      //   内联样式优先级高于样式表，`@media (prefers-reduced-motion: reduce)`
      //   里的 `animation:none` 拦不住内联值。漏了这一步，开了"减少动态效果"的
      //   用户反而会被强行播放动画。
      if (opt.keepScroll === false && !CP.ui.motionReduced()) {
        view.style.animation = 'none';
        requestAnimationFrame(function () {
          view.style.animation = 'fade-up .22s var(--ease)';
          view.addEventListener('animationend', function onEnd() {
            // 播完清掉内联值，避免它一直压着样式表
            view.style.animation = '';
            view.removeEventListener('animationend', onEnd);
          });
        });
      }

      window.scrollTo(0, opt.keepScroll === false ? 0 : prevScroll);
      CP.ui.refreshProgress();
      // 顶栏显示当前页名（窄屏靠它知道自己在哪，因为侧栏是抽屉）
      var title = document.getElementById('topbarTitle');
      if (title) {
        var page = PAGES.filter(function (p) { return p.id === route; })[0];
        title.textContent = page ? (page.num ? page.num + '. ' + page.label : page.label) : '';
      }
      // 插入 DOM 之后再绑定事件
      if (typeof CP.bindPage === 'function') CP.bindPage(route);
      if (CP.ui.afterRender) { var f = CP.ui.afterRender; CP.ui.afterRender = null; f(); }
    },

    /**
     * 路由跳转。
     * @param {string} route
     * @param {Object} opt { keepScroll: false } —— 决策输入页的原地重渲染用它保住滚动位置
     */
    go: function (route, opt) {
      if (!PAGES.some(function (p) { return p.id === route; })) route = 'home';
      var same = (CP.ui.route === route);
      CP.ui.route = route;
      var o = opt || {};
      // 不是同一页就必然回到页首
      if (!same) o.keepScroll = false;
      CP.ui.render(o);
      if (location.hash.slice(1) !== route) location.hash = route;
    },

    /**
     * 进度 = 三套测评 + 决策输入（四块等权）。
     *
     * 每一块按**自己的完成门槛**算，而不是一律按题目总数：
     * 能力清单是勾选式，"48 项全勾"既不是目标也不常见，要求它才会让
     * 诚实作答的学生永远看到未完成。门槛定义见 CP.blockProgress。
     */
    progress: function () {
      var a = CP.ui.archive;
      if (!a) return { pct: 0, parts: [] };
      var parts = [];

      ['riasec', 'anchor', 'ability'].forEach(function (k) {
        var bank = CP.BANKS[k];
        var bp = CP.blockProgress(k, a);
        // 侧栏计数怎么写，取决于这一块要不要"做完"：
        //   Likert 题（兴趣/职业锚）→ "已答/总题数"，分母是要求，应该显示。
        //   勾选式清单（能力）      → 只报"已勾 N 项"。写成 "N/48" 会暗示
        //                             "要做完 48 项"，与"能勾多少勾多少"的意图相反。
        var isChecklist = bp.threshold < bp.total;
        parts.push({
          id: k, label: bank.title,
          done: bp.done, total: bp.total,
          threshold: bp.threshold, reached: bp.reached,
          countHint: isChecklist ? ('已勾 ' + bp.done + ' 项') : (bp.done + '/' + bp.total),
          pct: bp.threshold ? Math.min(1, bp.done / bp.threshold) : 0
        });
      });

      var d = a.decision;
      var checks = [
        Object.keys(d.jobPref || {}).length > 0,
        (d.criteriaOrder || []).length === CP.CRITERIA.length,
        !!a.profile.grade && !!d.hoursPerWeek
      ];
      var doneN = checks.filter(Boolean).length;
      parts.push({
        id: 'decision', label: '决策输入与背景',
        done: doneN, total: checks.length, threshold: checks.length,
        reached: doneN >= checks.length, countHint: doneN + '/' + checks.length,
        pct: doneN / checks.length
      });

      var pct = parts.reduce(function (s, p) { return s + p.pct; }, 0) / parts.length;
      return { pct: pct, parts: parts };
    },

    refreshProgress: function () {
      var pr = CP.ui.progress();
      var pctTxt = Math.round(pr.pct * 100) + '%';
      var bar = document.getElementById('sideProgress');
      var txt = document.getElementById('sideProgressText');
      if (bar) bar.style.width = pctTxt;
      if (txt) txt.textContent = pctTxt;
      // 顶栏的进度条（窄屏侧栏不可见时的唯一进度提示）
      var top = document.getElementById('topProgress');
      if (top) top.style.width = pctTxt;

      pr.parts.forEach(function (p) {
        var el = document.querySelector('[data-count="' + p.id + '"]');
        if (!el) return;
        // 达标打勾；未达标显示 countHint（勾选式清单报"已勾 N 项"，不报分母）
        el.textContent = p.reached ? '✓' : p.countHint;
      });

      document.querySelectorAll('.nav-item').forEach(function (b) {
        var r = b.getAttribute('data-route');
        var p = pr.parts.filter(function (x) { return x.id === r; })[0];
        var done = false;
        if (p) done = p.reached;
        else if (r === 'home' || r === 'profile' || r === 'result' || r === 'export') done = pr.pct >= 0.85;
        else if (r === 'decision') done = pr.parts[4].reached;
        else if (r === 'action') done = (CP.ui.archive.actions || []).length > 0;
        b.classList.toggle('done', done);
      });
    },

    /**
     * 用户是否要求"减少动态效果"。
     *
     * 必须在 JS 里判断而不只靠 CSS 媒体查询：换页动画是用**内联** animation 做的，
     * 内联优先级高于样式表，`@media (prefers-reduced-motion: reduce){animation:none}`
     * 拦不住它。漏了这一步，开了该选项的用户反而被强行播动画。
     */
    motionReduced: function () {
      try {
        return (typeof matchMedia === 'function') && matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) {
        return false;   // 无 matchMedia（含测试垫片）时按"不减少"处理
      }
    },

    toast: function (msg, ms) {
      var host = document.getElementById('toastHost');
      var el = document.createElement('div');
      el.className = 'toast';
      el.textContent = msg;
      host.appendChild(el);
      setTimeout(function () {
        el.style.opacity = '0';
        el.style.transition = 'opacity .3s';
        setTimeout(function () { host.removeChild(el); }, 320);
      }, ms || 2600);
    },

    /** 统一的结果对象：有缓存用缓存，没有就现算 */
    result: function (force) {
      var a = CP.ui.archive;
      if (!force && a.computed && a.computed.generatedAt) return a.computed;
      a.computed = CP.buildResult(a);
      CP.store.save(a);
      return a.computed;
    },

    setField: function (path, value) {
      var segs = path.split('.');
      var o = CP.ui.archive;
      for (var i = 0; i < segs.length - 1; i++) o = o[segs[i]];
      o[segs[segs.length - 1]] = value;
      CP.store.saveSoon(CP.ui.archive);
    }
  };

  root.addEventListener('DOMContentLoaded', function () {
    try {
      CP.ui.init();
    } catch (e) {
      document.getElementById('view').innerHTML =
        '<div class="note note-danger">工作台启动失败：' + CP.esc(e.message) + '</div>';
      console.error(e);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
