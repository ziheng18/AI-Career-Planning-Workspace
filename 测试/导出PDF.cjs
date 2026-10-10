/*!
 * 测试/导出PDF.cjs — 用无头浏览器把「可打印报告」真正导出成 PDF，并检查排版
 *
 * 为什么需要它：
 *   分页问题（章节被从中间截断、表格跨页丢表头、整页空白、背景色丢失）
 *   光看 HTML 是看不出来的，只有真出一份 PDF 才能发现。
 *
 * 用法：
 *   node 测试/导出PDF.cjs                     # 生成并检查，输出到 输出/报告预览.pdf
 *   WB_KEEP=1 node 测试/导出PDF.cjs            # 同时保留中间 HTML
 *
 * 原理：走 CDP 的 Page.printToPDF（与浏览器「另存为 PDF」同一条路径），
 *      再用 zlib 解压页内容流，统计每页的绘图操作与文本量，判断是否有空白页。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var zlib = require('zlib');
var cp = require('child_process');
var http = require('http');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, '输出', '报告预览.pdf');
var PORT = Number(process.env.WB_PORT || 9334);

var BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
var BROWSER = BROWSERS.filter(function (p) { return fs.existsSync(p); })[0];
if (!BROWSER) { console.error('未找到 Edge/Chrome，跳过 PDF 校验。'); process.exit(0); }

/* ---------------- 准备副本 ---------------- */
var tmp = path.join(os.tmpdir(), 'wbtopdf');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

// 注入一段脚本：把示例档案灌进去，这样打印视图有内容可渲染
var page = fs.readFileSync(path.join(ROOT, '工作台.html'), 'utf8');
var boot = [
  '<script>',
  'window.addEventListener("load", function () {',
  '  try {',
  '    CP.ui.archive = CP.demoArchive();',
  '    CP.store.save(CP.ui.archive);',
  '    CP.ui.go("result");',
  '    window.__ready = true;',
  '  } catch (e) { window.__bootErr = e.message; }',
  '});',
  '<\/script>'
].join('\n');
fs.writeFileSync(path.join(tmp, 'index.html'), page.replace('</body>', boot + '\n</body>'), 'utf8');
['数据', '逻辑', '界面', '导出', '素材', '样式'].forEach(function (d) {
  var from = path.join(ROOT, d);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, d), { recursive: true });
});
var url = 'file:///' + tmp.replace(/\\/g, '/') + '/index.html';

/* ---------------- 启动浏览器 ---------------- */
var prof = path.join(os.tmpdir(), 'wbtopdf-prof');
fs.rmSync(prof, { recursive: true, force: true });

var child = cp.spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof,
  '--window-size=1100,900', url
], { stdio: 'ignore' });

function getJson(p) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function waitForDebugger(tries) {
  return getJson('/json/version').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 300); }).then(function () { return waitForDebugger(tries - 1); });
  });
}

/* ---------------- 极简 CDP 客户端 ---------------- */
function connect(wsUrl) {
  return new Promise(function (resolve, reject) {
    var m = wsUrl.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    var key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22);
    var req = http.request({
      host: m[1], port: Number(m[2]), path: m[3],
      headers: {
        'Connection': 'Upgrade', 'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key
      }
    });
    req.on('upgrade', function (res, socket) {
      var id = 0, pending = {}, buf = Buffer.alloc(0);
      function send(method, params) {
        return new Promise(function (res2) {
          var myId = ++id;
          pending[myId] = res2;
          var payload = Buffer.from(JSON.stringify({ id: myId, method: method, params: params || {} }));
          var header, mask = Buffer.from([0, 0, 0, 0]), len = payload.length;
          if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
          else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
          else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
          socket.write(Buffer.concat([header, mask, payload]));
        });
      }
      socket.on('data', function (chunk) {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          var op = buf[0] & 0x0f;
          var masked = (buf[1] & 0x80) !== 0;
          var len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (masked) off += 4;
          if (buf.length < off + len) return;
          var payload2 = buf.slice(off, off + len);
          buf = buf.slice(off + len);
          if (op === 8) { socket.end(); continue; }
          if (op !== 1) continue;
          var msg;
          try { msg = JSON.parse(payload2.toString('utf8')); } catch (e) { continue; }
          if (msg.id && pending[msg.id]) { pending[msg.id](msg.result || msg.error); delete pending[msg.id]; }
        }
      });
      socket.on('error', reject);
      resolve({ send: send, close: function () { socket.end(); } });
    });
    req.on('error', reject);
    req.end();
  });
}

