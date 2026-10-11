/*!
 * 测试/触摸诊断.cjs — 用 Chrome DevTools 协议的 Input.dispatchTouchEvent 做真实触摸点击
 *
 * 为什么需要单独一个：
 * 浏览器诊断.cjs 用 elementFromPoint + 合成 MouseEvent 模拟点击，
 * 但真机/移动端发出的是 touch 事件，而且合成事件不反映"手指落下时元素在哪"。
 * 已经靠这一层发现的两个真 bug：
 *   ① 抽屉打开时有位移动画，× 按钮还在视口外 → 开完立刻点会点空
 *   ② 隐形勾选框写成 width:0;height:0 → 触摸下勾不上（label 转发不可靠）
 *
 * 用法：node 测试/触摸诊断.cjs
 *   WB_W / WB_H 可改视口，WB_PORT 可改调试端口。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');
var http = require('http');

var ROOT = path.resolve(__dirname, '..');
var WIDTH = Number(process.env.WB_W || 390);
var HEIGHT = Number(process.env.WB_H || 844);
var PORT = Number(process.env.WB_PORT || 9333);

var BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
var BROWSER = BROWSERS.filter(function (p) { return fs.existsSync(p); })[0];
if (!BROWSER) { console.error('未找到 Edge/Chrome，跳过触摸诊断。'); process.exit(0); }

/* ---------------- 准备一份工作台副本 ---------------- */
var tmp = path.join(os.tmpdir(), 'wbtouch');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync(path.join(ROOT, '工作台.html'), path.join(tmp, 'index.html'));
['数据', '逻辑', '界面', '导出', '素材', '样式'].forEach(function (d) {
  var from = path.join(ROOT, d);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, d), { recursive: true });
});
var url = 'file:///' + tmp.replace(/\\/g, '/') + '/index.html';

/* ---------------- 启动带调试端口的浏览器 ---------------- */
var prof = path.join(os.tmpdir(), 'wbtouch-prof');
fs.rmSync(prof, { recursive: true, force: true });

var child = cp.spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + prof,
  '--window-size=' + WIDTH + ',' + HEIGHT,
  url
], { stdio: 'ignore' });

function getJson(p) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function waitForDebugger(tries) {
  return getJson('/json/version').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 300); }).then(function () { return waitForDebugger(tries - 1); });
  });
}

/* ---------------- 极简 CDP 客户端（够用即可，不引入依赖） ---------------- */
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
          var payload = buf.slice(off, off + len);
          buf = buf.slice(off + len);
          if (op === 8) { socket.end(); continue; }
          if (op !== 1) continue;
          var msg;
          try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
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

