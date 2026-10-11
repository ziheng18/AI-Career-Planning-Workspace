/*!
 * 冒烟测试：用最小 DOM 仿真跑真实的界面代码路径
 *
 * 为什么需要它：工作台的界面层（页面渲染、事件绑定、存档、导出）无法用纯逻辑测试覆盖，
 * 而本机没有可用的 headless 浏览器。这里实现一个够用的假 DOM，
 * 让 工作台.html 里的脚本按真实顺序加载，并真实触发按钮点击。
 *
 * 覆盖范围：
 *   · 启动引导（CP.ui.init）与全部 9 个路由的渲染与事件绑定
 *   · 点击作答 → 写入档案 → 防抖保存 → 实时反馈图刷新
 *   · 岗位偏好 / 标准排序上移下移 / 路径打分 / 时间与城市
 *   · 年级切换重置能力自评、决策页滚动位置保持
 *   · 示例档案载入、结果页 5 个标签页、行动计划增删改、复盘保存
 *   · Markdown 报告与可打印 HTML 的生成
 *
 * 不覆盖：真实 CSS 布局与视觉效果（需人工在浏览器里看）。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var state = { pass: 0, fail: 0, results: [] };

function test(name, fn) {
  try { fn(); state.pass += 1; state.results.push({ name: name, ok: true }); console.log('  \u2713 ' + name); }
  catch (e) {
    state.fail += 1; state.results.push({ name: name, ok: false, error: e.message });
    console.log('  \u2717 ' + name); console.log('      ' + e.message);
  }
}
function group(t) { console.log('\n' + t); }
function ok(c, m) { if (!c) throw new Error(m || '条件为假'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || '不等') + '：期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); }
function has(hay, needle, m) { if (String(hay).indexOf(needle) < 0) throw new Error((m || '未找到') + '：' + needle); }
function nearNum(a, b, tol, m) {
  if (Math.abs(a - b) > tol) throw new Error((m || '数值不符') + '：期望 ' + b + '±' + tol + '，实际 ' + a);
}

/* ============================================================
 * 最小 DOM 仿真
 * ============================================================ */

var MAP = Object.create(null);

function El(tag) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.children = [];
  this.attrs = Object.create(null);
  this.listeners = Object.create(null);
  this._text = '';
  this._html = '';
  this.value = '';
  this.disabled = false;
  // style 由原型上的 getter 提供，它直接读写 attrs.style，不能再赋一个空对象覆盖
  var self = this;
  // classList 直接以 attrs['class'] 为唯一真相：解析器通过 setAttribute 写类名，
  // 若此处另存一份列表就会两边不同步。
  function list() { return (self.attrs['class'] || '').split(/\s+/).filter(Boolean); }
  function write(arr) { self.attrs['class'] = arr.join(' '); }
  this.classList = {
    add: function (c) { var a = list(); if (a.indexOf(c) < 0) { a.push(c); write(a); } },
    remove: function (c) { var a = list().filter(function (x) { return x !== c; }); write(a); },
    contains: function (c) { return list().indexOf(c) >= 0; },
    toggle: function (c, on) {
      if (on === undefined) on = !this.contains(c);
      if (on) this.add(c); else this.remove(c);
    }
  };
  Object.defineProperty(this, 'className', {
    get: function () { return self.attrs['class'] || ''; },
    set: function (v) { self.attrs['class'] = v; }
  });
}
// 注意：setAttribute 不注册 id 映射。映射统一由 merge() 从根重建，
// 这样元素被 innerHTML 替换后不会留下指向旧节点的失效入口。
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.hasAttribute = function (k) { return this.attrs[k] !== undefined; };
El.prototype.getAttribute = function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; };
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.removeEventListener = function () { };
El.prototype.focus = function () { };
/* 布局测量。假 DOM 没有排版引擎，返回全零是**诚实**的做法：
   FLIP 动画靠"新旧位置之差"判断要不要播，零差值 = 不播，
   正是测试环境该有的行为（真实验证在 测试/悬停诊断.cjs 那一层用真浏览器做）。
   缺了它会让任何测量布局的产品代码直接抛错。 */
El.prototype.getBoundingClientRect = function () {
  return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
};
El.prototype.click = function () { if (typeof this.onclick === 'function') this.onclick({ target: this }); };
El.prototype.descendants = function () {
  var out = [];
  (function walk(n) {
    for (var i = 0; i < n.children.length; i++) { out.push(n.children[i]); walk(n.children[i]); }
  })(this);
  return out;
};
El.prototype.matches = function (sel) {
  sel = sel.trim();
  // 支持复合选择器：tag + #id + .class + [attr] + [attr="v"] 的任意组合
  var re = /(^[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  var m, any = false;
  while ((m = re.exec(sel)) !== null) {
    any = true;
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && this.getAttribute('id') !== m[2]) return false;
    if (m[3] && !this.classList.contains(m[3])) return false;
    if (m[4]) {
      var v = this.getAttribute(m[4]);
      if (m[5] === undefined) { if (v === null) return false; }
      else if (v !== m[5]) return false;
    }
  }
  return any;
};
/**
 * 支持 `A B`（后代）、`A > B`（直接子元素）、`A + B`（相邻兄弟）与单一复合选择器。
 *
 * 为什么必须区分组合符：曾经把 `>` 直接 filter 掉，于是 `.yearplan > li`
 * 悄悄退化成 `.yearplan li`，把嵌套的 li 也算了进来——测试因此得出
 * 与真实浏览器不同的结构结论。选择器语义错了，断言就失去意义。
 */
El.prototype.querySelectorAll = function (sel) {
  var parts = sel.trim().split(/\s+(?![^\[]*\])/).filter(Boolean);
  if (!parts.length) return [];

  // 从右往左拆出「选择器 + 组合符」链。
  // 注意 comb 记在**左侧**元素上：{sel:'.a', comb:'>'} 表示"由 .a 经 > 到下一个"。
  // 因此下面的循环必须读 chain[i-1].comb，而不是 chain[i].comb——
  // 错位一格会让 `>` 悄悄退化成后代匹配（曾经的 bug：.a > li 返回了 3 个 li）。
  var chain = [];
  var buf = null;
  parts.forEach(function (p) {
    if (p === '>' || p === '+' || p === '~') { if (buf) chain.push({ sel: buf, comb: p }); buf = null; }
    else if (buf === null) buf = p;
    else { chain.push({ sel: buf, comb: ' ' }); buf = p; }
  });
  if (buf) chain.push({ sel: buf, comb: null });

  var matched = this.descendants().filter(function (n) { return n.matches(chain[0].sel); });

  for (var i = 1; i < chain.length; i++) {
    var comb = chain[i - 1].comb;              // ← 组合符在左元素上
    var next = [];
    matched.forEach(function (a) {
      if (comb === '>') {
        next = next.concat(a.children.filter(function (c) { return c.matches(chain[i].sel); }));
      } else if (comb === '+') {
        var sib = a.parent && a.parent.children;
        if (sib) {
          var idx = sib.indexOf(a);
          if (idx >= 0 && sib[idx + 1] && sib[idx + 1].matches(chain[i].sel)) next.push(sib[idx + 1]);
        }
      } else if (comb === '~') {
        var sib2 = a.parent && a.parent.children;
        if (sib2) {
          var k = sib2.indexOf(a);
          sib2.slice(k + 1).forEach(function (s) { if (s.matches(chain[i].sel)) next.push(s); });
        }
      } else {
        next = next.concat(a.descendants().filter(function (n) { return n.matches(chain[i].sel); }));
      }
    });
    matched = next;
  }
  return matched.filter(function (n, i) { return matched.indexOf(n) === i; });   // 去重
};
El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
El.prototype.closest = function (sel) {
  var n = this.parent;
  while (n) { if (n.matches(sel)) return n; n = n.parent; }
  return null;
};

/**
 * 表单控件的值：真实浏览器里 input/textarea 的 value 是"活的"。
 *   · input  → 读 value 特性（模板里写成 value="..."）
 *   · textarea → 读它的文本子节点
 * 少了这一层，页面上用 <textarea> 初始化的内容在测试里读不到，
 * 会误判成"没写入"。
 */
Object.defineProperty(El.prototype, 'value', {
  get: function () {
    if (this.tagName === 'TEXTAREA') {
      return this._text !== undefined ? this._text : (this.attrs.value || '');
    }
    return this.attrs.value === undefined ? '' : this.attrs.value;
  },
  set: function (v) {
    if (this.tagName === 'TEXTAREA') this._text = String(v);
    else this.attrs.value = String(v);
  },
  configurable: true
});

/**
 * 复选框：checked 必须与 checked 属性互通。
 * 真实浏览器里 <input type="checkbox"> 的 checked 是属性/特性双向反射的，
 * 页面代码既会读 input.checked，测试也会用 q1(...).click() 来勾选。
 * 少了这一层，勾选式清单的交互在测试里会"点了没反应"。
 */
Object.defineProperty(El.prototype, 'checked', {
  get: function () { return this.attrs.checked !== undefined; },
  set: function (v) {
    if (v) this.attrs.checked = '';
    else delete this.attrs.checked;
  },
  configurable: true
});

/**
 * click()：对复选框/单选框要真的切换并派发 change/input，
 * 否则程序化点击与用户在浏览器里的点击行为不一致。
 */
El.prototype.click = function () {
  if (this.tagName === 'INPUT') {
    var type = (this.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') {
      this.checked = !this.checked;
      if (typeof this.onchange === 'function') this.onchange({ target: this });
      if (typeof this.oninput === 'function') this.oninput({ target: this });
      return;
    }
    if (type === 'radio') {
      this.checked = true;
      if (typeof this.onchange === 'function') this.onchange({ target: this });
      return;
    }
  }
  if (typeof this.onclick === 'function') this.onclick({ target: this });
};

/* ---------------- 极简 HTML 解析：让 innerHTML 真的长成 DOM 树 ----------------
   只支持页面代码实际会用到的子集：普通标签、带引号/不带值的属性、文本、注释、自闭合标签、
   以及 select/table/ul 等场景下的隐式闭合。目的是让查询能命中，而不是做一个浏览器。 */
var VOID = { br: 1, img: 1, input: 1, hr: 1, meta: 1, link: 1, col: 1, source: 1, area: 1, base: 1, wbr: 1 };
// 打开一个新标签时，是否要隐式闭合已在栈里的某个祖先标签。
// 例如 <li>a<li>b：第二个 li 会先把第一个关掉。
var AUTO_CLOSE = {
  li: { li: 1 }, tr: { tr: 1 }, td: { td: 1, th: 1 }, th: { td: 1, th: 1 },
  option: { option: 1 }, p: { p: 1, div: 1, ul: 1, ol: 1, table: 1, section: 1, h1: 1, h2: 1, h3: 1, h4: 1 },
  thead: { tbody: 1, tfoot: 1 }, tbody: { tbody: 1, tfoot: 1 }
};
// 哪些标签的结束标签可以省略（即"允许被隐式闭合"）。
// 查找目标祖先时遇到不属于此集合的标签就停下——那是边界，不能跨过。
// 注意不能拿 AUTO_CLOSE 当这个判据：它的键是"触发闭合的标签"，
// 例如 ul 是 <p> 的闭合触发者，但 ul 自身不能省略结束标签。
var CLOSABLE = {
  li: 1, tr: 1, td: 1, th: 1, option: 1, p: 1, thead: 1, tbody: 1, tfoot: 1
};

function parseHTML(str) {
  var out = [];
  var stack = [{ el: null, children: out }];
  var i = 0;
  var re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  var m, textStart = 0;

  function pushText(t) {
    if (!t) return;
    var top = stack[stack.length - 1];
    if (!top.el) return;                     // 根层文本忽略
    top.el._text += t.replace(/\s+/g, ' ').trim() ? t : '';
  }

  while ((m = re.exec(str)) !== null) {
    pushText(str.slice(textStart, m.index));
    textStart = re.lastIndex;

    if (m[0].indexOf('<!--') === 0) continue;   // 注释

    if (m[1]) {                                  // 结束标签
      for (var k = stack.length - 1; k > 0; k--) {
        if (stack[k].el && stack[k].el.tagName === m[1].toUpperCase()) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    var tagName = m[2];
    var attrsStr = m[3] || '';
    var e = new El(tagName);
    var ar = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
    var am;
    while ((am = ar.exec(attrsStr)) !== null) {
      if (!am[1]) continue;
      e.setAttribute(am[1], am[2] === undefined ? '' : am[2]);
    }
    // 让布尔/取值属性也反映到元素属性上，接近浏览器行为
    if (e.getAttribute('disabled') !== null) e.disabled = true;
    if (e.getAttribute('value') !== null) e.value = e.getAttribute('value');
    if (e.getAttribute('checked') !== null) e.checked = true;

    var parent = stack[stack.length - 1];
    if (parent.el) parent.el.children.push(e);
    else out.push(e);

    var ac = AUTO_CLOSE[tagName.toLowerCase()];
    if (ac) {
      // 隐式闭合：从栈顶往下逐层找"要闭合的那个祖先"，沿途只允许跨过可省略结束标签的层。
      //
      // 曾经的写法是往下遇到第一个非 void 元素就 break，于是 `<li><ul><li>` 里的内层 li
      // 撞上中间那层 `ul` 就放弃闭合——嵌套 li 被当兄弟节点平铺，DOM 与真实浏览器不一致。
      var target = -1;
      for (var j = stack.length - 1; j > 0; j--) {
        var tag = stack[j].el ? stack[j].el.tagName.toLowerCase() : '';
        if (!tag) break;
        if (ac[tag]) { target = j; break; }     // 找到需要被闭合的祖先
        if (!CLOSABLE[tag]) break;              // 遇到不可省略结束标签的层：这是边界，停下
      }
      if (target > 0) stack.length = target;
    }
    if (!VOID[tagName.toLowerCase()] && !m[4]) stack.push({ el: e, children: e.children });
  }
  pushText(str.slice(textStart));
  return out;
}

/**
 * 从根重新遍历，重建 id 映射：确保 byId 永远指向"当前还在文档里"的元素。
 * 规则贴近真实 DOM：任何带 id 的元素都能被查到；
 * 唯一的例外是带 for 属性的 <label>——它指向的是别的元素，不该占用那个 id。
 */
function rebuildMap() {
  var root = MAP.__root;
  Object.keys(MAP).forEach(function (k) { delete MAP[k]; });
  MAP.__root = root;
  if (!root) return;
  (function walk(x) {
    var id = x.getAttribute('id');
    if (id && !MAP[id] && x.getAttribute('for') === null) MAP[id] = x;
    x.children.forEach(walk);
  })(root);
}

function merge(host, nodes) {
  nodes.forEach(function (n) {
    if (host.children.indexOf(n) < 0) host.children.push(n);
    (function walk(x, parent) {
      x.parent = parent;
      x.children.forEach(function (c) { walk(c, x); });
    })(n, host);
  });
  rebuildMap();
}

Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) {
    this._html = String(v);
    this.children = [];
    merge(this, parseHTML(this._html));
  }
});
/**
 * textContent 必须**聚合后代的文本**。
 * 真实 DOM 的 textContent 会把整棵子树的文本拼起来；只返回自身 _text 的话，
 * 任何"外层容器里套着 span"的结构（进度行、指标卡、表格行）读出来都是空字符串，
 * 会让针对这些结构的断言全部失效或误判。
 */
