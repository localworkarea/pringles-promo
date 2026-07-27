/**
 * Розпакування локального .fig (Figma) без API та без токена.
 *
 *   node tools/figma/decode.mjs ["pringles LOC.fig"]
 *
 * Формат: ZIP -> canvas.fig (контейнер "fig-kiwi") -> два чанки:
 *   чанк 0 = kiwi-схема (raw deflate)
 *   чанк 1 = дані (zstd; у старих версіях raw deflate)
 * Далі дані декодуються за схемою (kiwi) у повідомлення `Message`.
 *
 * Результат:
 *   design/figma.json — нормалізоване дерево нод
 *   design/SPEC.md    — дайджест макета (екрани, палітра, шрифти, тексти)
 *
 * Обидва файли ГЕНЕРУЮТЬСЯ — правити руками немає сенсу, при новому .fig
 * вони перезапишуться. Ручні нотатки та висновки тримаємо в CLAUDE.md.
 */

import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

// ---------------------------------------------------------------------------
// ZIP: читання через центральний каталог (локальні заголовки тут без розмірів)
// ---------------------------------------------------------------------------

function readZip(buf) {
	let eocd = -1
	for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
	}
	if (eocd < 0) throw new Error('ZIP: не знайдено End of Central Directory')

	const total = buf.readUInt16LE(eocd + 10)
	let off = buf.readUInt32LE(eocd + 16)
	const files = new Map()

	for (let i = 0; i < total; i++) {
		if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('ZIP: пошкоджений центральний каталог')
		const method = buf.readUInt16LE(off + 10)
		const compSize = buf.readUInt32LE(off + 20)
		const nameLen = buf.readUInt16LE(off + 28)
		const extraLen = buf.readUInt16LE(off + 30)
		const commentLen = buf.readUInt16LE(off + 32)
		const localOff = buf.readUInt32LE(off + 42)
		const name = buf.toString('utf8', off + 46, off + 46 + nameLen)

		const lNameLen = buf.readUInt16LE(localOff + 26)
		const lExtraLen = buf.readUInt16LE(localOff + 28)
		const start = localOff + 30 + lNameLen + lExtraLen
		const raw = buf.subarray(start, start + compSize)
		files.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw)

		off += 46 + nameLen + extraLen + commentLen
	}
	return files
}

// ---------------------------------------------------------------------------
// fig-kiwi: розбір контейнера на чанки
// ---------------------------------------------------------------------------

function readFigChunks(buf) {
	if (buf.toString('latin1', 0, 8) !== 'fig-kiwi') throw new Error('canvas.fig: не fig-kiwi')
	const version = buf.readUInt32LE(8)
	const chunks = []
	let off = 12
	while (off + 4 <= buf.length) {
		const len = buf.readUInt32LE(off); off += 4
		if (len === 0 || off + len > buf.length) break
		const raw = buf.subarray(off, off + len); off += len
		chunks.push(decompress(raw))
	}
	return { version, chunks }
}

function decompress(raw) {
	// zstd (магія 28 b5 2f fd) — сучасні версії, deflate — старі
	if (raw.length > 4 && raw.readUInt32LE(0) === 0xfd2fb528) return zlib.zstdDecompressSync(raw)
	try { return zlib.inflateRawSync(raw) } catch { }
	try { return zlib.inflateSync(raw) } catch { }
	return raw
}

// ---------------------------------------------------------------------------
// kiwi: схема + декодер повідомлень
// ---------------------------------------------------------------------------

class ByteBuffer {
	constructor(buf) { this.buf = buf; this.i = 0 }
	byte() { return this.buf[this.i++] }
	bool() { return !!this.buf[this.i++] }
	varuint() {
		let value = 0, shift = 0, b
		do { b = this.buf[this.i++]; value |= (b & 127) << shift; shift += 7 } while (b & 128 && shift < 35)
		return value >>> 0
	}
	varint() { const v = this.varuint(); return (v & 1) ? ~(v >>> 1) : (v >>> 1) }
	varuint64() {
		let value = 0n, shift = 0n, b
		do { b = this.buf[this.i++]; value |= BigInt(b & 127) << shift; shift += 7n } while (b & 128 && shift < 56n)
		return value
	}
	varint64() { const v = this.varuint64(); return (v & 1n) ? ~(v >> 1n) : (v >> 1n) }
	// Нестандартний float: 0 у першому байті = 0.0, інакше 4 байти з ротацією
	float() {
		if (this.buf[this.i] === 0) { this.i++; return 0 }
		let bits = this.buf[this.i] | (this.buf[this.i + 1] << 8) | (this.buf[this.i + 2] << 16) | (this.buf[this.i + 3] << 24)
		this.i += 4
		bits = ((bits << 23) | (bits >>> 9)) >>> 0
		const b = Buffer.alloc(4); b.writeUInt32LE(bits); return b.readFloatLE()
	}
	string() {
		const start = this.i
		while (this.buf[this.i] !== 0) this.i++
		const s = this.buf.toString('utf8', start, this.i)
		this.i++; return s
	}
}