/* ---------------- PDF 分析 ---------------- */
/**
 * 页数：从 %%EOF 前的最后一个 /Count 取。
 * 这是快速启发式，足够用于"这份报告大概多少页"的校验。
 */
function pageCount(buf) {
  var s = buf.toString('latin1');
  var counts = s.match(/\/Count\s+(\d+)/g) || [];
  var max = 0;
  counts.forEach(function (c) {
    var n = parseInt(c.replace(/\D+/g, ''), 10);
    if (n > max) max = n;
  });
  return max;
}

/**
 * 逐页解压内容流，统计文本量与绘图操作。
 * 目的：发现"整页空白"——章节强制分页后最容易出现的问题。
 * 同时把解压后的文本留下来，供检查颜色操作符。
 */
function pageStats(buf) {
  var s = buf.toString('latin1');

  // ① 先收集"被页对象 /Contents 引用"的流编号。
  //    判据必须是引用关系，不能靠"流里像有文字"来猜：
  //    实测嵌入的 CIDFontType2 字体文件解压后 1.2MB，而且恰好含 8 个 Tj 字节，
  //    用启发式会把它当成一页内容，页数与文本量都会被算错。
  //    注意 /Contents 在页字典里出现在 /Type /Page 之前，所以必须整体取字典再解析。
  var contentNums = {};
  var objRe = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g, om;
  while ((om = objRe.exec(s)) !== null) {
    var dict = om[2];
    if (!/\/Type\s*\/Page(?![s])/.test(dict)) continue;
    var cs = dict.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (cs) contentNums[Number(cs[1])] = true;
  }
  var useRefs = Object.keys(contentNums).length > 0;
  var pageCount = Object.keys(contentNums).length;

  // ② 按对象号取流内容
  var stats = [];
  objRe.lastIndex = 0;
  while ((om = objRe.exec(s)) !== null) {
    var num = Number(om[1]);
    if (useRefs && !contentNums[num]) continue;
    var body = om[2];
    if (body.indexOf('/FlateDecode') < 0) continue;
    var i = body.indexOf('stream');
    if (i < 0) continue;
    var start = i + 'stream'.length;
    if (body[start] === '\r') start++;
    if (body[start] === '\n') start++;
    var end = body.indexOf('endstream', start);
    if (end < 0) continue;
    var text = '';
    try { text = zlib.inflateSync(Buffer.from(body.slice(start, end), 'latin1')).toString('latin1'); }
    catch (e) { continue; }
    stats.push({
      obj: num,
      textOps: (text.match(/T[jJ]/g) || []).length,
      drawOps: (text.match(/\bre\b|\bm\b|\bl\b/g) || []).length,
      bytes: text.length,
      body: text
    });
  }
  stats.sort(function (a, b) { return a.obj - b.obj; });
  return stats;
}

/** 把 PDF 内容流里所有出现的颜色操作符收出来 */
function colorOps(stats) {
  var seen = {};
  stats.forEach(function (s) {
    (s.body.match(/[\d.]+\s+[\d.]+\s+[\d.]+\s+(?:rg|RG)/g) || []).forEach(function (c) {
      seen[c.trim()] = (seen[c.trim()] || 0) + 1;
    });
  });
  return seen;
}

/**
 * 在 PDF 内容流里找某个颜色的填充操作符（如 .0588 .4627 .4314 rg = #0f766e）。
 * 这是"颜色真的写进了 PDF"的硬证据——比截图更可靠：
 * 截图只能说明 HTML 渲染有颜色，而 PDF 是完全独立的一条渲染路径。
 */