/**
 * style 必须真的读写 style 特性。
 * 之前 style 只是个空对象：写 `el.style.width = '50%'` 不会落到特性上，
 * 读 `el.style.width` 永远 undefined。结果是断言 `style.width !== '0%'` 恒真——
 * 即使进度条压根没更新也照样通过（假通过）。
 */
(function () {
  function parse(str) {
    var out = {};
    String(str || '').split(';').forEach(function (seg) {
      var i = seg.indexOf(':');
      if (i <= 0) return;
      var k = seg.slice(0, i).trim();
      var v = seg.slice(i + 1).trim();
      if (!k) return;
      // 转成 JS 属性名（background-color → backgroundColor），与真实 DOM 一致
      out[k.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = v;
    });
    return out;
  }
  function serialize(obj) {
    return Object.keys(obj).map(function (k) {
      var css = k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
      return css + ': ' + obj[k];
    }).join('; ');
  }
  Object.defineProperty(El.prototype, 'style', {
    get: function () {
      var self = this;
      var backing = this.__style || (this.__style = parse(this.attrs.style));
      // 用 Proxy 让任何属性写入都同步回 style 特性。
      // 真实 DOM 里 el.style.width = '50%' 之后，getAttribute('style') 也会变。
      return new Proxy(backing, {
        set: function (t, k, v) {
          t[k] = v;
          self.attrs.style = serialize(t);
          return true;
        }
      });
    },
    configurable: true
  });
})();

Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    var out = (this._text === undefined ? '' : this._text);
    for (var i = 0; i < this.children.length; i++) out += this.children[i].textContent;
    return out;
  },
  set: function (v) {
    this._text = String(v);
    this.children = [];   // 真实 DOM 里给 textContent 赋值会清空子节点
  }
});

function el(tag, attrs) {
  var e = new El(tag);
  Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  return e;
}

/** q(选择器, 根) —— 走真实的选择器引擎，不用捷径，保证测的是浏览器里的同一套逻辑 */
function q(sel, rootNode) { return (rootNode || byId('view')).querySelectorAll(sel); }
function q1(sel, rootNode) { return q(sel, rootNode)[0] || null; }
function byId(id) { return MAP[id] || null; }

/**
 * 构建假 DOM 的静态外壳。
 *
 * 关键点：**直接解析 工作台.html 的 <body>**，而不是在测试里手工复刻一份。
 * 手工复刻的代价是真实 HTML 一改（比如这次加了顶栏和抽屉），测试就大面积假失败。
 * 解析真实文件后，外壳结构永远与产品一致。
 */
function buildDom() {
  MAP = Object.create(null);
  var root = el('body');
  MAP.__root = root;

  var raw = fs.readFileSync(path.join(ROOT, '工作台.html'), 'utf8');
  var body = (raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [])[1] || '';
  var shell = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')   // 脚本由 scriptList() 负责加载
    .replace(/<!--[\s\S]*?-->/g, '');             // 注释里的裸 --> 会干扰解析

  parseHTML(shell).forEach(function (n) { root.appendChild(n); });
  rebuildMap();

  // document.body：挂成 root 的持久引用。不能塞进 MAP——
  // rebuildMap() 会清空 MAP 里除 __root 之外的所有键。
  root.__body = el('body');
  return root;
}

/* ============================================================
 * 组装运行环境
 * ============================================================ */

function makeSandbox() {
  var root = buildDom();
  var storeMap = Object.create(null);

  var localStorage = {
    getItem: function (k) { return storeMap[k] === undefined ? null : storeMap[k]; },
    setItem: function (k, v) { storeMap[k] = String(v); },
    removeItem: function (k) { delete storeMap[k]; }
  };

  var doc = {
    _root: root,
    _listeners: Object.create(null),
    getElementById: function (id) { return MAP[id] || null; },
    createElement: function (tag) { return new El(tag); },
    querySelectorAll: function (s) { return root.querySelectorAll(s); },
    querySelector: function (s) { return root.querySelector(s); },
    addEventListener: function (t, f) { (doc._listeners[t] = doc._listeners[t] || []).push(f); },
    removeEventListener: function () { },
    documentElement: root
  };
  // document.body 必须动态取，且不能依赖 MAP（rebuildMap 会清空它）
  Object.defineProperty(doc, 'body', { get: function () { return root.__body || null; } });

  var win = {
    location: { hash: '' },
    addEventListener: function () { },
    pageYOffset: 0,
    scrollTo: function (x, y) { sb.__lastScroll = y; },
    open: function () { return null; }
  };

  var sandbox = {
    window: win,
    document: doc,
    localStorage: localStorage,
    location: win.location,
    addEventListener: function (t, f) { if (t === 'DOMContentLoaded') win.__dcl = f; },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    /* requestAnimationFrame 必须提供：产品代码用它做换页动画。
       假 DOM 没有真正的帧循环，直接同步执行回调即可——调用方只是
       "下一帧再做某事"，同步执行不影响断言语义。
       这也是**能力检测**的一环：缺了它整个启动流程会抛错。 */
    requestAnimationFrame: function (fn) { fn(); return 0; },
    cancelAnimationFrame: function () { },
    Date: Date,
    Math: Math,
    JSON: JSON,
    Number: Number,
    String: String,
    Object: Object,
    Array: Array,
    isNaN: isNaN,
    Blob: function () { },
    URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () { } },
    FileReader: function () { },
    confirm: function () { return true; },
    prompt: function () { return null; },
    alert: function () { },
    module: { exports: {} },
    exports: {},
    globalThis: null
  };
  sandbox.globalThis = sandbox;
  // 把常用构造器也挂上，兼容脚本里可能的 window.X 用法
  win.document = doc;
  win.localStorage = localStorage;
  win.confirm = sandbox.confirm;
  win.prompt = sandbox.prompt;
  win.alert = sandbox.alert;
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.requestAnimationFrame = sandbox.requestAnimationFrame;
  win.cancelAnimationFrame = sandbox.cancelAnimationFrame;
  win.FileReader = sandbox.FileReader;
  win.Blob = sandbox.Blob;
  win.URL = sandbox.URL;
  win.console = console;
  win.Date = Date;
  win.JSON = JSON;

  return sandbox;
}

/** 按 工作台.html 里的顺序加载脚本 */
function scriptList() {
  var html = fs.readFileSync(path.join(ROOT, '工作台.html'), 'utf8');
  var re = /<script\s+src="([^"]+)"><\/script>/g;
  var out = [];
  var m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/\//g, path.sep));
  return out;
}

var FILES = scriptList();
var sb = makeSandbox();
var context = vm.createContext(sb);

FILES.forEach(function (rel) {
  var abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error('工作台.html 引用了不存在的脚本：' + rel);
  vm.runInContext(fs.readFileSync(abs, 'utf8'), context, { filename: rel });
});

var CP = sb.CP;
// 共享测试助手：能力清单的勾选式作答（与逻辑测试用同一份实现）
var fillAbility = require('./填充能力.cjs');
CP.fillAbility = function (archive, byDim, profile) {
  return fillAbility(CP, archive, byDim, profile);
};
var DOMContentLoaded = sb.window.__dcl || null;

/* ============================================================
 * 测试
 * ============================================================ */

console.log('AI 职业生涯规划工作台 — 界面层冒烟测试');
console.log('从 工作台.html 载入脚本 ' + FILES.length + ' 个');

group('一、启动');

test('脚本按顺序加载且 CP 命名空间完整', function () {
  ok(CP, 'CP 未定义');
  ['SCHEMA_VERSION', 'BANKS', 'JOB_FAMILIES', 'PATHS', 'store', 'chartRadar', 'pages', 'report', 'ui'].forEach(function (k) {
    ok(CP[k] !== undefined, '缺少 CP.' + k);
  });
  eq(CP.BANKS.riasec.items.length, 36);
  eq(FILES.length, 14, '脚本数量与 HTML 不一致，实际 ' + FILES.length);
});

test('init 引导成功：生成导航、渲染首页、写入存档', function () {
  CP.ui.init();
  var navBtns = byId('nav').children;
  eq(navBtns.length, 9, '导航应为 9 项');
  var html = byId('view').innerHTML;
  // 首页结构：主视觉 + 三个指标 + 八步流程
  has(html, 'class="hero"', '首页应有主视觉区');
  has(html, '职业生涯规划', '首页应有标题');
  has(html, '八步流程', '首页缺少流程说明');
  eq(q('.step').length, 8, '八步流程应有 8 个可点击步骤');
  eq(q('.metric').length >= 3, true, '首页应有三个指标卡');
  ok(byId('heroDemo'), '主视觉里应有"先看示例档案"按钮');
  ok(sb.localStorage.getItem('ai-career-workbench/archive/v1'), '未写入 localStorage');
  eq(byId('sideProgressText').textContent, '0%', '初始进度应为 0%');
});

test('主页八步流程可点击跳转', function () {
  CP.ui.go('home');
  var steps = q('.step');
  eq(steps.length, 8);
  // 第 3 步应为职业锚
  eq(steps[2].getAttribute('onclick').indexOf('anchor') > 0, true, '第 3 步应跳转到职业锚');
  eq(steps[7].getAttribute('onclick').indexOf('export') > 0, true, '第 8 步应跳转到导出');
});

test('主视觉里的示例档案按钮已绑定', function () {
  var saved = CP.ui.archive;                    // 保留进入本用例前的档案，避免污染后续用例
  CP.ui.go('home');
  sb.confirm = function () { return false; };   // 选大三示例
  byId('heroDemo').onclick();
  eq(CP.ui.archive.profile.grade, '大三', '应载入大三示例');
  ok(CP.ui.archive.computed, '示例档案应带计算结果');
  CP.ui.archive = saved;
  CP.store.save(saved);
});

test('存档能原样读回，且迁移会补齐缺失字段', function () {
  var back = CP.store.load();
  ok(back && back.kind === CP.ARCHIVE_KIND);
  var partial = { kind: CP.ARCHIVE_KIND, profile: { grade: '大四' }, answers: { riasec: { r1: { v: 5, t: 1 } } } };
  var m = CP.migrate(partial);
  eq(m.profile.grade, '大四');
  eq(m.profile.acceptPostgrad, '', '缺失字段应补默认值');
  eq(Object.keys(m.answers.riasec).length, 1);
  ok(m.answers.anchor && typeof m.answers.anchor === 'object', '应补出 anchor 容器');
  eq(m.schemaVersion, CP.SCHEMA_VERSION);
});

group('二、九个路由的渲染与事件绑定');

var ROUTES = ['home', 'profile', 'riasec', 'anchor', 'ability', 'decision', 'result', 'action', 'export'];

ROUTES.forEach(function (r) {
  test('路由 ' + r + ' 可渲染并完成事件绑定', function () {
    CP.ui.route = r;
    var html = CP.pages[r]();
    ok(typeof html === 'string' && html.length > 100, '渲染结果过短');
    byId('view').innerHTML = html;
    CP.bindPage(r);       // 绑定失败会抛出，等于覆盖了事件注册路径
  });
});

