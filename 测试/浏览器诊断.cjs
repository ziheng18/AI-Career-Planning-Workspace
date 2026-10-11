/*!
 * 测试/浏览器诊断.cjs — 用真实浏览器（无头 Edge/Chrome）检查工作台
 *
 * 为什么需要它：Node 侧的假 DOM 能测结构与逻辑，但测不了 CSS 层叠、命中测试
 * （elementFromPoint）、过渡时机这些东西。上一个真实 bug —— 宽屏下侧栏被误加
 * inert 导致整条导航点不动 —— 就是在这里被发现的，假 DOM 完全测不出来。
 *
 * 用法：
 *   node 测试/浏览器诊断.cjs                     # 桌面视口 1400,900
 *   $env:WB_VIEWPORT="420,860"; node 测试/浏览器诊断.cjs   # 窄屏
 *
 * 原理：把一段探针脚本注入 工作台.html 的副本（放在 ASCII 临时目录，避免中文路径
 * 影响 file:// 解析），用 --dump-dom 跑完后取回 #diag 的内容。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var VIEWPORT = process.env.WB_VIEWPORT || '1400,900';

var BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
var BROWSER = BROWSERS.filter(function (p) { return fs.existsSync(p); })[0];
if (!BROWSER) {
  console.error('未找到 Edge 或 Chrome，跳过浏览器诊断。');
  process.exit(0);
}

/* ---------------- 探针 ---------------- */
/* 逐项输出 PASS/FAIL，便于一眼看出问题。
   过渡有关的状态在 600ms 后统一输出——transform/visibility/opacity 都是 0.24s 过渡，
   在过渡中采样会得到假失败。 */