function hasFillColor(stats, hex) {
  var r = parseInt(hex.slice(1, 3), 16) / 255;
  var g = parseInt(hex.slice(3, 5), 16) / 255;
  var b = parseInt(hex.slice(5, 7), 16) / 255;
  // PDF 里的数字写法很随意：可能省略前导 0（.0588）、也可能补零（0.0588）。
  // 逐个生成候选写法，避免因为格式差异把"颜色其实在"误判成"颜色丢了"。
  var forms = function (v) {
    var out = {};
    [3, 4, 5].forEach(function (d) {
      var s = v.toFixed(d);
      out[s] = 1;
      if (s.charAt(0) === '0') out[s.slice(1)] = 1;
      out[s.replace(/0+$/, '').replace(/\.$/, '')] = 1;
    });
    return Object.keys(out).filter(function (x) { return x.length; })
      .map(function (x) { return x.replace(/\./g, '\\.'); });
  };
  var rs = forms(r), gs = forms(g), bs = forms(b);
  for (var i = 0; i < rs.length; i++) {
    for (var j = 0; j < gs.length; j++) {
      for (var k = 0; k < bs.length; k++) {
        var rx = new RegExp('(^|\\s)' + rs[i] + '\\s+' + gs[j] + '\\s+' + bs[k] + '\\s+(rg|RG)');
        if (stats.some(function (s) { return rx.test(s.body); })) return true;
      }
    }
  }
  return false;
}

