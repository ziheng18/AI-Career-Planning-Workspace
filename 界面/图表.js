/*!
 * 界面/图表.js — 手写内联 SVG 图表
 *
 * 刻意不用任何图表库：
 *   1. 离线可用，不依赖 CDN；
 *   2. 打印为 PDF 时矢量清晰；
 *   3. 数据由代码绘制，可随时重算，不会变成"一张死图"。
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  // esc / fmt 由 数据/schema.js 提供（导出层与界面层共用同一份）
  var esc = CP.esc;
  var fmt = CP.fmt;

  /** SVG 数字：保留 1 位小数，避免 width="13.400000000000006" 这类坐标垃圾 */
  function svgNum(n) {
    return (Math.round(n * 10) / 10).toString();
  }
  CP.svgNum = svgNum;

  /** 颜色由 CSS 变量控制，保证暗色模式跟随 */
  var C = {
    brand: 'var(--brand)',
    brand2: 'var(--brand-2)',
    accent: 'var(--accent)',
    line: 'var(--line)',
    ink3: 'var(--ink-3)',
    ink2: 'var(--ink-2)',
    danger: 'var(--danger)',
    warn: 'var(--warn)',
    ok: 'var(--ok)'
  };

  /* ============================================================
   * 雷达图
   * @param {Array} axes [{label, score}]   score 0-100 或 null
   * @param {Object} opt  { size, overlay:{label, values:[], color} }
   * ============================================================ */
  CP.chartRadar = function (axes, opt) {
    opt = opt || {};
    var size = opt.size || 300;
    var cx = size / 2, cy = size / 2;
    var R = size / 2 - 46;
    var n = axes.length;
    if (!n) return '<div class="empty">暂无数据</div>';

    function point(i, ratio) {
      var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(ang) * R * ratio, cy + Math.sin(ang) * R * ratio];
    }

    var svg = ['<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">'];

    // 网格环
    [0.25, 0.5, 0.75, 1].forEach(function (r) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = point(i, r); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      svg.push('<polygon points="' + pts.join(' ') + '" fill="none" stroke="' + C.line + '" stroke-width="1"/>');
    });
    // 轴线
    for (var i = 0; i < n; i++) {
      var p = point(i, 1);
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="' + C.line + '" stroke-width="1"/>');
    }

    // 叠加参考多边形（如目标岗位要求）
    if (opt.overlay && opt.overlay.values && opt.overlay.values.length === n) {
      var opts = opt.overlay.values.map(function (v, i) {
        var q = point(i, Math.max(0, Math.min(1, (v == null ? 0 : v) / 100)));
        return q[0].toFixed(1) + ',' + q[1].toFixed(1);
      });
      svg.push('<polygon points="' + opts.join(' ') + '" fill="none" stroke="' + (opt.overlay.color || C.accent) +
        '" stroke-width="2" stroke-dasharray="5 4"/>');
    }

    // 数据多边形
    var pts = [];
    var pendingPts = [];
    axes.forEach(function (a, i) {
      var pending = (a.score == null);
      var q = point(i, Math.max(0, Math.min(1, (pending ? 0 : a.score) / 100)));
      pts.push(q[0].toFixed(1) + ',' + q[1].toFixed(1));
      if (pending) pendingPts.push(q[0].toFixed(1) + ',' + q[1].toFixed(1));
    });

    // 未作答的扇区：用很淡的灰色填充占位，让"这块还没答"一眼可见
    axes.forEach(function (a, i) {
      if (a.score != null) return;
      var q0 = point(i, 1), q1 = point((i + 1) % n, 1);
      svg.push('<polygon points="' + cx + ',' + cy + ' ' + q0[0].toFixed(1) + ',' + q0[1].toFixed(1) + ' ' +
        q1[0].toFixed(1) + ',' + q1[1].toFixed(1) + '" fill="' + C.ink3 + '" fill-opacity="0.07"/>');
    });

    // 数据多边形：用虚线描边，因为此时还没有答完，形状会继续变化
    svg.push('<polygon points="' + pts.join(' ') + '" fill="' + C.brand + '" fill-opacity="0.16" stroke="' + C.brand + '" stroke-width="2"' +
      (pendingPts.length ? ' stroke-dasharray="6 4"' : '') + ' data-anim="pop"/>');

    // 顶点与标签。顶点也放进 pop 组？不——顶点是独立的 circle，
    // 给它们各自的 pop 会产生 6 次缩放，视觉上会"跳"。只让多边形与顶点一起淡入：
    // 顶点标 pop-delay，由运行器统一处理延迟。
    axes.forEach(function (a, i) {
      var pending = (a.score == null);
      var q = point(i, Math.max(0, Math.min(1, (pending ? 0 : a.score) / 100)));
      svg.push('<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3" fill="' +
        (pending ? C.ink3 : C.brand) + '"' + (pending ? ' fill-opacity="0.5"' : '') +
        (pending ? '' : ' data-anim="fade" data-anim-delay="' + (i * 30) + '"') + '/>');
      var lp = point(i, 1.17);
      var anchor = Math.abs(lp[0] - cx) < 6 ? 'middle' : (lp[0] > cx ? 'start' : 'end');
      svg.push('<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 4).toFixed(1) + '" text-anchor="' + anchor +
        '" font-size="11" fill="' + (pending ? C.ink3 : C.ink2) + '">' + esc(a.label) + '</text>');
      svg.push('<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 16).toFixed(1) + '" text-anchor="' + anchor +
        '" font-size="10" fill="' + C.ink3 + '">' + (pending ? '未答' : fmt(a.score, 0)) + '</text>');
    });

    svg.push('</svg>');
    return svg.join('');
  };

  /* ============================================================
   * 横向条形图
   * @param {Array} rows  [{label, value, note}]
   * @param {Object} opt  { max, width, unit, color, digits, pending }
   *   value 为 null 的行画成灰色淡条并标注"未答"，使图表从第一屏就存在，
   *   不会等到答完才突然出现。
   * ============================================================ */
  CP.chartBars = function (rows, opt) {
    opt = opt || {};
    var width = opt.width || 420;
    var labelW = opt.labelW || 96;
    var barMax = width - labelW - 58;
    var max = opt.max || 100;
    var rowH = 26;
    var height = rows.length * rowH + 6;
    if (!rows.length) return '<div class="empty">暂无数据</div>';

    var svg = ['<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img">'];
    rows.forEach(function (r, i) {
      var y = i * rowH + 4;
      var pending = (r.value == null);
      var v = pending ? 0 : r.value;
      var w = pending ? barMax : Math.max(1, Math.round((Math.min(v, max) / max) * barMax));
      svg.push('<text x="0" y="' + (y + 13) + '" font-size="11.5" fill="' + (pending ? C.ink3 : C.ink2) + '">' + esc(r.label) + '</text>');
      svg.push('<rect x="' + labelW + '" y="' + y + '" width="' + barMax + '" height="13" rx="3" fill="' + C.line + '" fill-opacity="0.55"/>');
      // 数据条带 data-anim="grow"：入场时从 0 宽度长出，逐条错开。
      // 注意 SVG 属性（width）不能用 CSS transition，动画由 界面/应用.js
      // 用 WAAPI 改写 transform 属性实现——见那里的说明。
      svg.push('<rect x="' + labelW + '" y="' + y + '" width="' + w + '" height="13" rx="3" fill="' +
        (pending ? C.ink3 : (r.color || opt.color || C.brand)) + '" fill-opacity="' + (pending ? 0.16 : 1) + '"' +
        (pending ? '' : ' data-anim="grow" data-anim-origin="' + labelW + '" data-anim-delay="' + (i * 45) + '"') + '/>');
      var txt = pending ? '未答' : fmt(r.value, opt.digits == null ? 1 : opt.digits) + (opt.unit || '');
      svg.push('<text x="' + (width - 2) + '" y="' + (y + 12) + '" text-anchor="end" font-size="11.5" fill="' +
        (pending ? C.ink3 : C.ink2) + '" font-variant-numeric="tabular-nums">' + esc(txt) + '</text>');
      if (r.note) {
        svg.push('<text x="' + (labelW + 4) + '" y="' + (y + 24) + '" font-size="10" fill="' + C.ink3 + '">' + esc(r.note) + '</text>');
      }
    });
    svg.push('</svg>');
    return svg.join('');
  };

  /* ============================================================
   * 缺口对比图：左半为"我的水平"，右半为"距离要求的缺口"
   * @param {Array} rows [{label, got, req}]
   * ============================================================ */
  CP.chartGaps = function (rows, opt) {
    opt = opt || {};
    var width = opt.width || 460;
    var labelW = 100;
    var half = (width - labelW - 60) / 2;
    var rowH = 30;
    var height = rows.length * rowH + 24;
    if (!rows.length) return '<div class="empty">暂无数据</div>';

    var svg = ['<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img">'];
    var mid = labelW + half;

    // 表头
    svg.push('<text x="' + labelW + '" y="10" font-size="10.5" fill="' + C.ink3 + '">← 我的水平</text>');
    svg.push('<text x="' + (width - 2) + '" y="10" text-anchor="end" font-size="10.5" fill="' + C.ink3 + '">距岗位要求的缺口 →</text>');

    rows.forEach(function (r, i) {
      var y = i * rowH + 20;
      var got = Math.max(0, Math.min(100, r.got == null ? 0 : r.got));
      var req = Math.max(0, Math.min(100, r.req == null ? 0 : r.req));
      var gap = Math.max(0, req - got);

      svg.push('<text x="0" y="' + (y + 13) + '" font-size="11.5" fill="' + C.ink2 + '">' + esc(r.label) + '</text>');
      // 左：我的水平（从中间向左延伸）。
      // 左边这条原本 x = mid - wGot，动画时"从右端（中线处）向左长出"，
      // 所以 origin 是 mid 而不是条的起点。
      var wGot = Math.max(1, (got / 100) * half);
      svg.push('<rect x="' + svgNum(mid - wGot) + '" y="' + y + '" width="' + svgNum(wGot) + '" height="14" rx="3" fill="' + C.brand + '"' +
        ' data-anim="grow" data-anim-origin="' + svgNum(mid) + '" data-anim-delay="' + (i * 45) + '"/>');
      // 右：缺口（从中间向右延伸）
      if (gap > 0) {
        var wGap = Math.max(1, (gap / 100) * half);
        svg.push('<rect x="' + svgNum(mid) + '" y="' + y + '" width="' + svgNum(wGap) + '" height="14" rx="3" fill="' + C.danger + '" fill-opacity="0.85"' +
          ' data-anim="grow" data-anim-origin="' + svgNum(mid) + '" data-anim-delay="' + (i * 45 + 20) + '"/>');
      } else {
        svg.push('<text x="' + (mid + 6) + '" y="' + (y + 12) + '" font-size="10.5" fill="' + C.ok + '">已达标</text>');
      }
      svg.push('<line x1="' + mid + '" y1="' + (y - 3) + '" x2="' + mid + '" y2="' + (y + 17) + '" stroke="' + C.ink3 + '" stroke-width="1"/>');
      svg.push('<text x="' + (width - 2) + '" y="' + (y + 12) + '" text-anchor="end" font-size="11" fill="' + C.ink3 +
        '" font-variant-numeric="tabular-nums">' + fmt(got, 0) + ' / ' + fmt(req, 0) + '</text>');
    });
    svg.push('</svg>');
    return svg.join('');
  };

  /* ============================================================
   * 图表用 SVG 需要显式宽度（在浏览器里由 CSS 缩放）。
   * 与其猜容器宽度，不如在窄屏换成另一种排版——
   * 把一个 560 宽的图硬缩到 320，11px 的字会变成 1.5mm，读不了。
   * ============================================================ */

  /**
   * 缺口图（窄屏专用紧凑版）
   * 与宽屏版的区别：只有一列"我的水平"条，缺口用红色叠在其上，
   * 右侧只保留"缺口数值"，标签在条形上方独占一行。
   * 这样在 320–360px 下文字仍是原尺寸。
   * @param {Array} rows [{label, got, req, gap}]
   */
  CP.chartGapsCompact = function (rows, opt) {
    opt = opt || {};
    var width = opt.width || 340;
    var pad = 10;
    var barMax = width - pad * 2;
    var rowH = 42;
    var headH = 16;
    var height = headH + rows.length * rowH + 6;
    if (!rows.length) return '<div class="empty">暂无数据</div>';

    var svg = ['<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img">'];
    svg.push('<text x="' + pad + '" y="11" font-size="10.5" fill="' + C.ink3 + '">灰色为岗位要求，绿色为我的水平，红色为缺口</text>');

    rows.forEach(function (r, i) {
      var y = headH + i * rowH;
      var got = Math.max(0, Math.min(100, r.got == null ? 0 : r.got));
      var req = Math.max(0, Math.min(100, r.req == null ? 0 : r.req));
      var gap = Math.max(0, req - got);

      // 标签行：左侧维度名，右侧缺口数值
      svg.push('<text x="' + pad + '" y="' + (y + 12) + '" font-size="12" fill="' + C.ink2 + '">' + esc(r.label) + '</text>');
      var gapTxt = gap > 0 ? ('缺口 ' + fmt(gap, 0)) : '已达标';
      svg.push('<text x="' + (width - pad) + '" y="' + (y + 12) + '" text-anchor="end" font-size="11.5" fill="' +
        (gap > 0 ? C.danger : C.ok) + '" font-variant-numeric="tabular-nums">' + esc(gapTxt) + '</text>');

      // 条形：底色=岗位要求，绿色=我的水平（叠在上面）
      var boxY = y + 19;
      var h = 13;
      svg.push('<rect x="' + pad + '" y="' + boxY + '" width="' + barMax + '" height="' + h + '" rx="3" fill="' + C.line + '" fill-opacity="0.6"/>');
      svg.push('<rect x="' + pad + '" y="' + boxY + '" width="' + svgNum(barMax * req / 100) + '" height="' + h +
        '" rx="3" fill="' + C.ink3 + '" fill-opacity="0.26"/>');
      svg.push('<rect x="' + pad + '" y="' + boxY + '" width="' + svgNum(Math.max(2, barMax * got / 100)) + '" height="' + h +
        '" rx="3" fill="' + C.brand + '"/>');
      if (gap > 0) {
        var x0 = pad + barMax * got / 100;
        svg.push('<rect x="' + svgNum(x0) + '" y="' + boxY + '" width="' + svgNum(barMax * gap / 100) + '" height="' + h +
          '" rx="3" fill="' + C.danger + '" fill-opacity="0.85"/>');
      }
    });
    svg.push('</svg>');
    return svg.join('');
  };

  /**
   * 窄屏时为 true。用来在选择图表排版时切换。
   * 用 matchMedia 而不是 innerWidth，测试环境里没有 matchMedia 时按宽屏处理。
   */
  CP.isNarrow = function () {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 760px)').matches;
  };

  /* ============================================================
   * 权重饼图
   * @param {Array} rows [{label, value}]  value 为 0-100 的占比
   * ============================================================ */
  CP.chartPie = function (rows, opt) {
    opt = opt || {};
    var size = opt.size || 210;
    var r = size / 2 - 8, cx = size / 2, cy = size / 2;
    var palette = ['#0f766e', '#4f46e5', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444'];
    var total = rows.reduce(function (s, x) { return s + (x.value || 0); }, 0);
    if (!total) return '<div class="empty">暂无数据</div>';

    var svg = ['<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">'];
    var acc = 0;
    rows.forEach(function (row, i) {
      var frac = (row.value || 0) / total;
      var a0 = acc * 2 * Math.PI - Math.PI / 2;
      var a1 = (acc + frac) * 2 * Math.PI - Math.PI / 2;
      acc += frac;
      var large = frac > 0.5 ? 1 : 0;
      var x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      var x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      var color = row.color || palette[i % palette.length];
      if (frac >= 0.9999) {
        svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '"/>');
      } else {
        svg.push('<path d="M ' + cx + ' ' + cy + ' L ' + x0.toFixed(1) + ' ' + y0.toFixed(1) +
          ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Z" fill="' + color + '"/>');
      }
    });
    if (opt.hole !== false) svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.52) + '" fill="var(--surface)"/>');
    svg.push('</svg>');

    var legend = rows.map(function (row, i) {
      return '<span><i style="background:' + (row.color || palette[i % palette.length]) + '"></i>' +
        esc(row.label) + ' ' + fmt(row.value, 1) + '%</span>';
    }).join('');
    return svg.join('') + '<div class="chart-legend">' + legend + '</div>';
  };

  /* ============================================================
   * 适配度对比条（小尺寸，用于排序表内联）
   * ============================================================ */
  CP.barInline = function (value, max, color) {
    var m = max || 100;
    var pct = Math.max(0, Math.min(100, (value / m) * 100));
    return '<span style="display:inline-block;width:100%;height:8px;background:var(--line);border-radius:999px;overflow:hidden">' +
      '<i style="display:block;height:100%;width:' + pct.toFixed(1) + '%;background:' + (color || C.brand) + ';border-radius:999px"></i></span>';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