var PROBE = [
  '<div id="diag" style="display:none"></div>',
  '<script>',
  '(function () {',
  '  var out = [], fails = 0;',
  '  function line(t) { out.push(t); }',
  '  function check(name, cond, detail) {',
  '    if (!cond) fails++;',
  '    out.push((cond ? "PASS " : "FAIL ") + name + (detail ? "  → " + detail : ""));',
  '  }',
  '  function info(k, v) { out.push("     " + k + ": " + v); }',
  '  function hitOf(el) {',
  '    if (!el) return null;',
  '    var r = el.getBoundingClientRect();',
  '    if (r.width === 0 || r.height === 0) return null;',
  '    var h = document.elementFromPoint(Math.round(r.left + r.width / 2),',
  '      Math.round(r.top + Math.min(r.height / 2, 18)));',
  '    return (h === el || el.contains(h)) ? h : null;',
  '  }',
  '  function desc(el) {',
  '    return el ? el.tagName + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ")[0] : "") : "null";',
  '  }',
  '  /* 等状态稳定。',
  '     不用固定 setTimeout：无头浏览器的 --virtual-time-budget 下定时器与 CSS 过渡',
  '     不同步，会采到过渡中的中间值而误判失败。这里先注入 !important 关掉过渡，',
  '     再等两帧 rAF，拿到确定性的终值。真实浏览器里过渡照常，只是这里不需要看动画。 */',
  '  function waitSettled(el, cb) {',
  '    var n = 0;',
  '    (function tick() {',
  '      n++;',
  '      if (n >= 3) { cb(); return; }',
  '      requestAnimationFrame(tick);',
  '    })();',
  '  }',
  '  function finish() { flush(fails === 0); }',
  '  /* 每个阶段都同步写盘：无头浏览器的 --virtual-time-budget 会在预算用尽时立刻',
  '     兑现 --dump-dom，异步收尾（setTimeout / rAF）不保证跑完。',
  '     所以宁可多次写，也要保证 #diag 里始终是最新的结果。 */',
  '  function flush(final) {',
  '    var d = document.getElementById("diag");',
  '    if (!d) return;',
  '    var tail = final ? (fails === 0 ? "全部通过" : fails + " 项失败") : "（进行中…）";',
  '    d.textContent = out.join("\\n") + "\\n\\n== " + tail + " ==";',
  '  }',
  '',
  '  window.addEventListener("load", function () {',
  '    // 关掉过渡：本诊断关心的是"状态对不对"，不是"动画好不好看"',
  '    var st = document.createElement("style");',
  '    st.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";',
  '    document.head.appendChild(st);',
  '',
  '    var nav = document.getElementById("nav");',
  '    var sidebar = document.getElementById("sidebar");',
  '    var item = nav ? nav.querySelector("[data-route=\\"riasec\\"]") : null;',
  '    var narrow = window.matchMedia("(max-width: 900px)").matches;',
  '',
  '    line("视口 " + window.innerWidth + "x" + window.innerHeight + "  窄屏=" + narrow);',
  '    line("");',
  '    line("— 启动 —");',
  '    check("脚本全部加载，CP.ui 就绪", typeof CP === "object" && !!CP.ui);',
  '    check("无启动错误", !window.__bootError, window.__bootError || "");',
  '    check("导航渲染出 9 项", nav && nav.children.length === 9, nav ? nav.children.length + " 项" : "nav 不存在");',
  '    check("首页内容已渲染", (document.getElementById("view").textContent || "").length > 200);',
  '',
  '    line("");',
  '    line("— 侧栏可交互性（关键）—");',
  '    if (narrow) {',
  '      check("窄屏·关闭时侧栏移出屏幕", getComputedStyle(sidebar).visibility === "hidden",',
  '        "visibility=" + getComputedStyle(sidebar).visibility);',
  '      check("窄屏·关闭时不可交互(inert)", sidebar.hasAttribute("inert"),',
  '        "inert=" + sidebar.getAttribute("inert"));',
  '    } else {',
  '      check("宽屏·侧栏常驻可见", getComputedStyle(sidebar).visibility === "visible",',
  '        "visibility=" + getComputedStyle(sidebar).visibility);',
  '      check("宽屏·侧栏未被禁用(inert)", !sidebar.hasAttribute("inert"),',
  '        "inert=" + sidebar.getAttribute("inert"));',
  '      check("宽屏·侧栏未被 aria-hidden", sidebar.getAttribute("aria-hidden") === null,',
  '        "aria-hidden=" + sidebar.getAttribute("aria-hidden"));',
  '      check("宽屏·导航项命中自身", !!hitOf(item), "命中=" + desc(hitOf(item)));',
  '      check("宽屏·底部按钮命中自身", !!hitOf(document.getElementById("btnDemo")),',
  '        "命中=" + desc(hitOf(document.getElementById("btnDemo"))));',
  '    }',
  '',
  '    line("");',
  '    line("— 侧栏计数 —");',
  '    Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (b) {',
  '      var c = b.querySelector("[data-count]");',
  '      if (c && c.textContent) info(b.getAttribute("data-route"), JSON.stringify(c.textContent));',
  '    });',
  '    // 勾选式清单的计数不能带分母：分母会暗示"要做完 48 项"，与设计意图相反',
  '    var abEl = document.querySelector(".nav-item[data-route=\\"ability\\"] [data-count]");',
  '    var abCount = abEl ? abEl.textContent : "";',
  '    check("能力清单计数不带 48 分母", abCount.indexOf("/48") < 0, "显示为 " + JSON.stringify(abCount));',
  '    flush();',
  '',
  '    line("");',
  '    line("— 结果页标签栏（回归：活动标签曾经白字透明底而隐形）—");',
  '    // 直接调 go()：hashchange 是异步的，同步探针里等不到',
  '    CP.ui.go("result");',
  '    var active = document.querySelector(".result-tabs .btn-primary");',
  '    if (active) {',
  '      var acs = getComputedStyle(active);',
  '      // 背景必须真的上了色。曾经 `.result-tabs .btn{background:transparent}`',
  '      // 以 2 个类的特异性压过 `.btn-primary`（1 个类），而 color:#fff 没被覆盖，',
  '      // 于是白字落在透明底上——整条活动标签看不见。',
  '      check("活动标签背景不是透明",',
  '        acs.backgroundColor !== "rgba(0, 0, 0, 0)" && acs.backgroundColor !== "transparent",',
  '        "background=" + acs.backgroundColor);',
  '      // 只比字符串是不够的：背景透明时是 "rgba(0, 0, 0, 0)"，',
  '      // 与白色文字字符串"不同"，会误判成通过——那是弱断言。要解析 alpha。',
  '      function alphaOf(c) {',
  '        var m = /rgba?\\(\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*(?:,\\s*([\\d.]+)\\s*)?\\)/.exec(c || "");',
  '        return m ? (m[1] === undefined ? 1 : Number(m[1])) : 0;',
  '      }',
  '      check("活动标签背景不透明", alphaOf(acs.backgroundColor) > 0.9,',
  '        "background=" + acs.backgroundColor + " alpha=" + alphaOf(acs.backgroundColor));',
  '      check("活动标签与相邻标签底色不同",',
  '        acs.backgroundColor !== getComputedStyle(document.querySelectorAll(".result-tabs .btn")[1] || document.body).backgroundColor,',
  '        "活动=" + acs.backgroundColor);',
  '      check("活动标签有可见文本", (active.textContent || "").trim().length > 0,',
  '        JSON.stringify(active.textContent));',
  '      // 五个标签的文本都不能为空',
  '      var emptyTabs = 0;',
  '      Array.prototype.forEach.call(document.querySelectorAll(".result-tabs .btn"), function (b) {',
  '        if (!(b.textContent || "").trim()) emptyTabs += 1;',
  '      });',
  '      check("五个标签都有文本", emptyTabs === 0, "空标签数=" + emptyTabs);',
  '    } else {',
  '      check("找到结果页的活动标签", false, "未找到 .result-tabs .btn-primary");',
  '    }',
  '    flush();',
  '',
  '    line("");',
  '    line("— 点击导航（真实点击）—");',
  '    if (item) {',
  '      item.click();',
  '      check("hash 已改变", location.hash === "#riasec", "hash=" + location.hash);',
  '      CP.ui.go("riasec");   // 不等 hashchange：无头环境下异步事件不保证派发',
  '      check("路由已切换", CP.ui.route === "riasec", "route=" + CP.ui.route);',
  '      check("页面内容已更新", (document.getElementById("view").textContent || "").indexOf("兴趣测评") >= 0);',
  '      flush();',
  '',
  '      line("");',
  '      line("— 抽屉（仅窄屏需要）—");',
  '      if (!narrow) {',
  '        // 宽屏没有抽屉：侧栏常驻，openDrawer 不应改变任何可见状态',
  '        CP.ui.openDrawer();',
  '        check("宽屏·openDrawer 不产生 open 类", !sidebar.classList.contains("open"));',
  '        check("宽屏·openDrawer 不显示遮罩", document.getElementById("scrim").hidden);',
  '        check("宽屏·侧栏仍可点击", !!hitOf(item), "命中=" + desc(hitOf(item)));',
  '        CP.ui.closeDrawer();',
  '        check("宽屏·关抽屉后侧栏仍可交互", !sidebar.hasAttribute("inert"));',
  '        finish();',
  '      } else {',
  '      CP.ui.openDrawer();',
  '      check("打开后解除 inert", !sidebar.hasAttribute("inert"));',
  '      check("打开后加 open 类", sidebar.classList.contains("open"));',
  '      var cs = getComputedStyle(sidebar);',
  '      check("打开后侧栏可见", cs.visibility === "visible", "visibility=" + cs.visibility);',
  '      check("打开后侧栏移入视口", cs.transform === "none" || cs.transform.indexOf("matrix(1, 0, 0, 1, 0") === 0,',
  '        "transform=" + cs.transform);',
  '      check("打开后导航项可点击", !!hitOf(item), "命中=" + desc(hitOf(item)));',
  '      check("打开后关闭按钮可点击", !!hitOf(document.getElementById("btnDrawerClose")),',
  '        "命中=" + desc(hitOf(document.getElementById("btnDrawerClose"))));',
  '      var scrim = document.getElementById("scrim");',
  '      check("遮罩已显示", !scrim.hidden, "hidden=" + scrim.hidden);',
  '',
  '      // 真正的指针级点击：在坐标上找命中元素并派发事件，绕过 el.click() 的"程序化直通"。',
  '      // el.click() 不看 pointer-events / 层叠 / inert，所以它全绿也不代表用户能点到。',
  '      function pointerClick(sel, label) {',
  '        var el = typeof sel === "string" ? document.querySelector(sel) : sel;',
  '        if (!el) { check(label, false, "元素不存在"); return; }',
  '        var r = el.getBoundingClientRect();',
  '        var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);',
  '        var target = document.elementFromPoint(x, y);',
  '        var opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0 };',
  '        target.dispatchEvent(new PointerEvent("pointerdown", opts));',
  '        target.dispatchEvent(new MouseEvent("mousedown", opts));',
  '        target.dispatchEvent(new PointerEvent("pointerup", opts));',
  '        target.dispatchEvent(new MouseEvent("mouseup", opts));',
  '        target.dispatchEvent(new MouseEvent("click", opts));',
  '        return { target: target, x: x, y: y, rect: r };',
  '      }',
  '',
  '      var closeInfo = pointerClick("#btnDrawerClose", "指针点击×应关闭抽屉");',
  '      check("指针点击×后抽屉关闭", CP.ui.drawerOpen === false,',
  '        "drawerOpen=" + CP.ui.drawerOpen',
  '        + "；按钮位置 x=" + Math.round(closeInfo.rect.left) + " y=" + Math.round(closeInfo.rect.top)',
  '        + " w=" + Math.round(closeInfo.rect.width) + " h=" + Math.round(closeInfo.rect.height)',
  '        + "；命中=" + desc(closeInfo.target));',
  '      check("指针点击×后侧栏恢复 inert", sidebar.hasAttribute("inert"));',
  '      check("指针点击×后遮罩隐藏", scrim.hidden);',
  '',
  '      // 顺带用同样方式验一遍：指针点击汉堡能否打开',
  '      var burgerInfo = pointerClick("#btnDrawer", "指针点击汉堡应打开抽屉");',
  '      check("指针点击汉堡后抽屉打开", CP.ui.drawerOpen === true,',
  '        "drawerOpen=" + CP.ui.drawerOpen + "；命中=" + desc(burgerInfo.target));',
  '      finish();',
  '      }',
  '    } else {',
  '      check("找到导航项", false, "nav 为空");',
  '      finish();',
  '    }',
  '  });',
  '})();',
  '<\/script>'
].join('\n');