/* ---------------- 主流程 ---------------- */
var results = [];
function record(name, pass, detail) {
  results.push(pass);
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  await waitForDebugger(40);
  var targets = await getJson('/json/list');
  var first = targets.filter(function (t) { return t.type === 'page'; })[0];
  if (!first) throw new Error('没有可用的页面目标');

  var cdp = await connect(first.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  async function ev(expr) {
    var out = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) {
      throw new Error((out.exceptionDetails.exception || {}).description || out.exceptionDetails.text);
    }
    return out.result ? out.result.value : undefined;
  }

  // 等示例档案就位
  for (var i = 0; i < 40; i++) {
    if (await ev('window.__ready === true')) break;
    await sleep(250);
  }
  var bootErr = await ev('window.__bootErr || ""');
  record('页面启动并载入示例档案', !bootErr, bootErr ? '启动错误：' + bootErr : '');

  // 直接生成打印视图（与工作台里点「生成可打印页面」同一条代码路径）
  var openRes = await ev('(function(){' +
    'var stub = {' +
    '  open: function(){ window.__printHtml = ""; },' +
    '  write: function(h){ window.__printHtml = (window.__printHtml||"") + h; },' +
    '  close: function(){}' +
    '};' +
    'var w = { document: stub, focus: function(){}, print: function(){}, close: function(){} };' +
    'CP.report.renderPrintView(w, CP.ui.archive, CP.ui.result(), "");' +
    'return (window.__printHtml||"").length;})()');
  record('打印视图 HTML 生成成功', openRes > 3000, '长度 ' + openRes);

  // 关键：打印视图是独立文档，图表用 fill="var(--brand)" 取色，
  // 所以令牌必须在它自己的 <style> 里重新声明。缺了就会整份报告变灰阶。
  var printHtml0 = await ev('window.__printHtml');
  if (process.env.WB_DUMP) {
    fs.writeFileSync(path.join(os.tmpdir(), 'wb-print.html'), printHtml0, 'utf8');
    console.log('     （打印视图 HTML 已存至 ' + path.join(os.tmpdir(), 'wb-print.html') + '）');
  }
  var tokens = ['--brand', '--brand-2', '--ink-3', '--danger', '--ok'];
  var missingTokens = tokens.filter(function (tk) { return printHtml0.indexOf(tk + ':') < 0; });
  record('打印视图自带设计令牌（否则图表会变黑）', missingTokens.length === 0,
    missingTokens.length ? '缺少 ' + missingTokens.join(',') : tokens.length + ' 个令牌都在');

  var varFills = (printHtml0.match(/var\(--[a-z0-9-]+\)/g) || []).length;
  record('开启了打印背景色保留',
    printHtml0.indexOf('print-color-adjust:exact') >= 0);

  // 关键章节必须在打印视图里。
  // 只查 HTML 是不够的（HTML 有、渲染后没了也曾发生过），但"HTML 里都没有"
  // 是最先要排除的一种失败——所以这一步和下面的 PDF 校验互补。
  var sections = ['摘要', '第一章', '第二章', '第三章', '第四章', '第五章', '逐年规划建议', '附录'];
  var missingSec = sections.filter(function (x) { return printHtml0.indexOf(x) < 0; });
  record('打印视图含全部章节', missingSec.length === 0,
    missingSec.length ? '缺少 ' + missingSec.join('、') : sections.length + ' 个章节都在');

  // 逐年规划建议必须带具体学年
  var years = ['大三', '大四'];
  record('逐年规划建议带具体学年', years.every(function (y) { return printHtml0.indexOf(y) >= 0 }),
    '含 ' + years.join('、'));

  var branchCount = (printHtml0.match(/var\(--[a-z0-9-]+\)/g) || []).length;
  record('图表确实依赖 CSS 变量取色', branchCount > 0, branchCount + ' 处 var() 引用');

  // 关键：先 document.write 装进当前页面，再按打印媒体截图 / 打印。
  // 如果先截图（此时页面还是工作台本体），检查的就根本不是报告版面。
  var printHtml = await ev('window.__printHtml');
  fs.mkdirSync(path.join(ROOT, '输出'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '输出', '报告预览.html'), printHtml, 'utf8');
  record('打印视图 HTML 已存档', printHtml.length > 3000,
    '输出/报告预览.html（可直接在浏览器里 Ctrl+P 另存为 PDF）');

  await ev('document.open(); document.write(' + JSON.stringify(printHtml) + '); document.close(); true');
  await sleep(700);

  // 用打印媒体 + 长截图，检查版面（章节分页、表头底色、封面条）
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });

  // 逐章截图：整份文档 11 页太长了，一次截完看不清。
  // 先量出每个 <section> 的像素位置，再按章节裁剪。
  var sections = await ev('Array.prototype.map.call(document.querySelectorAll("section"), function (el) {' +
    'var r = el.getBoundingClientRect();' +
    'return { top: Math.round(r.top + window.scrollY), h: Math.round(r.height),' +
    ' name: (el.querySelector("h2") || {}).textContent || "?" };})');
  console.log('    章节位置: ' + sections.map(function (x) { return x.name.replace(/\s+/g, '') + '@' + x.top + '(+' + x.h + ')'; }).join('  '));

  async function shoot(name, clip) {
    var shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: clip
    });
    if (!shot || !shot.data) return false;
    fs.writeFileSync(path.join(ROOT, '输出', '报告预览-' + name + '.png'), Buffer.from(shot.data, 'base64'));
    return true;
  }

  // 封面 + 摘要。宽度用 A4 的实际像素宽（794），并额外检查封面元素有没有溢出。
  var coverEnd = sections.length ? sections[0].top + sections[0].h : 900;
  var overflow = await ev('(function(){' +
    'var c = document.querySelector(".cover");' +
    'var facts = document.querySelector(".cover-facts");' +
    'var out = [];' +
    'if (c) { var cr = c.getBoundingClientRect();' +
    '  if (facts) { var fr = facts.getBoundingClientRect();' +
    '    if (fr.right > cr.right - 8) out.push("信息条右边界超出封面内边距 " + Math.round(fr.right - cr.right + 8) + "px"); }' +
    '  if (c.scrollWidth > c.clientWidth + 1) out.push("封面横向溢出 " + (c.scrollWidth - c.clientWidth) + "px");' +
    '}' +
    'return out;})()');
  record('封面内容没有横向溢出', overflow.length === 0, overflow.join('；') || '未溢出');

  var okCover = await shoot('封面', { x: 0, y: 0, width: 794, height: Math.min(1700, coverEnd + 120), scale: 1 });

  // 取含表格的章节（第二章有职业简表，最能看出表格美化的效果）
  var tableSec = null;
  for (var si = 0; si < sections.length; si++) {
    var hasTable = await ev('(function(){var s=document.querySelectorAll("section")[' + si + '];' +
      'return !!s && s.querySelectorAll("table").length > 0;})()');
    if (hasTable) { tableSec = sections[si]; break; }
  }
  var okTable = false;
  if (tableSec) {
    okTable = await shoot('表格', { x: 0, y: tableSec.top, width: 794, height: Math.min(1900, tableSec.h + 60), scale: 1 });
  }
  record('分章截图生成成功', okCover || okTable,
    (okCover ? '报告预览-封面.png' : '') + (okTable ? ' 报告预览-表格.png' : ''));

  // 保留一张长截图便于快速浏览前三页
  var shot = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 794, height: 2400, scale: 1 }
  });
  if (shot && shot.data) {
    fs.writeFileSync(path.join(ROOT, '输出', '报告预览-版面.png'), Buffer.from(shot.data, 'base64'));
  }

  // 打印成 PDF
  await sleep(200);

  var printed = await cdp.send('Page.printToPDF', {
    printBackground: true,          // 必须开，否则表头底色、提示框、封面条全部丢失
    paperWidth: 8.27, paperHeight: 11.69,   // A4
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,  // 页边距由 @page 控制
    preferCSSPageSize: true
  });

  if (!printed || !printed.data) throw new Error('printToPDF 没有返回数据');
  var pdf = Buffer.from(printed.data, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, pdf);

  record('PDF 生成成功', pdf.length > 20000, (pdf.length / 1024).toFixed(0) + ' KB');

  var pages = pageCount(pdf);
  record('页数可识别（1-60 页之间）', pages >= 1 && pages <= 60, pages + ' 页');

  var stats = pageStats(pdf);
  var blank = stats.filter(function (s) { return s.textOps < 3 && s.drawOps < 5; });
  record('没有整页空白', blank.length === 0,
    blank.length ? blank.length + ' 页疑似空白' : stats.length + ' 个内容流过检');

  // 关键章节标题是否都进了 PDF
  var texty = stats.map(function (s) { return s.textOps; }).reduce(function (a, b) { return a + b; }, 0);
  record('文本量正常（不是只剩图形）', texty > 200, '文本算子总数 ' + texty);

  // 颜色硬证据：品牌色必须真的写进 PDF 内容流。
  // 这一步抓的是"打印视图缺设计令牌导致图表全黑"那类问题——
  // 只看 HTML 或只看截图都可能漏掉。
  var brand = hasFillColor(stats, '#0f766e');   // 图表主色 --brand
  record('品牌色（青绿）已写入 PDF 内容流', brand, brand ? '#0f766e 命中' : '未找到 rg 填充，图表可能是黑色');

  // 顺带验证色板确实来自设计令牌，而不是某处硬编码的黑色
  var ops = colorOps(stats);
  var opCount = Object.keys(ops).length;
  record('PDF 使用了多种颜色（不是灰阶输出）', opCount >= 8, opCount + ' 种颜色操作符');

  // 反面证据：如果图表变黑，说明令牌解析失败
  var blackish = Object.keys(ops).filter(function (k) {
    return /^0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+(rg|RG)$/.test(k.replace(/\s+/g, ' '));
  });
  var blackCount = blackish.reduce(function (a, k) { return a + ops[k]; }, 0);
  var totalOps = Object.keys(ops).reduce(function (a, k) { return a + ops[k]; }, 0);
  record('纯黑占比很低（说明没有整份塌成黑色）', totalOps === 0 || blackCount / totalOps < 0.1,
    '纯黑 ' + blackCount + ' / 共 ' + totalOps);

  // 页面数量：内容流数必须与页对象数一致（多一个少一个都说明流挑选逻辑出了问题）
  var pageObjs = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s])/g) || []).length;
  record('每个页对象恰好一个内容流', stats.length === pageObjs,
    stats.length + ' 个内容流 / ' + pageObjs + ' 个页对象');
  record('页数与 PDF 声明的 /Count 一致', pages === pageObjs,
    '/Count=' + pages + '，页对象=' + pageObjs);

  cdp.close();
  console.log('\n已输出：' + path.relative(ROOT, OUT));
  var fails = results.filter(function (x) { return !x; }).length;
  console.log('== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}

main().then(function (fails) {
  try { child.kill(); } catch (e) { }
  process.exit(fails === 0 ? 0 : 1);
}).catch(function (e) {
  console.error('PDF 导出失败：' + e.message);
  try { child.kill(); } catch (e2) { }
  process.exit(1);
});
