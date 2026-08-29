from pathlib import Path
import re

# Update HTML
p_html = Path("templates/index.html")
html = p_html.read_text()
if 'id="fn-clips"' not in html:
    html = html.replace(
        '</button>\n      </div>\n    </div>\n\n    <div id="clip-list"',
        '</button>\n      </div>\n      <div class="dz-filename" id="fn-clips" style="margin-top:12px; font-family:monospace; color:var(--accent); word-break:break-all;"></div>\n    </div>\n\n    <div id="clip-list"'
    )
    p_html.write_text(html)

# Update JS
p_js = Path("static/app.js")
js = p_js.read_text()

# Add fnClips selector
if 'const fnClips =' not in js:
    js = js.replace('const dzClips = $("dz-clips");', 'const dzClips = $("dz-clips");\nconst fnClips = $("fn-clips");')

# In btnBrowseFolder success
target_success = 'btnBuild.disabled = false;'
if 'fnClips.innerText =' not in js:
    js = js.replace(
        target_success,
        'fnClips.innerText = "📁 " + data.path;\n      ' + target_success
    )

p_js.write_text(js)
print("Updated HTML and JS successfully.")