/* ---------------- 主流程 ---------------- */
var results = [];
function record(name, pass, detail) {
  results.push({ name: name, pass: pass });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  await waitForDebugger(40);
  var targets = await getJson('/json/list');
  var page = targets.filter(function (t) { return t.type === 'page'; })[0];
  if (!page) throw new Error('没有可用的页面目标');

  var cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Page.reload', { ignoreCache: true });

  // 等页面就绪
  for (var i = 0; i < 40; i++) {
    var r = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState + "|" + (typeof CP !== "undefined" && CP.ui ? document.getElementById("nav").children.length : -1)',
      returnByValue: true
    });
    if (String(r.result && r.result.value).indexOf('complete|9') === 0) break;
    await sleep(250);
  }

  async function ev(expr) {
    var out = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) {
      throw new Error((out.exceptionDetails.exception || {}).description || out.exceptionDetails.text);
    }
    return out.result ? out.result.value : undefined;
  }

  /** 在坐标上发一次真实触摸（touchStart + touchEnd） */
  async function touchAt(x, y) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y), radiusX: 10, radiusY: 10, force: 1 }]
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
  }

  /** 某选择器的中心点，然后触摸 */
  async function tap(selector) {
    var box = await ev('(function(){var e=document.querySelector(' + JSON.stringify(selector) + ');' +
      'if(!e)return null;var r=e.getBoundingClientRect();' +
      'return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    if (!box) { record('触摸 ' + selector, false, '元素不存在'); return null; }
    await touchAt(box.x, box.y);
    return box;
  }

  /** 第 i 个勾选项的"可视方块"中心坐标（先滚入视口，否则坐标会落在视口外） */
  function boxCenter(i) {
    return ev('(function(){var el=document.querySelectorAll("[data-check]")[' + i + '];' +
      'if(!el)return null;' +
      'el.scrollIntoView({block:"center"});' +
      'var r=el.querySelector(".check-box").getBoundingClientRect();' +
      'return {x:r.left+r.width/2,y:r.top+r.height/2,' +
      ' inView: r.top>=0 && r.bottom<=window.innerHeight};})()');
  }

  var checkedN = function () { return ev('Object.keys(CP.ui.archive.answers.ability).length'); };

  console.log('===== 触摸诊断（' + path.basename(BROWSER) + ' · ' + WIDTH + 'x' + HEIGHT + ' · mobile 仿真）=====');
  console.log('— 启动与抽屉 —');

  record('进入窄屏模式', (await ev('window.matchMedia("(max-width: 900px)").matches')) === true);
  record('导航渲染出 9 项', (await ev('document.getElementById("nav").children.length')) === 9);

  await tap('#btnDrawer');
  await sleep(300);
  record('触摸汉堡打开抽屉', (await ev('CP.ui.drawerOpen')) === true);
  record('抽屉可见且未 inert',
    (await ev('(function(){var s=document.getElementById("sidebar");var c=getComputedStyle(s);' +
      'return c.visibility+"|"+c.transform+"|"+s.hasAttribute("inert");})()')) === 'visible|none|false');
  // × 按钮只在真正的手机宽度显示（≤620px），触摸诊断跑在 390px，
  // 所以这里它**应该存在且能点到**——手机上它是主要的关闭手段。
  record('手机宽度下 × 按钮可见',
    (await ev('(function(){var b=document.getElementById("btnDrawerClose");' +
      'return !!b && getComputedStyle(b).display !== "none";})()')) === true);
  record('× 按钮在视口内',
    (await ev('document.getElementById("btnDrawerClose").getBoundingClientRect().left')) >= 0);

  await tap('#btnDrawerClose');
  record('触摸 × 关闭抽屉', (await ev('CP.ui.drawerOpen')) === false);

  // 打开后立刻点 ×（真实用户常常这么做）
  await tap('#btnDrawer');
  await sleep(0);
  var immediateLeft = await ev('document.getElementById("btnDrawerClose").getBoundingClientRect().left');
  await tap('#btnDrawerClose');
  record('开完立刻点 × 也能关闭', (await ev('CP.ui.drawerOpen')) === false,
    '× 当时 left=' + Math.round(immediateLeft));

  // 遮罩也要能关（宽平板/桌面缩窄时没有 ×，只能靠它）
  await tap('#btnDrawer');
  await sleep(200);
  await tap('#scrim');
  record('触摸遮罩关闭抽屉', (await ev('CP.ui.drawerOpen')) === false);

  await tap('#btnDrawer');
  await sleep(200);
  await tap('[data-route="riasec"]');
  record('触摸导航项切页并收起抽屉',
    (await ev('CP.ui.route')) === 'riasec' && (await ev('CP.ui.drawerOpen')) === false);

  /* ---------------- 能力清单：真实触摸勾选 ---------------- */
  console.log('\n— 能力清单（真实触摸勾选）—');
  await ev('CP.ui.archive.profile.grade = "大三"; CP.ui.go("ability"); window.scrollTo(0,0);');
  await sleep(400);

  record('清单渲染出 48 个勾选框', (await ev('document.querySelectorAll("[data-checkbox]").length')) === 48);
  record('按 8 个维度分组', (await ev('document.querySelectorAll(".check-dim").length')) === 8);
  record('每维都有可选的证据输入框', (await ev('document.querySelectorAll("[data-evidence]").length')) === 8);

  var shape = await ev('(function(){var b=document.querySelector("[data-checkbox]");' +
    'var r=b.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};})()');
  // input 若是 0×0，触摸下勾不上（label 转发依赖原生控件尺寸）
  record('隐形勾选框不是零尺寸', shape.w >= 16 && shape.h >= 16, 'input ' + shape.w + '×' + shape.h);

  var c0 = await boxCenter(0);
  await sleep(120);
  await touchAt(c0.x, c0.y);
  record('触摸勾选框能勾上', (await checkedN()) === 1,
    '已勾选 ' + (await checkedN()) + '；坐标 ' + Math.round(c0.x) + ',' + Math.round(c0.y) +
    ' 视口内=' + c0.inView);

  await touchAt(c0.x, c0.y);
  record('再触摸能取消勾选', (await checkedN()) === 0, '已勾选 ' + (await checkedN()));

  for (var ti = 0; ti < 3; ti++) {
    var c = await boxCenter(ti);
    await sleep(80);
    await touchAt(c.x, c.y);
  }
  record('连续触摸 3 项能勾上', (await checkedN()) === 3, '已勾选 ' + (await checkedN()));
  record('维度小计数同步更新',
    (await ev('(document.querySelector(\'[data-count="math"]\')||{}).textContent')) === '3/6');

  var textPos = await ev('(function(){var el=document.querySelectorAll("[data-check]")[4];' +
    'el.scrollIntoView({block:"center"});' +
    'var r=el.querySelector(".check-text").getBoundingClientRect();' +
    'return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
  await sleep(120);
  await touchAt(textPos.x, textPos.y);
  record('触摸文字区域也能勾上', (await checkedN()) === 4, '已勾选 ' + (await checkedN()));

  await ev('(function(){var b=document.querySelectorAll("[data-checkbox]")[5];' +
    'b.scrollIntoView({block:"center"});b.focus();})()');
  await sleep(120);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(250);
  record('键盘空格能切换勾选（原生语义）', (await checkedN()) === 5, '已勾选 ' + (await checkedN()));

  await ev('(function(){var i=document.querySelector(\'[data-evidence="math"]\');i.focus();i.value="线性代数 92 分";i.onchange();})()');
  record('证据字段可写入', (await ev('(CP.ui.archive.abilityEvidence||{}).math')) === '线性代数 92 分');

  // 结果页应能反映勾选结果
  await ev('CP.ui.archive.decision.jobPref = {"algo-research":"like"}; CP.ui.go("result");');
  await sleep(400);
  record('结果页能基于勾选结果渲染',
    (await ev('document.getElementById("view").textContent.length')) > 300);

  cdp.close();
  var fails = results.filter(function (x) { return !x.pass; }).length;
  console.log('\n== ' + (fails === 0 ? '全部通过' : fails + ' 项失败') + ' ==');
  return fails;
}

main().then(function (fails) {
  try { child.kill(); } catch (e) { }
  process.exit(fails === 0 ? 0 : 1);
}).catch(function (e) {
  console.error('触摸诊断失败：' + e.message);
  try { child.kill(); } catch (e2) { }
  process.exit(1);
});