const PRIMITIVES = ['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64']
const KIND_ENUM = 0, KIND_STRUCT = 1

function parseSchema(buf) {
	const bb = new ByteBuffer(buf)
	const count = bb.varuint()
	const defs = []
	for (let i = 0; i < count; i++) {
		const name = bb.string()
		const kind = bb.byte()
		const fieldCount = bb.varuint()
		const fields = []
		for (let j = 0; j < fieldCount; j++) {
			fields.push({ name: bb.string(), type: bb.varint(), isArray: !!(bb.byte() & 1), value: bb.varuint() })
		}
		defs.push({ name, kind, fields })
	}
	return defs
}

function decodeMessage(defs, buf, rootName) {
	const index = new Map(defs.map((d, i) => [d.name, i]))

	function readValue(bb, type) {
		if (type >= 0) return readDef(bb, type)
		switch (PRIMITIVES[-type - 1]) {
			case 'bool': return bb.bool()
			case 'byte': return bb.byte()
			case 'int': return bb.varint()
			case 'uint': return bb.varuint()
			case 'float': return bb.float()
			case 'string': return bb.string()
			case 'int64': return Number(bb.varint64())
			case 'uint64': return Number(bb.varuint64())
		}
	}
	function readField(bb, field) {
		if (!field.isArray) return readValue(bb, field.type)
		const n = bb.varuint()
		const arr = new Array(n)
		for (let i = 0; i < n; i++) arr[i] = readValue(bb, field.type)
		return arr
	}
	function readDef(bb, defIndex) {
		const def = defs[defIndex]
		if (def.kind === KIND_ENUM) {
			const v = bb.varuint()
			const f = def.fields.find(f => f.value === v)
			return f ? f.name : v
		}
		const obj = {}
		if (def.kind === KIND_STRUCT) {
			for (const f of def.fields) obj[f.name] = readField(bb, f)
			return obj
		}
		for (;;) {
			const id = bb.varuint()
			if (id === 0) return obj
			const f = def.fields.find(f => f.value === id)
			if (!f) throw new Error(`kiwi: невідоме поле ${id} у ${def.name}`)
			obj[f.name] = readField(bb, f)
		}
	}
	return readDef(new ByteBuffer(buf), index.get(rootName))
}

// ---------------------------------------------------------------------------
// Геометрія: команди контуру (змінна довжина)
//   0 = END, 1 = MOVE(x,y), 2 = LINE(x,y), 3 = ?(4 float), 4 = CUBIC(6 float)
// Частина складного декору не парситься — для верстки вона й не потрібна.
// ---------------------------------------------------------------------------

const OP_ARGS = { 0: 0, 1: 2, 2: 2, 3: 4, 4: 6, 5: 0 }
const OP_NAME = { 0: 'end', 1: 'M', 2: 'L', 3: 'Q', 4: 'C', 5: 'Z' }

function parsePath(bytes) {
	const b = Buffer.from(bytes)
	const out = []
	let p = 0
	while (p < b.length) {
		const op = b[p]
		if (!(op in OP_ARGS)) return null
		const n = OP_ARGS[op]
		if (p + 1 + n * 4 > b.length) return null
		const coords = []
		for (let i = 0; i < n; i++) coords.push(round(b.readFloatLE(p + 1 + i * 4)))
		out.push(OP_NAME[op] + (coords.length ? ' ' + coords.join(' ') : ''))
		p += 1 + n * 4
		if (op === 0) break
	}
	return p === b.length ? out : null
}

// ---------------------------------------------------------------------------
// Нормалізація дерева
// ---------------------------------------------------------------------------

