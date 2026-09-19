# -*- coding: utf-8 -*-
"""
生成初音未来主题应用图标(electron-builder 约定 build/icon.ico / icon.png)。
素材:「千年」曲绘(asahi_kuroi),取青发双马尾头部区域;
圆角方形裁切 + 提亮增饱和 + 青色描边。重跑:python scripts/gen-icon-miku.py
"""
from PIL import Image, ImageEnhance, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(os.path.dirname(ROOT), "cand-a.png")  # 原画(临时素材)
OUT = os.path.join(ROOT, "build")
S = 1024
RADIUS = 220
TEAL = (57, 197, 187)


def load_source():
    if os.path.exists(SRC):
        return Image.open(SRC).convert("RGBA")
    # 原画不在时退回已处理的背景图(亮度补偿)
    alt = Image.open(os.path.join(ROOT, "src", "assets", "miku-bg.webp")).convert("RGBA")
    alt = ImageEnhance.Brightness(alt).enhance(1.9)
    return alt


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def main():
    art = load_source()
    # 头部方裁:脸 + 双马尾上段 + 白鸽(原图 2039x1147)
    box = (1080, 0, 1720, 640)
    crop = art.crop(box).resize((S, S), Image.LANCZOS)
    # 图标观感:提亮 + 增饱和
    crop = ImageEnhance.Brightness(crop).enhance(1.08)
    crop = ImageEnhance.Color(crop).enhance(1.28)
    crop = ImageEnhance.Contrast(crop).enhance(1.05)

    # 青色内描边
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(rim)
    for i, alpha in ((0, 230), (3, 140), (6, 70)):
        d.rounded_rectangle([i, i, S - 1 - i, S - 1 - i], radius=RADIUS - i, outline=TEAL + (alpha,), width=2)

    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(crop, (0, 0), rounded_mask(S, RADIUS))
    icon.alpha_composite(rim)
    icon = icon.copy()
    # 描边超出的圆角外区域重新裁掉
    icon.putalpha(Image.composite(icon.split()[3], Image.new("L", (S, S), 0), rounded_mask(S, RADIUS)))

    os.makedirs(OUT, exist_ok=True)
    icon.save(os.path.join(OUT, "icon.png"))
    icon.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "icon-preview.png"))
    icon.resize((256, 256), Image.LANCZOS).save(
        os.path.join(OUT, "icon.ico"),
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)],
    )
    print("icon ->", OUT)


if __name__ == "__main__":
    main()
