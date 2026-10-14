# -*- coding: utf-8 -*-
"""
============================================================
OPTIONEXT · 页面清单生成器
------------------------------------------------------------
收集站点根目录及一级子目录下的全部 .html，整份打包进
components/page-manifest.js（挂在 window.__OPTIONEXT_PAGE_MANIFEST__）。

为什么需要它：
    双击 HTML 以 file:// 直开时，浏览器安全策略禁止页面 fetch /
    XHR 读取其他本地文件，软导航（page-transit.js）拿不到目标页
    内容，只能退化成整页硬跳转——页眉随之重建。
    <script src> 加载本地 JS 不受此限制，所以把各页 HTML 预先
    收进一份 JS 清单，file:// 下软导航直接从清单取内容换 <main>，
    页眉全程保活。

什么时候要重跑：
    页面内容（任何 .html）改动后、新增/删除页面后，重跑一次：
        python tools/build_manifest.py
    （或在资源管理器里双击本脚本）
    http(s) 环境（含 GitHub Pages）永远优先实时 fetch，
    清单只在 fetch 失败时兜底，清单陈旧不影响线上正常浏览。
============================================================
"""
import io
import os
import re
import json
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'components', 'page-manifest.js')


def collect_pages():
    """站点根 *.html + 一级子目录 */*.html；跳过 __ 开头的临时文件。"""
    pages = {}
    for name in sorted(os.listdir(ROOT)):
        p = os.path.join(ROOT, name)
        if os.path.isfile(p) and name.endswith('.html') and not name.startswith('__'):
            pages[name] = p
    for sub in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, sub)
        if not os.path.isdir(d) or sub.startswith(('.', '_', '__')):
            continue
        if sub in ('tools',):
            continue
        for name in sorted(os.listdir(d)):
            if name.endswith('.html') and not name.startswith('__'):
                rel = sub + '/' + name
                pages[rel] = os.path.join(d, name)
    return pages


def js_single_quoted(text):
    """把任意文本安全嵌入 JS 单引号字符串（外层 HTML 为 <script>）。

    一次扫描完成全部替换，避免后引入的反斜杠被二次转义：
      \\        -> \\\\      反斜杠
      '         -> \\'       单引号定界
      </        -> <\\/      打断 </script> 闭合序列（\\/ 在 JS 中等于 /）
      U+2028/29 -> \\u2028/9 行分隔符在 JS 字符串字面量中非法
    输入先经 json.dumps（\\n、\" 等 JSON 转义已生成），JS 解一层、
    JSON.parse 再解一层，两层后内容与原文件逐字节一致。
    """
    ls, ps = chr(0x2028), chr(0x2029)
    table = {
        '\\': '\\\\',
        "'": "\\'",
        '</': '<\\/',
        ls: '\\u2028',
        ps: '\\u2029',
    }
    return re.sub(r"\\|'|</|[" + ls + ps + "]", lambda m: table[m.group(0)], text)


def main():
    pages = collect_pages()
    payload = json.dumps(
        {
            'v': datetime.date.today().strftime('%Y%m%d'),
            'pages': {
                rel: io.open(path, encoding='utf-8').read()
                for rel, path in sorted(pages.items())
            },
        },
        ensure_ascii=False,
        separators=(',', ':'),
    )

    content = (
        '/* ============================================================\n'
        '   OPTIONEXT · 页面清单（自动生成，请勿手改）\n'
        '   由 tools/build_manifest.py 收集全部 .html 打包而成。\n'
        '   用途：file:// 直开时供软导航取页内容（浏览器禁止 fetch\n'
        '   本地文件）；http(s) 下仅在 fetch 失败时兜底。\n'
        '   页面改动后请重跑：python tools/build_manifest.py\n'
        '   ============================================================ */\n'
        "window.__OPTIONEXT_PAGE_MANIFEST__ = JSON.parse('"
        + js_single_quoted(payload)
        + "');\n"
    )

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(content)
    total = sum(len(v) for v in pages.values())
    print('page-manifest.js 已生成：%d 个页面，源文件合计 %d 字节' % (len(pages), total))
    for rel in sorted(pages):
        print('  + ' + rel)
    try:
        input('完成，按回车关闭……')
    except EOFError:
        pass


if __name__ == '__main__':
    main()