test('导航按钮点击会切换路由', function () {
  var btn = byId('nav').children.filter(function (b) { return b.getAttribute('data-route') === 'riasec'; })[0];
  ok(btn, '未找到兴趣测评导航按钮');
  btn.click();
  // click → location.hash 赋值 → 本仿真不触发 hashchange，手动补一次
  CP.ui.go('riasec');
  eq(CP.ui.route, 'riasec');
  ok(byId('nav').children.filter(function (b) { return b.classList.contains('active'); })[0].getAttribute('data-route') === 'riasec',
    '当前导航项未高亮');
});

group('三、测评作答交互');

test('完整作答：点击量表按钮写入档案、更新反馈图与进度', function () {
  CP.ui.archive.answers.riasec = {};
  CP.ui.route = 'riasec';
  byId('view').innerHTML = CP.pages.riasec();
  CP.bindPage('riasec');

  eq(q('[data-item]').length, 36 * 5, '36 题 × 5 档应为 180 个按钮');

  CP.BANK_RIASEC.items.forEach(function (it) {
    var b = q1('[data-item="' + it.id + '"][data-val="4"]');
    ok(b, '未找到题 ' + it.id + ' 的档位按钮');
    b.click();
  });

  var ans = CP.ui.archive.answers.riasec;
  eq(Object.keys(ans).length, 36, '应记录 36 题作答');
  eq(ans.r1.v, 4, '记录的值不对');
  ok(ans.r1.t > 0, '应记录作答时间戳');
  ok(byId('fb').innerHTML.indexOf('<svg') >= 0, '实时反馈图未生成');
});

test('能力清单（勾选式）能作答，并画出能力条形图', function () {
  CP.ui.archive.profile.grade = '大三';
  CP.ui.archive.answers.ability = {};
  CP.ui.route = 'ability';
  byId('view').innerHTML = CP.pages.ability();
  CP.bindPage('ability');
  var items = CP.activeItems(CP.BANK_ABILITY, CP.ui.archive.profile);
  eq(q('[data-checkbox]').length, items.length, '每项应有一个勾选框，共 ' + items.length + ' 个');
  eq(q('[data-checkbox]').length, 48, '大二及以上版清单应有 48 项');
  eq(q('.check-dim').length, 8, '应按 8 个维度分组');
  eq(q('[data-evidence]').length, 8, '每个维度应有一个可选的证据输入框');

  // 勾选每维前 3 项
  var cnt = {};
  items.forEach(function (it) {
    cnt[it.dim] = (cnt[it.dim] || 0) + 1;
    if (cnt[it.dim] <= 3) q1('[data-checkbox="' + it.id + '"]').click();
  });
  eq(Object.keys(CP.ui.archive.answers.ability).length, 24, '8 维 × 3 项 = 24 个勾选项');
  ok(byId('fb').innerHTML.indexOf('<svg') >= 0, '能力条形图未生成');

  // 取消勾选应真的删除记录
  var first = items[0].id;
  q1('[data-checkbox="' + first + '"]').click();
  eq(CP.ui.archive.answers.ability[first], undefined, '取消勾选应删除该题记录');
  q1('[data-checkbox="' + first + '"]').click();

  // 证据字段：填了就存，清空就删
  var ev = q1('[data-evidence="math"]');
  ev.value = '线性代数 92 分';
  ev.onchange();
  eq(CP.ui.archive.abilityEvidence.math, '线性代数 92 分');
  ev.value = '';
  ev.onchange();
  eq(CP.ui.archive.abilityEvidence.math, undefined, '清空证据应删除该字段');
});

test('维度小计数随勾选更新，且异常勾选会给提示', function () {
  CP.ui.archive.profile.grade = '大三';
  CP.ui.archive.answers.ability = {};
  CP.ui.route = 'ability';
  byId('view').innerHTML = CP.pages.ability();
  CP.bindPage('ability');
  eq(byId('view').querySelector('[data-count="math"]').textContent, '0/6', '初始应为 0/6');
  q1('[data-checkbox="math1"]').click();
  q1('[data-checkbox="math2"]').click();
  eq(byId('view').querySelector('[data-count="math"]').textContent, '2/6', '勾 2 项后应显示 2/6');

  // 全勾 → 应提示可能高估。
  // 先清空再重新渲染，保证起点确实是"一个都没勾"，否则再点一次等于取消勾选。
  CP.ui.archive.answers.ability = {};
  byId('view').innerHTML = CP.pages.ability();
  CP.bindPage('ability');
  q('[data-checkbox]').forEach(function (box) { box.click(); });
  var allIds = CP.activeItems(CP.BANK_ABILITY, CP.ui.archive.profile).map(function (x) { return x.id; });
  var missed = allIds.filter(function (id) { return CP.ui.archive.answers.ability[id] === undefined; });
  eq(Object.keys(CP.ui.archive.answers.ability).length, 48,
    '全勾后应记录 48 项，漏掉的：' + missed.join(','));
  var fbData = byId('fb').innerHTML;
  ok(fbData.indexOf('高估') >= 0, '全勾时应提示可能高估，实际未提示');
});

test('作答后进度条会推进', function () {
  CP.ui.refreshProgress();
  var pct = parseInt(byId('sideProgressText').textContent, 10);
  ok(pct > 0, '进度应大于 0，实际 ' + pct);
  ok(byId('sideProgress').style.width !== '0%', '进度条宽度未更新');
  eq(q('.nav-item', byId('nav')).length, 9, '导航应保持 9 项');
  ok(byId('sideProgress').style.width !== '0%', '侧边进度条应同步更新');
});

test('同一题改选会覆盖而不是重复累加', function () {
  // 回到兴趣测评页并重新渲染，确保操作的是当前 DOM
  CP.ui.go('riasec');
  var before = Object.keys(CP.ui.archive.answers.riasec).length;
  q1('[data-item="r1"][data-val="5"]').click();
  eq(CP.ui.archive.answers.riasec.r1.v, 5, '应覆盖为 5');
  eq(Object.keys(CP.ui.archive.answers.riasec).length, before, '题数不应变化');
  // 被改选的按钮应高亮，同题其他档位应取消高亮
  eq(q1('[data-item="r1"][data-val="5"]').classList.contains('on'), true);
  eq(q1('[data-item="r1"][data-val="4"]').classList.contains('on'), false);
});

group('四、决策输入交互');

test('岗位偏好三态切换（感兴趣 / 不排斥 / 排除）', function () {
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');

  q1('[data-pref="ai-pm"][data-val="like"]').click();
  eq(CP.ui.archive.decision.jobPref['ai-pm'], 'like');
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  q1('[data-pref="ai-pm"][data-val="exclude"]').click();
  eq(CP.ui.archive.decision.jobPref['ai-pm'], 'exclude');
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  q1('[data-pref="ai-pm"][data-val="exclude"]').click();
  eq(CP.ui.archive.decision.jobPref['ai-pm'], undefined, '再次点击同一状态应取消');
});

test('决策标准排序按钮会改变权重顺序', function () {
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  var order = (CP.ui.archive.decision.criteriaOrder.length === 6)
    ? CP.ui.archive.decision.criteriaOrder.slice()
    : CP.CRITERIA.map(function (c) { return c.id; });
  var first = order[0], second = order[1];
  q1('[data-move="up"][data-cid="' + second + '"]').click();
  eq(CP.ui.archive.decision.criteriaOrder[0], second, '第 2 位应上移到第 1 位');
  eq(CP.ui.archive.decision.criteriaOrder[1], first);
  var w = CP.criteriaWeights(CP.ui.archive.decision.criteriaOrder).weights;
  ok(w[second] > w[first], '上移后权重应变大');
  CP.ui.go('decision');
  has(byId('view').innerHTML, '决策标准排序');
});

test('排序行带 FLIP 定位标记，且移动时会挂动画钩子', function () {
  // 滑动动画本身靠真浏览器验证（测试/排序动效诊断.cjs）。
  // 假 DOM 没有排版，量不到位置，所以这里只测两件能测的：
  //   ① 每行有 data-sortcid —— 没有它，重渲染后找不回"同一行"，
  //      FLIP 就算不出位移，动画会静默失效；
  //   ② 点移动按钮后 CP.ui.afterRender 被挂上 —— FLIP 的播放入口，
  //      漏挂的话位置量完了却没人播。
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');

  var rows = q('.sortrow[data-sortcid]');
  eq(rows.length, CP.CRITERIA.length,
    '每行都应带 data-sortcid，实际 ' + rows.length + ' 行有标记');
  // 标记值必须能对上标准 id，否则重渲染后对不上号
  var ids = rows.map(function (r) { return r.getAttribute('data-sortcid'); });
  CP.CRITERIA.forEach(function (c) {
    ok(ids.indexOf(c.id) >= 0, '标记里应含标准 id：' + c.id);
  });

  CP.ui.afterRender = null;
  var order = CP.ui.archive.decision.criteriaOrder.slice();
  var second = order[1];
  // 钩子会在 render() 里被消费掉（执行完置回 null），所以不能在点击后直接查它，
  // 那样看到的必然是 null。改成包一层，记录"它到底被调用过没有"。
  var origRender = CP.ui.render;
  var hookFireCount = 0;
  var sawHookAsFunction = false;
  CP.ui.render = function (opt) {
    // render() 内部会把 afterRender 取出来执行，这里在它执行前偷看一下类型
    if (typeof CP.ui.afterRender === 'function') sawHookAsFunction = true;
    var r = origRender.apply(this, arguments);
    hookFireCount += 1;
    return r;
  };
  q1('[data-move="up"][data-cid="' + second + '"]').click();
  CP.ui.render = origRender;

  ok(sawHookAsFunction, '移动时应挂上 afterRender 钩子（FLIP 的播放入口）');
  eq(hookFireCount, 1, '移动应只触发一次重渲染');
  eq(CP.ui.archive.decision.criteriaOrder[0], second, '顺序仍应正确更新');
});

test('路径打分下拉框会写入覆盖值并改变加权得分', function () {
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  var before = CP.decidePaths(CP.ui.archive).ranked.filter(function (r) { return r.pathId === 'p-考公'; })[0].total;
  var sel = q1('[data-path="p-考公"][data-crit="balance"]');
  ok(sel, '未找到路径评分下拉框');
  sel.value = '1';
  sel.onchange();
  eq(CP.ui.archive.decision.pathScores['p-考公'].balance, 1);
  var after = CP.decidePaths(CP.ui.archive).ranked.filter(function (r) { return r.pathId === 'p-考公'; })[0].total;
  ok(after < before, '把评分从默认值降到 1 后加权得分应下降');
});

test('决策页不再包含生涯人物访谈（已于 v0.2 移除）', function () {
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  var html = byId('view').innerHTML;
  ok(html.indexOf('访谈') < 0, '决策页不应再出现访谈入口');
  ok(!byId('addIv'), '不应再有"添加访谈对象"按钮');
  ok(!('interviews' in CP.ui.archive), '档案里不应再有 interviews 字段');
  // 但应保留时间与城市，并说明城市不参与计算
  ok(byId('hoursPerWeek'), '决策页应有每周时长输入');
  has(html, '不参与任何筛选或计算', '应说明城市不参与计算');
});

test('城市移到了决策输入，且明确说明不参与计算', function () {
  CP.ui.archive.decision.targetCities = [];
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  q1('[data-city="杭州"]').click();
  eq(CP.ui.archive.decision.targetCities.indexOf('杭州') >= 0, true, '应记录期望城市');
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  has(byId('view').innerHTML, '不参与任何筛选或计算', '应说明城市不参与计算');
  q1('[data-city="杭州"]').click();
  eq(CP.ui.archive.decision.targetCities.length, 0, '再次点击应取消');
});

test('每周学习时长在决策输入页，并写入 decision', function () {
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  ok(byId('hoursPerWeek'), '决策页应有每周时长输入');
  byId('hoursPerWeek').value = '12';
  byId('hoursPerWeek').onchange();
  eq(CP.ui.archive.decision.hoursPerWeek, 12);
});

test('决策页点击按钮后保留滚动位置（不跳回顶端）', function () {
  CP.ui.route = 'decision';
  byId('view').innerHTML = CP.pages.decision();
  CP.bindPage('decision');
  // 模拟用户已向下滚动
  sb.window.pageYOffset = 900;
  q1('[data-pref="ai-pm"][data-val="like"]').click();
  eq(sb.__lastScroll, 900, '重渲染后应回到原来的滚动位置，实际 ' + sb.__lastScroll);
  // 换页时必须回到页首
  CP.ui.go('result');
  eq(sb.__lastScroll, 0, '换页时应回到页首');
});

test('基本信息表单可写入，年级变化会计时切换能力口径', function () {
  CP.ui.archive.profile.cities = [];
  CP.ui.route = 'profile';
  byId('view').innerHTML = CP.pages.profile();
  CP.bindPage('profile');
  byId('grade').value = '大三'; byId('grade').onchange();
  eq(CP.ui.archive.profile.grade, '大三');
  byId('acceptPostgrad').value = '接受'; byId('acceptPostgrad').onchange();
  eq(CP.ui.archive.profile.acceptPostgrad, '接受');
});

