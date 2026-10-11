/*!
 * 契约与数据层测试：题目数量、维度覆盖、岗位与路径字段完整性
 */
'use strict';
var t = require('./tiny');
var CP = require('./load');

function countByDim(bank) {
  var c = {};
  bank.dimensions.forEach(function (d) { c[d.id] = 0; });
  bank.items.forEach(function (it) { c[it.dim] = (c[it.dim] || 0) + 1; });
  return c;
}

module.exports = function () {
  t.group('一、契约与数据完整性');

  t.test('契约版本与存档类型已定义', function () {
    // 版本号必须与 数据/schema.js 一致；
    // 1.1.0 能力部分改勾选式，1.2.0 加长远打算，1.3.0 长远打算改为系统生成的逐年建议
    t.eq(CP.SCHEMA_VERSION, '1.3.0');
    t.eq(CP.ARCHIVE_KIND, 'ai-career-workbench/archive');
  });

  t.test('空档案含能力证据字段，且不含逐年建议（后者不进档案）', function () {
    var a = CP.createBlankArchive();
    t.ok(Object.prototype.hasOwnProperty.call(a, 'abilityEvidence'), '缺少 abilityEvidence 字段');
    t.eq(typeof a.abilityEvidence, 'object');
    t.eq(Object.keys(a.abilityEvidence).length, 0, '新档案的证据字段应为空');
    // 逐年规划建议是系统算出来的，不应该被存进档案
    t.ok(!Object.prototype.hasOwnProperty.call(a, 'longTermPlan'),
      '逐年建议不应作为档案字段存在（应由 CP.yearPlan 实时生成）');
  });

  t.test('空档案包含全部必需字段', function () {
    var a = CP.createBlankArchive();
    ['kind', 'schemaVersion', 'profile', 'answers', 'decision', 'actions', 'reviews'].forEach(function (k) {
      t.ok(Object.prototype.hasOwnProperty.call(a, k), '缺少字段 ' + k);
    });
    t.ok(!('interviews' in a), 'interviews 字段应已移除');
    ['riasec', 'anchor', 'ability', 'prefer'].forEach(function (k) {
      t.ok(a.answers[k] !== undefined, 'answers 缺少 ' + k);
    });
    t.eq(a.kind, CP.ARCHIVE_KIND);
  });

  t.test('RIASEC 共 36 题，6 维各 6 题', function () {
    var b = CP.BANK_RIASEC;
    t.eq(b.items.length, 36);
    t.eq(b.dimensions.length, 6);
    var c = countByDim(b);
    Object.keys(c).forEach(function (k) { t.eq(c[k], 6, '维度 ' + k + ' 题数不对'); });
  });

  t.test('RIASEC 每维至少 1 道反向题', function () {
    CP.BANK_RIASEC.dimensions.forEach(function (d) {
      var rev = CP.BANK_RIASEC.items.filter(function (i) { return i.dim === d.id && i.reverse; });
      t.ok(rev.length >= 1, '维度 ' + d.id + ' 缺少反向题');
    });
  });

  t.test('职业锚共 40 题，8 锚各 5 题', function () {
    var b = CP.BANK_ANCHOR;
    t.eq(b.items.length, 40);
    t.eq(b.dimensions.length, 8);
    var c = countByDim(b);
    Object.keys(c).forEach(function (k) { t.eq(c[k], 5, '锚 ' + k + ' 题数不对'); });
  });

  t.test('能力清单：两套清单各 48 题，8 维各 6 项，且每维权重合计 100', function () {
    var b = CP.BANK_ABILITY;
    t.eq(b.dimensions.length, 8);
    var fresh = CP.activeItems(b, { grade: '大一' });
    var senior = CP.activeItems(b, { grade: '大三' });
    t.eq(fresh.length, 48, '大一版清单应为 48 项');
    t.eq(senior.length, 48, '大二及以上版清单应为 48 项');
    t.eq(CP.activeItems(b, {}).length, 48, '未指定年级时默认使用大二及以上版');
    t.eq(CP.scaleOf(b, { grade: '大一' }).type, 'checklist', '量程应为勾选式');
    t.eq(CP.scaleOf(b, { grade: '大三' }).type, 'checklist');

    [['大一', fresh], ['大三', senior]].forEach(function (pair) {
      var c = {}, w = {};
      pair[1].forEach(function (it) {
        c[it.dim] = (c[it.dim] || 0) + 1;
        w[it.dim] = (w[it.dim] || 0) + it.weight;
      });
      Object.keys(c).forEach(function (k) {
        t.eq(c[k], 6, pair[0] + ' 清单下维度 ' + k + ' 应为 6 项');
        t.eq(w[k], 100, pair[0] + ' 清单下维度 ' + k + ' 的权重应合计 100，实际 ' + w[k]);
      });
    });
  });

  t.test('能力清单的权重递增，且两套清单的题目各不相同', function () {
    var b = CP.BANK_ABILITY;
    [['大一', 0], ['大三', 1]].forEach(function (pair) {
      var items = CP.activeItems(b, { grade: pair[0] });
      var dim = items.filter(function (it) { return it.dim === 'math'; });
      for (var i = 1; i < dim.length; i++) {
        t.ok(dim[i].weight >= dim[i - 1].weight, pair[0] + ' 的权重应单调不减（由易到难）');
      }
      // 权重递增的理由：等权会让"修完一门课"只拿到 33%，区分度不够
      t.ok(dim[dim.length - 1].weight > dim[0].weight, pair[0] + ' 首尾权重应有明显差距');
    });
    var fresh = CP.activeItems(b, { grade: '大一' });
    var senior = CP.activeItems(b, { grade: '大三' });
    t.ok(fresh[0].text !== senior[0].text, '两套清单的题目措辞必须不同（大一版门槛更低）');
  });

  t.test('能力清单的每一维第 1 项都刻意低门槛，避免正常填答落到 0 分', function () {
    // 勾选式唯一需要小心的地方：如果第 1 项门槛太高，诚实作答的人会全维 0 分
    ['大一', '大三'].forEach(function (g) {
      var items = CP.activeItems(CP.BANK_ABILITY, { grade: g });
      CP.BANK_ABILITY.dimensions.forEach(function (d) {
        var first = items.filter(function (it) { return it.dim === d.id; })[0];
        t.ok(first, g + ' 的 ' + d.id + ' 维缺少第 1 项');
        t.ok(first.weight >= 12 && first.weight <= 15,
          g + ' 的 ' + d.id + ' 维第 1 项权重应在 12-15 之间（低门槛档位），实际 ' + first.weight);
      });
    });
  });

  t.test('题目 id 在其所属年级口径内唯一', function () {
    [['riasec', null], ['anchor', null], ['ability', { grade: '大一' }], ['ability', { grade: '大三' }]].forEach(function (pair) {
      var seen = {};
      CP.activeItems(CP.BANKS[pair[0]], pair[1]).forEach(function (it) {
        t.ok(!seen[it.id], pair[0] + ' 的题目 id 在其口径内重复：' + it.id);
        seen[it.id] = true;
      });
    });
    // 两套能力题共用题号（math1 等），但题目文字必须不同，否则口径切换没有意义
    var fresh = CP.activeItems(CP.BANK_ABILITY, { grade: '大一' });
    var senior = CP.activeItems(CP.BANK_ABILITY, { grade: '大三' });
    fresh.forEach(function (f, i) {
      t.eq(f.id, senior[i].id, '两套能力题的题号应一一对应');
      t.ok(f.text !== senior[i].text, '题号 ' + f.id + ' 的两套问法不应相同');
    });
  });

  t.test('兴趣与职业锚不区分年级', function () {
    t.eq(CP.activeItems(CP.BANK_RIASEC, { grade: '大一' }).length, 36);
    t.eq(CP.activeItems(CP.BANK_RIASEC, { grade: '研三' }).length, 36);
    t.eq(CP.activeItems(CP.BANK_ANCHOR, { grade: '大一' }).length, 40);
  });

  t.test('能力题目的维度必须存在于能力维度表', function () {
    var ids = CP.BANK_ABILITY.dimensions.map(function (d) { return d.id; });
    CP.BANK_ABILITY.items.forEach(function (it) {
      t.ok(ids.indexOf(it.dim) >= 0, '未知能力维度 ' + it.dim);
    });
  });

  t.test('岗位库至少 10 个岗位，字段齐全', function () {
    t.ok(CP.JOB_FAMILIES.length >= 10, '岗位数应至少 10，实际 ' + CP.JOB_FAMILIES.length);
    CP.JOB_FAMILIES.forEach(function (j) {
      ['id', 'name', 'family', 'summary', 'duties', 'interest', 'ability', 'anchor', 'minEdu', 'employers', 'salaryBand', 'risks'].forEach(function (f) {
        t.ok(j[f] !== undefined && j[f] !== null, j.id + ' 缺少字段 ' + f);
      });
      t.eq(Object.keys(j.interest).length, 6, j.id + ' 兴趣画像应有 6 类');
      t.eq(Object.keys(j.ability).length, 8, j.id + ' 能力要求应有 8 项');
      t.ok(j.anchor.length >= 1 && j.anchor.length <= 3, j.id + ' 锚画像应为 1-3 个');
      t.ok(CP.EDU_LEVELS.indexOf(j.minEdu) >= 0, j.id + ' 学历门槛取值非法');
      Object.keys(j.interest).forEach(function (k) {
        t.ok(j.interest[k] >= 0 && j.interest[k] <= 100, j.id + ' 兴趣值越界 ' + k);
      });
      Object.keys(j.ability).forEach(function (k) {
        t.ok(j.ability[k] >= 0 && j.ability[k] <= 100, j.id + ' 能力值越界 ' + k);
      });
      j.anchor.forEach(function (a) {
        var valid = CP.BANK_ANCHOR.dimensions.some(function (d) { return d.id === a; });
        t.ok(valid, j.id + ' 引用了未知职业锚 ' + a);
      });
    });
  });

  t.test('每个岗位都有工作内容时间分配，且四项合计 100', function () {
    var keys = CP.DUTY_KEYS.map(function (d) { return d.k; });
    t.eq(CP.DUTY_KEYS.length, 4);
    CP.JOB_FAMILIES.forEach(function (j) {
      t.ok(j.workMix, j.id + ' 缺少 workMix');
      var sum = 0;
      keys.forEach(function (k) {
        t.ok(typeof j.workMix[k] === 'number', j.id + ' 的 workMix 缺少 ' + k);
        t.ok(j.workMix[k] >= 0 && j.workMix[k] <= 100, j.id + ' 的 ' + k + ' 取值越界');
        sum += j.workMix[k];
      });
      t.eq(sum, 100, j.id + ' 的工作内容占比合计应为 100，实际 ' + sum);
    });
  });

  t.test('岗位 id 唯一', function () {
    var seen = {};
    CP.JOB_FAMILIES.forEach(function (j) {
      t.ok(!seen[j.id], '岗位 id 重复：' + j.id);
      seen[j.id] = true;
    });
  });

  t.test('路径库 6 条路径，默认评分覆盖全部 6 项标准', function () {
    t.eq(CP.PATHS.length, 6);
    var critIds = CP.CRITERIA.map(function (c) { return c.id; });
    CP.PATHS.forEach(function (p) {
      critIds.forEach(function (c) {
        t.ok(typeof p.defaults[c] === 'number', p.id + ' 缺少默认评分 ' + c);
        t.ok(p.defaults[c] >= 1 && p.defaults[c] <= 5, p.id + ' 默认评分越界 ' + c);
      });
      t.ok(p.milestones && p.milestones.term && p.milestones.oneYear, p.id + ' 缺少里程碑');
      (p.relatedJobs || []).forEach(function (jid) {
        t.ok(CP.getJob(jid) !== null, p.id + ' 引用了未知岗位 ' + jid);
      });
    });
  });

  t.test('决策标准共 6 项且 id 唯一', function () {
    t.eq(CP.CRITERIA.length, 6);
    var seen = {};
    CP.CRITERIA.forEach(function (c) {
      t.ok(!seen[c.id], '标准 id 重复：' + c.id);
      seen[c.id] = true;
    });
  });

  t.test('空档案的完整性检查能列出全部待办', function () {
    var a = CP.createBlankArchive();
    var missing = CP.validateArchive(a);
    t.ok(missing.length >= 6, '空档案应列出多项缺失，实际 ' + missing.length);
    t.ok(missing.some(function (m) { return m.indexOf('兴趣测评') >= 0; }), '应提示兴趣测评未完成');
  });

  /* ============================================================
   * 本地时间：日期必须按本地时区取，不能走 UTC
   * ============================================================ */

  t.test('dateOnly 取本地日期，不受 UTC 偏移影响', function () {
    // 本地凌晨 3 点：东八区下 UTC 还停在前一天。
    // 旧写法 new Date().toISOString().slice(0,10) 会得到昨天，
    // 于是"今天到期"的任务会被误判为逾期。
    var early = new Date(2026, 9, 10, 3, 0, 0);   // 2026-10-10 03:00 本地
    t.eq(CP.dateOnly(early), '2026-10-10', '本地凌晨应仍算当天');
    t.eq(CP.dateOnly(new Date(2026, 9, 10, 23, 0, 0)), '2026-10-10', '本地深夜同理');
    // 月/日补零
    t.eq(CP.dateOnly(new Date(2026, 0, 5)), '2026-01-05');
    t.eq(CP.dateOnly(new Date(2026, 11, 31)), '2026-12-31');
  });

  t.test('dateOnly 在跨月与跨年边界正确', function () {
    t.eq(CP.dateOnly(new Date(2026, 0, 1)), '2026-01-01');
    t.eq(CP.dateOnly(new Date(2026, 11, 32 - 31)), '2026-12-01');
    // 月末加一天要进位到下个月
    var d = new Date(2026, 0, 31);
    d.setDate(d.getDate() + 1);
    t.eq(CP.dateOnly(d), '2026-02-01', '1 月 31 日加一天应到 2 月 1 日');
  });

  t.test('parseDateOnly 按本地时区解析，不产生日期偏移', function () {
    var d = CP.parseDateOnly('2026-03-20');
    t.eq(d.getFullYear(), 2026);
    t.eq(d.getMonth(), 2);
    t.eq(d.getDate(), 20, '不能变成 19 日（UTC 解析在正时区会退一天）');
    t.eq(CP.dateOnly(CP.parseDateOnly('2026-03-20')), '2026-03-20', '解析后再格式化应回到原值');
    // 非法输入回退到当前时间，不抛错
    t.ok(CP.parseDateOnly('乱七八糟') instanceof Date);
    t.ok(CP.parseDateOnly('') instanceof Date);
  });

  t.test('localTime 把 UTC 时刻转成本地时间显示', function () {
    // 档案按惯例存 UTC，界面要显示墙上时间。
    // 直接切 ISO 串（slice(0,16).replace('T',' ')）会把 UTC 当本地时间，东八区下少 8 小时。
    var iso = '2026-10-10T14:11:32.809Z';
    var shown = CP.localTime(iso);
    var expect = new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    t.eq(shown, expect, '应与本地格式化结果一致');
    // 关键断言：不能等于直接切出来的 UTC 串
    t.ok(shown !== '2026/10/10 14:11', '不应显示 UTC 的 14:11');
    if (new Date().getTimezoneOffset() < 0) {
      t.ok(shown.indexOf('22:11') >= 0, '东八区应显示 22:11，实际 ' + shown);
    }
    // 毫秒时间戳也支持
    t.ok(CP.localTime(1700000000000).indexOf('2023') >= 0);

    // 取不到时给占位，不显示 NaN 或 undefined
    ['', null, undefined, '乱七八糟'].forEach(function (bad) {
      var out = CP.localTime(bad);
      t.eq(out, '—', '非法输入应返回占位符，实际 ' + out);
    });
    t.eq(CP.localTime('', '未知'), '未知', '应支持自定义占位符');
  });

  t.test('createdAt / updatedAt 在存档往返中不丢', function () {
    var a = CP.createBlankArchive();
    a.createdAt = '2026-09-01T02:00:00.000Z';
    a.updatedAt = '2026-10-10T14:00:00.000Z';
    var back = CP.migrate(JSON.parse(JSON.stringify(a)));
    t.eq(back.createdAt, '2026-09-01T02:00:00.000Z', 'createdAt 不应在迁移中丢失');
    t.eq(back.updatedAt, '2026-10-10T14:00:00.000Z', 'updatedAt 不应在迁移中丢失');
  });

  t.test('能力清单的完成门槛是"每维至少 1 项"，不是 48 项全勾', function () {
    var a = CP.createBlankArchive();
    a.profile.grade = '大三';

    // 一项都没勾：未达标
    var bp0 = CP.blockProgress('ability', a);
    t.eq(bp0.done, 0);
    t.eq(bp0.threshold, 8, '门槛应为 8（8 个维度）');
    t.eq(bp0.total, 48, '总题数仍是 48');
    t.eq(bp0.reached, false, '一项没勾不应算完成');

    // 每维只勾第 1 项：刚好达标——这就是"门槛"的意义
    CP.fillAbility(a, 1);
    var bp1 = CP.blockProgress('ability', a);
    t.eq(bp1.done, 8);
    t.eq(bp1.reached, true, '每维勾 1 项就应算完成，不该要求全勾');
    t.eq(CP.validateArchive(a).filter(function (m) { return m.indexOf('能力') >= 0; }).length, 0,
      '达标后完整性校验不应再报能力清单');

    // 差一个维度：未达标，且提示要说清差几个
    CP.fillAbility(a, { math: 1, code: 1, data: 1, model: 1, deploy: 1, product: 1, comm: 1 });
    var bp2 = CP.blockProgress('ability', a);
    t.eq(bp2.done, 7);
    t.eq(bp2.reached, false);
    var msg = CP.validateArchive(a).filter(function (m) { return m.indexOf('能力清单') >= 0; })[0];
    t.ok(msg && msg.indexOf('1 个维度') >= 0, '应提示还差 1 个维度，实际：' + msg);

    // 兴趣 / 职业锚仍是"答满才算完成"，不受影响
    var bpr = CP.blockProgress('riasec', a);
    t.eq(bpr.threshold, bpr.total, '兴趣测评的门槛应等于题目总数');
    t.eq(bpr.reached, false, '兴趣未答完不应算完成');
  });

  t.test('blockProgress 与 validateArchive 判据一致（回归：曾各写一套导致自相矛盾）', function () {
    var a = CP.createBlankArchive();
    a.profile.grade = '大三';
    // 只补上兴趣与职业锚，能力每维勾 1 项
    CP.activeItems(CP.BANKS.riasec, a.profile).forEach(function (it) { a.answers.riasec[it.id] = { v: 3, t: Date.now() }; });
    CP.activeItems(CP.BANKS.anchor, a.profile).forEach(function (it) { a.answers.anchor[it.id] = { v: 3, t: Date.now() }; });
    CP.fillAbility(a, 1);

    // 三块的"达标"与"校验不报错"必须一一对应
    ['riasec', 'anchor', 'ability'].forEach(function (k) {
      var bp = CP.blockProgress(k, a);
      var flagged = CP.validateArchive(a).some(function (m) {
        return m.indexOf(CP.BANKS[k].title.replace('能力清单', '能力清单')) >= 0;
      });
      t.eq(bp.reached, !flagged, k + ' 的门槛判定应与完整性校验一致');
    });
  });

  t.test('两个入口文件必须完全一致（index.html 与 工作台.html）', function () {
    // 为什么会有两个入口：
    //   index.html   → GitHub Pages / 静态服务器按惯例找的默认文档
    //   工作台.html   → 本地双击用的中文名入口
    // 两份内容相同。重复文件最大的风险是改了一个忘了另一个——
    // 那会导致"本地打开正常、线上打开是旧版"这种最难排查的问题。
    var fs = require('fs');
    var path = require('path');
    var ROOT = path.resolve(__dirname, '..');
    var a = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    var b = fs.readFileSync(path.join(ROOT, '工作台.html'), 'utf8');
    t.eq(a, b, '两个入口文件内容不一致——改了一个请同步另一个（或运行 npm run sync:entry）');
    // 顺带确认入口引用的都是相对路径，子目录部署才不会 404
    t.ok(a.indexOf('src="/') < 0, '入口不应使用根绝对路径');
    t.ok(a.indexOf('href="/') < 0, '入口不应使用根绝对路径');
  });

  t.test('localStorage 键在 file:// 下不带前缀（避免改目录名就丢进度）', function () {
    // 键名规则见 界面/存储.js。这里只断言"HTTP 下会分区、file:// 下不分区"这一约定，
    // 因为改目录名/搬动文件夹导致进度"丢失"是用户最不能接受的失败方式。
    var src = require('fs').readFileSync(
      require('path').resolve(__dirname, '..', '界面', '存储.js'), 'utf8');
    t.ok(src.indexOf("proto !== 'http:'") >= 0, '应按协议判断是否分区');
    t.ok(src.indexOf('ai-career-workbench/archive/v1') >= 0, '基础键名应保留');
  });

  t.test('任务截止日按本地日期推算，加 N 周不偏一天', function () {
    var a = CP.createBlankArchive();
    a.profile.grade = '大三';
    var s = {
      ability: { dims: { math: { score: 50, label: '数学' } } },
      holland: { code: 'I' }
    };
    var m = { ranked: [{ name: '算法研究员', drags: [{ dim: 'math', gap: 30, severity: 1, pct: 100 }] }] };
    var acts = CP.draftActions(a, s, m, { primary: { name: 'p', milestones: {} } }, '2026-03-20');
    t.ok(acts.length > 0, '应生成任务');
    var due = CP.parseDateOnly(acts[0].due);
    var start = CP.parseDateOnly('2026-03-20');
    var days = Math.round((due - start) / 86400000);
    t.eq(days % 7, 0, '截止日与起始日应相差整数周，实际 ' + days + ' 天');
    t.eq(days > 0, true, '截止日应在起始日之后');
  });

  t.test('能力清单两套口径共用 item id，weightOf 必须按年级查', function () {
    // 大一的清单与大三的清单共用同一批 id（math1…math6），
    // 只有题目文本与权重不同；而 bank.items 是两套的合并数组。
    // weightOf 若不带年级地按 id 查找，会命中排在前面那套——拿到另一套的权重。
    var freshW = CP.ABILITY_WEIGHTS.fresh;
    var seniorW = CP.ABILITY_WEIGHTS.senior;
    t.ok(freshW.join() !== seniorW.join(), '两套权重表应当不同，否则这条检查没有意义');
    t.eq(freshW.reduce(function (a, b) { return a + b; }, 0), 100, '大一权重合计应为 100');
    t.eq(seniorW.reduce(function (a, b) { return a + b; }, 0), 100, '高年级权重合计应为 100');

    t.eq(CP.BANK_ABILITY.weightOf('math1', { grade: '大一' }), freshW[0], '大一的 math1 应取大一权重表');
    t.eq(CP.BANK_ABILITY.weightOf('math1', { grade: '大三' }), seniorW[0], '大三的 math1 应取高年级权重表');

    // 关键一致性：weightOf 必须与计分实际使用的 it.weight 完全相同。
    // 计分走 activeItems()，weightOf 若与之不符，说明查询口径已经分叉。
    ['大一', '大三', '研一'].forEach(function (g) {
      var prof = { grade: g };
      CP.activeItems(CP.BANK_ABILITY, prof).forEach(function (it) {
        t.eq(CP.BANK_ABILITY.weightOf(it.id, prof), it.weight,
          g + ' 的 ' + it.id + '：weightOf 与 activeItems 的 weight 必须一致');
      });
    });

    // 每维权重合计 100 且非递减（由易到难），首项不能太小
    [['大一', 'fresh'], ['大三', 'senior']].forEach(function (p) {
      var prof = { grade: p[0] };
      var items = CP.activeItems(CP.BANK_ABILITY, prof);
      var dims = {};
      items.forEach(function (it) { (dims[it.dim] = dims[it.dim] || []).push(it); });
      Object.keys(dims).forEach(function (d) {
        var w = dims[d].map(function (it) { return it.weight; });
        t.eq(w.reduce(function (a, b) { return a + b; }, 0), 100, p[0] + ' 的 ' + d + ' 权重合计应为 100');
        for (var i = 1; i < w.length; i++) {
          t.ok(w[i] >= w[i - 1], p[0] + ' 的 ' + d + ' 权重应非递减（由易到难）');
        }
        t.ok(w[0] >= 10, p[0] + ' 的 ' + d + ' 首项权重应 ≥10，保证诚实作答不会得 0 分');
      });
    });
  });

  /* ============================================================
   * v1.0.0 → v1.1.0 迁移：能力部分从 1-4 档 Likert 改为勾选式清单
   * ============================================================ */

  /** 造一个 v1.0.0 旧档案（能力是 1-4 档 Likert 自评） */
  function legacyArchive(grade, levelByDim) {
    var old = {
      kind: CP.ARCHIVE_KIND, schemaVersion: '1.0.0',
      profile: { grade: grade, track: '人工智能', gpaBand: '10-30%', acceptPostgrad: '接受' },
      answers: { riasec: {}, anchor: {}, ability: {}, prefer: {} },
      decision: {
        jobPref: { 'algo-research': 'like' },
        criteriaOrder: ['interest', 'growth', 'ability', 'salary', 'location', 'balance'],
        pathScores: {}, targetCities: ['杭州'], hoursPerWeek: 10
      },
      actions: [], reviews: [], computed: null
    };
    CP.activeItems(CP.BANKS.riasec, null).forEach(function (it) {
      old.answers.riasec[it.id] = { v: it.reverse ? 2 : 4, t: 1 };
    });
    CP.activeItems(CP.BANKS.anchor, null).forEach(function (it) {
      old.answers.anchor[it.id] = { v: it.reverse ? 2 : 4, t: 1 };
    });
    // 旧的 24 题（每维 3 题）
    CP.BANKS.ability.dimensions.forEach(function (d) {
      [1, 2, 3].forEach(function (i) {
        old.answers.ability[d.id + i] = { v: (levelByDim && levelByDim[d.id]) || 3, t: 1 };
      });
    });
    return old;
  }

  t.test('v1.0.0 旧档案迁移到当前版本且不丢作答', function () {
    var a = CP.migrate(legacyArchive('大三', { deploy: 1 }));
    t.eq(a.schemaVersion, CP.SCHEMA_VERSION, '迁移后应更新契约版本');
    t.ok(!Object.prototype.hasOwnProperty.call(a, 'longTermPlan'),
      '长远打算已不进档案，迁移后也不应凭空多出该字段');
    t.ok(Object.keys(a.answers.ability).length > 0, '旧能力作答应被换算成勾选项');
    t.eq(a.decision.targetCities.length, 1, '旧档案的城市应保留（虽然不参与计算）');
    t.eq(CP.validateArchive(a).length, 0, '迁移后应通过完整性校验');
  });

  t.test('迁移后的能力分与旧档位保持同一量级（不会凭空归零）', function () {
    var a3 = CP.migrate(legacyArchive('大三', { math: 3, deploy: 1 }));
    var s3 = CP.scoreAll(a3);
    // 旧 3 档 = "完整项目层面"，新清单应落在 60 分上下，而不是 0 或 100
    t.ok(s3.ability.dims.math.score > 45 && s3.ability.dims.math.score < 80,
      '旧 3 档应迁移到 45-80 分区间，实际 ' + s3.ability.dims.math.score);
    // 旧 1 档 = "没有相关经历"，新清单第 1 项门槛很低，所以应拿到第 1 项的权重而不是 0
    t.ok(s3.ability.dims.deploy.score > 0,
      '旧 1 档不能迁移成 0 分（否则改版等于把学生的分数改低了），实际 ' + s3.ability.dims.deploy.score);
    t.ok(s3.ability.dims.deploy.score < s3.ability.dims.math.score, '低档应仍低于高档');

    var a4 = CP.migrate(legacyArchive('大三', { math: 4 }));
    t.ok(CP.scoreAll(a4).ability.dims.math.score >= 95, '旧 4 档应迁移到接近满分');
  });

  t.test('迁移对大一旧档案同样有效', function () {
    var s = CP.scoreAll(CP.migrate(legacyArchive('大一', { math: 3, deploy: 1 })));
    t.eq(s.abilityGrade, 'fresh', '大一档案应使用大一版清单');
    t.ok(s.ability.dims.math.score > 45 && s.ability.dims.math.score < 80,
      '大一旧 3 档也应落在合理区间，实际 ' + s.ability.dims.math.score);
    t.ok(s.ability.dims.deploy.score > 0, '大一旧 1 档同样不能归零');
  });

  t.test('迁移是幂等的：已是新版结构的档案不会被二次换算', function () {
    var a = CP.migrate(legacyArchive('大三', { math: 3 }));
    var first = Object.keys(a.answers.ability).length;
    var b = CP.migrate(JSON.parse(JSON.stringify(a)));
    t.eq(Object.keys(b.answers.ability).length, first, '二次迁移不应改变勾选数量');
    t.eq(CP.scoreAll(b).ability.dims.math.score, CP.scoreAll(a).ability.dims.math.score,
      '二次迁移不应改变能力分');
  });
};
