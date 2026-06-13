import re
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
lines = content.count('\n')
print(f'Lines: {lines}')
funcs = re.findall(r'function (\w+)\(', content)
print(f'Functions: {len(funcs)}')