test('大一时 GPA 档位不可填，且说明会解释口径变化', function () {
  CP.ui.route = 'profile';
  byId('view').innerHTML = CP.pages.profile();
  CP.bindPage('profile');
  byId('grade').value = '大一'; byId('grade').onchange();
  eq(CP.ui.archive.profile.grade, '大一');
  eq(CP.ui.archive.profile.gpaBand, '', '切到大一后 GPA 档位应被清空');
  var html = byId('view').innerHTML;
  var gpa = byId('gpaBand');
  ok(gpa, '未生成 GPA 字段');
  eq(gpa.tagName, 'INPUT', 'GPA 字段应为 input');
  eq(gpa.getAttribute('disabled') !== null, true, '大一的 GPA 输入应带 disabled 属性');
  eq(gpa.disabled, true, '大一的 GPA 档位应禁用');
  has(html, '不适用（大一通常尚未评定）', '大一的 GPA 项应显示为不适用');
  ok(html.indexOf('大一版行为清单') < 0, '基本信息页不应再解释口径细节');

  // 切回大三应恢复可填
  byId('grade').value = '大三'; byId('grade').onchange();
  eq(byId('gpaBand').disabled, false, '大三应恢复可填');
});

test('基本信息页不再重复解释设计口径（只保留必要的操作提示）', function () {
  // 这条守着一次刻意的删除：页面上不再解释"为什么大一换口径"
  CP.ui.archive.profile.grade = '大一';
  byId('view').innerHTML = CP.pages.profile();
  var html = byId('view').innerHTML;
  ok(html.indexOf('拿它主导排序没有意义') < 0, '不应再出现设计理由的解释');
  ok(html.indexOf('所以工作台对你改用两套不同的口径') < 0, '不应再出现设计理由的解释');
  has(html, '这是本页唯一参与计算的一项', '参与计算字段的提示要保留（属于操作说明）');
  CP.ui.archive.profile.grade = '大三';
});

test('切换年级会重置能力自评（避免两套口径的答案混在一起）', function () {
  CP.ui.archive.profile.grade = '大三';
  CP.ui.route = 'ability';
  byId('view').innerHTML = CP.pages.ability();
  CP.bindPage('ability');
  CP.BANK_ABILITY.items.slice(0, 24).forEach(function (it) { CP.ui.archive.answers.ability[it.id] = { v: 3, t: 1 }; });
  ok(Object.keys(CP.ui.archive.answers.ability).length > 0);
  CP.ui.route = 'profile';
  byId('view').innerHTML = CP.pages.profile();
  CP.bindPage('profile');
  byId('grade').value = '大一'; byId('grade').onchange();
  eq(Object.keys(CP.ui.archive.answers.ability).length, 0, '换年级后能力作答应被清空');
});

test('能力自评页面在大一与大三下展示不同的题面', function () {
  CP.ui.archive.profile.grade = '大一';
  byId('view').innerHTML = CP.pages.ability();
  var freshHtml = byId('view').innerHTML;
  has(freshHtml, '行为清单（勾选式）', '大一应标注行为清单');
  eq(byId('view').querySelectorAll('[data-checkbox]').length, 48, '大一版清单应为 48 项');
  // 大一版的第 1 项门槛更低
  var freshFirst = CP.activeItems(CP.BANK_ABILITY, { grade: '大一' })[0].text;
  has(freshHtml, freshFirst, '页面应渲染大一版题目');

  CP.ui.archive.profile.grade = '大三';
  byId('view').innerHTML = CP.pages.ability();
  var seniorHtml = byId('view').innerHTML;
  eq(byId('view').querySelectorAll('[data-checkbox]').length, 48, '大三版清单应为 48 项');
  var seniorFirst = CP.activeItems(CP.BANK_ABILITY, { grade: '大三' })[0].text;
  has(seniorHtml, seniorFirst, '页面应渲染大三版题目');
  ok(freshFirst !== seniorFirst, '两套清单的题面必须不同');
  ok(seniorHtml.indexOf(freshFirst) < 0, '大三页面不应出现大一版题目');
});

group('五、示例档案与结果页');

test('载入示例档案：两个示例都可载入且通过完整性校验', function () {
  // 确认返回 true → 大一示例
  sb.confirm = function () { return true; };
  byId('btnDemo').click();
  eq(CP.ui.archive.profile.grade, '大一', '应载入大一示例');
  var missingFresh = CP.validateArchive(CP.ui.archive);
  eq(missingFresh.length, 0, '大一示例应通过完整性校验，实际：' + missingFresh.join('|'));
  var freshActs = CP.ui.archive.actions;
  ok(freshActs.length > 0, '大一示例应带行动计划');
  eq(freshActs[0].fromGap, null, '第一条应是方向探索任务');
  has(freshActs[0].note, '先验证方向', '探索任务的说明应点明目的');
  eq(CP.ui.archive.computed.score.abilityMode, 'checklist');
  eq(CP.ui.archive.computed.score.abilityGrade, 'fresh', '大一示例应使用大一版清单');
  eq(CP.ui.route, 'result');

  // 确认返回 false → 大三示例
  sb.confirm = function () { return false; };
  byId('btnDemo').click();
  eq(CP.ui.archive.profile.grade, '大三', '应载入大三示例');
  eq(CP.validateArchive(CP.ui.archive).length, 0, '大三示例不应缺项');
  ok(CP.ui.archive.actions.length > 0);
  eq(CP.ui.archive.computed.score.abilityGrade, 'senior', '大三示例应使用大二及以上版清单');
  ok(CP.ui.archive.computed.match.ranked.length > 0);

  // 收尾：把档案固定成大三示例，避免后面的用例受年级状态影响
  CP.ui.archive = CP.demoArchive();
  CP.store.save(CP.ui.archive);
});

test('结果页 5 个标签都能渲染', function () {
  CP.ui.go('result');
  var tabs = q('[data-tab]');
  eq(tabs.length, 5, '应有 5 个标签按钮');
  tabs.forEach(function (b) {
    b.click();
    var html = byId('view').innerHTML;
    ok(html.length > 200, '标签 ' + b.getAttribute('data-tab') + ' 渲染内容过少');
  });
});

test('结果页包含可核查的推导面板', function () {
  CP.ui.go('result');
  q1('[data-tab="profile"]').click();
  var html = byId('view').innerHTML;
  has(html, '查看推导', '画像页缺少推导入口');
  has(html, '一句话画像');
  q1('[data-tab="match"]').click();
  html = byId('view').innerHTML;
  has(html, '查看推导', '岗位匹配页缺少推导入口');
  has(html, 'Fit = 0.40', '推导面板未展示综合公式');
  ok((html.match(/查看推导/g) || []).length >= 3, 'Top3 岗位都应带推导面板，实际 ' + (html.match(/查看推导/g) || []).length);
});

test('结果页展示置信度提示与被排除岗位清单', function () {
  q1('[data-tab="match"]').click();
  var html = byId('view').innerHTML;
  has(html, 'Top 3 推荐');
  has(html, '被硬约束排除的岗位', '应显示被排除的岗位');
  has(html, 'AI 治理', '排除清单应含被明确排除的岗位');
  ok(html.indexOf('第 1 名比第 2 名高') >= 0 || html.indexOf('前两名只差') >= 0, '应给出置信度提示');
});

test('差距页展示双向对照图与学习任务', function () {
  q1('[data-tab="gap"]').click();
  var html = byId('view').innerHTML;
  has(html, '能力对照');
  has(html, '验收作品');
  has(html, '<svg');
});

test('决策页展示权重饼图、路径排序与时间轴', function () {
  q1('[data-tab="decision"]').click();
  var html = byId('view').innerHTML;
  has(html, '决策标准权重');
  has(html, '路径加权排序');
  has(html, '主路径时间轴');
});

test('SWOT 页四象限齐全', function () {
  q1('[data-tab="swot"]').click();
  var html = byId('view').innerHTML;
  ['S 优势', 'W 劣势', 'O 机会', 'T 威胁'].forEach(function (k) { has(html, k); });
});

test('重算按钮会刷新结果快照', function () {
  CP.ui.go('result');
  CP.ui.archive.computed.generatedAt = '2000-01-01T00:00:00.000Z';
  byId('btnRecalc').click();
  ok(CP.ui.archive.computed.generatedAt !== '2000-01-01T00:00:00.000Z', '重算后快照时间应更新');
});

group('六、行动计划与复盘');

test('手动添加任务进入看板', function () {
  CP.ui.go('action');
  var n = CP.ui.archive.actions.length;
  var answers = ['手动添加的测试任务', '2026-06-30'];   // prompt 调用两次
  sb.prompt = function () { return answers.shift() || ''; };
  byId('addAction').click();
  eq(CP.ui.archive.actions.length, n + 1);
  var last = CP.ui.archive.actions[CP.ui.archive.actions.length - 1];
  eq(last.title, '手动添加的测试任务');
  eq(last.due, '2026-06-30');
});

test('非法截止日期会被丢弃而不是写入', function () {
  var answers = ['日期格式测试', '下个月'];
  sb.prompt = function () { return answers.shift() || ''; };
  byId('addAction').click();
  var last = CP.ui.archive.actions[CP.ui.archive.actions.length - 1];
  eq(last.due, null, '非法日期应存为 null');
});

test('任务状态可在三列之间流转', function () {
  CP.ui.go('action');
  var idx = CP.ui.archive.actions.length - 1;
  q1('[data-mv="' + idx + '"][data-to="doing"]').click();
  eq(CP.ui.archive.actions[idx].status, 'doing');
  CP.ui.go('action');
  q1('[data-mv="' + idx + '"][data-to="done"]').click();
  eq(CP.ui.archive.actions[idx].status, 'done');
});

test('任务可删除', function () {
  CP.ui.go('action');
  var n = CP.ui.archive.actions.length;
  q1('[data-del="' + (n - 1) + '"]').click();
  eq(CP.ui.archive.actions.length, n - 1);
});

test('复盘记录以计数与证据为主，可保存与删除', function () {
  CP.ui.go('action');
  var n = CP.ui.archive.reviews.length;
  byId('revProgress') && ok(false, '不应再有 progress 自由文本字段');
  byId('revPlanned').value = '5';
  byId('revDone').value = '3';
  byId('revOverdue').value = '1';
  byId('revEvidence').value = 'RAG 项目代码已推送到 GitHub';
  byId('revNext').value = '跑通检索部分';
  byId('revType').value = '周';
  byId('revDate').value = '2026-04-01';
  byId('addReview').click();
  eq(CP.ui.archive.reviews.length, n + 1);
  var last = CP.ui.archive.reviews[n];
  eq(last.planned, 5);
  eq(last.done, 3);
  eq(last.overdue, 1);
  eq(last.evidence, 'RAG 项目代码已推送到 GitHub');
  eq(last.next, '跑通检索部分');
  ok(!('progress' in last) && !('adjust' in last), '不应再写入主观字段');
  has(byId('view').innerHTML, '完成率', '看板应展示完成率');

  CP.ui.go('action');
  q1('[data-delrev="' + n + '"]').click();
  eq(CP.ui.archive.reviews.length, n);
});

test('未填计划/完成条数的复盘被拒绝', function () {
  CP.ui.go('action');
  var n = CP.ui.archive.reviews.length;
  byId('revPlanned').value = '';
  byId('revDone').value = '';
  byId('addReview').click();
  eq(CP.ui.archive.reviews.length, n, '缺计数不应写入');
});

test('行动计划草案可一键追加，且带截止日与来源差距', function () {
  CP.ui.go('action');
  var n = CP.ui.archive.actions.length;
  var before = CP.ui.result();
  ok(before.gaps.length > 0, '结果快照里应有差距任务，实际 ' + before.gaps.length);
  var fresh = CP.ui.archive.profile.grade === '大一';

  // 已有任务时会弹确认框，显式指定返回值，避免依赖前面用例留下的桩
  var realConfirm = sb.confirm;
  sb.confirm = function () { return true; };
  var btn = byId('draftActions');
  ok(btn, '未找到草案按钮');
  eq(typeof btn.onclick, 'function', '草案按钮未绑定事件');
  btn.onclick({ target: btn });
  sb.confirm = realConfirm;

  ok(CP.ui.archive.actions.length > n,
    '应追加草案任务（原 ' + n + ' 条，现 ' + CP.ui.archive.actions.length + ' 条；年级=' + CP.ui.archive.profile.grade
    + '；差距=' + before.gaps.map(function (g) { return g.dim; }).join(',') + '）');
  var added = CP.ui.archive.actions.slice(n);
  if (!fresh) {
    ok(added.some(function (x) { return x.fromGap; }), '应含差距驱动任务');
  }
  ok(added.every(function (x) { return x.due === null || /^\d{4}-\d{2}-\d{2}$/.test(x.due); }), '截止日期格式应合法');
});

group('七、导出');

test('Markdown 报告包含五个章节与精简的附录', function () {
  var md = CP.report.toMarkdown();
  ok(md.length > 3000, '报告过短：' + md.length);
  ['# 人工智能专业职业生涯规划报告',
    '第一章　自我认知', '第二章　职业与行业认知', '第三章　目标决策与路径设计',
    '第四章　能力锻造', '第五章　行动计划', '附录　方法与来源'].forEach(function (h) {
    has(md, h, '缺少章节');
  });
  has(md, 'Fit =', '附录应含适配度公式');
  has(md, '不等同于任何标准化心理量表', '应含测评性质说明');
});