const round = n => Math.round(n * 100) / 100
const guidKey = g => `${g.sessionID}:${g.localID}`

/**
 * Серіалізація з інлайном коротких значень: `"size": [1440, 100]` замість
 * чотирьох рядків. Дерево лишається grep-friendly, але втричі компактніше.
 */
function pretty(value, indent = '') {
	const compact = JSON.stringify(value)
	if (value === null || typeof value !== 'object' || compact.length <= 100) return compact
	const pad = indent + ' '
	if (Array.isArray(value)) return `[\n${value.map(v => pad + pretty(v, pad)).join(',\n')}\n${indent}]`
	return `{\n${Object.entries(value).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pretty(v, pad)}`).join(',\n')}\n${indent}}`
}

function toHex(c) {
	const h = [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
	return c.a < 1 ? `#${h}${Math.round(c.a * 255).toString(16).padStart(2, '0')}` : `#${h}`
}

function normalizePaint(p) {
	if (p.visible === false) return null
	if (p.type === 'SOLID') return p.opacity < 1 ? `${toHex(p.color)} @${round(p.opacity)}` : toHex(p.color)
	if (p.type === 'IMAGE') return { image: Buffer.from(Object.values(p.image?.hash || {})).toString('hex') }
	if (String(p.type).includes('GRADIENT')) {
		return { gradient: p.type, stops: (p.stops || []).map(s => `${toHex(s.color)} ${Math.round(s.position * 100)}%`) }
	}
	return { paint: p.type }
}

function normalize(node, blobs) {
	const out = { name: node.name, type: node.type }

	if (node.size) out.size = [round(node.size.x), round(node.size.y)]
	if (node.transform) out.xy = [round(node.transform.m02), round(node.transform.m12)]
	if (node.visible === false) out.hidden = true
	if (node.opacity !== undefined && node.opacity < 1) out.opacity = round(node.opacity)

	const fills = (node.fillPaints || []).map(normalizePaint).filter(Boolean)
	if (fills.length) out.fill = fills
	const strokes = (node.strokePaints || []).map(normalizePaint).filter(Boolean)
	if (strokes.length) { out.stroke = strokes; out.strokeWeight = node.strokeWeight }

	if (node.cornerRadius) out.radius = node.cornerRadius
	const corners = ['rectangleTopLeftCornerRadius', 'rectangleTopRightCornerRadius', 'rectangleBottomRightCornerRadius', 'rectangleBottomLeftCornerRadius']
	if (corners.some(c => node[c])) out.radiusCorners = corners.map(c => node[c] || 0)

	if (node.stackMode && node.stackMode !== 'NONE') {
		out.layout = {
			dir: node.stackMode,
			gap: node.stackSpacing || 0,
			padding: [node.stackVerticalPadding || 0, node.stackHorizontalPadding || 0],
		}
		if (node.stackPrimaryAlignItems) out.layout.main = node.stackPrimaryAlignItems
		if (node.stackCounterAlignItems) out.layout.cross = node.stackCounterAlignItems
	}
	if (node.layoutGrids?.length) {
		out.grid = node.layoutGrids.map(g => ({ axis: g.axis, cols: g.numSections, offset: g.offset, gutter: g.gutterSize }))
	}

	if (node.type === 'TEXT' && node.textData) {
		out.text = node.textData.characters
		out.font = {
			family: node.fontName?.family,
			style: node.fontName?.style,
			size: node.fontSize,
			lineHeight: node.lineHeight?.units === 'PERCENT' ? `${node.lineHeight.value}%` : round(node.lineHeight?.value ?? 0),
		}
		if (node.letterSpacing?.value) out.font.letterSpacing = node.letterSpacing.value
		if (node.textCase) out.font.case = node.textCase
		if (node.textAlignHorizontal) out.font.align = node.textAlignHorizontal
		if (node.textDecoration) out.font.decoration = node.textDecoration
	}

	// Контур фігури — саме звідси беруться неочевидні форми (клин, скоси)
	const blobId = node.fillGeometry?.[0]?.commandsBlob
	if (blobId !== undefined && blobs[blobId]) {
		const cmds = parsePath(blobs[blobId].bytes)
		if (cmds && cmds.length <= 14) out.path = cmds.filter(c => c !== 'end').join(' ')
		else if (cmds) out.path = `${cmds.length} commands (omitted)`
		else out.path = 'unparsed'
	}

	if (node._children.length) out.children = node._children.map(c => normalize(c, blobs))
	return out
}

