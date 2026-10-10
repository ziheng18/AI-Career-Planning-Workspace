/*!
 * 测试/PDF取文.cjs — 从导出的 PDF 里把文字真正解出来（开发期核查用）
 *
 * 为什么需要它：PDF 里的中文是「字形编号 + ToUnicode 映射」，直接 grep 字节流
 * 是搜不到中文的。要确认"某个章节到底有没有进 PDF"，只能把文本解码出来看。
 *
 * 用法：node 测试/PDF取文.cjs [页码]
 */
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var file = process.argv[3] || path.join(ROOT, '输出', '报告预览.pdf');
var only = process.argv[2] ? Number(process.argv[2]) : 0;

var buf = fs.readFileSync(file);
var s = buf.toString('latin1');

/** 取某个间接对象（N 0 obj ... endobj）的内容 */
function obj(n) {
  var re = new RegExp('(?:^|[^0-9])' + n + '\\s+0\\s+obj\\b([\\s\\S]*?)endobj');
  var m = s.match(re);
  return m ? m[1] : null;
}

/** 反复解压，直到拿到内容流（PDF 支持多级 Flate） */
function inflateBody(body) {
  var i = body.indexOf('stream');
  if (i < 0) return '';
  var start = i + 'stream'.length;
  if (body[start] === '\r') start++;
  if (body[start] === '\n') start++;
  var end = body.indexOf('endstream', start);
  var raw = Buffer.from(body.slice(start, end), 'latin1');
  var out = raw;
  for (var k = 0; k < 3; k++) {
    try { out = zlib.inflateSync(out); } catch (e) { break; }
  }
  return out.toString('latin1');
}

function flatObj(n) {
  var b = obj(n);
  if (!b) return '';
  if (b.indexOf('/FlateDecode') >= 0) return inflateBody(b);
  return b;
}

/* ---------------- ToUnicode：字形编号 → Unicode ---------------- */
function cmapFor(fontObjNum) {
  var body = obj(fontObjNum);
  if (!body) return null;
  var m = body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
  if (!m) return null;
  var t = flatObj(Number(m[1]));
  if (!t) return null;

  var map = Object.create(null);
  // 形如： <0003> <4E2D>  或  <0003> <4E2D 6587>
  var re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, x;
  while ((x = re.exec(t)) !== null) {
    var from = parseInt(x[1], 16);
    var hex = x[2];
    var str = '';
    for (var i = 0; i + 4 <= hex.length; i += 4) {
      str += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    }
    map[from] = str;
  }
  // bfrange： <00> <7F> <4E00>
  var re2 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, y;
  while ((y = re2.exec(t)) !== null) {
    var lo = parseInt(y[1], 16), hi = parseInt(y[2], 16), to = parseInt(y[3], 16);
    for (var j = lo; j <= hi && j - lo < 512; j++) {
      if (map[j] === undefined) map[j] = String.fromCharCode(to + (j - lo));
    }
  }
  return map;
}

/* ---------------- 页面对象（按顺序，去重） ---------------- */
// 注意：/Type /Page 不能简单匹配 —— /Type /Pages 也会命中，
// 而且从同一个出现位置向前找 "N 0 obj" 可能两次落在同一个对象上，
// 那会造出"两页内容一模一样"的假象。
var pageNums = [];
var pre = /\/Type\s*\/Page(?![s])/g, pm;
while ((pm = pre.exec(s)) !== null) {
  var back = s.slice(Math.max(0, pm.index - 400), pm.index);
  var om = back.match(/(\d+)\s+0\s+obj[^]*$/);
  if (om) {
    var n = Number(om[1]);
    if (pageNums.indexOf(n) < 0) pageNums.push(n);
  }
}
// 按对象号排序（PDF 里页对象不一定按页序排列，但本工具生成的文档是顺序的）
pageNums.sort(function (a, b) { return a - b; });

console.log('页面对象: ' + pageNums.length + ' 页');

pageNums.forEach(function (pn, idx) {
  if (only && idx + 1 !== only) return;
  var body = obj(pn);
  if (!body) return;

  // 收集本页字体： /Font << /F1 12 0 R ... >>
  var fonts = {};
  var fm = body.match(/\/Font\s*<<([\s\S]*?)>>/);
  if (fm) {
    var fr = /\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g, f;
    while ((f = fr.exec(fm[1])) !== null) {
      var cm = cmapFor(Number(f[2]));
      if (cm) fonts[f[1]] = cm;
    }
  }
  // 字体也可能来自共享资源字典
  if (!Object.keys(fonts).length) {
    var all = body.match(/\/Font\s+(\d+)\s+0\s+R/);
    if (all) {
      var dict = obj(Number(all[1])) || '';
      var fr2 = /\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g, f2;
      while ((f2 = fr2.exec(dict)) !== null) {
        var cm2 = cmapFor(Number(f2[2]));
        if (cm2) fonts[f2[1]] = cm2;
      }
    }
  }

  var content = body.indexOf('/FlateDecode') >= 0 ? inflateBody(body) : '';
  if (!content) {
    // 内容可能单独放在一个流对象里： /Contents N 0 R
    var c = body.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (c) content = flatObj(Number(c[1]));
  }
  if (!content) return;

  // 解码：跟踪 Tf 切换字体，把 <hex> Tj / [<hex> ...] TJ 还原成文字
  var out = [];
  var cur = null;
  var re = /\/([A-Za-z0-9]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]+)>\s*Tj|\[([^\]]*)\]\s*TJ/g, m;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) { cur = fonts[m[1]] || null; continue; }
    var hexes = [];
    if (m[2]) hexes = [m[2]];
    else if (m[3]) {
      var hx = m[3].match(/<([0-9A-Fa-f\s]+)>/g) || [];
      hexes = hx.map(function (x) { return x.replace(/[<>\s]/g, ''); });
    }
    hexes.forEach(function (h) {
      h = h.replace(/\s/g, '');
      for (var i = 0; i + 4 <= h.length; i += 4) {
        var code = parseInt(h.substr(i, 4), 16);
        out.push(cur && cur[code] !== undefined ? cur[code] : '');
      }
    });
  }

  var text = out.join('').replace(/\s+/g, ' ').trim();
  console.log('\n===== 第 ' + (idx + 1) + ' 页 =====');
  console.log(text.slice(0, 1200));
});