/* ---------------- 注入并运行 ---------------- */

var html = fs.readFileSync(path.join(ROOT, '工作台.html'), 'utf8');
var patched = html.replace('</body>', PROBE + '\n</body>');
if (patched === html) { console.error('注入失败：没找到 </body>'); process.exit(1); }

var tmp = path.join(os.tmpdir(), 'wbdiag');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'index.html'), patched, 'utf8');
['数据', '逻辑', '界面', '导出', '素材', '样式'].forEach(function (d) {
  var from = path.join(ROOT, d);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, d), { recursive: true });
});

var prof = path.join(os.tmpdir(), 'wbdiag-prof');
fs.rmSync(prof, { recursive: true, force: true });
var url = 'file:///' + tmp.replace(/\\/g, '/') + '/index.html';

var res = cp.spawnSync(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  '--user-data-dir=' + prof, '--window-size=' + VIEWPORT,
  '--virtual-time-budget=12000', '--dump-dom', url
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (res.error) { console.error('启动浏览器失败：' + res.error.message); process.exit(1); }

var m = (res.stdout || '').match(/<div id="diag"[^>]*>([\s\S]*?)<\/div>/);
if (!m) {
  console.error('未取到诊断结果。stderr：' + String(res.stderr || '').slice(0, 600));
  process.exit(1);
}
var body = m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&');

console.log('===== 浏览器诊断（' + path.basename(BROWSER) + ' · 视口 ' + VIEWPORT + '）=====');
console.log(body);

process.exit(/\n\d+ 项失败/.test('\n' + body) ? 1 : 0);
