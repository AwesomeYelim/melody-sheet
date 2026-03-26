"""
Expo 웹 빌드 후 index.html에 VexFlow 스크립트 태그를 자동 삽입합니다.
빌드할 때마다 실행: python patch_index.py
"""
import re, os

INDEX = os.path.join(os.path.dirname(__file__), "app", "dist", "index.html")

with open(INDEX, "r", encoding="utf-8") as f:
    html = f.read()

# 이미 패치된 경우 스킵
if "/vexflow-bravura.js" in html:
    print("이미 패치되어 있습니다.")
    exit(0)

FONT_CAPTURE = """    <script>
      (function() {
        var _Orig = window.FontFace;
        window.FontFace = function(family, source) {
          if (family === 'Bravura' && typeof source === 'string' && source.startsWith('url(')) {
            window._bravuraFontUrl = source.slice(4, -1).replace(/['"]/g, '');
          }
          return new _Orig(family, source);
        };
        window.FontFace.prototype = _Orig.prototype;
      })();
    </script>
    <script src="/vexflow-bravura.js"></script>"""

# <script src="/_expo/..."> 바로 앞에 삽입
html = re.sub(
    r'(\s*<script src="/_expo/static/js/web/index-[^"]+\.js")',
    FONT_CAPTURE + r'\1',
    html,
)

with open(INDEX, "w", encoding="utf-8") as f:
    f.write(html)

print("패치 완료:", INDEX)