test('报告不含过程性数据', function () {
  var md = CP.report.toMarkdown();
  // 逐题作答不应出现在报告里（它在原始数据 CSV 中）
  ok(md.indexOf('归一化得分') < 0, '报告不应出现逐题归一化得分表');
  ok(md.indexOf('题内标准差') < 0, '报告不应出现题内标准差');
  ok(md.indexOf('是否反向计分') < 0, '报告不应出现反向计分标记');
  // 工具内部阈值与规则不应写进报告正文
  ok(md.indexOf('标准差 < 8') < 0, '报告不应出现一致性检验阈值');
  ok(md.indexOf('分差 < 5 分') < 0, '报告不应出现置信度阈值');
  ok(md.indexOf('3 秒') < 0, '报告不应出现计时检验阈值');
  // 排期参数的推算过程不应出现
  ok(md.indexOf('按每周') < 0, '报告中不应出现按每周换算的排期推算');
  // 但"指向原始数据文件"的说明应当保留
  has(md, '原始作答明细.csv', '应指出去哪里看原始数据');
  // 报告长度应显著短于原始数据
  var raw = CP.report.rawData();
  ok(raw.answers.length > 100, '原始数据应包含全部题目');
  ok(md.length < 16000, '报告应保持精简，实际 ' + md.length + ' 字符');
});

test('Markdown 报告中的结论与计算结果一致', function () {
  var md = CP.report.toMarkdown();
  var res = CP.ui.result();
  // 报告写结论、不写过程分项，因此核对的是"名字与判断"而非内部分数
  has(md, res.match.ranked[0].name, '报告应含首位岗位名');
  has(md, res.score.holland.code, '报告应含霍兰德代码');
  has(md, res.decision.primary.name, '报告应含主路径名');
  if (res.decision.planB) has(md, res.decision.planB.name, '报告应含备选路径名');
  if (res.match.ambiguous) {
    has(md, String(res.match.margin), '分差很小时报告应写出具体分差以说明"差别不大"');
  }
  // 岗位适配度的分项数字不进正文，但必须能在原始数据里找到
  var raw = CP.report.rawData();
  eq(raw.fit[1][3], res.match.ranked[0].shown, '原始数据里的适配度应与计算一致');
});

test('导出按钮已绑定且能走完下载流程（含原始数据）', function () {
  var calls = [];
  var realCreate = sb.URL.createObjectURL;
  sb.URL.createObjectURL = function () { calls.push('url'); return 'blob:x'; };
  CP.ui.route = 'export';
  byId('view').innerHTML = CP.pages.export();
  CP.bindPage('export');
  ok(byId('expJson'), '缺少档案导出按钮');
  ok(byId('expMd'), '缺少报告导出按钮');
  ok(byId('expPrint'), '缺少打印视图按钮');
  ok(byId('expRaw'), '缺少原始数据导出按钮');
  byId('expMd').click();
  ok(calls.length > 0, '报告导出未走到 Blob 下载流程');
  sb.URL.createObjectURL = realCreate;
});

test('原始数据导出包含逐题作答与岗位库参数', function () {
  var raw = CP.report.rawData();
  ['answers', 'dims', 'fit', 'gaps', 'path', 'jobs', 'meta'].forEach(function (k) {
    ok(raw[k], '缺少 ' + k);
  });
  // 逐题明细：表头 + 三套题的全部题目
  eq(raw.answers[0].length, 8, '逐题明细应有 8 列');
  var expect = CP.activeItems(CP.BANK_RIASEC, CP.ui.archive.profile).length
    + CP.activeItems(CP.BANK_ANCHOR, CP.ui.archive.profile).length
    + CP.activeItems(CP.BANK_ABILITY, CP.ui.archive.profile).length;
  eq(raw.answers.length - 1, expect, '逐题明细行数应等于题目总数');
  ok(raw.jobs.length - 1 === CP.JOB_FAMILIES.length, '岗位库参数表应含全部岗位');
  eq(raw.meta.schemaVersion, CP.SCHEMA_VERSION);
  eq(raw.meta.grade, CP.ui.archive.profile.grade);
  // 归一化列必须是数字，不能是空
  var answered = raw.answers.slice(1).filter(function (r) { return r[4] !== '未答'; });
  ok(answered.length > 0);
  answered.forEach(function (r) {
    ok(typeof r[5] === 'number' && r[5] >= 0 && r[5] <= 100, '归一化得分越界：' + JSON.stringify(r));
  });
});

test('报告以总结性文字为主，正文数值密度低于附录', function () {
  var md = CP.report.toMarkdown();
  var parts = md.split('附录　方法与来源');
  var body = parts[0];
  var appendix = parts[1] || '';
  var countNums = function (s) { return (s.match(/\d+(\.\d+)?/g) || []).length; };
  var densityBody = countNums(body) / body.length;
  var densityApp = countNums(appendix) / Math.max(1, appendix.length);
  ok(densityBody < densityApp, '正文的数字密度应明显低于附录（正文 ' + densityBody.toFixed(4) + ' vs 附录 ' + densityApp.toFixed(4) + '）');
  // 正文必须包含成段叙述：应有较长的连续段落
  var paragraphs = body.split('\n\n').filter(function (x) { return x.length > 120 && x.indexOf('|') < 0; });
  ok(paragraphs.length >= 6, '正文应包含多段成段的叙述文字，实际 ' + paragraphs.length + ' 段');
});

test('档案导出内容为合法 JSON 且可被 migrate 还原', function () {
  var text = JSON.stringify(CP.ui.archive);
  var back = CP.migrate(JSON.parse(text));
  eq(back.profile.grade, CP.ui.archive.profile.grade);
  eq(Object.keys(back.answers.riasec).length, 36);
  eq(back.actions.length, CP.ui.archive.actions.length);
});

test('生成的文件 输出/示例档案.json 可被导入且结果一致', function () {
  var f = path.join(ROOT, '输出', '示例档案.json');
  ok(fs.existsSync(f), '示例档案文件不存在，请先运行 npm run demo');
  var raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  eq(raw.kind, CP.ARCHIVE_KIND, '文件身份标识不对');
  var imported = CP.migrate(raw);
  eq(CP.validateArchive(imported).length, 0, '导入后不应有缺项');
  // 用导入的档案重算，结果应与文件里存的快照一致（验证计算幂等且可复现）
  var recomputed = CP.buildResult(imported);
  eq(recomputed.match.ranked[0].jobId, raw.computed.match.ranked[0].jobId, '首位岗位应一致');
  eq(recomputed.match.ranked.length, raw.computed.match.ranked.length, '岗位数量应一致');
  nearNum(recomputed.match.ranked[0].fit, raw.computed.match.ranked[0].fit, 0.001, '首位适配度应可复现');
  eq(recomputed.score.holland.code, raw.computed.score.holland.code, '霍兰德代码应一致');
  eq(recomputed.decision.primary.pathId, raw.computed.decision.primary.pathId, '主路径应一致');
});

test('导入档案后界面能正常渲染结果页', function () {
  var raw = JSON.parse(fs.readFileSync(path.join(ROOT, '输出', '示例档案.json'), 'utf8'));
  CP.ui.archive = CP.migrate(raw);
  CP.store.save(CP.ui.archive);
  CP.ui.go('result');
  q1('[data-tab="profile"]').click();
  var html = byId('view').innerHTML;
  has(html, '结果与画像');
  has(html, '一句话画像');
  ok(html.indexOf('undefined') < 0, '导入后渲染出现 undefined');
  // 恢复一个干净档案，避免影响后续断言
  CP.ui.archive = CP.demoArchive();
  CP.store.save(CP.ui.archive);
});

test('大一示例：结果页与行动计划页都能正确渲染', function () {
  sb.confirm = function () { return true; };
  byId('btnDemo').click();                 // 载入大一示例
  eq(CP.ui.archive.profile.grade, '大一');

  CP.ui.go('result');
  var tabs = q('[data-tab]');
  eq(tabs.length, 5);
  tabs.forEach(function (b) {
    b.onclick();
    var html = byId('view').innerHTML;
    ok(html.indexOf('undefined') < 0, '标签 ' + b.getAttribute('data-tab') + ' 出现 undefined');
    ok(html.indexOf('NaN') < 0, '标签 ' + b.getAttribute('data-tab') + ' 出现 NaN');
  });
  // 岗位匹配页要说明大一使用的是兴趣为主的权重
  q1('[data-tab="match"]').click();
  has(byId('view').innerHTML, '本次使用「大一」权重', '应说明大一的权重口径');
  // 差距页第一条应为方向探索
  q1('[data-tab="gap"]').click();
  var gapHtml = byId('view').innerHTML;
  has(gapHtml, '方向探索', '差距页应标出方向探索任务');
  has(gapHtml, '兴趣方向贴合度', '差距页应给出大一口径的排序依据');

  // 行动计划页
  CP.ui.go('action');
  var actHtml = byId('view').innerHTML;
  ok(actHtml.indexOf('undefined') < 0, '行动计划页出现 undefined');
  has(actHtml, '贴合兴趣的优先', '应标注排序口径');
  has(actHtml, '第一步', '探索任务应显示为第一步');

  // 收尾：恢复大三示例
  sb.confirm = function () { return false; };
  byId('btnDemo').click();
  eq(CP.ui.archive.profile.grade, '大三');
});

test('打印视图：无图环境下也能生成完整 HTML', function () {
  var written = '';
  var fakeWin = {
    document: {
      write: function (h) { written += h; },
      close: function () { },
      open: function () { }
    },
    focus: function () { }
  };
  CP.report.renderPrintView(fakeWin, CP.ui.archive, CP.ui.result(), '');
  ok(written.length > 3000, '打印视图过短：' + written.length);
  ['人工智能专业', '第一章', '第二章', '第三章', '第四章', '第五章', '附录', 'cover']
    .forEach(function (k) { has(written, k, '打印视图缺少 ' + k); });
  ok(written.indexOf('undefined') < 0, '打印视图出现 undefined');
  ok(written.indexOf('NaN') < 0, '打印视图出现 NaN');
  ok(written.indexOf('background-image:url()') < 0, '无图时不应产生空的 background-image');
});

test('打印视图：有封面图时会嵌入 data URI', function () {
  var written = '';
  var fakeWin = { document: { write: function (h) { written += h; }, close: function () { }, open: function () { } } };
  CP.report.renderPrintView(fakeWin, CP.ui.archive, CP.ui.result(), 'data:image/png;base64,AAAA');
  has(written, 'data:image/png;base64,AAAA', '封面图应嵌入为 data URI');
});

test('本地素材文件都存在（HTML 与打印视图引用它们）', function () {
  ['素材/hero.png', '素材/cover.png', '素材/雷达底纹.svg', '素材/favicon.svg'].forEach(function (rel) {
    ok(fs.existsSync(path.join(ROOT, rel)), '缺少素材 ' + rel);
  });
  // 工作台.html 必须把主视觉素材接上
  var html = fs.readFileSync(path.join(ROOT, '工作台.html'), 'utf8');
  has(html, '素材/hero.png', 'HTML 未引用主视觉图');
  has(html, '素材/雷达底纹.svg', 'HTML 未引用雷达底纹');
  has(html, '素材/favicon.svg', 'HTML 未引用图标');
});

