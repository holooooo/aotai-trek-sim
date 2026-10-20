"""Contact sheet for checking stills: python3 promo/sheet.py out.jpg cols img1 img2 ...  (tiles 360 px wide, labelled)"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
TW = int(os.environ.get("TW", 360))
ims = [Image.open(f).convert("RGB") for f in files]
th = max(int(im.height * TW / im.width) for im in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * TW, rows * th), (0, 0, 0))
font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 20)
d = ImageDraw.Draw(sheet)
for k, (f, im) in enumerate(zip(files, ims)):
    x, y = (k % cols) * TW, (k // cols) * th
    sheet.paste(im.resize((TW, int(im.height * TW / im.width))), (x, y))
    lab = os.path.basename(f).rsplit(".", 1)[0]
    d.rectangle([x, y, x + 12 * len(lab) + 10, y + 28], fill=(0, 0, 0))
    d.text((x + 5, y + 3), lab, fill=(255, 220, 0), font=font)
sheet.save(out, quality=88)
print(out, sheet.size)
