"""
generate_user_guide_pdf.py
Converts USER_GUIDE.md into a beautifully branded, client-ready PDF
with high-resolution screenshots, formatted tables, tip boxes, and
London Gaze styling (Deep Slate #1F2C38, Sky Blue #38BDF8, zero harsh black text).
"""

import os
import re
from pathlib import Path
from fpdf import FPDF

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def sanitize(text):
    text = text.replace('’', "'").replace('‘', "'")
    text = text.replace('“', '"').replace('”', '"')
    text = text.replace('—', ' -- ').replace('–', '-')
    text = text.replace('…', '...').replace('•', '-')
    text = text.replace('⚡', '[RUN]').replace('📁', '[DIR]').replace('🏷️', '[TAG]')
    text = text.replace('⏪', '[REV]').replace('🗑️', '[DEL]').replace('✨', '[AUTO]')
    text = text.replace('⏱️', '[TIME]').replace('🎵', '[AUDIO]').replace('🚀', '[EXPORT]')
    text = text.replace('🤖', '[AI]').replace('🔊', '[SOUND]').replace('🎨', '[GRADE]')
    text = text.replace('🔤', '[TEXT]').replace('▶', '>').replace('◀', '<')
    text = text.replace('⌘', 'Cmd+').replace('⇧', 'Shift+').replace('⌥', 'Option+')
    text = text.replace('⌫', 'Backspace')
    text = re.sub(r'[^\x00-\xff]', '', text)
    return text.strip()