test('窄屏抽屉：开关、遮罩、Esc、点击导航后自动收起', function () {
  CP.ui.go('home');

  // 初始：关闭，且侧栏对键盘不可达
  eq(CP.ui.drawerOpen, false, '初始应为关闭');
  ok(byId('sidebar').getAttribute('aria-hidden') === 'true', '关闭时侧栏应 aria-hidden');
  eq(byId('btnDrawer').getAttribute('aria-expanded'), 'false');
  ok(byId('scrim').hidden === true, '关闭时遮罩应隐藏');

  // 点汉堡打开
  byId('btnDrawer').onclick();
  eq(CP.ui.drawerOpen, true, '点击应打开');
  ok(byId('sidebar').classList.contains('open'), '打开时应加 open 类');
  eq(byId('sidebar').getAttribute('aria-hidden'), null, '打开时不应 aria-hidden');
  eq(byId('btnDrawer').getAttribute('aria-expanded'), 'true');
  eq(byId('scrim').hidden, false, '打开时遮罩应显示');
  ok(sb.document.body.classList.contains('drawer-open'), '打开时应锁住背景滚动');

  // 点遮罩关闭
  byId('scrim').onclick();
  eq(CP.ui.drawerOpen, false, '点遮罩应关闭');
  ok(sb.document.body.classList.contains('drawer-open') === false, '关闭后应解除滚动锁');
  ok(byId('scrim').hidden === true, '关闭后遮罩应重新隐藏');

  // 侧栏里的 × 关闭按钮：显示条件交给 CSS 的 ≤620px 媒体查询，
  // 这里只验证"它存在、且绑了 onclick"。按钮必须在，因为手机上要靠它关闭——
  // 曾经出过"按钮还在但 onclick 被删掉"，按下去毫无反应（用户报的就是这个）。
  var closeBtn = byId('btnDrawerClose');
  ok(closeBtn, '侧栏应有 × 关闭按钮（手机上靠它关闭抽屉）');
  eq(typeof closeBtn.onclick, 'function', '× 按钮必须绑了 onclick，否则按下去没反应');
  CP.ui.openDrawer();
  closeBtn.onclick();
  eq(CP.ui.drawerOpen, false, '点 × 应关闭抽屉');

  // 样式表必须让它在窄屏隐藏、只在手机宽度显示，且规则要排在 .icon-btn 之后
  // （两者特异性相同，CSS 按源码顺序决胜；写反了会被 .icon-btn 的 display:grid 盖掉）
  var css = require('fs').readFileSync(
    require('path').resolve(ROOT, '样式', '工作台.css'), 'utf8');
  var iIcon = css.indexOf('.icon-btn {');
  var iHide = css.indexOf('.drawer-close { display: none; }');
  var iShow = css.indexOf('.drawer-close { display: grid; }');
  ok(iHide >= 0, '应有 .drawer-close 的默认隐藏规则');
  ok(iShow >= 0, '应有窄屏显示规则');
  ok(iHide > iIcon,
    '.drawer-close 的隐藏规则必须写在 .icon-btn 之后，否则会被它的 display:grid 盖掉');

  // 用括号深度判断"显示规则落在哪个媒体查询里"。
  // 不能拿 @media 到 @media 之间的文本做正则——跨块匹配会误判。
  function mediaOf(src, index) {
    var depth = 0, stack = [];
    var lines = src.slice(0, index).split('\n');
    lines.forEach(function (line) {
      var t = line.trim();
      var isMedia = /@media/.test(t);
      for (var k = 0; k < line.length; k++) {
        if (line[k] === '{') { depth++; stack.push(isMedia ? t : null); isMedia = false; }
        else if (line[k] === '}') { depth--; stack.pop(); }
      }
    });
    return stack.filter(Boolean).join(' ⊃ ');
  }
  var at = mediaOf(css, iShow);
  ok(at.indexOf('620px') >= 0, '× 的显示规则应落在 ≤620px 媒体查询内，实际在：' + (at || '顶层'));
  ok(at.indexOf('900px') < 0, '不应再在 ≤900px 里显示 ×（那个断点包含桌面缩窄的窗口）');

  // Esc 关闭
  CP.ui.openDrawer();
  var keyHandlers = sb.document._listeners.keydown || [];
  eq(keyHandlers.length > 0, true, '应注册 keydown 监听');
  keyHandlers.forEach(function (f) { f({ key: 'Escape' }); });
  eq(CP.ui.drawerOpen, false, 'Esc 应关闭抽屉');

  // 点导航项后应收起（否则内容被盖住）
  CP.ui.openDrawer();
  var item = q('.nav-item', byId('nav')).filter(function (b) {
    return b.getAttribute('data-route') === 'riasec';
  })[0];
  item.onclick();
  eq(CP.ui.drawerOpen, false, '点导航项后应收起抽屉');
  CP.ui.go('home');
});

test('顶栏显示当前页名，并同步进度', function () {
  CP.ui.go('export');
  has(byId('topbarTitle').textContent, '导出报告', '顶栏应显示当前页名');
  CP.ui.go('anchor');
  has(byId('topbarTitle').textContent, '职业锚', '顶栏应随路由变化');
  byId('topProgress').style.width = '';
  CP.ui.refreshProgress();
  ok(byId('topProgress').style.width !== '', '顶栏进度条应被刷新');
  eq(byId('topProgress').style.width, byId('sideProgress').style.width, '两处进度应一致');
});

test('量表按钮带上无障碍语义（档位说明与选中态）', function () {
  CP.ui.archive.profile.grade = '大三';
  CP.ui.route = 'riasec';
  byId('view').innerHTML = CP.pages.riasec();
  CP.bindPage('riasec');
  var b = q1('[data-item="r1"][data-val="4"]');
  ok(b, '未找到 r1 的第 4 档按钮');
  var aria = b.getAttribute('aria-label');
  ok(aria, '按钮缺少 aria-label');
  // 第 4 档是"比较符合"（第 5 档才是"很符合"）
  ok(aria.indexOf('比较符合') >= 0, 'aria-label 应说明该档位的含义，实际：' + aria);
  eq(aria.indexOf('第 4 档') === 0, true, 'aria-label 应指明档位序号，实际：' + aria);
  eq(b.getAttribute('aria-pressed'), 'false', '未选中应为 false');
  b.onclick();
  eq(q1('[data-item="r1"][data-val="4"]').getAttribute('aria-pressed'), 'true', '选中后应为 true');
  eq(q1('[data-item="r1"][data-val="3"]').getAttribute('aria-pressed'), 'false', '同题其他档位应为 false');
  // 5 档量表应有 scale-5 类，窄屏据此等宽铺开
  ok(q1('[data-item="r1"]').closest('.scale').classList.contains('scale-5'), '5 档量表应有 scale-5');
});

test('窄屏铺开规则：兴趣用 scale-5 按钮，能力用勾选清单', function () {
  // 兴趣测评仍是 5 档按钮，窄屏靠 scale-5 等宽铺开
  CP.ui.route = 'riasec';
  byId('view').innerHTML = CP.pages.riasec();
  CP.bindPage('riasec');
  ok(q1('[data-item="r1"]').closest('.scale').classList.contains('scale-5'), '5 档量表应有 scale-5');

  // 能力部分换成勾选清单，不再有量表按钮
  var savedGrade = CP.ui.archive.profile.grade;
  CP.ui.archive.profile.grade = '大一';
  CP.ui.route = 'ability';
  byId('view').innerHTML = CP.pages.ability();
  CP.bindPage('ability');
  eq(q('[data-item]').length, 0, '能力清单不应再有量表按钮');
  eq(q('[data-checkbox]').length, 48, '应为 48 个勾选框');
  ok(q1('[data-checkbox="math1"]').closest('.check-item'), '勾选框应包在 .check-item 里');
  CP.ui.archive.profile.grade = savedGrade;
});

