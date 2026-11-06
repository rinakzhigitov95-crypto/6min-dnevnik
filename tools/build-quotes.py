#!/usr/bin/env python3
"""Собирает app/quotes.js из tools/quotes-source.txt.
Формат строки источника: «текст || автор». Нужно ровно 365 уникальных цитат.
Порядок в quotes.js = календарь (1 января — первая). Перемешивание детерминированное (seed),
чтобы русские и мировые цитаты чередовались, а порядок не менялся от сборки к сборке."""
import json, random, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'tools' / 'quotes-source.txt'
dst = root / 'app' / 'quotes.js'
items, seen = [], set()
norm = lambda t: re.sub(r'[^а-яёa-z0-9]+', '', t.lower().replace('ё', 'е'))[:60]
for line in src.read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if not line or line.startswith('#'): continue
    text, author = [x.strip() for x in line.split('||')]
    k = norm(text)
    if k in seen: sys.exit('дубль: ' + text[:60])
    seen.add(k); items.append({'text': text, 'author': author})
if len(items) != 365: sys.exit(f'нужно 365 цитат, сейчас {len(items)}')
random.Random(2026).shuffle(items)
out = ['// Цитаты дня: 365 штук, по одной на каждый день года (1 января — первая, далее по порядку).',
       '// Файл собирается скриптом tools/build-quotes.py из tools/quotes-source.txt — правь источник, не этот файл.',
       '// Формат: { text: "Текст.", author: "Автор" }',
       'window.QUOTES = [']
out += ['  ' + json.dumps(q, ensure_ascii=False) + ',' for q in items]
out += ['];', '']
dst.write_text('\n'.join(out), encoding='utf-8')
print('quotes.js:', len(items))
