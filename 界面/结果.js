/*!
 * 界面/结果.js — 结果与画像页：五个标签视图 + 推导面板
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});
  CP.pages = CP.pages || {};

  function esc(s) { return CP.esc(s); }
  function fmt(n, d) { return CP.fmt(n, d); }

  var TABS = [
    { id: 'profile', label: '① 我的画像' },
    { id: 'match', label: '② 岗位匹配' },
    { id: 'gap', label: '③ 差距与任务' },
    { id: 'decision', label: '④ 决策与路径' },
    { id: 'swot', label: '⑤ SWOT' }
  ];

  var currentTab = 'profile';

  /* ============================================================
   * 页面骨架
   * ============================================================ */
  CP.pages.result = function () {
    var a = CP.ui.archive;
    var missing = CP.validateArchive(a);
    var incomplete = missing.length > 0;

    var body;
    try {
      var res = CP.ui.result();
      body = renderTab(res, a);
    } catch (e) {
      body = '<div class="note note-danger">计算失败：' + esc(e.message) + '</div>';
      console.error(e);
    }

    return '<div class="page-head"><h1>结果与画像</h1>'
      + '<div class="sub">所有数值都由公开公式现算得出，不是预先写死的结论。点击任意结果下的「查看推导」可以看到它用了哪几道题、什么权重、怎么算出来的。</div></div>'
      + (incomplete ? '<div class="note note-warn" style="margin-bottom:14px"><b>注意：档案尚未填完。</b>以下结果基于不完整数据，仅供预览。缺：'
        + esc(missing.join('；')) + '</div>' : '')
      + '<div class="result-tabs no-print">'
      + TABS.map(function (t) {
        return '<button class="btn btn-sm' + (t.id === currentTab ? ' btn-primary' : '') + '" data-tab="' + t.id + '">' + esc(t.label) + '</button>';
      }).join('')
      + '</div>'
      + '<div class="actions-bar no-print" style="margin-bottom:16px">'
      + '<span class="spacer"></span>'
      + '<button class="btn btn-sm" id="btnRecalc">重算并保存</button>'
      + '<button class="btn btn-sm" id="btnGotoExport">去导出报告</button>'
      + '</div>'
      + '<div id="tabBody">' + body + '</div>';
  };

  function renderTab(res, a) {
    if (currentTab === 'match') return tabMatch(res, a);
    if (currentTab === 'gap') return tabGap(res, a);
    if (currentTab === 'decision') return tabDecision(res, a);
    if (currentTab === 'swot') return tabSWOT(res, a);
    return tabProfile(res, a);
  }

  CP.pages.resultBind = function () {
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () {
        currentTab = b.getAttribute('data-tab');
        CP.ui.go('result');
      };
    });
    var rc = document.getElementById('btnRecalc');
    if (rc) rc.onclick = function () {
      CP.ui.result(true);
      CP.ui.go('result');
      CP.ui.toast('已按当前数据重新计算');
    };
    var ge = document.getElementById('btnGotoExport');
    if (ge) ge.onclick = function () { location.hash = 'export'; };
  };

  /* ============================================================
   * ① 我的画像
   * ============================================================ */
  function tabProfile(res, a) {
    var s = res.score;
    var axes = CP.BANK_RIASEC.dimensions.map(function (d) {
      return { label: d.label.replace(/\s*[A-Z]$/, ''), score: s.riasec.dims[d.id].score };
    });
    var anchorRows = CP.BANK_ANCHOR.dimensions.map(function (d) {
      return { label: d.label, value: s.anchor.dims[d.id].score };
    }).sort(function (x, y) { return (y.value || 0) - (x.value || 0); });
    var abilityRows = CP.BANK_ABILITY.dimensions.map(function (d) {
      return { label: d.label, value: s.ability.dims[d.id].score };
    }).sort(function (x, y) { return (y.value || 0) - (x.value || 0); });

    var flags = s.flags.length
      ? '<div class="note note-warn" style="margin-bottom:14px"><b>数据质量提示：</b><ul style="margin:6px 0 0;padding-left:20px">'
        + s.flags.map(function (f) { return '<li>' + esc(f.message) + '</li>'; }).join('') + '</ul></div>'
      : '<div class="note note-ok" style="margin-bottom:14px">数据质量检查通过：各维度作答有足够区分度，作答速度正常。</div>';

    return '<div class="card"><div class="card-head"><h3>一句话画像</h3></div>'
      + '<div style="font-size:16px;font-weight:600">' + esc(s.oneLiner || '数据不足，请先完成测评') + '</div>'
      + '</div>'
      + flags
      + '<div class="grid grid-3">'
      + '<div class="card" style="box-shadow:none"><div class="card-head"><h3>兴趣六边形</h3></div>'
      + '<div class="chart-shell">' + CP.chartRadar(axes, { size: 280 }) + '</div>'
      + '<div class="chart-caption">霍兰德代码 <b style="font-size:17px;color:var(--brand)">' + esc(s.holland.code || '—') + '</b></div>'
      + deriveInterest(s)
      + '</div>'
      + '<div class="card" style="box-shadow:none"><div class="card-head"><h3>职业锚强度</h3></div>'
      + CP.chartBars(anchorRows, { width: 320, labelW: 86, digits: 0 })
      + '<div style="font-size:12.5px;margin-top:4px">主锚：<b>' + esc(s.anchorTop.primary ? s.anchorTop.primary.label : '—') + '</b>'
      + (s.anchorTop.isDual ? ' <span class="tag tag-warn">双锚</span>' : '')
      + (s.anchorTop.secondary ? '　副锚：' + esc(s.anchorTop.secondary.label) : '') + '</div>'
      + (s.anchorTop.isDual ? '<div class="disclaimer" style="margin-top:4px">主副锚分数非常接近。这意味着你的职业诉求有两条主线，选工作时最好两者都能兼顾，否则容易干得不痛快。</div>' : '')
      + deriveAnchor(s)
      + '</div>'
      + '<div class="card" style="box-shadow:none"><div class="card-head"><h3>能力八维</h3></div>'
      + CP.chartBars(abilityRows, { width: 320, labelW: 86, digits: 0 })
      + deriveAbility(s)
      + '</div>'
      + '</div>';
  }

  function deriveInterest(s) {
    var rows = s.holland.all.map(function (x, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.label) + '</td><td class="num">' + fmt(x.score, 1) + '</td></tr>';
    }).join('');
    return '<details class="derive"><summary>查看推导</summary><div class="derive-body">'
      + '<div class="formula">norm = (raw − 1) / (5 − 1) × 100　（反向题先取 raw\' = 6 − raw）\n维度得分 = 该维度 6 道题 norm 的算术平均</div>'
      + '<table><thead><tr><th>排名</th><th>维度</th><th class="num">得分</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div></details>';
  }

  function deriveAnchor(s) {
    var rows = s.anchorTop.all.map(function (x, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.label) + '</td><td class="num">' + fmt(x.score, 1) + '</td></tr>';
    }).join('');
    return '<details class="derive"><summary>查看推导</summary><div class="derive-body">'
      + '<div class="formula">每个锚 5 道题，取 norm 均值\n主锚 = 最高分锚；主副分差 &lt; 6 分 → 标记为"双锚"</div>'
      + '<table><thead><tr><th>排名</th><th>职业锚</th><th class="num">得分</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div></details>';
  }

  function deriveAbility(s) {
    var items = CP.activeItems(CP.BANK_ABILITY, CP.ui.archive.profile);
    var rows = CP.BANK_ABILITY.dimensions.map(function (d) {
      var x = s.ability.dims[d.id];
      var total = items.filter(function (it) { return it.dim === d.id; })
        .reduce(function (sum, it) { return sum + it.weight; }, 0);
      return '<tr><td>' + esc(d.label) + '</td>'
        + '<td class="num">' + (x.checked || 0) + ' / ' + (x.expected || 0) + '</td>'
        + '<td class="num">' + (x.weightChecked || 0) + ' / ' + (total || 100) + '</td>'
        + '<td class="num">' + fmt(x.score, 1) + '</td></tr>';
    }).join('');
    return '<details class="derive"><summary>查看推导</summary><div class="derive-body">'
      + '<div class="formula">维度得分 = 100 × Σ(已勾项权重) / Σ(该维全部项权重)\n未勾的项计 0 分</div>'
      + '<table><thead><tr><th>能力维度</th><th class="num">已勾项</th><th class="num">已勾权重</th><th class="num">得分</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '</div></details>';
  }

  /* ============================================================
   * ② 岗位匹配
   * ============================================================ */
  function jobCard(r, rank) {
    return '<div class="jobcard' + (rank === 1 ? ' hi' : '') + '">'
      + '<div class="jh"><span class="tag' + (rank === 1 ? ' tag-brand' : '') + '">第 ' + rank + ' 名</span>'
      + '<b>' + esc(r.name) + '</b><span class="tag">' + esc(r.family) + '</span>'
      + '<span class="fit">' + r.shown + '<small> / 100</small></span></div>'
      + '<div style="font-size:12.5px;color:var(--ink-2)">' + esc(r.summary) + '</div>'
      + '<div class="grid grid-3" style="margin-top:10px;gap:10px">'
      + '<div class="why"><div><span class="k">兴趣匹配</span><b>' + fmt(r.parts.interest, 1) + '</b> × 40%</div>'
      + '<div><span class="k">能力适配</span><b>' + fmt(r.parts.ability, 1) + '</b> × 45%</div>'
      + '<div><span class="k">锚对齐</span><b>' + (r.parts.anchor === null ? '—' : fmt(r.parts.anchor, 1)) + '</b> × 15%</div></div>'
      + '<div class="why" style="grid-column:span 2">'
      + '<div><span class="k">主要贡献</span>' + (r.contributions.length ? r.contributions.map(function (c) { return esc(c.label) + '（' + fmt(c.pct, 0) + '%）'; }).join('、') : '—') + '</div>'
      + '<div><span class="k">主要拖累</span>' + (r.drags.length ? r.drags.map(function (c) { return esc(c.label) + '（差 ' + c.gap + ' 分）'; }).join('、') : '无明显短板') + '</div>'
      + '<div><span class="k">学历门槛</span>' + esc(r.minEdu) + '　<span class="k">参考薪资</span>' + esc(r.salaryBand) + '</div>'
      + '</div></div>'
      + '<div style="font-size:12px;color:var(--ink-3);margin-top:8px"><b>这个岗位的风险：</b>' + esc(r.risks) + '</div>'
      + deriveJob(r)
      + '</div>';
  }

  function deriveJob(r) {
    var idetail = r.detail.interest.map(function (d) {
      return '<tr><td>' + esc(d.dim) + '</td><td class="num">' + d.want + '</td><td class="num">' + fmt(d.got, 1) + '</td><td class="num">' + fmt(d.ratio * 100, 1) + '%</td></tr>';
    }).join('');
    var adetail = r.detail.ability.map(function (d) {
      return '<tr><td>' + esc(CP.abilityLabel(d.dim)) + '</td><td class="num">' + d.req + '</td><td class="num">' + fmt(d.got, 1) + '</td><td class="num">' + d.gap + '</td><td class="num">' + fmt(d.contrib, 3) + '</td></tr>';
    }).join('');
    var andetail = r.detail.anchor.map(function (d) {
      return '<tr><td>' + esc(d.label) + '</td><td>' + esc(d.reason) + '</td><td class="num">' + d.weight + ' × ' + d.got + '</td></tr>';
    }).join('');

    return '<details class="derive"><summary>查看推导</summary><div class="derive-body">'
      + '<div class="formula">Fit = 0.40 × 兴趣匹配 + 0.45 × 能力适配 + 0.15 × 锚对齐\n'
      + '     = 0.40 × ' + fmt(r.parts.interest, 1) + ' + 0.45 × ' + fmt(r.parts.ability, 1) + ' + 0.15 × ' + (r.parts.anchor === null ? 0 : fmt(r.parts.anchor, 1)) + '\n'
      + '     = ' + fmt(r.fit, 2) + ' → 展示为 ' + r.shown + '</div>'
      + '<b style="font-size:12.5px">兴趣匹配（达到岗位期望即满分，超出不加分）</b>'
      + '<div class="formula">interest = 100 × Σ w·min(我的得分 / 岗位期望, 1) / Σ w</div>'
      + '<table><thead><tr><th>兴趣维度</th><th class="num">岗位期望</th><th class="num">我的得分</th><th class="num">达成率</th></tr></thead><tbody>' + idetail + '</tbody></table>'
      + '<b style="font-size:12.5px;display:block;margin-top:10px">能力适配（软最小值：缺口平方惩罚）</b>'
      + '<div class="formula">ability = 100 × Σ ω·(1 − max(0, 期望 − 我的) / 100)² / Σ ω</div>'
      + '<table><thead><tr><th>能力维度</th><th class="num">岗位期望</th><th class="num">我的自评</th><th class="num">缺口</th><th class="num">加权贡献</th></tr></thead><tbody>' + adetail + '</tbody></table>'
      + '<b style="font-size:12.5px;display:block;margin-top:10px">职业锚对齐</b>'
      + '<div class="formula">anchor = 100 × Σ(命中得分) / 1.5　（主锚权重 1.0，副锚 0.5；命中首位得 1.0，命中第 2/3 位得 0.5）</div>'
      + '<table><thead><tr><th>我的锚</th><th>判定</th><th class="num">得分</th></tr></thead><tbody>' + (andetail || '<tr><td colspan="3">—</td></tr>') + '</tbody></table>'
      + '</div></details>';
  }

  function tabMatch(res, a) {
    var m = res.match;
    if (!m.ranked.length) {
      return '<div class="card"><div class="empty">所有岗位都被硬约束排除了。请回到「基本信息」放宽读研限制，或到「决策输入」取消排除标记。</div></div>';
    }

    var w = m.ranked[0].parts;
    var weightNote = m.isFreshman
      ? '<div class="note note-ok" style="margin-bottom:14px"><b>本次使用「大一」权重：兴趣 ' + Math.round(w.interestWeight * 100)
        + '% ／ 能力 ' + Math.round(w.abilityWeight * 100) + '% ／ 锚 ' + Math.round(w.anchorWeight * 100) + '%。</b></div>'
      : '';

    var conf = m.ambiguous
      ? '<div class="note note-warn" style="margin-bottom:14px"><b>前两名只差 ' + m.margin + ' 分。</b>这说明你的优势还不够聚焦——第 1 名和第 2 名并没有本质差别，请结合自己的偏好来决定，不要因为排序就认定必须选第一个。</div>'
      : '<div class="note note-ok" style="margin-bottom:14px">第 1 名比第 2 名高 ' + m.margin + ' 分，排序有一定的区分度。</div>';

    var excluded = m.excluded.length
      ? '<div class="card"><div class="card-head"><h3>被硬约束排除的岗位</h3><span class="tag tag-warn">' + m.excluded.length + ' 个</span></div>'
        + m.excluded.map(function (e) {
          return '<div style="padding:8px 0;border-bottom:1px solid var(--line-2)"><b>' + esc(e.job.name) + '</b>'
            + '<div style="font-size:12px;color:var(--danger)">' + e.reasons.map(esc).join('；') + '</div></div>';
        }).join('')
        + '</div>'
      : '';

    var rankRows = m.ranked.map(function (r, i) {
      return '<div class="rank-row' + (i === 0 ? ' top1' : '') + '">'
        + '<span class="idx">' + (i + 1) + '</span>'
        + '<span class="nm"><b>' + esc(r.name) + '</b><span>' + esc(r.family) + '　兴趣 ' + fmt(r.parts.interest, 0) + '｜能力 ' + fmt(r.parts.ability, 0) + '｜锚 ' + (r.parts.anchor === null ? '—' : fmt(r.parts.anchor, 0)) + '</span></span>'
        + '<span>' + CP.barInline(r.fit) + '</span>'
        + '<span class="score">' + r.shown + '</span></div>';
    }).join('');

    // 职业简表：与报告第二章同源，让学生在界面里就能看到
    var digestRows = m.top.map(function (r, i) {
      var j = CP.getJob(r.jobId);
      var tp = CP.report.workMixTop(j);
      return '<tr>'
        + '<td data-label="排名">' + (i + 1) + '</td>'
        + '<td data-label="岗位"><b>' + esc(r.name) + '</b>'
        + '<div style="font-size:11.5px;color:var(--ink-3);margin-top:2px">' + esc(j.duties.slice(0, 3).join('；')) + '</div></td>'
        + '<td data-label="一周工作内容">' + esc(CP.report.workMixText(j))
        + (tp ? '<div style="font-size:11.5px;color:var(--ink-3);margin-top:2px">'
          + esc(CP.report.textFor('digestHint', { job: j })) + '</div>' : '') + '</td>'
        + '<td data-label="学历门槛">' + esc(r.minEdu) + '</td>'
        + '<td data-label="参考薪资">' + esc(r.salaryBand.replace(/^示例区间：/, '')) + '</td>'
        + '<td data-label="风险">' + esc(r.risks) + '</td>'
        + '</tr>';
    }).join('');

    var digest = m.top.length
      ? '<div class="card"><div class="card-head"><h3>排名较高的职业简表</h3>'
        + '<span class="tag">来自岗位库，报告同款</span></div>'
        + '<div class="table-wrap"><table class="card-table"><thead><tr>'
        + '<th>排名</th><th>岗位与职责</th><th>一周工作内容占比</th><th>学历门槛</th><th>参考薪资</th><th>这个岗位的风险</th>'
        + '</tr></thead><tbody>' + digestRows + '</tbody></table></div>'
        + '<div class="note" style="margin-top:10px">「一周工作内容占比」一栏值得特别留意——'
        + '很多人对某个岗位的想象与实际工作内容差距极大。数据为课程示例，非实时行情。</div>'
        + '</div>'
      : '';

    return weightNote + conf
      + digest
      + '<div class="card"><div class="card-head"><h3>Top 3 推荐</h3><span class="tag">综合适配度排序</span></div>'
      + '<div class="grid" style="gap:12px">' + m.top.map(function (r, i) { return jobCard(r, i + 1); }).join('') + '</div></div>'
      + (m.backup.length ? '<div class="card"><div class="card-head"><h3>备选（第 4-6 位）</h3></div>'
        + m.backup.map(function (r) {
          return '<div style="padding:8px 0;border-bottom:1px solid var(--line-2)"><b>' + esc(r.name) + '</b> '
            + '<span class="tag">' + r.shown + ' 分</span>'
            + '<div style="font-size:12px;color:var(--ink-2)">' + esc(r.summary) + '</div></div>';
        }).join('') + '</div>' : '')
      + '<div class="card"><div class="card-head"><h3>完整排序</h3></div>' + rankRows + '</div>'
      + excluded;
  }

  /* ============================================================
   * ③ 差距与任务
   * ============================================================ */
  function tabGap(res, a) {
    var top = res.match.ranked[0];
    if (!top) return '<div class="card"><div class="empty">没有可比较的岗位。</div></div>';

    var rows = top.detail.ability.map(function (d) {
      // 缺口现算并保留 1 位小数：100 − 96.6 这类减法会产出 3.400000000000006
      return { label: CP.abilityLabel(d.dim), got: d.got, req: d.req, gap: CP.round(Math.max(0, d.req - d.got), 1) };
    }).sort(function (x, y) { return y.gap - x.gap; });

    var perWeek = a.decision.hoursPerWeek || 8;
    var gapCards = res.gaps.map(function (g, i) {
      var isExplore = g.dim === '_explore';
      return '<div class="card" style="box-shadow:none"><div class="card-head"><h3>'
        + (isExplore ? '第一步：' : '缺口 ' + (i + 1) + '：') + esc(g.label) + '</h3>'
        + (isExplore ? '<span class="tag tag-brand">方向探索</span>'
          : '<span class="tag tag-danger">差 ' + g.gap + ' 分</span>')
        + '</div>'
        + (isExplore
          ? '<div style="font-size:12.5px;color:var(--ink-2)">'
            + esc(g.basis) + '</div>'
          : '<div style="font-size:12.5px;color:var(--ink-2)">目标岗位「' + esc(g.forJob) + '」要求 ' + g.req + ' 分，你当前 ' + g.got + ' 分；'
            + '该缺口在加权计算中占全部缺口的 <b>' + fmt(g.severityPct, 1) + '%</b>。<br><b>排序依据：</b>' + esc(g.basis) + '</div>')
        + '<div style="margin-top:10px"><b style="font-size:12.5px">学习任务</b>'
        + '<ul style="margin:4px 0 8px;padding-left:20px;font-size:12.5px">' + g.tasks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        + '<b style="font-size:12.5px">验收作品（没有作品就不算完成）</b>'
        + '<ul style="margin:4px 0 8px;padding-left:20px;font-size:12.5px">' + g.deliverables.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        + '<div style="font-size:11.5px;color:var(--ink-3)">预计投入 ' + g.hours + ' 小时｜按每周 ' + perWeek + ' 小时计约 '
        + Math.ceil(g.hours / perWeek) + ' 周｜参考资源：' + esc((g.resources || []).join('、')) + '</div>'
        + '</div></div>';
    }).join('');

    // 窄屏换用紧凑排版：一个 560 宽的图缩到 320 会让 11px 的字变成 1.5mm，读不了
    var narrow = CP.isNarrow();
    var gapChart = narrow
      ? CP.chartGapsCompact(rows, { width: 340 })
      : CP.chartGaps(rows, { width: 560 });

    return '<div class="card"><div class="card-head"><h3>我与「' + esc(top.name) + '」的能力对照</h3>'
      + '<span class="tag">' + (narrow ? '绿＝我的水平　红＝缺口' : '左＝我的自评　右＝距要求的缺口') + '</span></div>'
      + gapChart
      + '</div>'
      + '<div class="grid grid-3" style="margin-top:14px;gap:12px">' + (gapCards || '<div class="empty">当前岗位没有明显缺口</div>') + '</div>'
      + '<div class="card" style="margin-top:14px"><div class="card-head"><h3>其他岗位的差距速览</h3></div>'
      + '<div class="table-wrap"><table class="card-table"><thead><tr><th>岗位</th><th>最大缺口</th><th class="num">缺口分值</th><th>第二缺口</th></tr></thead><tbody>'
      + res.match.top.map(function (r) {
        var d = r.drags;
        return '<tr><td data-label="岗位">' + esc(r.name) + '</td>'
          + '<td data-label="最大缺口">' + (d[0] ? esc(d[0].label) : '无') + '</td>'
          + '<td class="num" data-label="缺口分值">' + (d[0] ? d[0].gap : '—') + '</td>'
          + '<td data-label="第二缺口">' + (d[1] ? esc(d[1].label) + '（差 ' + d[1].gap + '）' : '—') + '</td></tr>';
      }).join('')
      + '</tbody></table></div>'
      + '<div class="disclaimer" style="margin-top:8px">如果多个目标岗位的最大缺口都指向同一项能力，那基本可以确定：<b>这就是你未来半年最该投入的方向。</b></div>'
      + '</div>';
  }

  /* ============================================================
   * ④ 决策与路径
   * ============================================================ */
  function tabDecision(res, a) {
    var d = res.decision;
    var primary = d.primary;

    var weightRows = CP.CRITERIA.map(function (c) {
      return { label: c.label, value: CP.round(d.weights.weights[c.id] * 100, 1) };
    }).sort(function (x, y) { return y.value - x.value; });

    var pathRows = d.ranked.map(function (r, i) {
      return '<tr' + (i === 0 ? ' style="background:var(--brand-soft)"' : '') + '>'
        + '<td>' + (i + 1) + '</td><td><b>' + esc(r.name) + '</b>'
        + (r.editedByUser ? ' <span class="tag tag-brand">你改过评分</span>' : '')
        + '<div style="font-size:11.5px;color:var(--ink-3);margin-top:2px">' + esc(r.summary) + '</div></td>'
        + '<td class="num"><b>' + r.shown + '</b></td>'
        + '<td style="min-width:110px">' + CP.barInline(r.total) + '</td></tr>';
    }).join('');

    var milestones = primary && primary.milestones
      ? '<div class="timeline">'
        + [['本学期', 'term'], ['1 年内', 'oneYear'], ['3 年内', 'threeYear'], ['5 年内', 'fiveYear']].map(function (pair) {
          var list = primary.milestones[pair[1]] || [];
          return '<div class="node"><b>' + esc(pair[0]) + '</b><ul>' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
        }).join('')
        + '</div>'
      : '<div class="empty">暂无路径里程碑</div>';

    return '<div class="grid grid-2">'
      + '<div class="card" style="box-shadow:none"><div class="card-head"><h3>决策标准权重</h3></div>'
      + CP.chartPie(weightRows, { size: 190 })
      + '</div>'
      + '<div class="card" style="box-shadow:none"><div class="card-head"><h3>主路径与备选</h3></div>'
      + (primary ? '<div style="font-size:15px;font-weight:650">主路径：' + esc(primary.name) + '（' + primary.shown + ' 分）</div>'
        + '<div style="font-size:12.5px;color:var(--ink-2);margin-top:4px">' + esc(primary.summary) + '</div>'
        + '<div style="font-size:12px;color:var(--danger);margin-top:8px"><b>风险：</b>' + esc(primary.risks) + '</div>' : '')
      + (d.planB ? '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">'
        + '<div style="font-size:13.5px;font-weight:650">Plan B：' + esc(d.planB.name) + '（' + d.planB.shown + ' 分）</div>'
        + '<div style="font-size:12px;color:var(--ink-2);margin-top:3px">' + esc(d.planB.summary) + '</div></div>' : '')
      + (d.consistent === false
        ? '<div class="note note-warn" style="margin-top:10px">你在最重要的标准「' + esc(d.topCriterionLabel) + '」上，给「' + esc(d.bestOnTopCriterion.name) + '」打了最高分，但它并不是加权总分第一。'
          + '这通常意味着<b>你心里其实更想要另一条路</b>，只是被其他标准拉低了总分。建议两条都认真考虑。</div>'
        : (d.consistent === true ? '<div class="note note-ok" style="margin-top:10px">一致性检查通过：你在最重要标准上打分最高的路径，正是加权总分第一的路径。</div>' : ''))
      + '</div></div>'

      + '<div class="card" style="margin-top:14px"><div class="card-head"><h3>路径加权排序</h3>'
      + '<span class="tag">得分 = Σ（评分/5 × 100 × 权重）</span></div>'
      + '<div class="table-wrap"><table><thead><tr><th>#</th><th>候选路径</th><th class="num">加权得分</th><th>分布</th></tr></thead><tbody>' + pathRows + '</tbody></table></div>'
      + deriveDecision(d)
      + '</div>'

      + '<div class="card" style="margin-top:14px"><div class="card-head"><h3>主路径时间轴</h3>'
      + '<span class="tag">' + esc(primary ? primary.name : '—') + '</span></div>' + milestones + '</div>';
  }

  function deriveDecision(d) {
    var rows = CP.CRITERIA.map(function (c) {
      return '<tr><td>' + esc(c.label) + '</td><td class="num">' + fmt(d.weights.weights[c.id] * 100, 1) + '%</td></tr>';
    }).join('');
    return '<details class="derive"><summary>查看推导</summary><div class="derive-body">'
      + '<div class="formula">权重 w_i = (6 − 名次) / Σ(6 − 名次)，Σw = 1\n路径得分 = Σ_i w_i × (评分_i / 5) × 100</div>'
      + '<table><thead><tr><th>决策标准</th><th class="num">权重</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div></details>';
  }

  /* ============================================================
   * ⑤ SWOT
   * ============================================================ */
  function tabSWOT(res, a) {
    var s = res.swot;
    function q(cls, title, list) {
      return '<div class="q ' + cls + '"><h4>' + esc(title) + '</h4><ul>'
        + (list.length ? list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') : '<li>—</li>')
        + '</ul></div>';
    }
    var top = res.match.ranked[0];

    return '<div class="note" style="margin-bottom:14px">SWOT 由测评数据<b>半自动</b>生成：优势/劣势来自兴趣、锚与能力得分，机会/威胁来自岗位画像与路径决策。这些是"素材"，不是结论——请你在导出报告里用自己的话再改一遍，那才是真正的规划。</div>'
      + '<div class="swot">'
      + q('s', 'S 优势', s.strengths)
      + q('w', 'W 劣势', s.weaknesses)
      + q('o', 'O 机会', s.opportunities)
      + q('t', 'T 威胁', s.threats)
      + '</div>'
      + (top ? '<div class="card" style="margin-top:14px"><div class="card-head"><h3>目标岗位画像速览</h3><span class="tag">' + esc(top.name) + '</span></div>'
        + '<div class="grid grid-2"><div><b style="font-size:12.5px">主要职责</b>'
        + '<ul style="margin:4px 0 0;padding-left:20px;font-size:12.5px">' + CP.JOB_FAMILIES.filter(function (j) { return j.id === top.jobId; })[0].duties.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
        + '<div><b style="font-size:12.5px">典型雇主</b>'
        + '<ul style="margin:4px 0 0;padding-left:20px;font-size:12.5px">' + (top.employers || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>'
        + '<div style="font-size:12.5px;margin-top:10px"><b>参考薪资：</b>' + esc(top.salaryBand) + '</div>'
        + '<div style="font-size:12.5px"><b>风险：</b>' + esc(top.risks) + '</div>'
        + '</div>' : '');
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