// ---------------------------------------------------------------------------
// SPEC.md
// ---------------------------------------------------------------------------

function buildSpec(meta, screens, all, images) {
	const L = []
	const push = (...s) => L.push(...s)

	push('<!-- ЗГЕНЕРОВАНО tools/figma/decode.mjs — не правити руками -->')
	push(`# Макет «${meta.file_name}» — спека`, '')
	const canvasBox = meta.client_meta?.render_coordinates
	push(`Експорт із Figma: ${meta.exported_at}. Нод: ${all.length}.${canvasBox ? ` Полотно: ${Math.round(canvasBox.width)}×${Math.round(canvasBox.height)}.` : ''}`, '')
	push('Повне дерево з усіма розмірами й контурами — `design/figma.json`. Тут — витяг.', '')

	push('## Екрани', '')
	push('| # | Назва | Розмір | Позиція на полотні |', '|---|---|---|---|')
	screens.forEach((s, i) => push(`| ${i} | ${s.name} | ${Math.round(s.size.x)}×${Math.round(s.size.y)} | ${Math.round(s.transform.m02)}, ${Math.round(s.transform.m12)} |`))
	push('')

	// Палітра
	const colors = {}, gradients = new Set()
	for (const n of all) {
		for (const p of (n.fillPaints || [])) {
			if (p.visible === false) continue
			if (p.type === 'SOLID') { const h = toHex(p.color); colors[h] = (colors[h] || 0) + 1 }
			else if (String(p.type).includes('GRADIENT')) {
				gradients.add(`${p.type}: ${(p.stops || []).map(s => `${toHex(s.color)} ${Math.round(s.position * 100)}%`).join(', ')}`)
			}
		}
	}
	push('## Палітра', '')
	push('| Колір | Використань |', '|---|---|')
	Object.entries(colors).sort((a, b) => b[1] - a[1]).forEach(([h, c]) => push(`| \`${h}\` | ${c} |`))
	push('')
	if (gradients.size) { push('Градієнти:', ''); [...gradients].forEach(g => push(`- \`${g}\``)); push('') }

	// Типографіка
	const styles = {}
	for (const n of all) {
		if (n.type !== 'TEXT') continue
		const lh = n.lineHeight?.units === 'PERCENT' ? `${n.lineHeight.value}%` : round(n.lineHeight?.value ?? 0)
		const key = `${n.fontName?.family} ${n.fontName?.style} | ${n.fontSize}px | lh ${lh} | ${n.textCase || '—'} | ${n.textAlignHorizontal || '—'}`
		styles[key] = (styles[key] || 0) + 1
	}
	push('## Типографіка', '')
	push('| Шрифт | Розмір | Line-height | Case | Align | Використань |', '|---|---|---|---|---|---|')
	Object.entries(styles).sort((a, b) => b[1] - a[1]).forEach(([k, c]) => push(`| ${k.split(' | ').join(' | ')} | ${c} |`))
	push('')

	// Зображення
	push('## Зображення (у .fig, під sha1-іменами)', '')
	push('| Хеш | Розмір файлу | Де використано |', '|---|---|---|')
	for (const [hash, info] of Object.entries(images)) {
		push(`| \`${hash.slice(0, 12)}…\` | ${(info.bytes / 1024).toFixed(0)} КБ | ${info.usedBy.slice(0, 3).join('; ')}${info.usedBy.length > 3 ? ` (+${info.usedBy.length - 3})` : ''} |`)
	}
	push('')

	// Структура екранів
	push('## Структура екранів', '')
	for (const s of screens) {
		push(`### ${s.name} — ${Math.round(s.size.x)}×${Math.round(s.size.y)}`, '', '```')
		outline(s, 0, push)
		push('```', '')
	}
	return L.join('\n')
}

