import sys, json
import pymupdf
for name in ('shapely', 'scipy', 'matplotlib', 'numpy'):
    try:
        m = __import__(name); print(name, m.__version__)
    except Exception as e:
        print(name, 'MISSING', e)
d = pymupdf.open(sys.argv[1]); p = d[0]
print('rect', p.rect)
out = []
for g in p.get_drawings():
    print('drawing', g['type'], 'fill', g.get('fill'), 'color', g.get('color'), 'width', g.get('width'), 'even_odd', g.get('even_odd'), 'items', len(g['items']), 'rect', g['rect'])
    sub, cur = [], []
    for it in g['items']:
        k = it[0]
        if k == 'l':
            a, b = it[1], it[2]
            if not cur or abs(cur[-1][0]-a.x) > 1e-6 or abs(cur[-1][1]-a.y) > 1e-6:
                if cur: sub.append(cur)
                cur = [[a.x, a.y]]
            cur.append([b.x, b.y])
        elif k == 'c':
            a, b, c, e = it[1:5]
            if not cur or abs(cur[-1][0]-a.x) > 1e-6 or abs(cur[-1][1]-a.y) > 1e-6:
                if cur: sub.append(cur)
                cur = [[a.x, a.y]]
            for i in range(1, 5):
                t = i/4; u = 1-t
                cur.append([u**3*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t**3*e.x, u**3*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t**3*e.y])
        elif k == 're':
            if cur: sub.append(cur); cur = []
            r = it[1]; sub.append([[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]])
        elif k == 'qu':
            if cur: sub.append(cur); cur = []
            q = it[1]; sub.append([[q.ul.x,q.ul.y],[q.ur.x,q.ur.y],[q.lr.x,q.lr.y],[q.ll.x,q.ll.y]])
    if cur: sub.append(cur)
    print('  subpaths', len(sub), 'points', sum(len(s) for s in sub))
    out.append({'type': g['type'], 'fill': g.get('fill'), 'even_odd': g.get('even_odd'), 'width': g.get('width'), 'paths': sub})
json.dump({'rect': list(p.rect), 'drawings': out}, open(sys.argv[2], 'w'))
