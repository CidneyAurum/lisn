# -*- coding: utf-8 -*-
"""
生成 聆 LISN PC 端应用图标(electron-builder 约定路径 build/icon.ico)。
设计:对角 aurora 玻璃底 + 白色玻璃质感双音符 + 左下三段均衡器条。
与安卓端图标同品牌但不同构图。重跑:python scripts/gen-icon.py
"""
from PIL import Image, ImageDraw, ImageFilter
import os

S = 1024
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")

INDIGO = (94, 92, 230)
CYAN = (100, 210, 255)
PINK = (255, 45, 85)
DEEP = (13, 16, 26)
WHITE = (255, 255, 255)


def diagonal_aurora() -> Image.Image:
    """四角插值的对角渐变 + 有机光斑(对角流向:左上靛蓝 → 右下绯红)"""
    base = Image.new("RGB", (2, 2))
    base.putpixel((0, 0), INDIGO)          # 左上:靛蓝
    base.putpixel((1, 0), (26, 70, 105))   # 右上:深青蓝
    base.putpixel((0, 1), (16, 18, 30))    # 左下:深空
    base.putpixel((1, 1), (205, 42, 82))   # 右下:绯红
    bg = base.resize((S, S), Image.BILINEAR).convert("RGBA")

    blob = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(blob)
    d.ellipse([620, 40, 1060, 420], fill=CYAN + (95,))      # 右上青色辉光
    d.ellipse([-80, 300, 420, 760], fill=(125, 123, 255, 110))  # 左中紫罗兰
    d.ellipse([560, 640, 1120, 1120], fill=PINK + (120,))   # 右下粉
    blob = blob.filter(ImageFilter.GaussianBlur(150))
    img = Image.alpha_composite(bg, blob)

    # 对角玻璃光带(两条斜向高光)
    streak = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(streak)
    sd.polygon([(-100, 560), (760, -140), (920, -140), (-100, 720)], fill=(255, 255, 255, 22))
    sd.polygon([(-100, 980), (1120, -60), (1220, 40), (0, 1120)], fill=(255, 255, 255, 14))
    streak = streak.filter(ImageFilter.GaussianBlur(60))
    return Image.alpha_composite(img, streak)


def draw_note() -> Image.Image:
    """白色玻璃双音符(独立层,含投影/辉光/顶部高光)"""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # 音头 / 音杆 / 音梁
    d.ellipse([255, 640, 445, 800], fill=WHITE + (250,))     # 左音头
    d.ellipse([520, 600, 710, 760], fill=WHITE + (250,))     # 右音头
    d.rectangle([378, 270, 424, 745], fill=WHITE + (250,))   # 左杆
    d.rectangle([643, 228, 689, 705], fill=WHITE + (250,))   # 右杆
    d.polygon([(378, 206), (689, 162), (689, 252), (378, 296)], fill=WHITE + (250,))  # 音梁

    # 投影(右下偏移黑色柔影)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.paste(layer, (18, 30), layer)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 90))
    note_alpha = layer.split()[3]
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sh.paste(Image.new("RGBA", (S, S), (0, 0, 0, 110)), (20, 34), note_alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(28))
    layer_full = Image.alpha_composite(sh, layer)

    # 靛蓝辉光(音符轮廓晕染)
    glow_src = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow_src.paste(Image.new("RGBA", (S, S), INDIGO + (150,)), (0, 0), note_alpha)
    glow = glow_src.filter(ImageFilter.GaussianBlur(38))
    return Image.alpha_composite(Image.alpha_composite(glow, layer_full), layer)


def note_top_highlight(note_layer: Image.Image) -> Image.Image:
    """沿音梁顶部的一条柔和高光,强化玻璃质感"""
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(hl)
    d.line([(382, 214), (685, 170)], fill=(255, 255, 255, 230), width=10)
    return hl.filter(ImageFilter.GaussianBlur(5))


def draw_equalizer() -> Image.Image:
    """左下三段均衡器条(青/靛/粉,圆角,带辉光)"""
    bars = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(bars)
    specs = [(118, 700, 58, 220, CYAN), (224, 622, 58, 298, (232, 235, 255)), (330, 790, 58, 130, PINK)]
    for x, top, w, h, color in specs:
        d.rounded_rectangle([x, top, x + w, top + h + 60], radius=30, fill=color + (235,))
    glow = bars.filter(ImageFilter.GaussianBlur(24))
    tinted = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    tinted.paste(Image.new("RGBA", (S, S), (255, 255, 255, 60)), (0, 0), glow.split()[3])
    base = Image.alpha_composite(glow, bars)
    return Image.alpha_composite(base, tinted)


def glass_tile(img: Image.Image) -> Image.Image:
    """圆角方遮罩 + 内侧玻璃描边 + 顶部高光弧"""
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, S, S], radius=225, fill=255)
    tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    tile.paste(img, (0, 0), mask)

    edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle([8, 8, S - 8, S - 8], radius=218, outline=(255, 255, 255, 78), width=6)
    hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.rounded_rectangle([26, 22, S - 26, S - 26], radius=205, outline=(255, 255, 255, 46), width=3)
    tile = Image.alpha_composite(tile, Image.alpha_composite(edge, hi))
    return tile


def main():
    bg = diagonal_aurora()
    note = draw_note()
    note = Image.alpha_composite(note, note_top_highlight(note))
    eq = draw_equalizer()

    full = Image.alpha_composite(Image.alpha_composite(bg, eq), note)
    tile = glass_tile(full)

    os.makedirs(OUT, exist_ok=True)
    # electron-builder Windows 约定:build/icon.ico
    tile.save(os.path.join(OUT, "icon.ico"),
              sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    tile.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "icon.png"), "PNG")
    tile.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "icon-preview.png"), "PNG")
    print("icon.ico / icon.png / icon-preview.png ->", OUT)


if __name__ == "__main__":
    main()