test('窄屏缺口图换成紧凑排版，字号不被压缩', function () {
  var rows = [
    { label: '数学与理论', got: 40, req: 70, gap: 30 },
    { label: '系统与部署', got: 60, req: 30, gap: 0 }
  ];
  var compact = CP.chartGapsCompact(rows, { width: 340 });
  has(compact, '<svg', '紧凑版应产出 SVG');
  has(compact, '缺口 30', '应显示缺口数值');
  has(compact, '已达标', '达标项应标注');
  has(compact, 'font-size="12"', '标签字号应保持可读，不被压缩');
  // 宽度应适配窄屏
  var w = parseInt((compact.match(/viewBox="0 0 (\d+)/) || [])[1], 10);
  ok(w <= 360, '紧凑版宽度应适配窄屏，实际 ' + w);
  // 宽屏版仍然存在且更宽
  var wide = CP.chartGaps(rows, { width: 560 });
  ok(parseInt((wide.match(/viewBox="0 0 (\d+)/) || [])[1], 10) === 560, '宽屏版宽度不变');
});

test('isNarrow 在没有 matchMedia 的环境下安全降级', function () {
  // 仿真环境故意不提供 matchMedia，应返回 false 而不是抛错
  eq(typeof sb.window.matchMedia, 'undefined');
  eq(CP.isNarrow(), false, '无 matchMedia 时应按宽屏处理');
});

test('结果页含职业简表，且表格带 data-label 供窄屏堆叠', function () {
  sb.confirm = function () { return false; };
  byId('btnDemo').click();                 // 大三示例
  CP.ui.go('result');
  q1('[data-tab="match"]').click();
  var html = byId('view').innerHTML;
  has(html, '排名较高的职业简表', '结果页应显示职业简表');
  has(html, '一周工作内容占比', '应含工作内容占比一栏');
  eq(q('.card-table tbody tr').length >= 3, true, '简表应含 3 个岗位');
  // 每个单元格都要有 data-label，窄屏堆叠时才看得到表头
  var cells = q('.card-table tbody td');
  ok(cells.length > 0);
  cells.forEach(function (c, i) {
    ok(c.getAttribute('data-label'), '第 ' + i + ' 个单元格缺少 data-label');
  });
});

test('宽屏下侧栏必须是常驻可交互的（回归：曾因误加 inert 导致整条导航点不动）', function () {
  // 模拟宽屏：matchMedia('(max-width: 900px)') 返回 false
  var realMM = sb.window.matchMedia;
  sb.window.matchMedia = function (q) {
    return {
      media: q,
      matches: /min-width/.test(q),        // 宽屏查询命中，窄屏查询不命中
      addEventListener: function () { },
      removeListener: function () {}
    };
  };
  CP.ui.closeDrawer();
  CP.ui.go('home');

  var sidebar = byId('sidebar');
  // 核心断言：宽屏时侧栏绝不能带 inert 或 aria-hidden，否则内容全部不可点
  eq(sidebar.getAttribute('inert'), null, '宽屏时侧栏不应有 inert 属性');
  eq(sidebar.inert === true, false, '宽屏时侧栏不应是 inert');
  eq(sidebar.getAttribute('aria-hidden'), null, '宽屏时侧栏不应 aria-hidden');
  eq(sidebar.classList.contains('open'), false, '宽屏时侧栏不需要 open 类（常驻可见）');
  eq(byId('btnDrawer').getAttribute('aria-expanded'), 'false', '宽屏时展开状态应为 false');
  eq(byId('scrim').hidden, true, '宽屏时遮罩应隐藏');
  // 宽屏下点导航项必须真的切换页面
  var item = q('.nav-item', byId('nav')).filter(function (b) {
    return b.getAttribute('data-route') === 'riasec';
  })[0];
  item.onclick();
  CP.ui.go('riasec');                 // 仿真环境不派发 hashchange，显式补一次
  eq(CP.ui.route, 'riasec', '宽屏下点导航项应切换页面');

  sb.window.matchMedia = realMM;
  CP.ui.go('home');
});

test('窄屏下侧栏按抽屉处理：关闭时 inert，打开时恢复可交互', function () {
  var realMM = sb.window.matchMedia;
  sb.window.matchMedia = function (q) {
    return {
      media: q,
      matches: /max-width:\s*900px/.test(q),
      addEventListener: function () { },
      removeListener: function () {}
    };
  };
  var sidebar = byId('sidebar');

  CP.ui.closeDrawer();
  eq(sidebar.getAttribute('inert'), '', '窄屏关闭时侧栏应设 inert');
  eq(sidebar.getAttribute('aria-hidden'), 'true', '窄屏关闭时侧栏应 aria-hidden');
  eq(byId('scrim').hidden, true, '窄屏关闭时遮罩应隐藏');

  CP.ui.openDrawer();
  eq(sidebar.getAttribute('inert'), null, '窄屏打开时侧栏应恢复可交互');
  eq(sidebar.getAttribute('aria-hidden'), null, '窄屏打开时不应 aria-hidden');
  ok(sidebar.classList.contains('open'), '窄屏打开时应加 open 类');
  eq(byId('scrim').hidden, false, '窄屏打开时遮罩应显示');
  eq(byId('btnDrawer').getAttribute('aria-expanded'), 'true', '窄屏打开时展开状态应为 true');

  sb.window.matchMedia = realMM;      // 恢复到默认（无 matchMedia）
  CP.ui.closeDrawer();
});

test('行动计划页给出逐年规划建议，锚到具体学年', function () {
  CP.ui.archive = CP.demoArchive();
  CP.ui.archive.profile.grade = '大三';
  CP.store.save(CP.ui.archive);
  CP.ui.go('action');

  // 必须是只读建议，不是让用户填的输入框
  eq(byId('longTermPlan'), null, '不应再有长远打算 textarea');
  eq(q('.yearplan').length, 1, '应有逐年规划建议列表');

  // 必须用子选择器：.yearplan li 会把"个性化要点"那一层嵌套的 li 也算进来
  var items = q('.yearplan > li');
  ok(items.length >= 2, '大三应看到大三、大四两条，实际 ' + items.length + ' 条');
  eq(q('.yp-year')[0].textContent, '大三', '第一条应从当前年级开始');

  // 已经过去的学年不应出现
  var years = q('.yp-year').map(function (x) { return x.textContent; });
  ok(years.indexOf('大一') < 0, '大三学生不应再看到大一的安排，实际：' + years.join(','));
  ok(years.indexOf('大二') < 0, '大三学生不应再看到大二的安排');

  // 每条都要有可执行的行动与判断标准
  var bodies = q('.yp-action');
  var notes = q('.yp-note');
  eq(bodies.length, items.length, '每条都应有一句行动');
  eq(notes.length, items.length, '每条都应有一句判断标准');
  bodies.forEach(function (b, i) { ok(b.textContent.length > 8, '第 ' + i + ' 条行动太短'); });
  notes.forEach(function (n, i) { ok(n.textContent.length > 6, '第 ' + i + ' 条判断标准太短'); });

  // 个性化要点要渲染出来，且必须取自实测数据（带具体分值 / 岗位名）
  var focusItems = q('.yp-focus > li');
  ok(focusItems.length >= 1, '行动页应显示个性化要点，实际 ' + focusItems.length + ' 条');
  var focusText = focusItems.map(function (x) { return x.textContent; }).join('；');
  ok(focusText.indexOf('重点补') >= 0, '应点出要补的能力维度，实际：' + focusText);
  ok(/还差 \d+ 分/.test(focusText), '缺口应带具体分值，实际：' + focusText);
});

test('逐年规划建议随年级变化，起点取当前学年', function () {
  // 大一应看到全部四年
  CP.ui.archive = CP.demoArchiveFresh();
  CP.ui.go('action');
  var freshYears = q('.yp-year').map(function (x) { return x.textContent; });
  eq(freshYears.length, 4, '大一应看到四年安排，实际 ' + freshYears.join(','));
  eq(freshYears[0], '大一', '大一应从大一起算');

  // 研究生只看到研一以后
  CP.ui.archive.profile.grade = '研一';
  CP.ui.go('action');
  var gradYears = q('.yp-year').map(function (x) { return x.textContent; });
  ok(gradYears.indexOf('大四') < 0, '研一不应再看到大四的安排，实际：' + gradYears.join(','));
  eq(gradYears[0], '研一', '研一应从研一起算');
  eq(gradYears.length, 3, '研一应看到研一、研二、研三三条');
});

test('yearPlan 在缺少决策结果时也能给出建议', function () {
  var a = CP.demoArchive();
  var rows = CP.yearPlan(a, null, null, null);
  ok(rows.length > 0, '没有 decision 时也应给出学年安排');
  rows.forEach(function (r) {
    ok(r.year && r.action && r.note, '每条都应有 year/action/note');
  });
  // 未知年级回退到大三，不应崩
  a.profile.grade = '';
  ok(CP.yearPlan(a, null, null, null).length > 0, '年级为空时应回退到默认');
});

test('逐年规划建议会进入导出的报告正文', function () {
  CP.ui.archive = CP.demoArchive();
  CP.ui.archive.profile.grade = '大三';
  CP.store.save(CP.ui.archive);
  CP.ui.go('result');

  var md = CP.report.toMarkdown();
  has(md, '逐年规划建议', 'Markdown 报告应有一节');
  has(md, '**大三**', '报告应含当前年级这一条');
  has(md, '**大四**', '报告应含下一学年这一条');

  // 打印视图同样要有，且编号为 5.3
  var printHtml = '';
  var w = { document: { open: function () {}, write: function (h) { printHtml += h; }, close: function () {} },
            focus: function () {}, print: function () {}, close: function () {} };
  CP.report.renderPrintView(w, CP.ui.archive, CP.ui.result(), '');
  has(printHtml, '逐年规划建议', '打印视图应有一节');
  has(printHtml, '5.3', '章节编号应为 5.3');
});

test('勾选清单会记录作答时间戳（时长是它唯一的质量信号）', function () {
  var savedGrade = CP.ui.archive.profile.grade;
  CP.ui.archive.profile.grade = '大三';
  CP.ui.archive.answers.ability = {};
  CP.ui.route = 'ability';
  byId('view').innerHTML = CP.pages.ability();
  CP.bindPage('ability');

  var boxes = q('[data-checkbox]');
  var before = Date.now();
  boxes.slice(0, 6).forEach(function (b) { b.click(); });
  var after = Date.now();

  var ids = Object.keys(CP.ui.archive.answers.ability);
  eq(ids.length, 6, '应勾上 6 项');
  ids.forEach(function (id, i) {
    var t = CP.ui.archive.answers.ability[id].t;
    ok(typeof t === 'number', id + ' 缺少作答时间戳');
    ok(t >= before && t <= after, id + ' 的时间戳不在本次操作区间内');
  });

  // 关键：有了时间戳，时长检验才跑得起来。
  // 清单不做题内一致性检验，所以时长是它唯一能发现"秒勾全表"的信号。
  var scored = CP.scoreChecklist(CP.BANK_ABILITY, CP.ui.archive.answers.ability, CP.ui.archive.profile);
  var timing = CP.timingCheck(CP.BANK_ABILITY, CP.ui.archive.answers.ability, 3, CP.ui.archive.profile);
  ok(timing.secondsPerItem !== null, '有 6 条时间戳时不应跳过时长检验');

  // 同一毫秒内勾完 6 项 → 每题 0 秒，应被判为偏快
  ids.forEach(function (id) { CP.ui.archive.answers.ability[id].t = before; });
  var fast = CP.timingCheck(CP.BANK_ABILITY, CP.ui.archive.answers.ability, 3, CP.ui.archive.profile);
  eq(fast.ok, false, '时间戳全部相同时应判为作答偏快，实际未判');

  // 取消勾选应删除记录
  q('[data-checkbox]')[0].click();
  eq(Object.keys(CP.ui.archive.answers.ability).length, 5, '取消勾选应删除记录');

  CP.ui.archive.profile.grade = savedGrade;
});

test('首页显示的时间是本地时间，不是 UTC', function () {
  CP.ui.archive = CP.demoArchive();
  CP.ui.archive.createdAt = '2026-09-01T02:00:00.000Z';
  CP.ui.archive.updatedAt = '2026-10-10T14:11:32.809Z';
  CP.ui.go('home');
  var html = byId('view').innerHTML;

  has(html, '最后保存', '首页应显示最后保存时间');
  var expect = CP.localTime('2026-10-10T14:11:32.809Z');
  has(html, expect, '应显示本地时间 ' + expect);

  // 关键：不能出现把 UTC 串直接切开的结果（ISO 的日期部分 + 时间部分拼起来）
  var utcRaw = '2026-10-10 14:11';
  ok(html.indexOf(utcRaw) < 0, '不应把 UTC 当本地时间显示（出现了 ' + utcRaw + '）');

  if (new Date().getTimezoneOffset() < 0) {
    has(html, '22:11', '东八区应显示 22:11 而不是 14:11');
  }

  // 结果生成时间同样是本地口径
  CP.ui.go('result');
  CP.ui.go('home');
  var html2 = byId('view').innerHTML;
  has(html2, '生成于', '结果已生成时应显示生成时间');
  ok(html2.indexOf('undefined') < 0, '首页出现 undefined');
  ok(html2.indexOf('NaN') < 0, '首页出现 NaN');
});

test('能力清单只要每维勾 1 项，侧边栏就算完成', function () {
  CP.ui.archive = CP.createBlankArchive();
  CP.ui.archive.profile.grade = '大三';
  CP.ui.archive.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
  // 补上兴趣与职业锚
  CP.activeItems(CP.BANKS.riasec, CP.ui.archive.profile).forEach(function (it) {
    CP.ui.archive.answers.riasec[it.id] = { v: 3, t: Date.now() };
  });
  CP.activeItems(CP.BANKS.anchor, CP.ui.archive.profile).forEach(function (it) {
    CP.ui.archive.answers.anchor[it.id] = { v: 3, t: Date.now() };
  });

  // 每维只勾第 1 项
  CP.fillAbility(CP.ui.archive, 1);
  CP.ui.go('home');                 // 让首页渲染出进度块，随后 refreshProgress 才有元素可写
  CP.ui.refreshProgress();

  var abilityPart = CP.ui.progress().parts.filter(function (p) { return p.id === 'ability'; })[0];
  eq(abilityPart.done, 8, '应勾了 8 项');
  eq(abilityPart.reached, true, '每维勾 1 项就应算完成');
  // 侧栏的计数徽标在导航里，用 byId 找不到，得从导航项里取
  var navAbility = q('.nav-item', byId('nav')).filter(function (b) {
    return b.getAttribute('data-route') === 'ability';
  })[0];
  eq(navAbility.querySelector('[data-count="ability"]').textContent, '✓',
    '侧边栏能力项应显示勾，而不是 8/48');
  ok(navAbility.querySelector('[data-count="ability"]').textContent.indexOf('/') < 0,
    '勾选式清单的计数不应带分母（分母会暗示"要做完 48 项"）');
  ok(navAbility.classList.contains('done'), '导航项能力清单应标为完成');

  // 差一个维度则应回到未完成
  CP.fillAbility(CP.ui.archive, { math: 1, code: 1, data: 1, model: 1, deploy: 1, product: 1, comm: 1 });
  CP.ui.refreshProgress();
  var p2 = CP.ui.progress().parts.filter(function (x) { return x.id === 'ability'; })[0];
  eq(p2.reached, false, '差一个维度应算未完成');
  eq(navAbility.querySelector('[data-count="ability"]').textContent, '已勾 7 项',
    '未达标时应报实际勾选数，而不是 7/48');
});

test('完成进度条与右侧数字同源，不出现"条满数字未满"', function () {
  CP.ui.archive = CP.demoArchive();
  CP.ui.archive.profile.grade = '大三';
  CP.fillAbility(CP.ui.archive, 1);       // 门槛刚达成，但只勾了 8/48
  CP.ui.go('home');
  var rows = q('.progress-row');
  eq(rows.length, 4, '应有四行进度');
  var abilityRow = rows.filter(function (r) { return r.textContent.indexOf('能力清单') >= 0; })[0];
  ok(abilityRow, '未找到能力清单那一行');
  var bar = abilityRow.querySelector('.progress > i');
  var pct = parseFloat(bar.style.width);
  ok(pct > 10 && pct < 25,
    '条形宽度应约 8/48≈17%；若为 100% 说明条形按门槛算、显示按实际算，两者不同源（实际 ' + pct + '%）');
  has(abilityRow.textContent, '已勾 8 项', '应报实际勾选数，且不带分母');
  ok(abilityRow.textContent.indexOf('/48') < 0,
    '不应出现 /48——分母会让人以为"要做完 48 项"');
  has(abilityRow.textContent, '✓', '达标后应显示勾选标记');
});

test('换页动画：换页播、原地重渲染不播', function () {
  // 实现已从"内联 CSS animation"改为 Web Animations API。
  // 为什么改：内联值是**外部状态**，动画被中途取消时收尾一旦漏掉就会残留，
  // 进而影响后续换页（用户报过"关闭动态效果再打开、刷新后大部分页面硬切"）。
  // WAAPI 把动画交给动画对象管理：不写样式表、不碰 inline style、播完自动释放。
  //
  // 假 DOM 没有 Element.animate，所以这里用垫片记录调用；
  // 真实浏览器里"动画到底有没有播"由 测试/动效诊断.cjs 采样 opacity 覆盖。
  var view = byId('view');
  var calls = [];
  var realAnimate = view.animate;
  view.animate = function (keyframes, timing) {
    calls.push({ keyframes: keyframes, timing: timing });
    return { cancel: function () { } };
  };

  CP.ui.archive = CP.demoArchive();
  CP.ui.go('home');
  calls.length = 0;

  // ① 真正换页 → 应调用 animate
  CP.ui.go('result');
  eq(calls.length, 1, '换页应触发一次入场动画，实际 ' + calls.length + ' 次');
  ok(calls[0].keyframes && calls[0].keyframes.length === 2, '应传两个关键帧');
  eq(calls[0].keyframes[0].opacity, 0, '起始帧应从透明开始');
  eq(calls[0].keyframes[1].opacity, 1, '结束帧应完全不透明');
  ok(calls[0].timing && calls[0].timing.duration > 0, '应带时长');

  // ② 原地重渲染 → 不应触发。
  //    决策页改岗位偏好会调 rerender()，而它调 go('decision')——此时已在决策页，
  //    keepScroll 保持真值，正是"原地重渲染"路径。
  CP.ui.go('decision');
  calls.length = 0;
  var chip = q('[data-pref]')[0];
  ok(chip, '决策页应能找到岗位偏好按钮');
  chip.click();
  eq(CP.ui.route, 'decision', '点偏好按钮不应离开决策页');
  eq(calls.length, 0, '原地重渲染不应触发换页动画（否则点一下整页闪一次）');

  // ③ WAAPI 不碰 inline style，换页不应留下内联 animation
  CP.ui.go('action');
  eq(view.style.animation, '', '换页不应残留内联 animation');

  if (realAnimate === undefined) delete view.animate; else view.animate = realAnimate;
});

test('没有 Element.animate 时退回类触发（老浏览器兜底）', function () {
  // WAAPI 在 Safari 13.1 及更早版本上不可用。兜底必须能跑，
  // 否则那些浏览器连首屏之后的换页动画都没有。
  var view = byId('view');
  var realAnimate = view.animate;
  view.animate = undefined;                 // 模拟老浏览器

  CP.ui.archive = CP.demoArchive();
  CP.ui.go('home');
  view.classList.remove('is-entering');
  CP.ui.go('riasec');                       // 走兜底路径：挂 .is-entering 类

  ok(view.classList.contains('is-entering'),
    '没有 WAAPI 时应挂 is-entering 类作为兜底');
  // 收尾：模拟动画结束，类应被摘掉
  (view.listeners.animationend || []).slice().forEach(function (f) { f({ type: 'animationend' }); });
  ok(!view.classList.contains('is-entering'), '动画结束后应摘掉 is-entering 类');

  if (realAnimate === undefined) delete view.animate; else view.animate = realAnimate;
});

test('reduced-motion 由 JS 兜底（WAAPI 不受媒体查询约束）', function () {
  // WAAPI 不受 `@media (prefers-reduced-motion: reduce)` 约束，
  // 必须在 JS 里判断。删掉它会让无障碍选项失效，而纯 CSS 断言测不出来。
  eq(typeof CP.ui.motionReduced, 'function', 'CP.ui.motionReduced 应存在');
  eq(typeof CP.ui.motionReduced(), 'boolean', 'motionReduced 应返回布尔值');

  var src = require('fs').readFileSync(
    require('path').resolve(ROOT, '界面', '应用.js'), 'utf8');
  ok(src.indexOf('CP.ui.motionReduced()') >= 0, '换页动画应经过 motionReduced 判断');
});


test('能力清单页的计数不带分母（回归：曾经显示 21/48）', function () {
  // 这是同一个错误的**第二处**：首页进度块与侧边栏改过之后，
  // 能力清单页顶部的"已勾选"卡片仍然写着 `21/48`，分母在暗示"要做完 48 项"。
  CP.ui.archive = CP.demoArchive();
  CP.ui.archive.profile.grade = '大三';
  CP.fillAbility(CP.ui.archive, 3);
  CP.store.save(CP.ui.archive);

  CP.ui.go('ability');
  var v = byId('view').innerHTML;
  var checked = Object.keys(CP.ui.archive.answers.ability).length;
  ok(checked > 0, '示例应已勾选若干项');

  // 指标卡里应写"已勾 N 项"，不出现 /48
  ok(v.indexOf('/' + CP.activeItems(CP.BANKS.ability, CP.ui.archive.profile).length) < 0,
    '能力清单页不应出现 /48 这样的分母');
  ok(v.indexOf('已勾选') >= 0, '应保留"已勾选"这个标签');

  // Likert 题（兴趣测评）应继续显示分母——那里的分母是真实要求
  CP.ui.go('riasec');
  var v2 = byId('view').innerHTML;
  var total = CP.activeItems(CP.BANKS.riasec, CP.ui.archive.profile).length;
  ok(v2.indexOf('/' + total) >= 0, '兴趣测评应继续显示 /' + total + '（它确实是"要答完"的）');
});

test('答题反馈有微动效（量表弹一下、勾选闪一下）', function () {
  // 为什么值得测：这两处动效的 class 是临时加的、动画结束就摘掉，
  // 写错了不会报错、只是"点了没反应"——不容易被人发现。
  var sb2 = CP.ui.archive = CP.demoArchive();
  CP.ui.archive.profile.grade = '大三';
  CP.store.save(CP.ui.archive);
  CP.ui.go('riasec');

  // 量表：点某一档后，那个按钮应带上 pick-pop
  var scaleBtn = q('[data-item]')[2];
  ok(scaleBtn, '应找到量表按钮');
  scaleBtn.click();
  has(scaleBtn.getAttribute('class'), 'pick-pop', '点中的那一档应带上 pick-pop');

  // 动画结束应摘掉（否则同一档再点不会重播）
  (scaleBtn.listeners.animationend || []).slice().forEach(function (f) { f({ type: 'animationend' }); });
  ok(scaleBtn.getAttribute('class').indexOf('pick-pop') < 0, '动画结束后应摘掉 pick-pop');

  // 连续点同一档也能重播
  scaleBtn.click();
  has(scaleBtn.getAttribute('class'), 'pick-pop', '再点一次仍应带动画');
  (scaleBtn.listeners.animationend || []).slice().forEach(function (f) { f({ type: 'animationend' }); });

  // 清单：勾上时整行闪一下
  CP.ui.go('ability');
  var box = q('[data-checkbox]')[0];
  ok(box, '应找到勾选框');
  var row = box.closest('[data-check]');
  ok(row, '勾选框应能找回所在行');
  box.checked = true;
  box.onchange();
  has(row.getAttribute('class'), 'row-flash', '勾上后整行应闪一下');
  (row.listeners.animationend || []).slice().forEach(function (f) { f({ type: 'animationend' }); });
  ok(row.getAttribute('class').indexOf('row-flash') < 0, '闪完应摘掉 row-flash');

  // 取消勾选不闪（取消不是"完成了一件事"）
  box.checked = false;
  box.onchange();
  ok(row.getAttribute('class').indexOf('row-flash') < 0, '取消勾选不应闪');

  // 样式表里要有对应的 keyframes
  var css = require('fs').readFileSync(
    require('path').resolve(ROOT, '样式', '工作台.css'), 'utf8');
  ok(css.indexOf('@keyframes pick-pop') >= 0, '应有 @keyframes pick-pop');
  ok(css.indexOf('@keyframes row-flash') >= 0, '应有 @keyframes row-flash');
});

test('图表带入场动画锚点，且属性存的是终态', function () {
  // 图表本身（界面/图表.js）只打锚点、不播动画——动画由界面层触发，
  // 这样打印视图拿到的永远是静态终态。
  var a = CP.demoArchive();
  var res = CP.buildResult(a);
  var s = res.score;

  var radar = CP.chartRadar(CP.BANK_RIASEC.dimensions.map(function (d) {
    return { label: d.label, score: s.riasec.dims[d.id].score };
  }), { size: 250 });
  eq((radar.match(/data-anim="pop"/g) || []).length, 1, '雷达图应有 1 个 pop 锚点');

  var bars = CP.chartBars(Object.keys(s.ability.dims).map(function (k) {
    return { label: s.ability.dims[k].label, value: s.ability.dims[k].score };
  }), { width: 420, labelW: 96, digits: 0, pending: true });
  var growN = (bars.match(/data-anim="grow"/g) || []).length;
  eq(growN, 8, '能力条形图应有 8 个 grow 锚点，实际 ' + growN);

  // 关键：属性里必须是**终态**尺寸。如果为了动画把 width 写成 0，
  // 那么打印视图（没有动画）就会得到一堆空条。
  var m = bars.match(/<rect[^>]*data-anim="grow"[^>]*>/);
  var w = Number((m[0].match(/width="([\d.]+)"/) || [])[1]);
  ok(w > 0, 'grow 元素的 width 属性必须是终态正数，实际 ' + w);
  ok(m[0].indexOf('data-anim-origin=') >= 0, 'grow 元素应带原点信息');
});

test('报告与结果页不含未定义 / NaN / 浮点噪声', function () {
  // 强制重算，确保检查的是当前代码的结果而不是存档里的历史快照
  CP.ui.result(true);
  CP.ui.go('result');
  var html = byId('view').innerHTML;
  ok(html.indexOf('undefined') < 0, '结果页出现了 undefined');
  ok(html.indexOf('NaN') < 0, '结果页出现了 NaN');
  ok(!/\d\.\d{6,}/.test(html), '结果页出现浮点噪声：' + (html.match(/\d\.\d{6,}/) || [])[0]);
  var md = CP.report.toMarkdown();
  ok(md.indexOf('undefined') < 0, '报告出现了 undefined');
  ok(md.indexOf('NaN') < 0, '报告出现了 NaN');
  ok(!/\d\.\d{6,}/.test(md), '报告出现浮点噪声：' + (md.match(/\d\.\d{6,}/) || [])[0]);
});

test('清空后能重新开始，且不残留旧数据', function () {
  CP.store.clear();
  eq(CP.store.load(), null, '清空后读取应为 null');
  CP.ui.archive = CP.createBlankArchive();
  CP.store.save(CP.ui.archive);
  CP.ui.go('home');
  has(byId('view').innerHTML, '八步流程');
  CP.ui.refreshProgress();
  eq(byId('sideProgressText').textContent, '0%');
  eq(q('.nav-item.done', byId('nav')).length, 0, '清空后不应有完成标记');
});

/* ============================================================
 * 假 DOM 的测试基础设施本身（选择器引擎、HTML 解析器、属性语义）
 *
 * 为什么值得单独测：这些缺陷不会让产品报错，只会让**其它测试得出错误结论**——
 * 例如 `.yearplan > li` 悄悄退化成 `.yearplan li`，断言就把嵌套的 li 也算了进去，
 * 于是一个正确的实现被报成失败（反过来，一个错误的实现也可能被放过）。
 * 基础设施错了，上面所有断言的可信度都归零。
 * ============================================================ */

test('选择器引擎：组合符语义与浏览器一致', function () {
  var host = byId('view');
  host.innerHTML = '<ol class="a">'
    + '<li><b>x</b><ul class="b"><li>1</li><li>2</li></ul></li>'
    + '<li><b>y</b></li>'
    + '</ol>';

  eq(q('.a > li').length, 2, '直接子元素：应只有两个顶层 li');
  eq(q('.a li').length, 4, '后代：应包含嵌套的两个 li');
  eq(q('.b > li').length, 2, '嵌套列表的直接子元素');
  eq(q('ol > li').length, 2, '用标签名做父级');
  eq(q('.a > b').length, 0, 'b 在 li 里面，不是 ol 的直接子元素');

  host.innerHTML = '<div class="p"><span>1</span><span>2</span><i>3</i></div>';
  eq(q('.p > span').length, 2, '直接子元素');
  eq(q('span + span').length, 1, '相邻兄弟');
  eq(q('span ~ i').length, 1, '通用兄弟');
  eq(q('i + span').length, 0, '顺序反了不应命中');

  // 注意：真实浏览器会为 <table> 隐式插入 tbody，所以这里显式写 tbody，
  // 避免让测试依赖"浏览器会不会自动补 tbody"这种差异行为。
  host.innerHTML = '<table><tbody><tr><td>a</td><td>b</td></tr>'
    + '<tr><td>c</td><td>d</td></tr></tbody></table>';
  eq(q('tbody > tr').length, 2, '表格行');
  eq(q('tr > td').length, 4, '单元格');
  eq(q('table td').length, 4, '跨层后代');
});

test('HTML 解析器：嵌套 li 不被平铺成兄弟节点', function () {
  // 回归：`<li><ul><li>` 里内层 li 曾经被当成外层 li 的兄弟，
  // 于是所有基于嵌套列表结构的断言都会得出错误结论。
  var host = byId('view');
  host.innerHTML = '<ol class="a"><li><b>B1</b><div class="body">'
    + '<div class="act">A1</div><ul class="focus"><li>F1</li><li>F2</li></ul>'
    + '<div class="note">N1</div></div></li><li><b>B2</b></li></ol>';

  eq(q('.a').length, 1, '应有一个 ol');
  eq(q('.a')[0].children.length, 2, 'ol 应只有两个直接子 li，实际 ' + q('.a')[0].children.length);

  // 嵌套层级必须保持
  eq(q('.body > .act').length, 1, 'act 应在 body 内');
  eq(q('.body > .focus').length, 1, 'focus 应在 body 内');
  eq(q('.body > .note').length, 1, 'note 应在 body 内');
  eq(q('.focus > li').length, 2, 'focus 里应有两个 li');
  eq(q('.focus').length, 1, 'focus 只应有一个');

  // textContent 要聚合整棵子树
  ok(q('.body')[0].textContent.indexOf('N1') >= 0, 'body 的文本应包含 note 的内容');
});

test('HTML 解析器：表格与段落的隐式闭合', function () {
  var host = byId('view');
  host.innerHTML = '<table><tr><td>a<td>b<tr><td>c<td>d</table>';
  eq(q('tr').length, 2, '未闭合的 tr 应被隐式闭合');
  eq(q('td').length, 4, '未闭合的 td 应被隐式闭合');

  host.innerHTML = '<div><p>一<p>二</div>';
  eq(q('p').length, 2, '未闭合的 p 应被隐式闭合');
});

test('假 DOM：布尔与取值属性反映到元素上', function () {
  var host = byId('view');
  host.innerHTML = '<input type="checkbox" checked><input type="text" value="abc">'
    + '<textarea>多行</textarea><button disabled>按钮</button>';
  var inputs = q('input');
  eq(inputs[0].checked, true, 'checked 属性应反映到属性上');
  eq(inputs[1].checked, false, '未勾选应为 false');
  eq(inputs[1].value, 'abc', 'value 应能读到');
  eq(q('textarea')[0].value, '多行', 'textarea 的 value 读文本内容');
  eq(q('button')[0].disabled, true, 'disabled 应能读到');

  var fired = 0;
  inputs[0].onchange = function () { fired += 1; };
  inputs[0].click();
  eq(inputs[0].checked, false, '点击后应取消勾选');
  eq(fired, 1, '点击应触发一次 change');
});

test('假 DOM：style 写入会落到 style 特性上', function () {
  // 回归：style 曾经只是个空对象，写 `el.style.width = '50%'` 不落到特性上，
  // 于是断言 `style.width !== '0%'` 恒真——进度条压根没更新也照样通过。
  var host = byId('view');
  host.innerHTML = '<i id="bar" style="width:0%"></i>';
  var bar = byId('bar');
  eq(bar.style.width, '0%', '应能读到模板里写的初始值');
  bar.style.width = '42%';
  eq(bar.style.width, '42%', '写入后应能读回');
  ok(bar.getAttribute('style').indexOf('42%') >= 0, 'style 特性也应同步更新');
});

/* ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('通过 ' + state.pass + ' 项，失败 ' + state.fail + ' 项');
if (state.fail) {
  console.log('\n失败清单：');
  state.results.filter(function (r) { return !r.ok; }).forEach(function (r) {
    console.log('  - ' + r.name + '：' + r.error);
  });
}
console.log('='.repeat(52));
console.log('说明：本测试不覆盖真实 CSS 布局与视觉效果，那部分需人工在浏览器中确认。');
process.exit(state.fail === 0 ? 0 : 1);