def strip_md(text):
    text = re.sub(r'<kbd>(.*?)</kbd>', r'[\1]', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    text = re.sub(r'`(.*?)`', r'\1', text)
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    return sanitize(text)

class StudioUserGuidePDF(FPDF):
    def __init__(self):
        super().__init__()
        self.set_margins(20, 20, 20)
        self.set_auto_page_break(auto=True, margin=20)
        
        # London Gaze Brand Palette
        self.c_primary = hex_to_rgb("#1F2C38")     # Deep Slate
        self.c_accent = hex_to_rgb("#0284C7")      # Sky / Cyan
        self.c_secondary = hex_to_rgb("#4E6A83")   # Muted Slate
        self.c_text = hex_to_rgb("#273747")        # Charcoal Slate (No pure black!)
        self.c_grey = hex_to_rgb("#8199AE")        # Border / Footnote Grey
        self.c_bg_box = hex_to_rgb("#F4F7F9")      # Light Tint Box Fill

    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "B", 8)
            self.set_text_color(*self.c_secondary)
            self.cell(0, 6, "SWIFT REEL STUDIO  |  COMPLETE USER GUIDE & MASTERCLASS", align="L")
            self.set_font("Helvetica", "", 8)
            self.set_text_color(*self.c_grey)
            self.set_xy(20, 20)
            self.cell(0, 6, f"Page {self.page_no()}", align="R")
            self.ln(7)
            self.set_draw_color(*self.c_accent)
            self.set_line_width(0.3)
            self.line(20, self.get_y(), 190, self.get_y())
            self.ln(8)

    def footer(self):
        if self.page_no() > 1:
            self.set_y(-15)
            self.set_font("Helvetica", "", 8)
            self.set_text_color(*self.c_grey)
            self.cell(0, 5, "CONFIDENTIAL & PROPRIETARY  |  DIGITAL AGENCY AI STUDIO", align="C")

    def cover_page(self):
        self.ln(35)
        
        # Tagline
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*self.c_accent)
        self.cell(0, 6, "CREATOR & VIDEO EDITOR MASTERCLASS", align="L")
        self.ln(10)

        # Main Title
        self.set_font("Helvetica", "B", 28)
        self.set_text_color(*self.c_primary)
        self.cell(0, 12, "Reel Pipeline Studio", align="L")
        self.ln(11)
        self.set_font("Helvetica", "B", 20)
        self.set_text_color(*self.c_secondary)
        self.cell(0, 10, "User Guide & Production Handbook", align="L")
        self.ln(14)

        # Accent Bar
        self.set_draw_color(*self.c_accent)
        self.set_line_width(1.0)
        self.line(20, self.get_y(), 65, self.get_y())
        self.ln(12)

        # Overview Box
        self.set_fill_color(*self.c_bg_box)
        self.set_draw_color(*self.c_grey)
        self.set_line_width(0.2)
        box_y = self.get_y()
        self.rect(20, box_y, 170, 42, "FD")
        
        self.set_xy(25, box_y + 4)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*self.c_primary)
        self.cell(0, 6, "Key Features Covered in this Handbook:", align="L")
        self.ln(6)
        
        self.set_x(25)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*self.c_text)
        features = [
            "- 3-Step Beat-Sync Reel Workflow with Content-Aware CLIP AI",
            "- DaVinci Resolve-Style 1:1 Timeline with 60 FPS CTI Scrubbing",
            "- Pro Lumetri/Resolve Color Grading, 3D LUTs & Dynamic 9:16 Reframe",
            "- Multi-Layer Editing (T1 Text Track, A1 Audio Track & Quick Deletes)",
            "- Zero-Loss DaVinci Resolve & Premiere Pro FCPXML / EDL Export",
        ]
        for f in features:
            self.set_x(27)
            self.cell(0, 5, f, align="L")
            self.ln(5)

        # Metadata at bottom
        self.set_y(-35)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*self.c_primary)
        self.cell(0, 5, "Author: London Gaze AI Engineering Team", align="L")
        self.ln(5)
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(*self.c_grey)
        self.cell(0, 5, "Version: 2.5 (October 2026)  |  macOS Apple Silicon & Intel", align="L")
        self.add_page()

    def add_h1(self, text):
        self.ln(6)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(*self.c_primary)
        self.multi_cell(0, 8, sanitize(text))
        
        self.set_draw_color(*self.c_accent)
        self.set_line_width(0.5)
        y = self.get_y() + 1
        self.line(20, y, 55, y)
        self.ln(6)

    def add_h2(self, text):
        self.ln(4)
        self.set_font("Helvetica", "B", 12)
        self.set_text_color(*self.c_primary)
        self.multi_cell(0, 7, sanitize(text))
        self.ln(2)

    def add_h3(self, text):
        self.ln(3)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*self.c_accent)
        self.multi_cell(0, 6, sanitize(text))
        self.ln(1)

    def add_body(self, text):
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*self.c_text)
        self.multi_cell(0, 5.5, strip_md(text))
        self.ln(2)

    def add_bullet(self, text):
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*self.c_text)
        self.set_x(25)
        self.cell(5, 5.5, "-")
        self.multi_cell(0, 5.5, strip_md(text))
        self.ln(1)

    def add_tip(self, text):
        self.ln(3)
        self.set_fill_color(*self.c_bg_box)
        self.set_draw_color(*self.c_accent)
        self.set_line_width(0.8)
        
        y0 = self.get_y()
        self.set_font("Helvetica", "I", 9)
        self.set_text_color(*self.c_primary)
        
        # Calculate height
        self.set_x(26)
        self.multi_cell(160, 5.2, "TIP: " + strip_md(text))
        h = self.get_y() - y0
        
        # Draw left accent line
        self.line(22, y0, 22, y0 + h)
        self.ln(3)

    def add_image_figure(self, img_path, caption=""):
        if not os.path.exists(img_path):
            return
        # Check remaining page height (assume img takes ~85mm + margins)
        if self.get_y() + 85 > 270:
            self.add_page()
            
        self.ln(2)
        img_w = 170
        self.image(img_path, x=20, y=self.get_y(), w=img_w)
        self.set_y(self.get_y() + 88)
        
        if caption:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(*self.c_secondary)
            self.cell(0, 4, sanitize(caption), align="C")
            self.ln(5)

    def add_table(self, rows):
        if not rows:
            return
        num_cols = len(rows[0])
        if num_cols == 3:
            col_widths = [35, 45, 90]
        elif num_cols == 2:
            col_widths = [50, 120]
        else:
            col_widths = [170 // num_cols] * num_cols

        # Check page break
        if self.get_y() + (len(rows) * 7) > 265:
            self.add_page()

        for r_idx, row in enumerate(rows):
            is_header = (r_idx == 0)
            self.set_font("Helvetica", "B" if is_header else "", 8.5)
            self.set_text_color(*(self.c_primary if is_header else self.c_text))
            
            if is_header:
                self.set_fill_color(*self.c_bg_box)
                self.set_draw_color(*self.c_accent)
                self.set_line_width(0.4)
            else:
                self.set_draw_color(*self.c_grey)
                self.set_line_width(0.1)

            x_start = 20
            y_curr = self.get_y()
            max_h = 7

            for c_idx, cell in enumerate(row):
                w = col_widths[c_idx]
                txt = strip_md(str(cell))
                self.set_xy(x_start, y_curr)
                self.multi_cell(w, max_h, txt, border=1 if is_header else "B", fill=is_header)
                x_start += w

            self.set_xy(20, y_curr + max_h)
        self.ln(4)

def build_pdf_from_markdown(md_file_path, output_pdf_path):
    pdf = StudioUserGuidePDF()
    pdf.add_page()
    pdf.cover_page()

    with open(md_file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    in_table = False
    table_rows = []
    i = 0
    base_dir = Path(md_file_path).parent

    while i < len(lines):
        line = lines[i].rstrip("\n")
        stripped = line.strip()

        # Handle table rows
        if "|" in stripped and stripped.count("|") >= 2:
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            # Ignore separator line |:---|:---|
            if all(re.match(r"^[-:]+$", c.replace(" ", "")) for c in cells if c):
                i += 1
                continue
            table_rows.append(cells)
            in_table = True
            i += 1
            continue
        else:
            if in_table:
                pdf.add_table(table_rows)
                table_rows = []
                in_table = False

        if not stripped:
            i += 1
            continue

        # Ignore Table of Contents block
        if stripped.startswith("## Table of Contents") or stripped.startswith("1. [The Studio Interface"):
            i += 1
            continue
        if re.match(r"^\d+\.\s*\[.*?\]\(#.*?\)", stripped):
            i += 1
            continue

        # Images
        img_match = re.search(r"!\[(.*?)\]\((.*?)\)", stripped)
        if img_match:
            caption = img_match.group(1)
            img_rel = img_match.group(2)
            img_full = str((base_dir / img_rel).resolve())
            pdf.add_image_figure(img_full, caption)
            i += 1
            continue

        # Headers
        if stripped.startswith("# "):
            # H1
            pdf.add_h1(stripped[2:])
        elif stripped.startswith("## "):
            pdf.add_h2(stripped[3:])
        elif stripped.startswith("### "):
            pdf.add_h3(stripped[4:])
        elif stripped.startswith("> "):
            pdf.add_tip(stripped[2:])
        elif stripped.startswith("- ") or stripped.startswith("* "):
            pdf.add_bullet(stripped[2:])
        elif re.match(r"^\d+\.\s", stripped):
            pdf.add_bullet(re.sub(r"^\d+\.\s*", "", stripped))
        elif stripped == "---":
            pdf.ln(2)
            pdf.set_draw_color(*pdf.c_grey)
            pdf.set_line_width(0.1)
            pdf.line(20, pdf.get_y(), 190, pdf.get_y())
            pdf.ln(3)
        else:
            pdf.add_body(stripped)

        i += 1

    if in_table and table_rows:
        pdf.add_table(table_rows)

    pdf.output(output_pdf_path)
    print(f"Generated PDF: {output_pdf_path}")

if __name__ == "__main__":
    md_path = "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline/USER_GUIDE.md"
    out_pdf = "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline/USER_GUIDE.pdf"
    build_pdf_from_markdown(md_path, out_pdf)
