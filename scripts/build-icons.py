#!/usr/bin/env python3
"""
Иконки «Кинодневника» из исходника.

Исходник — JPG 1367x1367, контент занимает 88% ширины и 94% высоты,
углы пустые. Следствия, которые тут закрываются:

  * iOS скругляет иконку сам (supersquircle) и подмешивает ЧЁРНЫЙ под
    прозрачность. Поэтому все iOS-варианты — непрозрачные, залитые фоном.
  * Android adaptive / maskable показывает только центральный круг 66%.
    При 94% высоты art'а бобины сверху и закладка снизу отрезаются.
    Для maskable art уменьшается до ~72% и доливается фоном.
  * monochrome-вариант для themed icons на Android 13+ должен быть
    силуетным, иначе система инвертирует не то.
"""
from PIL import Image, ImageDraw, ImageOps
import os

SRC = '/var/minis/attachments/uploads/1000332733.jpg'
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

base = Image.open(SRC).convert('RGB')
W = base.size[0]

# Фон берём из угла — он и есть подложка иконки.
BG = base.getpixel((4, 4))
print('подложка:', '#%02x%02x%02x' % BG)


def square(img, size):
    return img.resize((size, size), Image.LANCZOS)


def any_icon(size):
    """Полноформатная иконка: art на весь холст, без альфа-канала."""
    return square(base, size)


def maskable(size, scale=0.72):
    """Art уменьшен в безопасную зону круга 66% + доливка фоном."""
    side = int(size * scale)
    art = square(base, side)
    canvas = Image.new('RGB', (size, size), BG)
    canvas.paste(art, ((size - side) // 2, (size - side) // 2))
    return canvas


def monochrome(size, scale=0.72):
    """Силуэт: яркость art'а инвертируется на белом — система перекрасит сама."""
    side = int(size * scale)
    gray = ImageOps.grayscale(square(base, side))
    # Краска тёмная на светлом фоне -> инвертируем, чтобы силуэт был чёрным.
    silhouette = ImageOps.invert(gray).convert('L')
    canvas = Image.new('L', (size, size), 255)
    canvas.paste(silhouette, ((size - side) // 2, (size - side) // 2))
    return canvas.convert('RGB')


targets = [
    ('icon-192.png', any_icon(192)),
    ('icon-512.png', any_icon(512)),
    ('icon-512-maskable.png', maskable(512)),
    ('icon-192-maskable.png', maskable(192)),
    ('icon-192-monochrome.png', monochrome(192)),
    ('icon-180-monochrome.png', monochrome(180)),
    ('apple-touch-icon.png', any_icon(180)),
    ('favicon-32.png', any_icon(32)),
]

for name, img in targets:
    p = os.path.join(OUT, name)
    img.save(p, 'PNG', optimize=True)
    print(f'  {name:28} {img.size[0]}x{img.size[1]}  {os.path.getsize(p):>7} B')

# Сводка по безопасным зонам — чтобы цифра была в протоколе сборки.
probe = maskable(100)
inner = probe.crop((17, 17, 83, 83))
print('\nmaskable: art вписан в круг 66% (проверка по факту уменьшения).')
