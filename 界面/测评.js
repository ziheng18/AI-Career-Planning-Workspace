/*!
 * 界面/测评.js — 三套测评的作答交互（Likert / 行为锚量表）
 *
 * 交互约定：
 *   · 每题点选即存，不需要"提交"；
 *   · 点选后立刻在顶部更新该块的图形化反馈（雷达/条形），维持作答动机；
 *   · 存档走防抖保存，不会因为频繁写盘卡顿。
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});
  CP.pages = CP.pages || {};

  function esc(s) { return CP.esc(s); }

  /** 当前档案的年级口径下的题目列表 */
  function itemsOf(bank) {
    return CP.activeItems(bank, CP.ui.archive.profile);
  }

  /** 该题库的作答进度 */
  function answered(bank, archive) {
    var n = 0;
    itemsOf(bank).forEach(function (it) { if (archive.answers[bank.id][it.id] !== undefined) n += 1; });
    return n;
  }

  /**
   * 渲染一套测评页面。
   * @param {Object} bank
   * @param {Object} opt { prev, next, feedback(scored) → html, note }
   */
  function renderBank(bank, opt) {
    var a = CP.ui.archive;
    var ans = a.answers[bank.id];
    var items = itemsOf(bank);
    var scale = CP.scaleOf(bank, a.profile);
    var isChecklist = scale.type === 'checklist';
    var n = answered(bank, a);
    var total = items.length;

    var nextRoute = opt.next || 'result';
    var prevRoute = opt.prev || 'home';

    var itemsHtml;
    if (isChecklist) {
      // 勾选式：按维度分组，每维内是从易到难的阶梯
      var dims = bank.dimensions;
      itemsHtml = dims.map(function (d) {
        var rows = items.filter(function (it) { return it.dim === d.id; });
        if (!rows.length) return '';
        var checkedN = rows.filter(function (it) { return ans[it.id] !== undefined; }).length;
        var body = rows.map(function (it) {
          var done = ans[it.id] !== undefined;
          return '<label class="check-item' + (done ? ' done' : '') + '" data-check="' + it.id + '">'
            + '<input type="checkbox" data-checkbox="' + it.id + '"' + (done ? ' checked' : '') + '>'
            + '<span class="check-box" aria-hidden="true"></span>'
            + '<span class="check-text">' + esc(it.text) + '</span>'
            + '<span class="check-w">' + it.weight + '</span>'
            + '</label>';
        }).join('');
        return '<div class="check-dim" data-dim="' + d.id + '">'
          + '<div class="check-dim-head"><b>' + esc(d.label) + '</b>'
          + '<span class="check-count" data-count="' + d.id + '">' + checkedN + '/' + rows.length + '</span></div>'
          + '<div class="check-list">' + body + '</div>'
          + '<label class="field check-evidence"><span class="lbl">这一维的证据（可选）</span>'
          + '<input type="text" data-evidence="' + d.id + '" placeholder="例如：线性代数 92 分 / GitHub 仓库链接 / 实习证明"'
          + ' value="' + esc((a.abilityEvidence || {})[d.id] || '') + '"></label>'
          + '</div>';
      }).join('');
    } else {
      itemsHtml = '<div class="qblock">' + items.map(function (it, idx) {
        var cur = ans[it.id] === undefined ? null : ans[it.id].v;
        var btns = [];
        for (var v = scale.min; v <= scale.max; v++) {
          btns.push('<button data-item="' + it.id + '" data-val="' + v + '"'
            + ' aria-label="第 ' + v + ' 档：' + esc(scale.labels[v - scale.min]) + '"'
            + ' aria-pressed="' + (cur === v ? 'true' : 'false') + '"'
            + ' title="' + esc(scale.labels[v - scale.min]) + '"'
            + ' class="' + (cur === v ? 'on' : '') + '">' + v + '</button>');
        }
        var cols = scale.max - scale.min + 1;
        return '<div class="qitem' + (cur !== null ? ' answered' : '') + '" data-row="' + it.id + '">'
          + '<div class="qtext"><span class="qidx">' + (idx + 1) + '</span>' + esc(it.text) + '</div>'
          + '<div><div class="scale scale-' + cols + '" role="group" aria-label="第 ' + (idx + 1) + ' 题的选项">'
          + btns.join('') + '</div>'
          + '<div class="scale-labels"><span>' + esc(scale.labels[0]) + '</span><span>' + esc(scale.labels[scale.labels.length - 1]) + '</span></div>'
          + '</div></div>';
      }).join('') + '</div>';
    }

    return '<div class="page-head"><h1>' + esc(bank.title) + '</h1>'
      + '<div class="sub">' + esc(bank.subtitle) + '</div></div>'
      + '<div class="grid grid-4" style="margin-bottom:14px">'
      + '<div class="metric"><div class="k">' + (isChecklist ? '已勾选' : '已作答') + '</div>'
      + '<div class="v">' + n + '<small>/' + total + '</small></div>'
      + '<div class="progress" style="margin-top:6px"><i style="width:' + (total ? (n / total * 100).toFixed(0) : 0) + '%"></i></div></div>'
      + '<div class="metric" style="grid-column:span 3"><div class="k">实时反馈（随作答更新）</div><div id="fb" style="margin-top:4px">'
      + (opt.feedback ? opt.feedback(isChecklist
        ? CP.scoreChecklist(bank, ans, a.profile)
        : CP.scoreBank(bank, ans, a.profile)) : '')
      + '</div></div>'
      + '</div>'
      + (opt.note ? '<div class="note' + (opt.noteClass ? ' ' + opt.noteClass : '') + '" style="margin-bottom:14px">' + opt.note + '</div>' : '')
      + '<div class="card"><div class="card-head"><h3>作答区</h3>'
      + '<span class="tag">' + (isChecklist ? '行为清单（勾选式）'
        : (scale.type === 'likert' ? scale.max + ' 级量表' : '量表')) + '</span></div>'
      + (scale.type === 'likert' ? '' : behaviorLegend(scale))
      + (isChecklist ? itemsHtml : '<div class="qblock">' + itemsHtml + '</div>')
      + '<div class="actions-bar" style="margin-top:16px">'
      + '<button class="btn btn-sm" onclick="location.hash=\'' + prevRoute + '\'">← 上一步</button>'
      + '<span class="spacer"></span>'
      + '<button class="btn btn-primary btn-sm" onclick="location.hash=\'' + nextRoute + '\'">'
      + (n >= total ? '完成，继续 →' : '先去下一步（还有 ' + (total - n) + ' 题未答）') + '</button>'
      + '</div></div>';
  }

  function behaviorLegend(scale) {
    if (scale.type === 'checklist') {
      return '<div class="behavior-legend"><b>怎么勾：</b>'
        + '<div style="margin-top:4px">只勾选你<b>确实能独立做到</b>的项。</div>'
        + '<div style="margin-top:6px;color:var(--ink-3)">没勾上的项不扣分，它们就是接下来要补的部分，'
        + '结果页会把它们变成学习任务。每维的项由易到难排列，右侧数字是该题的分值。</div>'
        + '</div>';
    }
    return '<div class="behavior-legend"><b>量表含义：</b><ol>'
      + scale.labels.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('')
      + '</ol>'
      + '</div>';
  }

  /** 绑定一道题的量表按钮 */
  function bindItems(bank, onAnswered) {
    var a = CP.ui.archive;
    document.querySelectorAll('[data-item]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-item');
        var val = Number(btn.getAttribute('data-val'));
        a.answers[bank.id][id] = { v: val, t: Date.now() };
        a.computed = null;

        var row = document.querySelector('[data-row="' + id + '"]');
        if (row) {
          row.classList.add('answered');
          row.querySelectorAll('[data-item]').forEach(function (b) {
            var on = (b === btn);
            b.classList.toggle('on', on);
            // 同步无障碍状态，读屏用户才能知道哪一档被选中
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
        }
        CP.store.saveSoon(a, 250);
        onAnswered();
      };
    });
  }

  /**
   * 绑定勾选式清单的交互。
   * 勾选即存；同时更新该维度的小计数与顶部反馈。
   *
   * ★ 必须记时间戳：清单不做"题内一致性"检验（勾选式没有方差可言），
   *   所以**作答时长是它唯一的质量信号**。漏记 t 会让 timingCheck 直接跳过，
   *   等于全勾 48 项也检测不出来。
   */
  function bindChecklist(bank, onAnswered) {
    var a = CP.ui.archive;
    var items = itemsOf(bank);

    document.querySelectorAll('[data-checkbox]').forEach(function (box) {
      box.onchange = function () {
        var id = box.getAttribute('data-checkbox');
        if (box.checked) a.answers[bank.id][id] = { v: 1, t: Date.now() };
        else delete a.answers[bank.id][id];
        a.computed = null;

        var row = box.closest('[data-check]');
        if (row) row.classList.toggle('done', box.checked);

        // 更新该维度的小计数
        var it = items.filter(function (x) { return x.id === id; })[0];
        if (it) {
          var rows = items.filter(function (x) { return x.dim === it.dim; });
          var cnt = rows.filter(function (x) { return a.answers[bank.id][x.id] !== undefined; }).length;
          var el = document.querySelector('[data-count="' + it.dim + '"]');
          if (el) el.textContent = cnt + '/' + rows.length;
        }

        CP.store.saveSoon(a, 250);
        onAnswered();
      };
    });

    // 证据：可选，失焦即存
    document.querySelectorAll('[data-evidence]').forEach(function (input) {
      input.onchange = function () {
        var dim = input.getAttribute('data-evidence');
        var v = (input.value || '').trim();
        a.abilityEvidence = a.abilityEvidence || {};
        if (v) a.abilityEvidence[dim] = v;
        else delete a.abilityEvidence[dim];
        a.computed = null;
        CP.store.saveSoon(a, 250);
      };
    });
  }

  /** 刷新"已作答"计数与实时反馈图 */
  function refreshFeedback(bank, feedbackFn) {
    var a = CP.ui.archive;
    var n = answered(bank, a);
    var m = document.querySelector('.metric .v');
    if (m) m.innerHTML = n + '<small>/' + itemsOf(bank).length + '</small>';
    var bar = document.querySelector('.metric .progress > i');
    if (bar) bar.style.width = (n / itemsOf(bank).length * 100).toFixed(0) + '%';
    var fb = document.getElementById('fb');
    var isChecklist = CP.scaleOf(bank, a.profile).type === 'checklist';
    if (fb && feedbackFn) {
      fb.innerHTML = feedbackFn(isChecklist
        ? CP.scoreChecklist(bank, a.answers[bank.id], a.profile)
        : CP.scoreBank(bank, a.answers[bank.id], a.profile));
    }
    CP.ui.refreshProgress();
  }

  /* ============================================================
   * 兴趣测评
   * ============================================================ */
  CP.pages.riasecFeedback = function (scored) {
    var axes = CP.BANK_RIASEC.dimensions.map(function (d) {
      return { label: d.label.replace(/\s*[A-Z]$/, ''), score: scored.dims[d.id].score };
    });
    var done = axes.filter(function (x) { return x.score !== null; }).length;
    return '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">'
      + CP.chartRadar(axes, { size: 190 })
      + '<div style="font-size:12.5px;color:var(--ink-2);flex:1 1 240px">'
      + '<div>当前三字母代码：<b style="font-size:15px">' + esc(CP.hollandCode(scored).code || '—') + '</b></div>'
      + '<div style="margin-top:4px;color:var(--ink-3)">'
      + (done < 6
        ? '灰色顶点是你还没作答的维度（按 0 分占位）。随着作答，图形会逐渐长出来。'
        : '六边形越不对称，说明兴趣越聚焦。')
      + '</div></div></div>';
  };
  CP.pages.riasec = function () {
    return renderBank(CP.BANK_RIASEC, { prev: 'profile', next: 'anchor', feedback: CP.pages.riasecFeedback });
  };
  CP.pages.riasecBind = function () {
    bindItems(CP.BANK_RIASEC, function () { refreshFeedback(CP.BANK_RIASEC, CP.pages.riasecFeedback); });
  };

  /* ============================================================
   * 职业锚
   * ============================================================ */
  CP.pages.anchorFeedback = function (scored) {
    var rows = CP.BANK_ANCHOR.dimensions.map(function (d) {
      return { label: d.label, value: scored.dims[d.id].score };
    });
    var done = rows.filter(function (r) { return r.value !== null; }).length;
    var sorted = rows.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
    var dom = CP.dominantAnchor(scored);
    return '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">'
      + '<div style="flex:1 1 300px">' + CP.chartBars(sorted, { width: 380, labelW: 90, digits: 0, pending: true }) + '</div>'
      + '<div style="font-size:12.5px;color:var(--ink-2);flex:1 1 200px">'
      + '<div>当前主锚：<b style="font-size:15px">' + esc(dom.primary ? dom.primary.label : '—') + '</b>'
      + (dom.isDual ? ' <span class="tag tag-warn">双锚</span>' : '') + '</div>'
      + '<div style="margin-top:4px;color:var(--ink-3)">'
      + (done < 8 ? '浅色条是还没作答的锚。' : '主锚与副锚分差很小的时候会提示"双锚"，这类人往往需要同时满足两种诉求。')
      + '</div></div></div>';
  };
  CP.pages.anchor = function () {
    return renderBank(CP.BANK_ANCHOR, { prev: 'riasec', next: 'ability', feedback: CP.pages.anchorFeedback });
  };
  CP.pages.anchorBind = function () {
    bindItems(CP.BANK_ANCHOR, function () { refreshFeedback(CP.BANK_ANCHOR, CP.pages.anchorFeedback); });
  };

  /* ============================================================
   * 能力清单（勾选式；题目按年级切换）
   * ============================================================ */
  CP.pages.abilityFeedback = function (scored) {
    var rows = CP.BANK_ABILITY.dimensions.map(function (d) {
      var x = scored.dims[d.id];
      return { label: d.label, value: x ? x.score : null };
    });
    var sorted = rows.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
    // 勾选式的作答质量提示：全勾 / 只勾首项 / 阶梯缺项
    var flags = CP.checklistCheck(CP.BANK_ABILITY, scored, CP.ui.archive.answers.ability, CP.ui.archive.profile);
    var flagHtml = flags.map(function (f) {
      return '<div class="note ' + (f.level === 'warn' ? 'note-danger' : '') + '" style="margin-top:8px;font-size:12px">'
        + esc(f.message) + '</div>';
    }).join('');

    return '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">'
      + '<div style="flex:1 1 300px">' + CP.chartBars(sorted, { width: 380, labelW: 90, digits: 0, pending: true }) + '</div>'
      + '<div style="font-size:12.5px;color:var(--ink-2);flex:1 1 220px">'
      + '<div><b>这是"已经会了"的比例，不是能力评分。</b></div>'
      + '<div style="margin-top:4px;color:var(--ink-3)">每一项都是可核验的具体行为，不是"我觉得我大概行"。</div>'
      + '<div style="margin-top:6px;color:var(--ink-3)">浅色条是还没勾选任何项的维度。</div>'
      + flagHtml
      + '</div></div>';
  };
  CP.pages.ability = function () {
    return renderBank(CP.BANK_ABILITY, {
      prev: 'anchor',
      next: 'decision',
      feedback: CP.pages.abilityFeedback,
      note: CP.ui.archive.profile.grade
        ? ''
        : '<b>你还没有选择年级。</b>请先回到「基本信息」选择年级，清单会换成对应的一套。'
    });
  };
  CP.pages.abilityBind = function () {
    bindChecklist(CP.BANK_ABILITY, function () { refreshFeedback(CP.BANK_ABILITY, CP.pages.abilityFeedback); });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