function outline(node, depth, push, maxDepth = 3) {
	if (depth > maxDepth) return
	const pad = '  '.repeat(depth)
	const size = node.size ? `${Math.round(node.size.x)}×${Math.round(node.size.y)}` : ''
	const xy = node.transform ? ` @${Math.round(node.transform.m02)},${Math.round(node.transform.m12)}` : ''
	const fill = (node.fillPaints || []).filter(p => p.visible !== false)
		.map(p => p.type === 'SOLID' ? toHex(p.color) : p.type === 'IMAGE' ? 'img' : 'grad').join(',')
	const layout = node.stackMode && node.stackMode !== 'NONE' ? ` AL:${node.stackMode} gap:${node.stackSpacing || 0}` : ''
	const radius = node.cornerRadius ? ` r${node.cornerRadius}` : ''
	const text = node.type === 'TEXT' && node.textData ? ` "${node.textData.characters.replace(/\n/g, ' / ')}"` : ''
	push(`${pad}[${node.type}] ${node.name} ${size}${xy}${fill ? ' ' + fill : ''}${radius}${layout}${text}`)

	// Довгі серії декоративних векторів згортаємо — вони лише шумлять
	const kids = node._children
	let i = 0
	while (i < kids.length) {
		const k = kids[i]
		if (k.type === 'VECTOR') {
			let j = i
			while (j < kids.length && kids[j].type === 'VECTOR') j++
			if (j - i >= 4) { push(`${'  '.repeat(depth + 1)}[VECTOR ×${j - i}] декор`); i = j; continue }
		}
		outline(k, depth + 1, push, maxDepth)
		i++
	}
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const root = process.cwd()
const figArg = process.argv[2] || fs.readdirSync(root).find(f => f.endsWith('.fig'))
if (!figArg) { console.error('Не знайдено .fig — вкажіть шлях аргументом'); process.exit(1) }

const figPath = path.resolve(root, figArg)
console.log(`Читаю ${path.basename(figPath)}…`)

const zip = readZip(fs.readFileSync(figPath))
const meta = JSON.parse(zip.get('meta.json').toString('utf8'))
const { version, chunks } = readFigChunks(zip.get('canvas.fig'))
console.log(`  fig-kiwi v${version}, чанків: ${chunks.length}`)

const schema = parseSchema(chunks[0])
const message = decodeMessage(schema, chunks[1], 'Message')
const all = message.nodeChanges
console.log(`  нод: ${all.length}, блобів: ${message.blobs.length}`)

// Дерево. Порядок дітей — побайтовим порівнянням position (НЕ localeCompare:
// воно ігнорує пунктуацію і плутає "#" з "#7", ламаючи і z-порядок, і autolayout)
const byGuid = new Map(all.map(n => [guidKey(n.guid), n]))
for (const n of all) n._children = []
for (const n of all) {
	const parent = n.parentIndex?.guid ? byGuid.get(guidKey(n.parentIndex.guid)) : null
	if (parent) parent._children.push(n)
}
for (const n of all) {
	n._children.sort((a, b) => {
		const x = a.parentIndex.position, y = b.parentIndex.position
		return x < y ? -1 : x > y ? 1 : 0
	})
}

const canvas = all.find(n => n.type === 'CANVAS' && n._children.length > 1) || all.find(n => n.type === 'CANVAS')
const screens = canvas._children

// Інвентар зображень
const imageFiles = new Map()
for (const [name, buf] of zip) {
	if (name.startsWith('images/')) imageFiles.set(name.slice(7), buf.length)
}
const images = {}
for (const n of all) {
	for (const p of (n.fillPaints || [])) {
		if (p.type !== 'IMAGE' || !p.image?.hash) continue
		const hash = Buffer.from(Object.values(p.image.hash)).toString('hex')
		images[hash] ??= { bytes: imageFiles.get(hash) || 0, usedBy: [] }
		images[hash].usedBy.push(`${n.name} ${n.size ? `${Math.round(n.size.x)}×${Math.round(n.size.y)}` : ''}`.trim())
	}
}

const outDir = path.join(root, 'design')
fs.mkdirSync(outDir, { recursive: true })

const tree = {
	source: path.basename(figPath),
	exportedAt: meta.exported_at,
	figKiwiVersion: version,
	nodes: all.length,
	screens: screens.map(s => normalize(s, message.blobs)),
}
fs.writeFileSync(path.join(outDir, 'figma.json'), pretty(tree))
fs.writeFileSync(path.join(outDir, 'SPEC.md'), buildSpec(meta, screens, all, images))

const kb = f => (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)
console.log(`  → design/figma.json (${kb('figma.json')} КБ)`)
console.log(`  → design/SPEC.md (${kb('SPEC.md')} КБ)`)
